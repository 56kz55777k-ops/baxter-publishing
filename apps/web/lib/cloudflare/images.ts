/**
 * Cloudflare Images client (server-only).
 *
 * Used by the preflight worker to publish preview/cover images. Images are
 * uploaded PUBLIC (`requireSignedURLs: false`) because they are marketplace
 * presentation assets — the private source PDF stays in `baxter-clean`.
 * Responsive sizing is handled by account-level variants (cover/grid/full),
 * so we upload a single high-res master per page and build delivery URLs.
 */

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_IMAGES_API_TOKEN;
const ACCOUNT_HASH = process.env.CLOUDFLARE_IMAGES_ACCOUNT_HASH;

function apiBase(): string {
  if (!ACCOUNT_ID || !API_TOKEN) {
    throw new Error('Cloudflare Images env not configured (account id / token).');
  }
  return `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/images/v1`;
}

/** Upload a JPEG and return its Cloudflare image id. */
export async function uploadImage(
  jpeg: Uint8Array,
  filename: string
): Promise<string> {
  // Copy into a fresh ArrayBuffer so the Blob part is typed as ArrayBuffer
  // (mupdf returns Uint8Array<ArrayBufferLike>, which TS won't accept directly).
  const buf = new ArrayBuffer(jpeg.byteLength);
  new Uint8Array(buf).set(jpeg);

  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'image/jpeg' }), filename);
  form.append('requireSignedURLs', 'false');

  const res = await fetch(apiBase(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_TOKEN}` },
    body: form,
  });
  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; result?: { id?: string }; errors?: unknown }
    | null;
  if (!res.ok || !json?.success || !json.result?.id) {
    throw new Error(
      `Cloudflare Images upload failed (${res.status}): ${JSON.stringify(
        json?.errors ?? json
      )}`
    );
  }
  return json.result.id;
}

/** Delete an image by id. Idempotent: a missing image (404) is not an error. */
export async function deleteImage(imageId: string): Promise<void> {
  const res = await fetch(`${apiBase()}/${imageId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '');
    console.error('Cloudflare Images delete failed', {
      imageId,
      status: res.status,
      body,
    });
  }
}

/** Build a public delivery URL for a given variant. */
export function imageDeliveryUrl(imageId: string, variant: string): string {
  if (!ACCOUNT_HASH) {
    throw new Error('CLOUDFLARE_IMAGES_ACCOUNT_HASH not configured.');
  }
  return `https://imagedelivery.net/${ACCOUNT_HASH}/${imageId}/${variant}`;
}
