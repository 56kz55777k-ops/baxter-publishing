/**
 * D-032 — an unreadable catalogue must never render as an empty one.
 *
 * The public catalogue reads (home, /publications, a creator's shelf) used to
 * discard the Supabase `error` and fall back to `data ?? []`, so a paused or
 * unreachable database looked exactly like "no publications yet". These tests
 * drive the real query module against a fake client whose tables answer with
 * rows, nothing, or an error, and pin the three outcomes apart:
 *   healthy + empty  → [] and no log;
 *   query failure    → CatalogueUnavailableError, one structured log line;
 *   cover failure    → cards without covers (non-fatal), logged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// images.ts reads the account hash once at module load, so it must exist
// before the query module is imported (vi.hoisted runs ahead of imports).
vi.hoisted(() => {
  process.env.CLOUDFLARE_IMAGES_ACCOUNT_HASH = 'test-hash';
});
import {
  CatalogueUnavailableError,
  composeHome,
  getAllPublished,
  getCreatorPublished,
  getEditorsPicks,
  getNewReleases,
  readCatalogue,
} from '@/lib/marketplace/queries';

type Answer = { data: unknown; error: { code?: string; message: string } | null };

/** A chainable stand-in for the PostgREST builder: every filter returns
 * itself; awaiting it yields the table's configured answer. */
function fakeDb(answers: Record<string, Answer>): SupabaseClient {
  return {
    from(table: string) {
      const answer = answers[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'not', 'order', 'limit', 'in'])
        builder[m] = () => builder;
      builder.then = (ok: (v: Answer) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(answer).then(ok, ko);
      return builder;
    },
  } as unknown as SupabaseClient;
}

const PUB = {
  id: 'p1',
  title: 'Work',
  slug: 'work',
  creator_id: 'u1',
  cover_asset_id: 'a1',
  format_preset_id: null,
  interior: null,
  page_count: null,
  price_minor: null,
  currency: 'CAD',
};
const USER = { id: 'u1', handle: 'maker', display_name: 'A Maker' };
const OUTAGE = { code: 'PGRST002', message: 'Could not query the database for the schema cache. Retrying.' };

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  log = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
});

describe('healthy database, zero publications', () => {
  it.each([
    ['editors picks', (db: SupabaseClient) => getEditorsPicks(db)],
    ['new releases', (db: SupabaseClient) => getNewReleases(db)],
    ['all published', (db: SupabaseClient) => getAllPublished(db)],
    ['creator shelf', (db: SupabaseClient) => getCreatorPublished(db, 'u1')],
  ])('%s → [] and nothing logged', async (_n, read) => {
    await expect(read(fakeDb({ publications: { data: [], error: null } }))).resolves.toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it('a null data with no error is still a healthy empty result', async () => {
    await expect(getAllPublished(fakeDb({ publications: { data: null, error: null } }))).resolves.toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it('readCatalogue reports an empty home as ok, not unavailable', async () => {
    await expect(readCatalogue(composeHome(fakeDb({})))).resolves.toEqual({ ok: true, value: [] });
  });
});

describe('database or query unavailable', () => {
  it.each([
    ['editors_picks', (db: SupabaseClient) => getEditorsPicks(db)],
    ['new_releases', (db: SupabaseClient) => getNewReleases(db)],
    ['all_published', (db: SupabaseClient) => getAllPublished(db, { category: 'Poetry' })],
    ['creator_published', (db: SupabaseClient) => getCreatorPublished(db, 'u1')],
  ])('%s → CatalogueUnavailableError, never []', async (query, read) => {
    const p = read(fakeDb({ publications: { data: null, error: OUTAGE } }));
    await expect(p).rejects.toBeInstanceOf(CatalogueUnavailableError);
    await expect(p).rejects.toMatchObject({ query });
  });

  it('logs one structured line: query, code and message only', async () => {
    await getAllPublished(fakeDb({ publications: { data: null, error: OUTAGE } })).catch(() => {});
    expect(log).toHaveBeenCalledTimes(1);
    const [msg, detail] = log.mock.calls[0]!;
    expect(msg).toBe('catalogue: query failed');
    expect(detail).toEqual({ query: 'all_published', fatal: true, code: 'PGRST002', error: OUTAGE.message });
  });

  it('a network-level failure (no PostgREST code) is still distinguished', async () => {
    const fetchFailed = { message: 'TypeError: fetch failed' };
    await expect(
      getNewReleases(fakeDb({ publications: { data: null, error: fetchFailed } }))
    ).rejects.toBeInstanceOf(CatalogueUnavailableError);
    expect(log.mock.calls[0]![1]).toMatchObject({ code: null, error: 'TypeError: fetch failed' });
  });

  it('a failed creators read is fatal — it would otherwise skip every card into an empty shelf', async () => {
    const db = fakeDb({
      publications: { data: [PUB], error: null },
      users: { data: null, error: OUTAGE },
    });
    await expect(getAllPublished(db)).rejects.toMatchObject({ query: 'creators' });
  });

  it('readCatalogue turns the home failure into { ok: false } for the page', async () => {
    const db = fakeDb({ publications: { data: null, error: OUTAGE } });
    await expect(readCatalogue(composeHome(db))).resolves.toEqual({ ok: false });
  });

  it('readCatalogue does not hide unrelated errors', async () => {
    await expect(readCatalogue(Promise.reject(new TypeError('bug')))).rejects.toThrow('bug');
  });
});

describe('degraded but not empty', () => {
  it('a failed covers read keeps the cards (without covers) and logs it as non-fatal', async () => {
    const db = fakeDb({
      publications: { data: [PUB], error: null },
      users: { data: [USER], error: null },
      assets: { data: null, error: OUTAGE },
    });
    const cards = await getAllPublished(db);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: 'p1', href: '/maker/work', coverUrl: null });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![1]).toMatchObject({ query: 'covers', fatal: false });
  });

  it('a healthy shelf resolves cards with covers and logs nothing', async () => {
    const db = fakeDb({
      publications: { data: [PUB], error: null },
      users: { data: [USER], error: null },
      assets: { data: [{ id: 'a1', external_id: 'img1' }], error: null },
    });
    const [card] = await getAllPublished(db);
    expect(card!.coverUrl).toContain('img1');
    expect(log).not.toHaveBeenCalled();
  });
});
