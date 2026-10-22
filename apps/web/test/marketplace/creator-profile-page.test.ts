/**
 * D-032 — the creator's room (/[handle]) must tell "no such creator" apart
 * from "Baxter could not look".
 *
 * Before this fix, both generateMetadata and the page discarded the error
 * from the initial `users` lookup, so a database outage rendered as a 404
 * ("Not found — Baxter" and notFound()) before the shelf's readCatalogue()
 * guard could ever run. These tests drive the real page module and the real
 * query module against a fake Supabase client and pin the outcomes apart:
 *   healthy lookup        → the profile renders, shelf included;
 *   lookup finds nobody   → notFound() and "Not found" metadata, as before;
 *   `~pending-` handle    → notFound() without touching the database;
 *   lookup fails          → a calm unavailable page and noindex metadata,
 *                           one structured log line, no raw error shown;
 *   shelf fails after a healthy lookup → the profile renders, the shelf says
 *                           it is briefly unavailable;
 *   a programming error   → propagates; it is never reported as an outage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// images.ts reads the account hash once at module load; the shared state
// object lets the hoisted mocks below hand the page whichever fake client a
// test installs.
const h = vi.hoisted(() => {
  process.env.CLOUDFLARE_IMAGES_ACCOUNT_HASH = 'test-hash';
  return { db: null as unknown };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => h.db),
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children),
}));
vi.mock('@/app/(auth)/actions', () => ({ signOut: vi.fn() }));
vi.mock('@/components/follow-button', () => ({
  FollowButton: ({
    initialIsFollowing,
    isAuthed,
  }: {
    initialIsFollowing: boolean;
    isAuthed: boolean;
  }) =>
    React.createElement('span', {
      'data-testid': 'follow',
      'data-following': String(initialIsFollowing),
      'data-authed': String(isAuthed),
    }),
}));
vi.mock('@/components/publication-shelf', () => ({
  PublicationShelf: ({ cards }: { cards: { id: string; title: string }[] }) =>
    React.createElement(
      'ul',
      { 'data-testid': 'shelf' },
      cards.map((c) => React.createElement('li', { key: c.id }, c.title))
    ),
}));

import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import ProfilePage, { generateMetadata } from '@/app/[handle]/page';

type QueryError = { code?: string; message: string };
type Answer = { data?: unknown; count?: number | null; error: QueryError | null };
/** How one table answers: `single` for .maybeSingle() reads, `list` for the
 * rest; `throws` makes `from(table)` itself throw (a programming error). */
interface TableAnswers {
  single?: Answer;
  list?: Answer;
  throws?: Error;
}

/** A chainable stand-in for the Supabase client. Records which tables were
 * read so tests can prove what did NOT happen after a failed lookup. */
function fakeDb(tables: Record<string, TableAnswers>, user: { id: string } | null = null) {
  const queried: string[] = [];
  const getUser = vi.fn(async () => ({ data: { user }, error: null }));
  const db = {
    queried,
    auth: { getUser },
    from(table: string) {
      queried.push(table);
      const t = tables[table] ?? {};
      if (t.throws) throw t.throws;
      let single = false;
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'not', 'order', 'limit', 'in'])
        builder[m] = () => builder;
      builder.maybeSingle = () => {
        single = true;
        return builder;
      };
      builder.then = (ok: (v: Answer) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(
          single
            ? (t.single ?? { data: null, error: null })
            : (t.list ?? { data: [], count: 0, error: null })
        ).then(ok, ko);
      return builder;
    },
  };
  h.db = db;
  return db;
}

const PROFILE = {
  id: 'u1',
  handle: 'maker',
  display_name: 'A Maker',
  bio: 'Makes zines in a back room.',
  created_at: '2026-03-01T12:00:00Z',
};
const CREATOR = { id: 'u1', handle: 'maker', display_name: 'A Maker' };
const PUB = {
  id: 'p1',
  title: 'A Quiet Work',
  slug: 'a-quiet-work',
  creator_id: 'u1',
  cover_asset_id: null,
  format_preset_id: null,
  interior: null,
  page_count: null,
  price_minor: null,
  currency: 'CAD',
};
const OUTAGE: QueryError = {
  code: 'PGRST002',
  message: 'Could not query the database for the schema cache. Retrying.',
};

