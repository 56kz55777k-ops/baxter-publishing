'use client';

/**
 * Read-only unit navigation (Slice A): the document's units as quiet text
 * rows — Front cover, spreads, Back cover — click to navigate. Thumbnails,
 * page management and reordering belong to later slices (I).
 */
import type { UnitOfView } from '@baxter/domain';
import { useEditorUi } from './state/editor-ui-context';

function pageRange(nums: readonly number[]): string {
  if (nums.length === 1) return String(nums[0]);
  return `${nums[0]}–${nums[nums.length - 1]}`;
}

export function UnitList({
  units,
  onNavigate,
}: {
  units: UnitOfView[];
  onNavigate: (index: number) => void;
}) {
  const ui = useEditorUi();
  return (
    <nav
      aria-label="Pages"
      className="w-52 shrink-0 overflow-y-auto border-r border-rule bg-canvas py-4"
    >
      <p className="metadata text-ink-faint px-5 mb-3">Pages</p>
      <ul>
        {units.map((u, i) => {
          const current = i === ui.unitIndex;
          return (
            <li key={u.pageNumbers[0]}>
              <button
                type="button"
                onClick={() => onNavigate(i)}
                aria-current={current ? 'true' : undefined}
                className={
                  'flex w-full items-baseline justify-between px-5 py-2 text-left text-caption transition-colors duration-400 ease-gentle ' +
                  (current
                    ? 'border-l-2 border-accent text-ink bg-white/50'
                    : 'border-l-2 border-transparent text-ink-soft hover:text-ink')
                }
              >
                <span>{u.label}</span>
                <span className="metadata text-ink-faint">{pageRange(u.pageNumbers)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
