'use client';

/**
 * The creation size readout — `W × H mm` (contract #3).
 *
 * DOM, not Konva, and deliberately so: the pill is editor chrome, not
 * publication content. Anything drawn on the canvas is something a reader
 * could mistake for the work; keeping transient measurement out of the scene
 * graph also means it can never be exported, screenshotted into a visual
 * regression baseline, or accidentally serialized.
 *
 * Units are written here because this is a measurement readout, not a
 * geometry field — the inspector's "consistent by absence" rule (#18) governs
 * editable values, not the live pill, which the spike also labelled.
 */
import { formatNum } from '@baxter/domain';

export function SizeReadout({ readout }: { readout: { widthMm: number; heightMm: number } | null }) {
  if (!readout) return null;
  return (
    <div
      data-testid="size-readout"
      className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-sm border border-rule bg-canvas/95 px-3 py-1.5"
    >
      <span className="metadata tabular-nums text-ink">
        {formatNum(readout.widthMm)} × {formatNum(readout.heightMm)} mm
      </span>
    </div>
  );
}
