import { S3Client } from '@aws-sdk/client-s3';

/**
 * Cloudflare R2 client.
 *
 * R2 is S3-compatible; the AWS SDK is pointed at the R2 endpoint and
 * authenticates with R2-issued access keys. The region must be 'auto'.
 */
export function r2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

export const QUARANTINE_BUCKET =
  process.env.R2_BUCKET_QUARANTINE ?? 'baxter-quarantine';
