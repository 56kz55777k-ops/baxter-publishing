'use client';

/**
 * The save-state chip — the ONLY component that re-renders for save-machine
 * transitions. Self-subscribes to the document context so save-phase churn
 * stops here instead of cascading into the canvas subtree (hardening pass,
 * render-count evidence: pre-change, every SAVE_STARTED/SAVED re-rendered
 * SpreadStage, UnitList and StatusBar for no visual difference).
 */
import { useDocumentState } from './state/document-context';
import { selectDirty, selectReadOnly, selectSaveLabel } from './state/selectors';

export function SaveStateChip() {
  const state = useDocumentState();
  const readOnly = selectReadOnly(state);
  const dirty = selectDirty(state);
  return (
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
  );
}
