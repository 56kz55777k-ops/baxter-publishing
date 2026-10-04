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
import { useCallback, useMemo, useRef } from 'react';
import {
  addElement,
  applyMoves,
  findElement,
  getFormatPreset,
  liveSelection,
  reorderElement,
  setLocked,
  updateElement,
  type ArrangeOp,
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

  const { spaceHeld } = useEditorKeyboard(uiDispatch, { onUndo, onRedo });

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
        />
      </div>

      <StatusBar
        spreadFitLabel={unit.pages.length === 2 ? 'Fit spread' : 'Fit page'}
        onFitPage={onFitPage}
        onFitSpread={onFitSpread}
        onHundred={onHundred}
      />
    </div>
  );
}
