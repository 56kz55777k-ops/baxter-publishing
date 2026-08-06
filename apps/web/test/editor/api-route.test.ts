/**
 * Save/init route contract — 200/400/401/404/409/423, revision arithmetic,
 * schema_version derivation, first-open race convergence, and the two-client
 * conflict interleaving (blueprint §2.6) — against a STATEFUL fake Supabase
 * client that applies the conditional-update semantics for real.
 *
 * Live-database repeats of the race and conflict scenarios run during slice
 * verification (they need credentials this environment doesn't hold).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getFormatPreset, newEditorDoc } from '@baxter/domain';

// ---------------------------------------------------------------------------
// Stateful fake
// ---------------------------------------------------------------------------

interface FakeDocRow {
  publication_id: string;
  doc: unknown;
  schema_version: number;
  revision: number;
  updated_at: string;
  updated_by: string | null;
  autosave_state?: unknown;
}

interface FakeState {
  user: { id: string } | null;
  publication: {
    id: string;
    creator_id: string;
    status: string;
    format_preset_id: string | null;
    title: string;
  } | null;
  docRow: FakeDocRow | null;
  upsertError: string | null;
  upsertCalls: unknown[];
}

const state: FakeState = {
  user: null,
  publication: null,
  docRow: null,
  upsertError: null,
  upsertCalls: [],
};

function fakeFrom(table: string) {
  if (table === 'publications') {
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: state.publication }) }),
      }),
    };
  }
  if (table === 'editor_documents') {
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: state.docRow }) }),
      }),
      upsert: async (row: Record<string, unknown>) => {
        state.upsertCalls.push(row);
        if (state.upsertError) return { error: { message: state.upsertError } };
        if (!state.docRow) {
          state.docRow = {
            publication_id: row.publication_id as string,
            doc: row.doc,
            schema_version: row.schema_version as number,
            revision: row.revision as number,
            updated_at: new Date().toISOString(),
            updated_by: row.updated_by as string,
          };
        }
        // Existing row: ON CONFLICT DO NOTHING — state untouched, no error.
        return { error: null };
      },
      update: (payload: Record<string, unknown>) => {
        const eqs: Array<[string, unknown]> = [];
        const chain = {
          eq(col: string, val: unknown) {
            eqs.push([col, val]);
            return chain;
          },
          async select() {
            const base = eqs.find(([c]) => c === 'revision')?.[1];
            if (state.docRow && state.docRow.revision === base) {
              state.docRow = {
                ...state.docRow,
                doc: payload.doc,
                schema_version: payload.schema_version as number,
                revision: payload.revision as number,
                updated_by: payload.updated_by as string,
                autosave_state: payload.autosave_state,
              };
              return { data: [{ revision: state.docRow.revision }], error: null };
            }
            return { data: [], error: null };
          },
        };
        return chain;
      },
    };
  }
  throw new Error(`unexpected table: ${table}`);
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: fakeFrom,
  }),
}));

import { POST, PUT } from '@/app/api/editor/[id]/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PUB_ID = '7d9f4c2e-1b3a-4f6d-9e8c-2a5b7c9d1e3f';
const OWNER = { id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' };
const CLIENT_A = 'c0ffee00-aaaa-4bbb-8ccc-000000000001';
const CLIENT_B = 'c0ffee00-aaaa-4bbb-8ccc-000000000002';

const params = Promise.resolve({ id: PUB_ID });

function putReq(body: unknown): NextRequest {
  return new NextRequest(`http://test.local/api/editor/${PUB_ID}`, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function postReq(): NextRequest {
  return new NextRequest(`http://test.local/api/editor/${PUB_ID}`, { method: 'POST' });
}

function ownedDraftPublication() {
  return {
    id: PUB_ID,
    creator_id: OWNER.id,
    status: 'draft',
    format_preset_id: 'zine_a5',
    title: 'Test',
  };
}

function validDoc() {
  return newEditorDoc(getFormatPreset('zine_a5')!);
}

beforeEach(() => {
  state.user = OWNER;
  state.publication = ownedDraftPublication();
  state.docRow = null;
  state.upsertError = null;
  state.upsertCalls = [];
});

// ---------------------------------------------------------------------------
// POST — create-if-absent
// ---------------------------------------------------------------------------

describe('POST /api/editor/[id] — initialization', () => {
  it('401 when signed out', async () => {
    state.user = null;
    const res = await POST(postReq(), { params });
    expect(res.status).toBe(401);
  });

  it('404 when the publication is not the caller’s', async () => {
    state.publication!.creator_id = 'someone-else';
    const res = await POST(postReq(), { params });
    expect(res.status).toBe(404);
  });

  it('423 outside the editable window', async () => {
    state.publication!.status = 'in_review';
    const res = await POST(postReq(), { params });
    expect(res.status).toBe(423);
  });

  it('400 when the publication has no usable format preset', async () => {
    state.publication!.format_preset_id = null;
    const res = await POST(postReq(), { params });
    expect(res.status).toBe(400);
  });

  it('creates revision 0 with a preset-derived document on first open', async () => {
    const res = await POST(postReq(), { params });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { doc: { pages: unknown[] }; revision: number };
    expect(body.revision).toBe(0);
    expect(body.doc.pages).toHaveLength(4); // zine: cover + 2 interiors + back
    expect(state.docRow?.schema_version).toBe(1);
  });

  it('simultaneous first opens converge on one row (ON CONFLICT DO NOTHING + re-select)', async () => {
    const [resA, resB] = await Promise.all([
      POST(postReq(), { params }),
      POST(postReq(), { params }),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const a = (await resA.json()) as { doc: unknown; revision: number };
    const b = (await resB.json()) as { doc: unknown; revision: number };
    expect(a.revision).toBe(0);
    expect(b.revision).toBe(0);
    // Both callers read the SAME surviving row, whichever insert won.
    expect(JSON.stringify(a.doc)).toBe(JSON.stringify(b.doc));
    expect(state.upsertCalls.length).toBe(2);
  });

  it('a later POST returns the existing document, never re-initializes', async () => {
    await POST(postReq(), { params });
    const existing = state.docRow!.doc;
    const res = await POST(postReq(), { params });
    const body = (await res.json()) as { doc: unknown; revision: number };
    expect(JSON.stringify(body.doc)).toBe(JSON.stringify(existing));
  });
});

// ---------------------------------------------------------------------------
// PUT — conditional save
// ---------------------------------------------------------------------------

describe('PUT /api/editor/[id] — revision-guarded save', () => {
  it('401 / 404 / 423 mirror the POST guards', async () => {
    state.user = null;
    expect((await PUT(putReq({}), { params })).status).toBe(401);

    state.user = OWNER;
    state.publication = null;
    expect((await PUT(putReq({}), { params })).status).toBe(404);

    state.publication = ownedDraftPublication();
    state.publication.status = 'published';
    expect(
      (await PUT(putReq({ doc: validDoc(), baseRevision: 0, clientId: CLIENT_A }), { params }))
        .status
    ).toBe(423);
  });

  it('400 on malformed envelope (missing fields, bad types)', async () => {
    expect((await PUT(putReq(null), { params })).status).toBe(400);
    expect((await PUT(putReq({ doc: validDoc() }), { params })).status).toBe(400);
    expect(
      (await PUT(putReq({ doc: validDoc(), baseRevision: -1, clientId: CLIENT_A }), { params }))
        .status
    ).toBe(400);
    expect(
      (await PUT(putReq({ doc: validDoc(), baseRevision: 0, clientId: 'not-a-uuid' }), { params }))
        .status
    ).toBe(400);
  });

  it('400 on an invalid document and on an unsupported future schemaVersion', async () => {
    const badDoc = { schemaVersion: 1, meta: {}, pages: [] };
    expect(
      (await PUT(putReq({ doc: badDoc, baseRevision: 0, clientId: CLIENT_A }), { params })).status
    ).toBe(400);

    const future = { ...validDoc(), schemaVersion: 2 };
    const res = await PUT(putReq({ doc: future, baseRevision: 0, clientId: CLIENT_A }), { params });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toMatch(/newer editor/);
  });

  it('404 when no document row exists yet', async () => {
    const res = await PUT(putReq({ doc: validDoc(), baseRevision: 0, clientId: CLIENT_A }), {
      params,
    });
    expect(res.status).toBe(404);
  });

  it('200: increments the revision and derives schema_version from the validated doc', async () => {
    await POST(postReq(), { params });
    const doc = validDoc();
    const res = await PUT(putReq({ doc, baseRevision: 0, clientId: CLIENT_A }), { params });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { revision: number }).revision).toBe(1);
    expect(state.docRow?.revision).toBe(1);
    expect(state.docRow?.schema_version).toBe(1);
    expect(
      (state.docRow?.autosave_state as { lastClientId: string }).lastClientId
    ).toBe(CLIENT_A);
  });

  it('two-client interleaving: first write wins, second gets 409 + serverRevision (blueprint §2.6)', async () => {
    await POST(postReq(), { params }); // both tabs load { revision: 0 }

    // T2 — tab A saves against base 0 and wins.
    const resA = await PUT(putReq({ doc: validDoc(), baseRevision: 0, clientId: CLIENT_A }), {
      params,
    });
    expect(resA.status).toBe(200);
    expect(((await resA.json()) as { revision: number }).revision).toBe(1);

    // T4 — tab B saves against the same base 0 and must lose, loudly.
    const resB = await PUT(putReq({ doc: validDoc(), baseRevision: 0, clientId: CLIENT_B }), {
      params,
    });
    expect(resB.status).toBe(409);
    const body = (await resB.json()) as { serverRevision: number };
    expect(body.serverRevision).toBe(1);

    // Tab B's write is BLOCKED: the stored doc is still tab A's save.
    expect((state.docRow?.autosave_state as { lastClientId: string }).lastClientId).toBe(CLIENT_A);
    expect(state.docRow?.revision).toBe(1);

    // Symmetry: A continues from its acknowledged revision without conflict.
    const resA2 = await PUT(putReq({ doc: validDoc(), baseRevision: 1, clientId: CLIENT_A }), {
      params,
    });
    expect(resA2.status).toBe(200);
    expect(((await resA2.json()) as { revision: number }).revision).toBe(2);
  });

  it('stale base after several saves conflicts with the CURRENT server revision', async () => {
    await POST(postReq(), { params });
    await PUT(putReq({ doc: validDoc(), baseRevision: 0, clientId: CLIENT_A }), { params });
    await PUT(putReq({ doc: validDoc(), baseRevision: 1, clientId: CLIENT_A }), { params });

    const res = await PUT(putReq({ doc: validDoc(), baseRevision: 0, clientId: CLIENT_B }), {
      params,
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { serverRevision: number }).serverRevision).toBe(2);
  });
});
