'use client';

/**
 * The inspector — the primary editing surface (contract #18).
 *
 * Contextual: page settings when nothing is selected, the single-object panel
 * when one element is. The multi-object panel (`N objects · M locked`, shared
 * properties, em-dash mixed values) belongs to Slice C's multi-selection and
 * is not stubbed here — an empty panel that promises a feature is worse than
 * an honest one that doesn't.
 *
 * Every control on this panel is wired. Sections that would only be
 * decoration for rect/ellipse are absent rather than disabled: the type
 * sections for image, text and line arrive with their slices.
 *
 * Token discipline (R12): one 14 px inset so no control touches a panel edge,
 * 26 px field height, one radius/border/background, one restrained oxblood
 * focus ring, and `fieldset { min-width: 0 }` for the min-content quirk that
 * otherwise blows the panel's width out. Disabled state is fieldset-driven
 * with a default cursor — never `not-allowed` as decoration.
 *
 * Geometry is implied-mm: units are written nowhere here, which is contract
 * #18's "consistent by absence".
 */
import { useCallback } from 'react';
import type { EditorElement } from '@baxter/domain';
import {
  FINE_BOUNDS,
  GEOMETRY_BOUNDS,
  NumField,
  PERCENT_BOUNDS,
  SIZE_BOUNDS,
} from './NumField';
import type { ArrangeOp } from '@baxter/domain';

/** Picking a colour on a None stroke assigns this width (contract #18). */
const DEFAULT_STROKE_WIDTH = 0.5;
/** Setting a width on a None stroke assigns this colour (contract #18). */
const DEFAULT_STROKE_COLOR = '#1a1a1a';

export interface InspectorProps {
  element: EditorElement | null;
  /** Page context shown when nothing is selected. */
  page: { formatName: string; marginMm: number; safeMm: number };
  selectionCount: number;
  disabled: boolean;
  onPatch: (patch: Record<string, unknown>, label: string) => void;
  onArrange: (op: ArrangeOp) => void;
  onSetLocked: (locked: boolean) => void;
}

export function Inspector(props: InspectorProps) {
  const { element, page, selectionCount, disabled } = props;

  return (
    <aside
      data-testid="inspector"
      className="flex w-[280px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-rule bg-canvas p-[14px]"
    >
      {element ? (
        <SingleObjectPanel {...props} element={element} />
      ) : selectionCount > 1 ? (
        <Section title={`${selectionCount} objects`}>
          <p className="text-caption text-ink-faint">
            Editing several objects at once arrives with movement and multi-selection.
          </p>
        </Section>
      ) : (
        <Section title="Page">
          <Row label="Format" value={page.formatName} />
          <Row label="Margin" value={String(page.marginMm)} />
          <Row label="Safe" value={String(page.safeMm)} />
          <p className="pt-1 text-caption text-ink-faint">
            Margin and safe are editorial guides for this publication.
          </p>
        </Section>
      )}
      {disabled && null}
    </aside>
  );
}

