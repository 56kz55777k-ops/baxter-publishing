'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type UploadState =
  | { phase: 'idle' }
  | { phase: 'uploading'; filename: string }
  | { phase: 'registering'; filename: string }
  | { phase: 'error'; message: string };

type UploadFormProps = {
  publicationId: string;
  /** Called after a successful upload + register, before router.refresh(). */
  onSuccess?: () => void;
  /** If provided, renders a quiet Cancel button in the idle state. */
  cancel?: () => void;
};

/**
 * PDF upload to R2 quarantine.
 *
 * Three-step:
 *   1. POST /api/upload/r2-presigned for a signed PUT URL.
 *   2. PUT the file directly to R2 from the browser.
 *   3. POST /api/publications/{id}/artifacts/register so the DB row
 *      reflects the upload.
 *
 * Editorial Constitution: indeterminate progress, no percentage. The
 * file is in flight, not racing. After completion, the parent server
 * component refreshes and shows "File received. Awaiting check."
 */
export function UploadForm({ publicationId, onSuccess, cancel }: UploadFormProps) {
  const router = useRouter();
  const [state, setState] = useState<UploadState>({ phase: 'idle' });
  const pending = state.phase === 'uploading' || state.phase === 'registering';

  async function handleFile(file: File) {
    if (file.type !== 'application/pdf') {
      setState({ phase: 'error', message: 'Upload must be a PDF.' });
      return;
    }

    setState({ phase: 'uploading', filename: file.name });

    try {
      const presignRes = await fetch('/api/upload/r2-presigned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicationId,
          filename: file.name,
          contentType: file.type,
        }),
      });
      if (!presignRes.ok) {
        const body = await presignRes.json().catch(() => ({}));
        throw new Error(
          body.message ?? 'Something prevented the upload from starting.'
        );
      }
      const { url, key } = await presignRes.json();

      const putRes = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error('Something prevented the upload from completing.');
      }

      setState({ phase: 'registering', filename: file.name });

      const registerRes = await fetch(
        `/api/publications/${publicationId}/artifacts/register`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key,
            contentType: file.type,
            sizeBytes: file.size,
          }),
        }
      );
      if (!registerRes.ok) {
        const body = await registerRes.json().catch(() => ({}));
        throw new Error(
          body.message ?? 'Something prevented the file from being recorded.'
        );
      }

      onSuccess?.();
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Something prevented this from completing.';
      setState({ phase: 'error', message });
    }
  }

  if (state.phase === 'uploading') {
    return (
      <p className="font-serif text-body text-ink-soft">
        Uploading {state.filename}.
      </p>
    );
  }
  if (state.phase === 'registering') {
    return (
      <p className="font-serif text-body text-ink-soft">
        Saving {state.filename}.
      </p>
    );
  }

  return (
    <div>
      <label className="font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle cursor-pointer">
        Upload PDF
        <input
          type="file"
          accept="application/pdf"
          className="sr-only"
          disabled={pending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </label>
      <p className="metadata text-ink-faint mt-4">
        Print-ready, single pages, no spreads.
      </p>

      {cancel && (
        <button
          type="button"
          onClick={cancel}
          className="font-shell text-[0.75rem] tracking-[0.08em] uppercase text-ink-soft hover:text-ink transition-colors duration-300 mt-6"
        >
          Cancel
        </button>
      )}

      {state.phase === 'error' && (
        <p
          role="alert"
          className="text-[0.9rem] text-accent border-l-2 border-accent pl-3 mt-6"
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
