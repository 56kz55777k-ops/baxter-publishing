/**
 * Transactional email via Resend (server-only).
 *
 * Clean integration point: until `RESEND_API_KEY` is set in the environment,
 * `sendAdminEmail` logs and no-ops (returns `{ sent: false }`) so the rest of
 * the app works without it. Once the key is added, sends are live with no code
 * change. Plain REST (no SDK dependency).
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
// Matches the documented var in .env.example. Falls back to Resend's test
// sender, which works without a verified domain.
const FROM = process.env.RESEND_FROM_ADDRESS ?? 'Baxter <onboarding@resend.dev>';
const ADMIN_TO = process.env.ADMIN_NOTIFICATION_EMAIL ?? 'benjamin@benjamingibson.ca';

export interface AdminEmail {
  subject: string;
  text: string;
}

export interface Email {
  to: string;
  subject: string;
  text: string;
}

/**
 * Send a plain-text email to an arbitrary recipient. Same no-op-without-a-key
 * behaviour as `sendAdminEmail`. Used for creator decision emails (Slice 6),
 * where the recipient is the creator, not the Baxter admin.
 */
export async function sendEmail(email: Email): Promise<{ sent: boolean }> {
  if (!RESEND_API_KEY) {
    console.warn('sendEmail: RESEND_API_KEY not set — skipping send', {
      subject: email.subject,
      to: email.to,
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
      to: email.to,
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

/** Send a plain-text notification to the Baxter admin address. */
export async function sendAdminEmail(email: AdminEmail): Promise<{ sent: boolean }> {
  return sendEmail({ to: ADMIN_TO, subject: email.subject, text: email.text });
}
