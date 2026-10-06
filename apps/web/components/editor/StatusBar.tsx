'use client';

/**
 * Bottom strip: tools (Select/Hand/Rectangle/Ellipse), fit controls, zoom
 * readout. View-only controls stay live in read-only states — looking is not
 * editing.
 *
 * The creation tools are armed here by click — the "Toolbar click" phase of
 * the creation language (contract #3; Slice B plan §3). Rectangle also has its
 * accepted letter, R; ellipse has none in #26's map, so this button is its
 * only way in. Arming a tool is UI state, never a document change, exactly
 * like the R key; while the editor is read-only the stage refuses the pointer,
 * so an armed tool cannot create anything there. Text labels, not icons:
 * toolbar icons are listed as post-beta work in the production handoff.
 */
import { memo } from 'react';
import { zoomOf } from './geometry';
import { useEditorUi, useEditorUiDispatch } from './state/editor-ui-context';

function BarButton({
  label,
  active,
  onClick,
  title,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      // Tool buttons are toggles: the armed tool is announced, not only
      // underlined. Fit/zoom buttons pass no `active` and stay plain buttons.
      aria-pressed={active}
      onClick={onClick}
      className={
        'px-2.5 py-1 text-caption transition-colors duration-400 ease-gentle ' +
        (active ? 'text-ink underline underline-offset-4 decoration-accent' : 'text-ink-soft hover:text-ink')
      }
    >
      {label}
    </button>
  );
}

export const StatusBar = memo(function StatusBar({
  onFitPage,
  onFitSpread,
  onHundred,
  spreadFitLabel,
  announcement = '',
}: {
  onFitPage: () => void;
  onFitSpread: () => void;
  onHundred: () => void;
  spreadFitLabel: string;
  /** A calm, transient line — e.g. a delete that kept locked objects (#5). */
  announcement?: string;
}) {
  const ui = useEditorUi();
  const uiDispatch = useEditorUiDispatch();
  const zoomPct = Math.round(zoomOf(ui.view) * 100);

  return (
    <div className="flex h-10 shrink-0 items-center border-t border-rule bg-canvas px-3">
      <BarButton
        label="Select"
        title="Select (V)"
        active={ui.tool === 'select'}
        onClick={() => uiDispatch({ type: 'SET_TOOL', tool: 'select' })}
      />
      <BarButton
        label="Hand"
        title="Pan (H, or hold Space)"
        active={ui.tool === 'hand'}
        onClick={() => uiDispatch({ type: 'SET_TOOL', tool: 'hand' })}
      />
      <BarButton
        label="Rectangle"
        title="Rectangle (R)"
        active={ui.tool === 'rect'}
        onClick={() => uiDispatch({ type: 'SET_TOOL', tool: 'rect' })}
      />
      <BarButton
        label="Ellipse"
        title="Ellipse"
        active={ui.tool === 'ellipse'}
        onClick={() => uiDispatch({ type: 'SET_TOOL', tool: 'ellipse' })}
      />
      <p
        role="status"
        aria-live="polite"
        data-testid="editor-announcement"
        className="flex-1 truncate px-3 text-center text-caption text-ink-soft"
      >
        {announcement}
      </p>
      <BarButton label="Fit page" onClick={onFitPage} />
      <BarButton label={spreadFitLabel} onClick={onFitSpread} />
      <BarButton label="100%" onClick={onHundred} />
      <span className="metadata text-ink-faint ml-3 w-12 text-right tabular-nums">{zoomPct}%</span>
    </div>
  );
});
