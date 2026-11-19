/**
 * Slice D stage 8A — the harness's Node-side, revision-aware editor API mock
 * and the browser network fence (plan §8.2; Ben's 8A authorization §0.21).
 *
 * The mock implements the real route's contract (`app/api/editor/[id]/route.ts`):
 * - POST (create-if-absent): 200 `{ doc, revision }` — the stored document, or a
 *   fresh one if none.
 * - PUT `{ doc, baseRevision, clientId }`: applies iff `baseRevision` equals the
 *   current revision, then answers 200 `{ revision: r + 1 }`; otherwise 409
 *   `{ serverRevision }`. Scripted answers (409, 423, 500, a held response) are
 *   queued per test. A held write can commit later — after its browser context
 *   has gone offline or closed — exactly as a server keeps running.
 *
 * It lives in the Playwright worker (Node), so it is shared by every context a
 * test opens, and it is the only thing that ever answers an editor request: the
 * network fence aborts every request that is not a same-origin GET for the page
 * or its assets, or an editor API call — and records it as a failure.
 */
import type { BrowserContext, Request, Route } from '@playwright/test';
import type { EditorDoc } from '@baxter/domain';

export const ORIGIN = 'http://127.0.0.1:3008';
export const API_PATH = '/api/editor/e2e-harness';

export type Scripted =
  | { kind: 'status'; status: 409 | 423 | 500 | 400 }
  /** Hold the response until `release()`; `commit` decides whether the held write is applied first. */
  | { kind: 'hold'; commit: boolean };

export interface MockWrite {
  seq: number;
  method: 'PUT' | 'POST';
  baseRevision: number | null;
  /** The document as sent (PUT) — the whole document, as `save-payload.ts` builds it. */
  doc: EditorDoc | null;
  status: number | 'held' | 'aborted';
  at: number;
}

export interface Held {
  write: MockWrite;
  /** Answer now; with `commit`, apply the write to the store first (if its base still matches). */
  release(): Promise<void>;
  /** Apply the write to the store without answering (the browser may be gone). Returns true if applied. */
  commitLate(): boolean;
}

export class EditorMock {
  doc: EditorDoc | null;
  revision: number;
  writes: MockWrite[] = [];
  held: Held[] = [];
  private script: Scripted[] = [];
  private seq = 0;

  constructor(doc: EditorDoc | null, revision = 1) {
    this.doc = doc ? structuredClone(doc) : null;
    this.revision = doc ? revision : 0;
  }

  /** Queue scripted answers for the next PUTs, in order. */
  next(...s: Scripted[]) {
    this.script.push(...s);
  }

  get puts() {
    return this.writes.filter((w) => w.method === 'PUT');
  }

  /** The element with this id in the stored document. */
  element(id: string) {
    for (const p of this.doc?.pages ?? []) for (const e of p.elements) if (e.id === id) return e;
    return undefined;
  }

  /** A change made by "someone else" directly in the store, at a new revision (plan §8.2 r5). */
  humanEdit(fn: (doc: EditorDoc) => void) {
    if (!this.doc) throw new Error('no document');
    fn(this.doc);
    this.revision += 1;
  }

  /** The route's conditional update. */
  applyPut(baseRevision: number, doc: EditorDoc): { status: 200 | 409; revision: number } {
    if (baseRevision !== this.revision) return { status: 409, revision: this.revision };
    this.doc = structuredClone(doc);
    this.revision += 1;
    return { status: 200, revision: this.revision };
  }

