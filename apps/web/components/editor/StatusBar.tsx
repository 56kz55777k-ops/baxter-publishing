'use client';

/**
 * Bottom strip: tools (Select/Hand), fit controls, zoom readout.
 * View-only controls stay live in read-only states — looking is not editing.
 */
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

export function StatusBar({
  onFitPage,
  onFitSpread,
  onHundred,
  spreadFitLabel,
}: {
  onFitPage: () => void;
  onFitSpread: () => void;
  onHundred: () => void;
  spreadFitLabel: string;
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
      <div className="flex-1" />
      <BarButton label="Fit page" onClick={onFitPage} />
      <BarButton label={spreadFitLabel} onClick={onFitSpread} />
      <BarButton label="100%" onClick={onHundred} />
      <span className="metadata text-ink-faint ml-3 w-12 text-right tabular-nums">{zoomPct}%</span>
    </div>
  );
}
