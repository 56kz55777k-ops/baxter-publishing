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
    // Path-style addressing. Some R2 CORS configurations apply cleanly
    // to the account endpoint but not to virtual-hosted-style bucket
    // subdomains; path-style sidesteps that.
    forcePathStyle: true,
    // AWS SDK v3 defaults to baking CRC32 checksums into presigned URLs;
    // browser PUTs cannot compute the matching checksum and R2 rejects
    // the request (sometimes even at the preflight step). WHEN_REQUIRED
    // skips the default and signs a cleaner URL the browser can fulfil.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

export const QUARANTINE_BUCKET =
  process.env.R2_BUCKET_QUARANTINE ?? 'baxter-quarantine';
