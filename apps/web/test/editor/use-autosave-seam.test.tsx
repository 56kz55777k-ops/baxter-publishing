// @vitest-environment jsdom
/**
 * The fetch→reducer seam (hardening item 7): REAL reducer + REAL scheduler +
 * REAL hook, mocked network. Each case pins the mapping from HTTP outcome to
 * reducer state and user-visible save label — the failures these prevent are
 * a response class silently mapped to the wrong phase (e.g. 423 retrying
 * forever, or a late 200 reviving a dead session).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getFormatPreset, newEditorDoc, newRectElement, type EditorDoc } from '@baxter/domain';
import {
  documentReducer,
  initialDocumentState,
  type DocumentAction,
  type DocumentState,
} from '@/components/editor/state/reducer';
import { selectSaveLabel } from '@/components/editor/state/selectors';
import { useAutosave } from '@/components/editor/state/use-autosave';
import { AUTOSAVE_DEBOUNCE_MS } from '@/components/editor/state/autosave-core';

const PUB = 'bf171826-6187-4213-9e36-c4b3044150b3';

type FetchScript = Array<
  | { status: number; body?: unknown }
  | { reject: true }
  | { hold: true }
>;

let script: FetchScript = [];
let calls: Array<{ body: string }> = [];
let heldResolvers: Array<(r: Response) => void> = [];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body ?? {}), { status });
}

function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ body: String(init?.body ?? '') });
      const step = script.shift() ?? { status: 200, body: { revision: 999 } };
      if ('reject' in step) throw new TypeError('network down');
      if ('hold' in step) {
        return new Promise<Response>((resolve) => {
          heldResolvers.push(resolve);
        });
      }
      return jsonResponse(step.status, step.body);
    })
  );
}

let container: HTMLDivElement;
let root: Root;
let currentState: DocumentState;
let dispatchRef: React.Dispatch<DocumentAction>;

function Harness({ initial }: { initial: DocumentState }) {
  const [state, dispatch] = React.useReducer(documentReducer, initial);
  currentState = state;
  dispatchRef = dispatch;
  useAutosave(PUB, state, dispatch);
  return null;
}

function fresh(): DocumentState {
  return initialDocumentState({
    doc: newEditorDoc(getFormatPreset('zine_a5')!),
    revision: 0,
    clientId: 'c0ffee00-aaaa-4bbb-8ccc-00000000000a',
  });
}

function edited(doc: EditorDoc): EditorDoc {
  return {
    ...doc,
    pages: doc.pages.map((p, i) =>
      i === 1 ? { ...p, elements: [...p.elements, newRectElement({ x: 9, y: 9 })] } : p
    ),
  };
}

function commit() {
  act(() => {
    dispatchRef({
      type: 'COMMIT',
      nextDoc: edited(currentState.doc),
      selection: [],
      label: 'seam',
    });
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  script = [];
  calls = [];
  heldResolvers = [];
  installFetch();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(React.createElement(Harness, { initial: fresh() }));
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('use-autosave seam — HTTP outcome to reducer state', () => {
  it('successful save: revision hydrates, savedDoc pins to the sent reference, label settles', async () => {
    script = [{ status: 200, body: { revision: 1 } }];
    commit();
    const sent = currentState.doc;
    expect(selectSaveLabel(currentState)).toBe('Unsaved changes');
    await advance(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(calls).toHaveLength(1);
    expect(currentState.revision).toBe(1);
    expect(currentState.savedDoc).toBe(sent);
    expect(selectSaveLabel(currentState)).toBe('All changes saved');
    // envelope carried the protocol fields
    const body = JSON.parse(calls[0]!.body) as { baseRevision: number; clientId: string };
    expect(body.baseRevision).toBe(0);
  });

  it('409 → terminal conflict with serverRevision; later commits never fetch again', async () => {
    script = [{ status: 409, body: { serverRevision: 7 } }];
    commit();
    await advance(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(currentState.savePhase).toBe('conflict');
    expect(currentState.conflictServerRevision).toBe(7);
    expect(selectSaveLabel(currentState)).toBe('Edited somewhere else — reload to continue.');

    commit(); // reducer refuses; scheduler is terminal
    await advance(120_000);
    expect(calls).toHaveLength(1);
  });

  it('423 → terminal window-closed; no retries', async () => {
    script = [{ status: 423 }];
    commit();
    await advance(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(currentState.savePhase).toBe('window-closed');
    expect(selectSaveLabel(currentState)).toBe('Editing is closed while Baxter has this publication.');
    await advance(120_000);
    expect(calls).toHaveLength(1);
  });

  it('400 (validation) → loud console error + retry ladder, not silence', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    script = [{ status: 400 }, { status: 200, body: { revision: 1 } }];
    commit();
    await advance(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(currentState.savePhase).toBe('retrying');
    expect(err).toHaveBeenCalledWith('editor autosave: server rejected the document (400)');
    await advance(10_000); // first ladder tier
    expect(calls).toHaveLength(2);
    expect(currentState.savePhase).toBe('idle');
  });

  it('network failure → retrying label, ladder retry succeeds and settles clean', async () => {
    script = [{ reject: true }, { status: 200, body: { revision: 1 } }];
    commit();
    await advance(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(currentState.savePhase).toBe('retrying');
    expect(selectSaveLabel(currentState)).toBe(
      'Baxter can’t reach the shelf — your work is safe in this tab.'
    );
    await advance(10_000);
    expect(currentState.revision).toBe(1);
    expect(selectSaveLabel(currentState)).toBe('All changes saved');
  });

  it('a late response after a terminal state never revives the session', async () => {
    script = [{ hold: true }];
    commit();
    const sent = currentState.doc;
    await advance(AUTOSAVE_DEBOUNCE_MS + 10); // flight held open
    expect(calls).toHaveLength(1);

    // The session dies while the response is in the air (window closes).
    act(() => {
      dispatchRef({ type: 'WINDOW_CLOSED' });
    });
    expect(currentState.savePhase).toBe('window-closed');

    // The old response finally lands as a 200 — it must change nothing.
    await act(async () => {
      heldResolvers[0]!(jsonResponse(200, { revision: 42 }));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(currentState.savePhase).toBe('window-closed');
    expect(currentState.revision).toBe(0);
    expect(currentState.savedDoc).not.toBe(sent);
    await advance(120_000);
    expect(calls).toHaveLength(1); // and the scheduler stays quiet
  });

  it('commit during an in-flight save follows the scheduler protocol (one follow-up)', async () => {
    script = [{ hold: true }, { status: 200, body: { revision: 2 } }];
    commit();
    await advance(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(calls).toHaveLength(1);
    commit(); // mid-flight edit
    await advance(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(calls).toHaveLength(1); // never two in flight

    await act(async () => {
      heldResolvers[0]!(jsonResponse(200, { revision: 1 }));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(currentState.revision).toBe(1);
    expect(currentState.doc).not.toBe(currentState.savedDoc); // still dirty
    await advance(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(calls).toHaveLength(2); // exactly one follow-up
    expect(currentState.revision).toBe(2);
    expect(currentState.doc).toBe(currentState.savedDoc);
  });
});
