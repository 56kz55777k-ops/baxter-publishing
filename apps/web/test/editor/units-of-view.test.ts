import { describe, expect, it } from 'vitest';
import { computeUnits, type EditorPage } from '@baxter/domain';

function page(kind: EditorPage['kind']): EditorPage {
  return { id: crypto.randomUUID(), kind, elements: [] };
}

describe('computeUnits — spreads derived, never stored (contract #1)', () => {
  it('even interiors: cover single, interiors paired verso|recto, back single', () => {
    const pages = [page('cover'), page('interior'), page('interior'), page('interior'), page('interior'), page('back')];
    const units = computeUnits(pages);

    expect(units.map((u) => u.type)).toEqual(['single', 'spread', 'spread', 'single']);
    expect(units.map((u) => u.label)).toEqual(['Front cover', 'Spread 1', 'Spread 2', 'Back cover']);
    // Sequential page numbering across the whole document.
    expect(units.flatMap((u) => u.pageNumbers)).toEqual([1, 2, 3, 4, 5, 6]);
    // Pairing preserves document order: first spread is interiors [0,1].
    expect(units[1]!.pages.map((p) => p.id)).toEqual([pages[1]!.id, pages[2]!.id]);
  });

  it('odd interiors: trailing interior stands alone as "Page"', () => {
    const pages = [page('cover'), page('interior'), page('interior'), page('interior'), page('back')];
    const units = computeUnits(pages);

    expect(units.map((u) => u.type)).toEqual(['single', 'spread', 'single', 'single']);
    expect(units[2]!.label).toBe('Page');
    expect(units[2]!.pages).toHaveLength(1);
    expect(units.flatMap((u) => u.pageNumbers)).toEqual([1, 2, 3, 4, 5]);
  });

  it('spread labels number in reading order regardless of singles between', () => {
    const pages = [page('cover'), page('interior'), page('interior'), page('back')];
    const units = computeUnits(pages);
    expect(units.filter((u) => u.type === 'spread').map((u) => u.label)).toEqual(['Spread 1']);
  });

  it('tolerates documents without cover/back (defensive: units for interiors only)', () => {
    const pages = [page('interior'), page('interior')];
    const units = computeUnits(pages);
    expect(units).toHaveLength(1);
    expect(units[0]!.type).toBe('spread');
    expect(units[0]!.pageNumbers).toEqual([1, 2]);
  });
});