function SingleObjectPanel({
  element,
  disabled,
  onPatch,
  onArrange,
  onSetLocked,
}: InspectorProps & { element: EditorElement }) {
  const locked = element.locked;
  // Locked means untouchable, not unselectable (contract #20): the panel keeps
  // the object's identity and the Unlock affordance, and every mutating
  // control below is fieldset-disabled.
  const mutationsDisabled = disabled || locked;

  const patch = useCallback(
    (p: Record<string, unknown>, label: string) => onPatch(p, label),
    [onPatch]
  );

  const hasSize = element.type === 'rect' || element.type === 'ellipse' || element.type === 'image';
  const hasStroke = element.type === 'rect' || element.type === 'ellipse' || element.type === 'line';
  const stroke = hasStroke ? (element as { stroke: string | null }).stroke : null;
  const strokeWidth = hasStroke ? (element as { strokeWidth: number }).strokeWidth : 0;

  return (
    <>
      {locked && (
        <div className="rounded-sm border border-rule bg-[#f2e7e5] px-3 py-2" data-testid="locked-banner">
          <p className="text-caption text-ink">This object is locked.</p>
        </div>
      )}

      <Fieldset title="Position &amp; Size" disabled={mutationsDisabled}>
        <div className="grid grid-cols-2 gap-2">
          <NumField
            label="X"
            value={element.x}
            bounds={GEOMETRY_BOUNDS}
            disabled={mutationsDisabled}
            onCommit={(x) => patch({ x }, 'Set X')}
          />
          <NumField
            label="Y"
            value={element.y}
            bounds={GEOMETRY_BOUNDS}
            disabled={mutationsDisabled}
            onCommit={(y) => patch({ y }, 'Set Y')}
          />
          {hasSize && (
            <>
              <NumField
                label="W"
                value={(element as { width: number }).width}
                bounds={SIZE_BOUNDS}
                disabled={mutationsDisabled}
                onCommit={(width) => patch({ width }, 'Set width')}
              />
              <NumField
                label="H"
                value={(element as { height: number }).height}
                bounds={SIZE_BOUNDS}
                disabled={mutationsDisabled}
                onCommit={(height) => patch({ height }, 'Set height')}
              />
            </>
          )}
        </div>
      </Fieldset>

      {(element.type === 'rect' || element.type === 'ellipse') && (
        <Fieldset title="Fill &amp; Stroke" disabled={mutationsDisabled}>
          <Swatch
            label="Fill"
            value={element.fill}
            disabled={mutationsDisabled}
            onChange={(fill) => patch({ fill }, 'Set fill')}
          />
          <Swatch
            label="Stroke"
            value={stroke}
            disabled={mutationsDisabled}
            onChange={(next) =>
              // Picking a colour on a None stroke assigns a default width —
              // otherwise the colour would be invisible (contract #18).
              patch(
                stroke === null
                  ? { stroke: next, strokeWidth: DEFAULT_STROKE_WIDTH }
                  : { stroke: next },
                'Set stroke'
              )
            }
          />
          <NumField
            label="W"
            name="Stroke width"
            testId="num-stroke-width"
            value={strokeWidth}
            bounds={FINE_BOUNDS}
            disabled={mutationsDisabled}
            onCommit={(width) =>
              // Width 0 returns the stroke to None; a width on a None stroke
              // activates it with the default colour. None is first-class.
              patch(
                width === 0
                  ? { stroke: null, strokeWidth: 0 }
                  : { stroke: stroke ?? DEFAULT_STROKE_COLOR, strokeWidth: width },
                'Set stroke width'
              )
            }
          />
          {stroke === null && <p className="text-caption text-ink-faint">Stroke: none</p>}
        </Fieldset>
      )}

      <Fieldset title="Appearance" disabled={mutationsDisabled}>
        <NumField
          label="%"
          name="Opacity"
          testId="num-opacity"
          value={Math.round(element.opacity * 100)}
          bounds={PERCENT_BOUNDS}
          disabled={mutationsDisabled}
          onCommit={(percent) => patch({ opacity: percent / 100 }, 'Set opacity')}
        />
        {element.type === 'rect' && (
          <NumField
            label="R"
            name="Corner radius"
            testId="num-corner-radius"
            value={element.cornerRadius}
            bounds={FINE_BOUNDS}
            disabled={mutationsDisabled}
            onCommit={(cornerRadius) => patch({ cornerRadius }, 'Set corner radius')}
          />
        )}
      </Fieldset>

      <Fieldset title="Arrange" disabled={mutationsDisabled}>
        <div className="grid grid-cols-2 gap-2">
          <ArrangeButton label="To front" op="front" disabled={mutationsDisabled} onArrange={onArrange} />
          <ArrangeButton label="Forward" op="forward" disabled={mutationsDisabled} onArrange={onArrange} />
          <ArrangeButton label="Backward" op="backward" disabled={mutationsDisabled} onArrange={onArrange} />
          <ArrangeButton label="To back" op="back" disabled={mutationsDisabled} onArrange={onArrange} />
        </div>
      </Fieldset>

      <Fieldset title="Lock" disabled={disabled}>
        <button
          type="button"
          data-testid="lock-toggle"
          onClick={() => onSetLocked(!locked)}
          disabled={disabled}
          className="h-[26px] rounded-sm border border-rule px-3 text-caption text-ink transition-colors duration-400 ease-gentle hover:border-accent hover:text-accent"
        >
          {locked ? 'Unlock' : 'Lock'}
        </button>
      </Fieldset>
    </>
  );
}

