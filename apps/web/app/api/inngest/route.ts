import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { functions } from '@/lib/inngest/functions';

/**
 * The Inngest endpoint.
 *
 * Inngest Cloud calls this endpoint to discover registered functions
 * (PUT during sync), invoke them (POST per event), and probe health
 * (GET). The serve handler verifies request signatures against
 * INNGEST_SIGNING_KEY automatically.
 *
 * Production URL: https://baxter-publishing-web.vercel.app/api/inngest
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