function healthy(overrides: Record<string, TableAnswers> = {}) {
  return {
    users: {
      single: { data: PROFILE, error: null },
      list: { data: [CREATOR], error: null },
    },
    follows: {
      list: { data: null, count: 3, error: null },
      single: { data: null, error: null },
    },
    publications: { list: { data: [PUB], error: null } },
    ...overrides,
  };
}

const params = (handle: string) => ({ params: Promise.resolve({ handle }) });

async function renderPage(handle: string): Promise<string> {
  return renderToStaticMarkup(await ProfilePage(params(handle)));
}

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  log = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(notFound).mockClear();
  vi.mocked(createClient).mockClear();
});
afterEach(() => {
  log.mockRestore();
  h.db = null;
});

describe('ProfilePage — healthy creator', () => {
  it('renders the profile and the shelf; nothing logged, no 404', async () => {
    const db = fakeDb(healthy());
    const html = await renderPage('maker');
    expect(html).toContain('A Maker');
    expect(html).toContain('Makes zines in a back room.');
    expect(html).toContain('3 followers');
    expect(html).toContain('<ul data-testid="shelf"><li>A Quiet Work</li></ul>');
    expect(html).toContain('data-authed="false"');
    expect(html).not.toContain('briefly unavailable');
    expect(html).not.toContain('data-catalogue="unavailable"');
    expect(notFound).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(db.queried).toEqual(['users', 'follows', 'publications', 'users']);
  });

  it('a healthy creator with no published work names the absence', async () => {
    fakeDb(healthy({ publications: { list: { data: [], error: null } } }));
    const html = await renderPage('maker');
    expect(html).toContain('No publications yet.');
    expect(html).not.toContain('briefly unavailable');
    expect(log).not.toHaveBeenCalled();
  });

  it('the signed-in creator sees Edit profile instead of Follow', async () => {
    const db = fakeDb(healthy(), { id: 'u1' });
    const html = await renderPage('maker');
    expect(html).toContain('href="/settings/profile"');
    expect(html).not.toContain('data-testid="follow"');
    // Their own follow row is never read.
    expect(db.queried.filter((t) => t === 'follows')).toHaveLength(1);
  });

  it('another signed-in reader sees their follow state', async () => {
    fakeDb(
      healthy({
        follows: {
          list: { data: null, count: 1, error: null },
          single: { data: { follower_id: 'u2' }, error: null },
        },
      }),
      { id: 'u2' }
    );
    const html = await renderPage('maker');
    expect(html).toContain('data-following="true"');
    expect(html).toContain('data-authed="true"');
    expect(html).toContain('1 follower<');
  });
});

describe('ProfilePage — no such creator', () => {
  it('a successful lookup that finds nobody is still a 404', async () => {
    const db = fakeDb(healthy({ users: { single: { data: null, error: null } } }));
    await expect(renderPage('nobody')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(db.queried).toEqual(['users']);
    expect(log).not.toHaveBeenCalled();
  });

  it.each(['~pending-3f9a', '%7Epending-3f9a'])(
    'pending handle %s is a 404 and never reaches the database',
    async (handle) => {
      const db = fakeDb(healthy());
      await expect(renderPage(handle)).rejects.toThrow('NEXT_NOT_FOUND');
      expect(createClient).not.toHaveBeenCalled();
      expect(db.queried).toEqual([]);
    }
  );
});

describe('ProfilePage — the profile lookup fails', () => {
  it('renders a calm unavailable page, not a 404, and reads nothing further', async () => {
    const db = fakeDb(healthy({ users: { single: { data: null, error: OUTAGE } } }));
    const html = await renderPage('maker');
    expect(notFound).not.toHaveBeenCalled();
    expect(html).toContain('data-catalogue="unavailable"');
    expect(html).toContain('This page is briefly unavailable.');
    expect(html).toContain('Please check back shortly.');
    expect(html).toContain('href="/"');
    // It does not claim the creator exists, or that they do not.
    expect(html).not.toContain('not on the shelf');
    expect(html).not.toContain('No publications yet');
    expect(html).not.toContain('maker');
    // No follow-up reads, no auth call, while the database is unreadable.
    expect(db.queried).toEqual(['users']);
    expect(db.auth.getUser).not.toHaveBeenCalled();
  });

  it('logs one structured line and shows no raw error', async () => {
    fakeDb(healthy({ users: { single: { data: null, error: OUTAGE } } }));
    const html = await renderPage('maker');
    expect(log).toHaveBeenCalledTimes(1);
    const [msg, detail] = log.mock.calls[0]!;
    expect(msg).toBe('catalogue: query failed');
    expect(detail).toEqual({
      query: 'creator_profile',
      fatal: true,
      code: 'PGRST002',
      error: OUTAGE.message,
    });
    expect(html).not.toContain('PGRST002');
    expect(html).not.toContain('schema cache');
  });

  it('a network-level failure (no PostgREST code) is unavailable too', async () => {
    fakeDb(healthy({ users: { single: { data: null, error: { message: 'TypeError: fetch failed' } } } }));
    const html = await renderPage('maker');
    expect(html).toContain('This page is briefly unavailable.');
    expect(notFound).not.toHaveBeenCalled();
    expect(log.mock.calls[0]![1]).toMatchObject({ query: 'creator_profile', code: null });
    expect(html).not.toContain('fetch failed');
  });
});

describe('ProfilePage — the shelf fails after a healthy lookup', () => {
  it('the profile renders; only the shelf says it is briefly unavailable', async () => {
    fakeDb(healthy({ publications: { list: { data: null, error: OUTAGE } } }));
    const html = await renderPage('maker');
    expect(notFound).not.toHaveBeenCalled();
    expect(html).toContain('A Maker');
    expect(html).toContain('publications are briefly unavailable');
    expect(html).not.toContain('This page is briefly unavailable.');
    expect(html).not.toContain('No publications yet');
    expect(html).not.toContain('data-testid="shelf"');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![1]).toMatchObject({ query: 'creator_published', fatal: true });
  });

  it('a failed creators read inside the shelf is the same unavailable shelf', async () => {
    fakeDb(
      healthy({
        users: {
          single: { data: PROFILE, error: null },
          list: { data: null, error: OUTAGE },
        },
      })
    );
    const html = await renderPage('maker');
    expect(html).toContain('A Maker');
    expect(html).toContain('publications are briefly unavailable');
    expect(log.mock.calls[0]![1]).toMatchObject({ query: 'creators' });
  });
});

