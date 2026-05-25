import { PutObjectCommand } from '@aws-sdk/client-s3';
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
