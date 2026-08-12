/**
 * Pure selectors over editor state (blueprint §2.3).
 *
 * `selectUnits` memoizes per pages-array reference (WeakMap) so navigation
 * and save-state changes never recompute or re-identify the unit list —
 * stable references keep React work minimal without a store library.
 */
import { computeUnits, type EditorDoc, type UnitOfView } from '@baxter/domain';
import type { DocumentState } from './reducer';

const unitsCache = new WeakMap<EditorDoc['pages'], UnitOfView[]>();

export function selectUnits(doc: EditorDoc): UnitOfView[] {
  const cached = unitsCache.get(doc.pages);
  if (cached) return cached;
  const units = computeUnits(doc.pages);
  unitsCache.set(doc.pages, units);
  return units;
}

/** Reference inequality IS the dirty flag (amendment A1). */
export function selectDirty(state: DocumentState): boolean {
  return state.doc !== state.savedDoc;
}

export function selectReadOnly(state: DocumentState): boolean {
  return state.savePhase === 'conflict' || state.savePhase === 'window-closed';
}

/** The save dot's quiet language. Situation, not status codes. */
export function selectSaveLabel(state: DocumentState): string {
  switch (state.savePhase) {
    case 'conflict':
      return 'Edited somewhere else — reload to continue.';
    case 'window-closed':
      return 'Editing is closed while Baxter has this publication.';
    case 'saving':
      return 'Saving…';
    case 'retrying':
      return 'Baxter can’t reach the shelf — your work is safe in this tab.';
    case 'idle':
      return selectDirty(state) ? 'Unsaved changes' : 'All changes saved';
  }
}
