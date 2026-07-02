import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { r2Client } from './client';

/**
 * Mint a time-limited PUT URL for direct browser upload to R2.
 *
 * Defaults to 15 minutes — long enough for a large PDF upload, short
 * enough to limit replay surface.
 */
export async function presignedPutUrl(opts: {
  bucket: string;
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}) {
  const client = r2Client();
  const command = new PutObjectCommand({
    Bucket: opts.bucket,
    Key: opts.key,
    ContentType: opts.contentType,
  });
  return getSignedUrl(client, command, {
    expiresIn: opts.expiresInSeconds ?? 900,
  });
}

/**
 * Mint a time-limited GET URL for reading a private R2 object — used to let an
 * admin download the clean, print-ready PDF from the review desk. The clean
 * bucket has no public access; this is the only read path. Short-lived by
 * default (5 minutes) since it's generated on demand per page view.
 */
export async function presignedGetUrl(opts: {
  bucket: string;
  key: string;
  expiresInSeconds?: number;
}) {
  const client = r2Client();
  const command = new GetObjectCommand({
    Bucket: opts.bucket,
    Key: opts.key,
  });
  return getSignedUrl(client, command, {
    expiresIn: opts.expiresInSeconds ?? 300,
  });
}
