'use client';

/**
 * The autosave driver — React/fetch glue around AutosaveScheduler
 * (blueprint §2.5; timing/ordering logic lives, tested, in autosave-core).
 *
 * Ordering safety: performSave captures the doc REFERENCE and base revision
 * at call time, serializes once at the network boundary, and dispatches
 * SAVED with that exact reference — a late response for an older payload can
 * never mark a newer document clean (the reducer compares references).
 *
 * beforeunload: while dirty or saving, prompt; additionally attempt a
 * best-effort keepalive PUT only when the payload is under 60 KB (keepalive
 * bodies are capped ~64 KB — amendment A5; the prompt is the guarantee, the
 * keepalive is a courtesy). Unmount disposes timers without aborting an
 * accepted in-flight save, and never updates unmounted state.
 */
import { useEffect, useRef } from 'react';
import type { Dispatch } from 'react';
import { AutosaveScheduler, type AutosaveOutcome } from './autosave-core';
import type { DocumentAction, DocumentState } from './reducer';
import { selectDirty, selectReadOnly } from './selectors';

const KEEPALIVE_MAX_BYTES = 60_000;

export function useAutosave(
  publicationId: string,
  state: DocumentState,
  dispatch: Dispatch<DocumentAction>
): void {
  const stateRef = useRef(state);
  stateRef.current = state;
  const mountedRef = useRef(true);
  const schedulerRef = useRef<AutosaveScheduler | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const driver = {
      isDirty(): boolean {
        const s = stateRef.current;
        return selectDirty(s) && !selectReadOnly(s);
      },
      async performSave(): Promise<AutosaveOutcome> {
        const s = stateRef.current;
        const sentDoc = s.doc;
        const baseRevision = s.revision;
        if (mountedRef.current) dispatch({ type: 'SAVE_STARTED' });
        performance.mark('baxter:editor:save-start');
        // Serialization happens exactly once, here, at the network boundary.
        const body = JSON.stringify({ doc: sentDoc, baseRevision, clientId: s.clientId });
        try {
          const res = await fetch(`/api/editor/${publicationId}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body,
          });
          if (res.status === 200) {
            const json = (await res.json()) as { revision: number };
            if (mountedRef.current) {
              dispatch({ type: 'SAVED', revision: json.revision, sentDoc });
            }
            performance.mark('baxter:editor:save-end');
            performance.measure('baxter:editor:save', 'baxter:editor:save-start', 'baxter:editor:save-end');
            return 'saved';
          }
          if (res.status === 409) {
            const json = (await res.json().catch(() => ({}))) as { serverRevision?: number };
            if (mountedRef.current) {
              dispatch({ type: 'SAVE_CONFLICT', serverRevision: json.serverRevision ?? null });
            }
            return 'conflict';
          }
          if (res.status === 423) {
            if (mountedRef.current) dispatch({ type: 'WINDOW_CLOSED' });
            return 'window-closed';
          }
          // 400 here means a document our own zod rejected — a bug, not a
          // network condition. Log loudly; the retry ladder keeps the session
          // honest instead of silently pretending it saved.
          if (res.status === 400) {
            console.error('editor autosave: server rejected the document (400)');
          }
          if (mountedRef.current) dispatch({ type: 'SAVE_FAILED' });
          return 'failed';
        } catch {
          if (mountedRef.current) dispatch({ type: 'SAVE_FAILED' });
          return 'failed';
        }
      },
    };

    const scheduler = new AutosaveScheduler(driver);
    schedulerRef.current = scheduler;
    return () => {
      mountedRef.current = false;
      scheduler.dispose(); // in-flight saves are not aborted
      schedulerRef.current = null;
    };
  }, [publicationId, dispatch]);

  // Every accepted commit nudges the scheduler (INIT/SAVED leave doc ===
  // savedDoc, so a clean state schedules nothing).
  useEffect(() => {
    if (selectDirty(state) && !selectReadOnly(state)) {
      schedulerRef.current?.noteCommit();
    }
  }, [state]);

  // Navigation-away guard + bounded keepalive courtesy (amendment A5).
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      const s = stateRef.current;
      const unsafe = (selectDirty(s) || s.savePhase === 'saving') && !selectReadOnly(s);
      if (!unsafe) return;
      e.preventDefault();
      e.returnValue = '';
      const body = JSON.stringify({ doc: s.doc, baseRevision: s.revision, clientId: s.clientId });
      if (body.length < KEEPALIVE_MAX_BYTES) {
        void fetch(`/api/editor/${publicationId}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {
          /* best-effort only; the prompt was the guarantee */
        });
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [publicationId]);
}
