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
import { useEffect, useRef, useState, type Dispatch } from 'react';
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

export function useEditorKeyboard(
  uiDispatch: Dispatch<EditorUiAction>,
  handlers: { onUndo: () => void; onRedo: () => void }
): { spaceHeld: boolean } {
  const [spaceHeld, setSpaceHeld] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      // ⌘Z / ⇧⌘Z — document history (contract #24/#26). The typing guard above
      // is what keeps in-field undo native while a numeric draft is focused.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) handlersRef.current.onRedo();
        else handlersRef.current.onUndo();
        return;
      }

      if (e.key === ' ') {
        e.preventDefault();
        setSpaceHeld(true);
      } else if (e.key === 'v' || e.key === 'V') {
        uiDispatch({ type: 'SET_TOOL', tool: 'select' });
      } else if (e.key === 'h' || e.key === 'H') {
        uiDispatch({ type: 'SET_TOOL', tool: 'hand' });
      } else if (e.key === 'r' || e.key === 'R') {
        // R is the accepted letter for the rectangle tool. The map assigns no
        // letter to ellipse, so ellipse stays toolbar-only (contract #26).
        uiDispatch({ type: 'SET_TOOL', tool: 'rect' });
      } else if (e.key === 'Escape') {
        // Deselect + return to Select. An in-flight gesture cancels itself on
        // Escape in the gesture hook; this is the resting-state behaviour.
        uiDispatch({ type: 'CLEAR_SELECTION' });
        uiDispatch({ type: 'SET_TOOL', tool: 'select' });
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
