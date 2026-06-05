import { inngest } from './client';

/**
 * Stub preflight function.
 *
 * Slice 3a wiring lands the plumbing — Inngest client, serve handler,
 * one function so the Inngest dashboard has something to display after
 * sync. Slice 3b replaces this body with the real preflight worker:
 * download the artifact from R2, run checks (page count vs format,
 * embedded fonts, image DPI, bleed, dimensions), write the result back
 * to the artifact's preflight jsonb, and promote the object from
 * quarantine to the clean bucket when checks pass.
 *
 * For now: receive the event, log the payload shape, return ok.
 */
const preflightStub = inngest.createFunction(
  { id: 'publication-preflight' },
  { event: 'publication/artifact.uploaded' },
  async ({ event }) => {
    console.log('preflight stub: received event', {
      name: event.name,
      data: event.data,
    });
    return { ok: true, received: event.data };
  }
);

/**
 * The set of functions registered with Inngest. The serve handler reads
 * this list when Inngest Cloud syncs the app.
 */
export const functions = [preflightStub];
