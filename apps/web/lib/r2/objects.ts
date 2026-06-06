import {
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { r2Client } from './client';

/**
 * Server-side R2 object operations used by the preflight worker.
 *
 * These run with the R2 token (scoped to all buckets); there is no browser
 * involvement, so no presigning. Deletes are idempotent: an already-absent
 * object is treated as success, so a retried Inngest step or a partial prior
 * failure self-heals (Decision D-014).
 */

/** Download an object's full body as bytes. Returns null if it is missing. */
export async function getObjectBytes(
  bucket: string,
  key: string
): Promise<Uint8Array | null> {
  try {
    const res = await r2Client().send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    if (!res.Body) return null;
    return await res.Body.transformToByteArray();
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Copy an object between buckets (or keys). Used to promote quarantine→clean. */
export async function copyObject(opts: {
  sourceBucket: string;
  destBucket: string;
  key: string;
}): Promise<void> {
  await r2Client().send(
    new CopyObjectCommand({
      Bucket: opts.destBucket,
      // CopySource is `<bucket>/<key>`, URL-encoded.
      CopySource: encodeURI(`${opts.sourceBucket}/${opts.key}`),
      Key: opts.key,
    })
  );
}

/** Delete an object. A missing object is not an error (idempotent). */
export async function deleteObject(bucket: string, key: string): Promise<void> {
  try {
    await r2Client().send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key })
    );
  } catch (err) {
    if (isNotFound(err)) return;
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}
