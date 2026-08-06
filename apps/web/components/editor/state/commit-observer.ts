/**
 * Commit observation (hardening item 4): autosave scheduling reacts to
 * DOCUMENT-REFERENCE changes — the reducer's definition of a commit — never
 * to save-machine transitions. SAVE_STARTED/SAVED/SAVE_FAILED/CONFLICT/
 * WINDOW_CLOSED produce new state objects with the SAME doc reference, so
 * they cannot schedule a debounce here; UI-context changes never reach this
 * observer at all (different context, different state object).
 */
import type { EditorDoc } from '@baxter/domain';
import type { DocumentState } from './reducer';
import { selectDirty, selectReadOnly } from './selectors';

export function createCommitObserver(
  initialDoc: EditorDoc,
  onCommit: () => void
): (state: DocumentState) => void {
  let lastDoc = initialDoc;
  return (state) => {
    if (state.doc === lastDoc) return; // not a commit — same document reference
    lastDoc = state.doc;
    if (selectDirty(state) && !selectReadOnly(state)) onCommit();
  };
}