function Fieldset({
  title,
  disabled,
  children,
}: {
  title: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    // min-width:0 is the R12 fix for the fieldset min-content quirk, which
    // otherwise forces the panel wider than its token width.
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="metadata pb-1 text-ink-faint">{title}</legend>
      {children}
    </fieldset>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="metadata pb-1 text-ink-faint">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="metadata text-ink-faint">{label}</span>
      <span className="text-caption tabular-nums text-ink">{value}</span>
    </div>
  );
}

/**
 * What the native colour control holds while the value is None. A native
 * colour input reports a choice only when its value CHANGES, so if None held
 * the latent #000000 (as it once did), choosing black from None was
 * indistinguishable from cancelling and the stroke could not be activated in
 * black. None therefore hands the picker a fixed placeholder that is not a
 * meaningful colour; black, the default and every ordinary choice are real
 * changes. (Picking exactly this hex — reachable only by typing it — is the
 * one choice the platform cannot report from None.)
 */
const NONE_PICKER_VALUE = '#010203';

function Swatch({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  /** null = None (contract #18): first-class, shown as "none", never as a latent colour. */
  value: string | null;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const isNone = value === null;
  return (
    <label
      className="flex items-center gap-2"
      data-testid={`swatch-${label.toLowerCase()}`}
      data-state={isNone ? 'none' : 'set'}
    >
      <span className="metadata w-10 shrink-0 text-ink-faint">{label}</span>
      <span className="relative h-[26px] w-[26px] shrink-0">
        {isNone && (
          // The conventional "none" mark: an empty chip crossed by one hairline
          // in the accent. The real colour control sits invisibly on top, so a
          // single pick from here both chooses the colour and activates it.
          <svg
            aria-hidden="true"
            data-testid={`swatch-${label.toLowerCase()}-none`}
            viewBox="0 0 26 26"
            className="pointer-events-none absolute inset-0 h-full w-full rounded-sm border border-rule bg-canvas"
          >
            <line x1="3" y1="23" x2="23" y2="3" style={{ stroke: 'var(--accent)' }} strokeWidth="1.25" strokeLinecap="round" />
          </svg>
        )}
        <input
          type="color"
          disabled={disabled}
          aria-label={isNone ? `${label} colour: none` : `${label} colour`}
          data-testid={`swatch-${label.toLowerCase()}-input`}
          value={isNone ? NONE_PICKER_VALUE : value}
          onChange={(e) => onChange(e.target.value)}
          className={
            'h-[26px] w-[26px] cursor-pointer rounded-sm border border-rule bg-canvas p-0 ' +
            (isNone ? 'absolute inset-0 opacity-0' : '')
          }
        />
      </span>
    </label>
  );
}

function ArrangeButton({
  label,
  op,
  disabled,
  onArrange,
}: {
  label: string;
  op: ArrangeOp;
  disabled: boolean;
  onArrange: (op: ArrangeOp) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onArrange(op)}
      data-testid={`arrange-${op}`}
      className="h-[26px] rounded-sm border border-rule px-2 text-caption text-ink transition-colors duration-400 ease-gentle hover:border-accent hover:text-accent"
    >
      {label}
    </button>
  );
}
