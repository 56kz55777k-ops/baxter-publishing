'use client';

/**
 * The editor frame: header (way back, title, save state), read-only banner,
 * unit navigation, stage, status bar. Composes the two contexts; owns unit
 * navigation (auto-fit on navigate — contract #27) and the fit actions.
 *
 * Read-only (conflict / window-closed): a persistent calm banner over an
 * inert canvas — unsaved work stays VISIBLE until the human chooses to
 * reload; nothing is silently kept or thrown away (blueprint §2.6).
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addElement,
  applyMoves,
  copyElements,
  duplicateElements,
  findElement,
  getFormatPreset,
  liveSelection,
  nudgeElements,
  pasteElements,
  patchAll,
  removeElements,
  reorderElement,
  setLockAll,
  setLocked,
  updateElement,
  type ArrangeOp,
  type ClipboardItem,
  type EditorDoc,
  type EditorElement,
  type UnitLayout,
} from '@baxter/domain';
import { Inspector } from './inspector/Inspector';
import { fitPageView, fitUnitView, hundredView, unitGeometry } from './geometry';
import { SaveStateChip } from './SaveStateChip';
import { SpreadStage } from './SpreadStage';
import { StatusBar } from './StatusBar';
import { UnitList } from './UnitList';
import { useEditorKeyboard } from './use-editor-keyboard';
import { useDocumentDispatch, useDocumentState } from './state/document-context';
import { useEditorUi, useEditorUiDispatch } from './state/editor-ui-context';
import { selectReadOnly, selectUnits } from './state/selectors';
import { useAutosave } from './state/use-autosave';

export function EditorShell({ publication }: { publication: { id: string; title: string } }) {
  const state = useDocumentState();
  const dispatch = useDocumentDispatch();
  const ui = useEditorUi();
  const uiDispatch = useEditorUiDispatch();
  useAutosave(publication.id, state, dispatch);

  /**
   * Undo/redo are orchestrated here rather than inside either reducer, which
   * is what keeps selection out of the document store (contract #4, #24).
   * The handler reads the entry it is about to restore, moves the document
   * through the transaction log, and restores that entry's selection into the
   * UI context filtered to ids that still exist — stale ids are never
   * recreated.
   */
  const onUndo = useCallback(() => {
    const entry = state.history[state.history.length - 1];
    if (!entry) return;
    dispatch({ type: 'UNDO', currentSelection: ui.selection });
    uiDispatch({ type: 'SET_SELECTION', ids: liveSelection(entry.doc, entry.selection) });
  }, [state.history, ui.selection, dispatch, uiDispatch]);

  const onRedo = useCallback(() => {
    const entry = state.future[state.future.length - 1];
    if (!entry) return;
    dispatch({ type: 'REDO', currentSelection: ui.selection });
    uiDispatch({ type: 'SET_SELECTION', ids: liveSelection(entry.doc, entry.selection) });
  }, [state.future, ui.selection, dispatch, uiDispatch]);


  const units = selectUnits(state.doc);
  const preset = getFormatPreset(state.doc.meta.formatPresetId)!;
  const unitIndex = Math.min(ui.unitIndex, units.length - 1);
  const unit = units[unitIndex]!;
  const layout = useMemo(
    () => ({ marginMm: state.doc.meta.marginMm, safeMm: state.doc.meta.safeMm }),
    [state.doc.meta.marginMm, state.doc.meta.safeMm]
  );
  const geom = useMemo(() => unitGeometry(unit, preset, layout), [unit, preset, layout]);
  /** The unit as the pure movement ops see it: its pages and their offsets. */
  const unitLayout = useMemo<UnitLayout>(
    () => ({ pageIds: unit.pages.map((p) => p.id), pageOffsetsMm: geom.pageOffsetsMm }),
    [unit.pages, geom.pageOffsetsMm]
  );
  const viewportRef = useRef({ w: 0, h: 0 });
  const readOnly = selectReadOnly(state);

  const viewport = useCallback(() => {
    return viewportRef.current.w > 0 ? viewportRef.current : { w: 1200, h: 800 };
  }, []);

  const navigate = useCallback(
    (index: number) => {
      const target = units[index];
      if (!target) return;
      const g = unitGeometry(target, preset, layout);
      const { w, h } = viewport();
      uiDispatch({ type: 'SET_UNIT', index, view: fitUnitView(g, w, h) });
    },
    [units, preset, layout, viewport, uiDispatch]
  );

  const onFitPage = useCallback(() => {
    const { w, h } = viewport();
    uiDispatch({ type: 'SET_VIEW', view: fitPageView(geom, w, h) });
  }, [geom, viewport, uiDispatch]);
  const onFitSpread = useCallback(() => {
    const { w, h } = viewport();
    uiDispatch({ type: 'SET_VIEW', view: fitUnitView(geom, w, h) });
  }, [geom, viewport, uiDispatch]);
  const onHundred = useCallback(() => {
    const { w, h } = viewport();
    uiDispatch({ type: 'SET_VIEW', view: hundredView(geom, w, h) });
  }, [geom, viewport, uiDispatch]);

  /**
   * The one document mutation Slice B introduces: a completed creation
   * gesture. The element is produced by pure helpers, committed once, and the
   * accepted after-state follows — the new element is selected, the inspector
   * arms because selection drives it, and the tool returns to Select
   * (contract #3).
   *
   * Slice A's dev-only `__baxterEditorDevCommit` handle is gone: it existed
   * because no editing surface did. Real tools have replaced it, and the
   * browser smoke now drives real gestures instead of a synthetic hook.
   */
  const onCreate = useCallback(
    (pageIndex: number, element: EditorElement, label: string) => {
      const page = unit.pages[pageIndex];
      if (!page) return;
      const nextDoc = addElement(state.doc, page.id, element);
      if (nextDoc === state.doc) return;
      dispatch({ type: 'COMMIT', nextDoc, selection: ui.selection, label });
      uiDispatch({ type: 'SET_SELECTION', ids: [element.id] });
      uiDispatch({ type: 'SET_TOOL', tool: 'select' });
    },
    [unit.pages, state.doc, ui.selection, dispatch, uiDispatch]
  );

  /**
   * A completed drag (#7): every unlocked member by the shared delta, per
   * member re-parent by centre (#2), ONE commit → one history entry → one
   * autosave. The selection is unchanged — the same objects, moved.
   */
  const onMove = useCallback(
    (ids: readonly string[], dx: number, dy: number) => {
      const nextDoc = applyMoves(state.doc, unitLayout, ids, dx, dy);
      if (nextDoc === state.doc) return;
      dispatch({ type: 'COMMIT', nextDoc, selection: ui.selection, label: 'Move' });
    },
    [state.doc, unitLayout, ui.selection, dispatch]
  );

  /* ------------------------------------------------------------------------ */
  /* Slice C object operations (contracts #5, #20, #24, #26; C-3, C-4)        */
  /* ------------------------------------------------------------------------ */

  /**
   * Object operations act on the selected elements of the unit being shown.
   * Selection survives navigation (#4), but an operation never reaches an
   * object the creator cannot see.
   */
  const unitIds = useMemo(() => new Set(unit.pages.flatMap((p) => p.elements.map((e) => e.id))), [unit.pages]);
  const unitSelection = useMemo(() => ui.selection.filter((id) => unitIds.has(id)), [ui.selection, unitIds]);

  /** One polite line in the status bar — how a partial delete "says so" (#5). */
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (!announcement) return;
    const t = setTimeout(() => setAnnouncement(''), 5000);
    return () => clearTimeout(t);
  }, [announcement]);

  /** One intention → one COMMIT; a no-op (same document) commits nothing (#24). */
  const commitDocWith = useCallback(
    (nextDoc: EditorDoc, label: string) => {
      if (nextDoc === state.doc) return;
      dispatch({ type: 'COMMIT', nextDoc, selection: ui.selection, label });
    },
    [state.doc, ui.selection, dispatch]
  );

  /** In-memory, per editor session (C-3). Never the system clipboard. */
  const clipboard = useRef<ClipboardItem[]>([]);

  const deleteSelection = useCallback(
    (label: 'Delete' | 'Cut') => {
      if (readOnly || unitSelection.length === 0) return;
      const r = removeElements(state.doc, unitSelection);
      if (r.keptLocked.length > 0) {
        setAnnouncement(
          r.removed.length > 0
            ? `${label === 'Cut' ? 'Cut' : 'Deleted'} ${r.removed.length} · ${r.keptLocked.length} locked kept`
            : `Locked objects are not deleted (${r.keptLocked.length} kept)`
        );
      }
      if (r.doc === state.doc) return;
      dispatch({ type: 'COMMIT', nextDoc: r.doc, selection: ui.selection, label });
      // The deleted ids leave the selection; locked survivors stay selected.
      uiDispatch({ type: 'SET_SELECTION', ids: ui.selection.filter((id) => !r.removed.includes(id)) });
    },
    [readOnly, unitSelection, state.doc, ui.selection, dispatch, uiDispatch]
  );

  const onDelete = useCallback(() => deleteSelection('Delete'), [deleteSelection]);

  const onNudge = useCallback(
    (dx: number, dy: number) => {
      if (readOnly) return;
      commitDocWith(nudgeElements(state.doc, unitSelection, dx, dy), 'Nudge');
    },
    [readOnly, state.doc, unitSelection, commitDocWith]
  );

  const onDuplicate = useCallback(() => {
    if (readOnly) return;
    const r = duplicateElements(state.doc, unitSelection);
    if (r.doc === state.doc) return;
    dispatch({ type: 'COMMIT', nextDoc: r.doc, selection: ui.selection, label: 'Duplicate' });
    uiDispatch({ type: 'SET_SELECTION', ids: r.newIds });
  }, [readOnly, state.doc, unitSelection, ui.selection, dispatch, uiDispatch]);

  const onCopy = useCallback(() => {
    if (unitSelection.length === 0) return;
    clipboard.current = copyElements(state.doc, unitSelection); // no commit: copying changes nothing
  }, [state.doc, unitSelection]);

  const onCut = useCallback(() => {
    if (readOnly || unitSelection.length === 0) return;
    clipboard.current = copyElements(state.doc, unitSelection);
    deleteSelection('Cut');
  }, [readOnly, state.doc, unitSelection, deleteSelection]);

  const onPaste = useCallback(() => {
    if (readOnly) return;
    const r = pasteElements(state.doc, unitLayout, clipboard.current);
    if (r.doc === state.doc) return;
    dispatch({ type: 'COMMIT', nextDoc: r.doc, selection: ui.selection, label: 'Paste' });
    uiDispatch({ type: 'SET_SELECTION', ids: r.newIds });
  }, [readOnly, state.doc, unitLayout, ui.selection, dispatch, uiDispatch]);

  /** ⌘A: everything on the current unit, locked included (#5). Selection only — no history. */
  const onSelectAll = useCallback(() => {
    uiDispatch({ type: 'SET_SELECTION', ids: [...unitIds] });
  }, [unitIds, uiDispatch]);

  const { spaceHeld } = useEditorKeyboard(uiDispatch, {
    onUndo,
    onRedo,
    onDelete,
    onNudge,
    onDuplicate,
    onCopy,
    onCut,
    onPaste,
    onSelectAll,
  });

  const multi = useMemo(
    () =>
      unitSelection.length > 1
        ? unitSelection.map((id) => findElement(state.doc, id)).filter((e): e is EditorElement => !!e)
        : undefined,
    [unitSelection, state.doc]
  );
  const onMultiOpacity = useCallback(
    (opacity: number) => {
      if (readOnly) return;
      commitDocWith(patchAll(state.doc, unitSelection, { opacity }), 'Set opacity');
    },
    [readOnly, state.doc, unitSelection, commitDocWith]
  );
  const onLockAll = useCallback(
    (locked: boolean) => {
      if (readOnly) return;
      commitDocWith(setLockAll(state.doc, unitSelection, locked), locked ? 'Lock all' : 'Unlock all');
    },
    [readOnly, state.doc, unitSelection, commitDocWith]
  );

  /**
   * Inspector commits. Each is one intention → one pure helper → one COMMIT →
   * one history entry (#24). The helpers return the same document reference
   * for a no-op, so an identical value or an already-front arrange writes
   * nothing at all.
   */
  const selectedElement = useMemo(
    () => (ui.selection.length === 1 ? (findElement(state.doc, ui.selection[0]!) ?? null) : null),
    [state.doc, ui.selection]
  );

  const doc = state.doc;
  const commitDoc = useCallback(
    (nextDoc: typeof doc, label: string) => {
      if (nextDoc === doc) return;
      dispatch({ type: 'COMMIT', nextDoc, selection: ui.selection, label });
    },
    [doc, ui.selection, dispatch]
  );

  const onPatch = useCallback(
    (patch: Record<string, unknown>, label: string) => {
      if (!selectedElement) return;
      commitDoc(updateElement(state.doc, selectedElement.id, patch), label);
    },
    [selectedElement, state.doc, commitDoc]
  );

  const onArrange = useCallback(
    (op: ArrangeOp) => {
      if (!selectedElement) return;
      commitDoc(reorderElement(state.doc, selectedElement.id, op), 'Arrange');
    },
    [selectedElement, state.doc, commitDoc]
  );

  const onSetLocked = useCallback(
    (locked: boolean) => {
      if (!selectedElement) return;
      commitDoc(setLocked(state.doc, selectedElement.id, locked), locked ? 'Lock' : 'Unlock');
    },
    [selectedElement, state.doc, commitDoc]
  );

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-rule px-4">
        <Link
          href={`/studio/publications/${publication.id}`}
          className="metadata text-ink-soft hover:text-ink transition-colors duration-400 ease-gentle"
        >
          ← Workspace
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-serif text-body">{publication.title}</h1>
        <SaveStateChip />
      </header>

      {readOnly && (
        <div
          className="flex items-center gap-4 border-b border-rule bg-[#f2e7e5] px-4 py-3"
          role="status"
          data-testid="read-only-banner"
        >
          <p className="text-caption text-ink">
            {state.savePhase === 'conflict'
              ? 'This publication was edited somewhere else — likely another tab. Reload to pick up the latest version. Work shown here after the fork was not saved.'
              : 'This publication left the editing window while it was open here. Reload to see where things stand.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="metadata text-accent underline underline-offset-4 hover:text-ink transition-colors duration-400 ease-gentle"
          >
            Reload
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <UnitList units={units} unitIndex={unitIndex} onNavigate={navigate} />
        <main className={'min-w-0 flex-1 ' + (readOnly ? 'pointer-events-none' : '')} aria-disabled={readOnly}>
          <SpreadStage
            geom={geom}
            pages={unit.pages}
            viewportRef={viewportRef}
            spaceHeld={spaceHeld}
            readOnly={readOnly}
            onCreate={onCreate}
            onMove={onMove}
          />
        </main>
        <Inspector
          element={selectedElement}
          page={{
            formatName: preset.name,
            marginMm: state.doc.meta.marginMm,
            safeMm: state.doc.meta.safeMm,
          }}
          selectionCount={ui.selection.length}
          disabled={readOnly}
          onPatch={onPatch}
          onArrange={onArrange}
          onSetLocked={onSetLocked}
          multi={multi}
          onMultiOpacity={onMultiOpacity}
          onLockAll={onLockAll}
          onDeleteSelection={onDelete}
        />
      </div>

      <StatusBar
        spreadFitLabel={unit.pages.length === 2 ? 'Fit spread' : 'Fit page'}
        onFitPage={onFitPage}
        onFitSpread={onFitSpread}
        onHundred={onHundred}
        announcement={announcement}
      />
    </div>
  );
}
