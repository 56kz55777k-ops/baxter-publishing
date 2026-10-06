// @vitest-environment jsdom
/**
 * Slice C — the object operations wired through the real shell, providers,
 * keyboard handler and inspector (contracts #5, #18, #20, #24, #26; C-3, C-4).
 *
 * This is the state half of the LOCKED-MEMBER MATRIX: each operation ×
 * {all unlocked, mixed, all locked} → document effect, history entries, and
 * the selection afterwards. The stage (Konva) and autosave transport are
 * stubbed; everything else is the production code. Autosave follows commits
 * by construction (commit observer, Slice A/B suites) — and the browser layer
 * counts the PUTs on the wire.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  addElement,
  findElement,
  getFormatPreset,
  newEditorDoc,
  newRectElement,
  type EditorDoc,
  type EditorElement,
} from '@baxter/domain';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}));
vi.mock('@/components/editor/SpreadStage', () => ({ SpreadStage: () => null }));
vi.mock('@/components/editor/state/use-autosave', () => ({ useAutosave: () => {} }));

const { EditorShell } = await import('@/components/editor/EditorShell');
const { DocumentProvider, useDocumentState } = await import('@/components/editor/state/document-context');
const { EditorUiProvider, useEditorUi, useEditorUiDispatch } = await import(
  '@/components/editor/state/editor-ui-context'
);

type DocState = ReturnType<typeof useDocumentState>;
type Ui = ReturnType<typeof useEditorUi>;
let doc: DocState;
let ui: Ui;
let uiDispatch: ReturnType<typeof useEditorUiDispatch>;

function Probe() {
  doc = useDocumentState();
  ui = useEditorUi();
  uiDispatch = useEditorUiDispatch();
  return null;
}

const preset = getFormatPreset('zine_a5')!;
let container: HTMLDivElement;
let root: Root;
let A: EditorElement;
let B: EditorElement;

function mount(kind: 'unlocked' | 'mixed' | 'locked') {
  let d: EditorDoc = newEditorDoc(preset);
  const cover = d.pages[0]!.id; // unit 0 is the front cover
  A = { ...newRectElement({ x: 20.05, y: 30 }), locked: kind === 'locked' };
  B = { ...newRectElement({ x: 60, y: 30 }), locked: kind !== 'unlocked', opacity: 0.5 };
  d = addElement(addElement(d, cover, A), cover, B);
  act(() =>
    root.render(
      <DocumentProvider doc={d} revision={1}>
        <EditorUiProvider>
          <EditorShell publication={{ id: 'p', title: 'T' }} />
          <Probe />
        </EditorUiProvider>
      </DocumentProvider>
    )
  );
  act(() => uiDispatch({ type: 'SET_SELECTION', ids: [A.id, B.id] }));
}

function key(k: string, mods: { metaKey?: boolean; shiftKey?: boolean } = {}) {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods });
  act(() => void document.body.dispatchEvent(e));
  return e;
}

const el = (id: string) => findElement(doc.doc, id);
const announcement = () => container.querySelector('[data-testid="editor-announcement"]')!.textContent;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('locked-member matrix — state layer', () => {
  it.each([
    ['unlocked', 1, [20.55, 60.5]],
    ['mixed', 1, [20.55, 60]],
    ['locked', 0, [20.05, 60]],
  ] as const)('nudge → %s: %i entry; locked members stay', (kind, entries, xs) => {
    mount(kind);
    const e = key('ArrowRight');
    expect(e.defaultPrevented).toBe(true);
    expect(doc.history).toHaveLength(entries);
    expect([el(A.id)!.x, el(B.id)!.x]).toEqual(xs);
    expect(ui.selection).toEqual([A.id, B.id]);
  });

  it('nudge: Shift = 5 mm; each press is its own entry (#24)', () => {
    mount('unlocked');
    key('ArrowDown', { shiftKey: true });
    key('ArrowLeft');
    expect(doc.history).toHaveLength(2);
    expect([el(A.id)!.x, el(A.id)!.y]).toEqual([19.55, 35]);
  });

  it.each([
    ['unlocked', 1, [false, false], [], ''],
    ['mixed', 1, [false, true], ['B'], 'Deleted 1 · 1 locked kept'],
    ['locked', 0, [true, true], ['A', 'B'], 'Locked objects are not deleted (2 kept)'],
  ] as const)('delete → %s', (kind, entries, survive, selAfter, said) => {
    mount(kind);
    key('Backspace');
    expect(doc.history).toHaveLength(entries);
    expect([!!el(A.id), !!el(B.id)]).toEqual(survive);
    expect(ui.selection).toEqual(selAfter.map((k) => (k === 'A' ? A.id : B.id)));
    expect(announcement()).toBe(said);
  });

  it('undo of a delete restores the objects AND their selection (#4, #24)', () => {
    mount('unlocked');
    key('Delete');
    expect(el(A.id)).toBeUndefined();
    key('z', { metaKey: true });
    expect(el(A.id)).toBeDefined();
    expect(ui.selection).toEqual([A.id, B.id]);
  });

  it.each([
    ['unlocked', 1, 2],
    ['mixed', 1, 1],
    ['locked', 0, 0],
  ] as const)('duplicate (⌘D) → %s: %i entry, %i copies, copies selected', (kind, entries, copies) => {
    mount(kind);
    const before = doc.doc.pages[0]!.elements.length;
    const e = key('d', { metaKey: true });
    expect(e.defaultPrevented).toBe(true); // no browser bookmark
    expect(doc.history).toHaveLength(entries);
    expect(doc.doc.pages[0]!.elements.length).toBe(before + copies);
    if (copies > 0) expect(ui.selection).toHaveLength(copies);
    else expect(ui.selection).toEqual([A.id, B.id]);
  });

  it.each(['unlocked', 'mixed', 'locked'] as const)('copy + paste → %s: copies every member, pastes unlocked at +5', (kind) => {
    mount(kind);
    key('c', { metaKey: true });
    expect(doc.history).toHaveLength(0); // copying is not an edit
    key('v', { metaKey: true });
    expect(doc.history).toHaveLength(1);
    expect(ui.selection).toHaveLength(2);
    const pasted = ui.selection.map((id) => el(id)!);
    expect(pasted.map((p) => [p.x, p.y, p.locked])).toEqual([
      [25.05, 35, false],
      [65, 35, false],
    ]);
  });

  it.each([
    ['unlocked', 1, 2],
    ['mixed', 1, 1],
    ['locked', 0, 0],
  ] as const)('cut (⌘X) → %s: %i entry, removes %i (unlocked only)', (kind, entries, removed) => {
    mount(kind);
    key('x', { metaKey: true });
    expect(doc.history).toHaveLength(entries);
    expect(2 - [el(A.id), el(B.id)].filter(Boolean).length).toBe(removed);
    key('v', { metaKey: true }); // the clipboard holds every member regardless
    expect(ui.selection).toHaveLength(2);
  });

  it('⌘A selects everything on the current unit, locked included — no history', () => {
    mount('mixed');
    act(() => uiDispatch({ type: 'CLEAR_SELECTION' }));
    const e = key('a', { metaKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(ui.selection).toEqual([A.id, B.id]);
    expect(doc.history).toHaveLength(0);
  });

  it('nothing selected: every operation is a no-op with zero entries', () => {
    mount('unlocked');
    act(() => uiDispatch({ type: 'CLEAR_SELECTION' }));
    for (const [k, m] of [
      ['ArrowUp', {}],
      ['Delete', {}],
      ['d', { metaKey: true }],
      ['x', { metaKey: true }],
      ['v', { metaKey: true }],
    ] as const)
      key(k, m);
    expect(doc.history).toHaveLength(0);
  });
});

describe('multi-object inspector (#5, #18)', () => {
  const header = () => container.querySelector('[data-testid="multi-header"]')?.textContent;
  const opacity = () => container.querySelector('[data-testid="num-opacity"]') as HTMLInputElement | null;

  it('header: N objects · M locked (locked count shown when some, not all, are locked)', () => {
    mount('mixed');
    expect(header()).toBe('2 objects · 1 locked');
  });

  it('all unlocked: no locked count; mixed opacity shows an em dash, never an average', () => {
    mount('unlocked'); // A 100 %, B 50 %
    expect(header()).toBe('2 objects');
    expect(opacity()!.value).toBe('');
    expect(opacity()!.placeholder).toBe('—');
  });

  it('typing an opacity applies to unlocked members only, in ONE entry', () => {
    mount('mixed');
    const f = opacity()!;
    act(() => f.focus());
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(f, '40');
      f.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => void f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(doc.history).toHaveLength(1);
    expect([el(A.id)!.opacity, el(B.id)!.opacity]).toEqual([0.4, 0.5]);
  });

  it('every member locked: the shared property is unavailable and says why; delete is disabled', () => {
    mount('locked');
    expect(header()).toBe('2 objects');
    expect(opacity()).toBeNull();
    expect(container.textContent).toContain('Every selected object is locked.');
    expect((container.querySelector('[data-testid="delete-selection"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('lock all / unlock all is one action each', () => {
    mount('mixed');
    const btn = () => container.querySelector('[data-testid="lock-all"]') as HTMLButtonElement;
    expect(btn().textContent).toBe('Lock all');
    act(() => btn().click());
    expect(doc.history).toHaveLength(1);
    expect([el(A.id)!.locked, el(B.id)!.locked]).toEqual([true, true]);
    expect(btn().textContent).toBe('Unlock all');
    act(() => btn().click());
    expect(doc.history).toHaveLength(2);
    expect([el(A.id)!.locked, el(B.id)!.locked]).toEqual([false, false]);
  });

  it('delete button: names how many unlocked go, removes those only, and says so', () => {
    mount('mixed');
    const btn = container.querySelector('[data-testid="delete-selection"]') as HTMLButtonElement;
    expect(btn.textContent).toBe('Delete 1 unlocked');
    act(() => btn.click());
    expect(el(A.id)).toBeUndefined();
    expect(el(B.id)).toBeDefined();
    expect(announcement()).toBe('Deleted 1 · 1 locked kept');
  });
});

describe('C-6 through the shell: ⌘Z after a colour pick', () => {
  it('undo works while focus is on a colour input', () => {
    mount('unlocked');
    key('ArrowRight');
    const swatch = document.createElement('input');
    swatch.type = 'color';
    document.body.appendChild(swatch);
    const e = new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true });
    act(() => void swatch.dispatchEvent(e));
    expect(doc.history).toHaveLength(0);
    expect(el(A.id)!.x).toBe(20.05);
    swatch.remove();
  });
});