describe('ProfilePage — programming errors are not outages', () => {
  it('an error thrown by the profile lookup propagates unchanged', async () => {
    fakeDb(healthy({ users: { throws: new TypeError('bug in the lookup') } }));
    await expect(renderPage('maker')).rejects.toThrow(TypeError);
    expect(notFound).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('an error thrown by the shelf read propagates unchanged', async () => {
    fakeDb(healthy({ publications: { throws: new TypeError('bug in the shelf') } }));
    await expect(renderPage('maker')).rejects.toThrow('bug in the shelf');
    expect(log).not.toHaveBeenCalled();
  });
});

describe('generateMetadata', () => {
  it('healthy creator → their name and bio', async () => {
    fakeDb(healthy());
    await expect(generateMetadata(params('maker'))).resolves.toEqual({
      title: 'A Maker — Baxter',
      description: 'Makes zines in a back room.',
    });
    expect(log).not.toHaveBeenCalled();
  });

  it('healthy creator without a bio → no description', async () => {
    fakeDb(healthy({ users: { single: { data: { ...PROFILE, bio: null }, error: null } } }));
    const meta = await generateMetadata(params('maker'));
    expect(meta).toMatchObject({ title: 'A Maker — Baxter' });
    expect(meta.description).toBeUndefined();
  });

  it('no such creator → Not found, as before', async () => {
    fakeDb(healthy({ users: { single: { data: null, error: null } } }));
    await expect(generateMetadata(params('nobody'))).resolves.toEqual({
      title: 'Not found — Baxter',
    });
    expect(log).not.toHaveBeenCalled();
  });

  it('pending handle → Not found without a database read', async () => {
    const db = fakeDb(healthy());
    await expect(generateMetadata(params('~pending-3f9a'))).resolves.toEqual({
      title: 'Not found — Baxter',
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(db.queried).toEqual([]);
  });

  it('failed lookup → unavailable, noindex, never "Not found"', async () => {
    fakeDb(healthy({ users: { single: { data: null, error: OUTAGE } } }));
    const meta = await generateMetadata(params('maker'));
    expect(meta).toEqual({
      title: 'Briefly unavailable — Baxter',
      robots: { index: false, follow: false },
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![1]).toMatchObject({ query: 'creator_profile', fatal: true });
  });

  it('an error thrown by the lookup propagates unchanged', async () => {
    fakeDb(healthy({ users: { throws: new TypeError('bug in the lookup') } }));
    await expect(generateMetadata(params('maker'))).rejects.toThrow(TypeError);
    expect(log).not.toHaveBeenCalled();
  });
});
