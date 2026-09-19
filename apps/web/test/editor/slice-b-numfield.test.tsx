// @vitest-environment jsdom
/**
 * NumField — the buffered numeric contract end to end (#18, #19).
 *
 * The pure rules are pinned in slice-b-numeric.test.ts; this file proves the
 * component honours the *boundaries*: which keystrokes commit, which do not,
 * what Escape does, and that a field visited without a change writes nothing.
 * The no-write assertions matter most — they are what keeps a stray tab
 * through the inspector from filling the undo stack (#24).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NumField, SIZE_BOUNDS, FINE_BOUNDS, GEOMETRY_BOUNDS } from '@/components/editor/inspector/NumField';

let container: HTMLDivElement;
let root: Root;
let commits: number[] = [];

function render(value: number, bounds = GEOMETRY_BOUNDS) {
  act(() => {
    root.render(
      React.createElement(NumField, {
        label: 'X',
        value,
        bounds,
        onCommit: (n: number) => commits.push(n),
      })
    );
  });
  return container.querySelector('input') as HTMLInputElement;
}

function type(input: HTMLInputElement, text: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function key(input: HTMLInputElement, key: string, shiftKey = false) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
  });
}

// Real focus/blur: React delegates onFocus/onBlur through focusin/focusout,
// so a hand-dispatched FocusEvent would never reach the component.
function blur(input: HTMLInputElement) {
  act(() => {
    input.blur();
  });
}

function focus(input: HTMLInputElement) {
  act(() => {
    input.focus();
  });
}

beforeEach(() => {
  commits = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the draft is free while focused', () => {
  it('transitional strings are never parsed or committed', () => {
    const input = render(20);
    focus(input);
    for (const draft of ['', '-', '12.']) {
      type(input, draft);
      expect(input.value).toBe(draft); // the draft stands as typed
      expect(commits).toEqual([]);
    }
  });

  it('an invalid draft restores the last valid value on blur, writing nothing', () => {
    const input = render(20);
    focus(input);
    type(input, '12.');
    blur(input);
    expect(input.value).toBe('20');
    expect(commits).toEqual([]);
  });
});

describe('commit boundaries', () => {
  it('Enter commits and keeps focus', () => {
    const input = render(20);
    focus(input);
    type(input, '35');
    key(input, 'Enter');
    expect(commits).toEqual([35]);
  });

  it('blur commits', () => {
    const input = render(20);
    focus(input);
    type(input, '35');
    blur(input);
    expect(commits).toEqual([35]);
  });

  it('typing alone commits nothing — one edit is one intention, not per keystroke', () => {
    const input = render(20);
    focus(input);
    type(input, '3');
    type(input, '35');
    type(input, '357');
    expect(commits).toEqual([]);
  });

  it('a visit with no change writes nothing (#19 no-op rule)', () => {
    const input = render(20);
    focus(input);
    blur(input);
    expect(commits).toEqual([]);
  });

  it('committing the identical value writes nothing', () => {
    const input = render(20);
    focus(input);
    type(input, '20');
    key(input, 'Enter');
    expect(commits).toEqual([]);
  });
});

describe('Escape', () => {
  it('restores the value and leaves the field, writing nothing', () => {
    const input = render(20);
    focus(input);
    type(input, '999');
    key(input, 'Escape');
    expect(input.value).toBe('20');
    expect(commits).toEqual([]);
  });
});

describe('arrow stepping — each press is one deliberate entry', () => {
  it('steps by the field rate, and by the shift rate with Shift', () => {
    const input = render(20);
    focus(input);
    key(input, 'ArrowUp');
    key(input, 'ArrowDown');
    key(input, 'ArrowUp', true);
    expect(commits).toEqual([21, 19, 25]);
  });

  it('fine fields step 0.1 and shift-step 1', () => {
    const input = render(0.5, FINE_BOUNDS);
    focus(input);
    key(input, 'ArrowDown');
    key(input, 'ArrowUp', true);
    expect(commits).toEqual([0.4, 1.5]);
  });

  it('stepping at a bound writes nothing — no entry for a no-op press', () => {
    const input = render(2, SIZE_BOUNDS);
    focus(input);
    key(input, 'ArrowDown');
    expect(commits).toEqual([]);
  });

  it('clamps a typed value below the declared floor', () => {
    const input = render(20, SIZE_BOUNDS);
    focus(input);
    type(input, '0.5');
    key(input, 'Enter');
    expect(commits).toEqual([2]);
  });
});

describe('display and external changes', () => {
  it('shows the model exactly, with no native spinner', () => {
    const input = render(12.5);
    expect(input.value).toBe('12.5');
    expect(input.getAttribute('type')).toBe('text');
    expect(input.getAttribute('inputmode')).toBe('decimal');
  });

  it('follows an external change while unfocused', () => {
    let input = render(20);
    expect(input.value).toBe('20');
    input = render(44);
    expect(input.value).toBe('44');
  });
});
