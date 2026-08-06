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
import { useEffect, useMemo, useRef } from 'react';
import { getFormatPreset, newRectElement } from '@baxter/domain';
import { fitPageView, fitUnitView, hundredView, unitGeometry } from './geometry';
import { SpreadStage } from './SpreadStage';
import { StatusBar } from './StatusBar';
import { UnitList } from './UnitList';
import { useDocumentDispatch, useDocumentState } from './state/document-context';
import { useEditorUi, useEditorUiDispatch } from './state/editor-ui-context';
import { selectDirty, selectReadOnly, selectSaveLabel, selectUnits } from './state/selectors';
import { useAutosave } from './state/use-autosave';

export function EditorShell({ publication }: { publication: { id: string; title: string } }) {
  const state = useDocumentState();
  const dispatch = useDocumentDispatch();
  const ui = useEditorUi();
  const uiDispatch = useEditorUiDispatch();
  useAutosave(publication.id, state, dispatch);

  const units = selectUnits(state.doc);
  const preset = getFormatPreset(state.doc.meta.formatPresetId)!;
  const unitIndex = Math.min(ui.unitIndex, units.length - 1);
  const unit = units[unitIndex]!;
  const layout = useMemo(
    () => ({ marginMm: state.doc.meta.marginMm, safeMm: state.doc.meta.safeMm }),
    [state.doc.meta.marginMm, state.doc.meta.safeMm]
  );
  const geom = useMemo(() => unitGeometry(unit, preset, layout), [unit, preset, layout]);
  const viewportRef = useRef({ w: 0, h: 0 });
  const readOnly = selectReadOnly(state);
  const dirty = selectDirty(state);

  function viewport() {
    return viewportRef.current.w > 0 ? viewportRef.current : { w: 1200, h: 800 };
  }

  function navigate(index: number) {
    const target = units[index];
    if (!target) return;
    const g = unitGeometry(target, preset, layout);
    const { w, h } = viewport();
    uiDispatch({ type: 'SET_UNIT', index, view: fitUnitView(g, w, h) });
  }

  // Dev-only commit handle for Slice A verification (no editing UI exists
  // yet). Dead-code-eliminated from production builds by the NODE_ENV check.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as typeof window & { __baxterEditorDevCommit?: (label?: string) => void };
    w.__baxterEditorDevCommit = (label = 'dev commit') => {
      const doc = state.doc;
      const nextDoc = {
        ...doc,
        pages: doc.pages.map((p, i) =>
          i === 1 ? { ...p, elements: [...p.elements, newRectElement({ x: 20, y: 20 })] } : p
        ),
      };
      dispatch({ type: 'COMMIT', nextDoc, selection: [], label });
    };
    return () => {
      delete w.__baxterEditorDevCommit;
    };
  }, [state.doc, dispatch]);

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
        <p className="flex items-center gap-2 text-caption text-ink-faint" data-testid="save-state">
          <span
            aria-hidden
            className={
              'inline-block h-1.5 w-1.5 rounded-full ' +
              (readOnly ? 'bg-accent' : dirty || state.savePhase !== 'idle' ? 'bg-accent/70' : 'bg-ink-faint/40')
            }
          />
          {selectSaveLabel(state)}
        </p>
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
        <UnitList units={units} onNavigate={navigate} />
        <main className={'min-w-0 flex-1 ' + (readOnly ? 'pointer-events-none' : '')} aria-disabled={readOnly}>
          <SpreadStage geom={geom} viewportRef={viewportRef} />
        </main>
      </div>

      <StatusBar
        spreadFitLabel={unit.pages.length === 2 ? 'Fit spread' : 'Fit page'}
        onFitPage={() => {
          const { w, h } = viewport();
          uiDispatch({ type: 'SET_VIEW', view: fitPageView(geom, w, h) });
        }}
        onFitSpread={() => {
          const { w, h } = viewport();
          uiDispatch({ type: 'SET_VIEW', view: fitUnitView(geom, w, h) });
        }}
        onHundred={() => {
          const { w, h } = viewport();
          uiDispatch({ type: 'SET_VIEW', view: hundredView(geom, w, h) });
        }}
      />
    </div>
  );
}
