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
 * Slice C adds the object map (contract #26): Delete/Backspace, arrows nudge
 * 0.5 mm (Shift 5 mm), ⌘D duplicate, ⌘C/⌘X/⌘V clipboard, ⌘A select all on
 * the current unit. All of them sit behind the same guard, so a focused text
 * field keeps its own Delete, arrows and ⌘A.
 *
 * Pointer-gesture concerns (pan state, its own blur cancellation) remain
 * stage-local by design — this hook owns keys, not gestures.
 */
import { useEffect, useRef, useState, type Dispatch } from 'react';
import type { EditorUiAction } from './state/editor-ui';

/**
 * Inputs that take no typed text. Focus lands on them after a pick or a
 * click (a colour chosen in the inspector leaves focus on the colour input),
 * and they have no use for ⌘Z, Delete or the arrows — so they must not
 * silence the document's shortcuts (Slice C decision C-6). `range` and
 * `radio` are deliberately absent: arrows belong to them.
 */
const CONTROL_INPUT_TYPES = new Set(['color', 'checkbox', 'button', 'submit', 'reset']);

/** The one authoritative guard: keys belong to the focused editable surface. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === 'INPUT') return !CONTROL_INPUT_TYPES.has((el as HTMLInputElement).type);
  return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
}

/**
 * A focused button or control input. Not a typing surface, but Space and
 * Enter are how the keyboard activates it — those two stay native.
 */
export function isControlTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === 'BUTTON') return true;
  return el.tagName === 'INPUT' && CONTROL_INPUT_TYPES.has((el as HTMLInputElement).type);
}

/** Contract #26: arrows nudge 0.5 mm, Shift 5 mm. */
export const NUDGE_MM = 0.5;
export const NUDGE_SHIFT_MM = 5;

export interface EditorKeyHandlers {
  onUndo: () => void;
  onRedo: () => void;
  /** Slice C object operations — optional so a surface can omit them. */
  onDelete?: () => void;
  onNudge?: (dx: number, dy: number) => void;
  onDuplicate?: () => void;
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
  onSelectAll?: () => void;
}

export function useEditorKeyboard(
  uiDispatch: Dispatch<EditorUiAction>,
  handlers: EditorKeyHandlers
): { spaceHeld: boolean } {
  const [spaceHeld, setSpaceHeld] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (isControlTarget(e.target) && (e.key === ' ' || e.key === 'Enter')) return;

      // ⌘Z / ⇧⌘Z — document history (contract #24/#26). The typing guard above
      // is what keeps in-field undo native while a numeric draft is focused.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) handlersRef.current.onRedo();
        else handlersRef.current.onUndo();
        return;
      }

      const h = handlersRef.current;
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        const chord =
          k === 'd' ? h.onDuplicate : k === 'c' ? h.onCopy : k === 'x' ? h.onCut : k === 'v' ? h.onPaste : k === 'a' ? h.onSelectAll : undefined;
        if (chord) {
          e.preventDefault(); // ⌘D would bookmark, ⌘A would select the page text
          chord();
          return;
        }
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && h.onDelete) {
        e.preventDefault();
        h.onDelete();
        return;
      }

      if (e.key.startsWith('Arrow') && h.onNudge && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const d = e.shiftKey ? NUDGE_SHIFT_MM : NUDGE_MM;
        const v =
          e.key === 'ArrowLeft' ? [-d, 0] : e.key === 'ArrowRight' ? [d, 0] : e.key === 'ArrowUp' ? [0, -d] : e.key === 'ArrowDown' ? [0, d] : null;
        if (v) {
          e.preventDefault(); // arrows must not scroll the page
          h.onNudge(v[0]!, v[1]!);
          return;
        }
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
