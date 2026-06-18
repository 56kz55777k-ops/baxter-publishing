/**
 * Transactional email via Resend (server-only).
 *
 * Clean integration point: until `RESEND_API_KEY` is set in the environment,
 * `sendAdminEmail` logs and no-ops (returns `{ sent: false }`) so the rest of
 * the app works without it. Once the key is added, sends are live with no code
 * change. Plain REST (no SDK dependency).
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM ?? 'Baxter <onboarding@resend.dev>';
const ADMIN_TO = process.env.ADMIN_NOTIFICATION_EMAIL ?? 'benjamin@benjamingibson.ca';

export interface AdminEmail {
  subject: string;
  text: string;
}

/** Send a plain-text notification to the Baxter admin address. */
export async function sendAdminEmail(email: AdminEmail): Promise<{ sent: boolean }> {
  if (!RESEND_API_KEY) {
    console.warn('sendAdminEmail: RESEND_API_KEY not set — skipping send', {
      subject: email.subject,
      to: ADMIN_TO,
    });
    return { sent: false };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: ADMIN_TO,
      subject: email.subject,
      text: email.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend send failed (${res.status}): ${body}`);
  }
  return { sent: true };
}