  async handle(route: Route, request: Request) {
    const method = request.method();
    if (method === 'POST') {
      const w: MockWrite = { seq: ++this.seq, method: 'POST', baseRevision: null, doc: null, status: 200, at: Date.now() };
      this.writes.push(w);
      if (!this.doc) throw new Error('POST create-if-absent needs a seeded mock document');
      if (this.revision === 0) this.revision = 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ doc: this.doc, revision: this.revision }) });
    }
    if (method !== 'PUT') {
      return route.fulfill({ status: 405, body: '' });
    }
    const body = JSON.parse(request.postData() ?? '{}') as { doc: EditorDoc; baseRevision: number; clientId: string };
    const w: MockWrite = { seq: ++this.seq, method: 'PUT', baseRevision: body.baseRevision, doc: body.doc, status: 'held', at: Date.now() };
    this.writes.push(w);
    const s = this.script.shift();
    if (s?.kind === 'status') {
      w.status = s.status;
      const json = s.status === 409 ? { message: 'conflict', serverRevision: this.revision } : { message: 'scripted' };
      return route.fulfill({ status: s.status, contentType: 'application/json', body: JSON.stringify(json) });
    }
    if (s?.kind === 'hold') {
      let applied: { status: 200 | 409; revision: number } | null = null;
      const commitLate = () => {
        if (applied) return applied.status === 200;
        applied = this.applyPut(body.baseRevision, body.doc);
        return applied.status === 200;
      };
      await new Promise<void>((resolve) => {
        this.held.push({
          write: w,
          commitLate,
          release: async () => {
            if (s.commit) commitLate();
            const r = applied ?? { status: 409 as const, revision: this.revision };
            w.status = r.status;
            await route
              .fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.status === 200 ? { revision: r.revision } : { message: 'conflict', serverRevision: r.revision }) })
              .catch(() => {
                w.status = 'aborted'; // the context is gone; the commit (if any) stands
              });
            resolve();
          },
        });
      });
      return;
    }
    const r = this.applyPut(body.baseRevision, body.doc);
    w.status = r.status;
    return route.fulfill({
      status: r.status,
      contentType: 'application/json',
      body: JSON.stringify(r.status === 200 ? { revision: r.revision } : { message: 'This publication was edited somewhere else.', serverRevision: r.revision }),
    });
  }
}

export interface Fence {
  /** Requests the fence refused (anything not allowlisted). A test fails if non-empty. */
  unexpected: string[];
  /** Same-origin GETs it let through (page, RSC, assets), for the report. */
  allowed: string[];
  /**
   * Next.js `<Link>` PREFETCHES of other app routes (same-origin GET carrying `next-router-prefetch: 1`),
   * e.g. the editor's "back to the workspace" link. Aborted, never forwarded, and listed separately: they
   * are the app's normal background behaviour, not persistence and not a test failure.
   */
  prefetchBlocked: string[];
}

/**
 * Install the network fence on a context BEFORE any navigation. Allowed: same-origin GET for the
 * harness page (and its RSC requests) and `/_next/` assets; the editor API, answered by `mock`.
 * Everything else — other origins, other paths, other methods — is aborted and recorded.
 */
export async function fence(context: BrowserContext, mock: { handle: EditorMock['handle'] } | (() => EditorMock)): Promise<Fence> {
  const f: Fence = { unexpected: [], allowed: [], prefetchBlocked: [] };
  const getMock = typeof mock === 'function' ? mock : () => mock as EditorMock;
  await context.route('**/*', async (route, request) => {
    const url = new URL(request.url());
    const m = request.method();
    if (url.origin === ORIGIN && url.pathname === API_PATH) {
      return getMock().handle(route, request);
    }
    const sameOriginGet = url.origin === ORIGIN && (m === 'GET' || m === 'HEAD');
    if (sameOriginGet && (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/e2e-harness/') || url.pathname === '/favicon.ico')) {
      f.allowed.push(`${m} ${url.pathname}`);
      return route.continue();
    }
    const h = await request.allHeaders();
    if (url.origin === ORIGIN && m === 'GET' && h['next-router-prefetch'] === '1' && h['rsc'] === '1') {
      f.prefetchBlocked.push(`${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    f.unexpected.push(`${m} ${request.url()}`);
    return route.abort('blockedbyclient');
  });
  return f;
}
