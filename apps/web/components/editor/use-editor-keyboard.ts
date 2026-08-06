'use client';

/**
 * Shell-level keyboard ownership (hardening item 1; blueprint §2.1's
 * `useEditorKeyboard`). ONE window keydown/keyup/blur listener set and ONE
 * typing/editable-target guard for the whole editor — Slice B extends the
 * map here rather than growing a second handler with a divergent guard.
 *
 * Slice A map (behaviour identical to the pre-hardening SpreadStage code):
 *   Space (held)  momentary hand — preventDefault stops page scroll
 *   V / H         Select / Hand tool
 *   window blur   clears the Space modifier (contract #26)
 *
 * Pointer-gesture concerns (pan state, its own blur cancellation) remain
 * stage-local by design — this hook owns keys, not gestures.
 */
import { useEffect, useState, type Dispatch } from 'react';
import type { EditorUiAction } from './state/editor-ui';

/** The one authoritative guard: keys belong to the focused editable surface. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable === true
  );
}

export function useEditorKeyboard(uiDispatch: Dispatch<EditorUiAction>): { spaceHeld: boolean } {
  const [spaceHeld, setSpaceHeld] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.key === ' ') {
        e.preventDefault();
        setSpaceHeld(true);
      } else if (e.key === 'v' || e.key === 'V') {
        uiDispatch({ type: 'SET_TOOL', tool: 'select' });
      } else if (e.key === 'h' || e.key === 'H') {
        uiDispatch({ type: 'SET_TOOL', tool: 'hand' });
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === ' ') setSpaceHeld(false);
    }
    function onBlur() {
      setSpaceHeld(false); // window blur clears modifier state (contract #26)
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [uiDispatch]);

  return { spaceHeld };
}
