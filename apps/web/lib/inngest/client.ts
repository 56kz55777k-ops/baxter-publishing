import { Inngest } from 'inngest';

/**
 * The Inngest client.
 *
 * Reads INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY from process.env. The
 * SDK pulls them automatically — never log or surface them from here.
 */
export const inngest = new Inngest({ id: 'baxter-publishing' });
