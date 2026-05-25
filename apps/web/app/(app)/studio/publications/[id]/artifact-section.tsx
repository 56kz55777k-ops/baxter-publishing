'use client';

import { useState } from 'react';
import { UploadForm } from './upload-form';

type Props = {
  publicationId: string;
  latestArtifact: {
    sizeBytes: number;
    uploadedAt: string;
  } | null;
};

/**
 * Toggles between the "file received" receipt and the upload form.
 *
 * Once an artifact exists, the receipt is shown with a quiet
 * "Replace file" affordance below it. Clicking switches to the upload
 * form; a successful upload returns to the receipt with the new file.
 * Cancel returns to the receipt without changing anything.
 */
export function ArtifactSection({ publicationId, latestArtifact }: Props) {
  const [mode, setMode] = useState<'show' | 'replace'>('show');

  if (!latestArtifact || mode === 'replace') {
    return (
      <UploadForm
        publicationId={publicationId}
        onSuccess={() => setMode('show')}
        cancel={mode === 'replace' ? () => setMode('show') : undefined}
      />
    );
  }

  const sizeMB = (latestArtifact.sizeBytes / 1024 / 1024).toFixed(1);
  const uploaded = new Date(latestArtifact.uploadedAt).toLocaleDateString(
    'en-CA',
    { year: 'numeric', month: 'long', day: 'numeric' }
  );

  return (
    <div>
      <p className="font-serif text-body text-ink">
        File received. Awaiting check.
      </p>
      <p className="metadata text-ink-faint mt-3">
        {sizeMB} MB · uploaded {uploaded}
      </p>
      <button
        type="button"
        onClick={() => setMode('replace')}
        className="font-shell text-[0.75rem] tracking-[0.08em] uppercase text-ink-soft hover:text-ink transition-colors duration-300 mt-8"
      >
        Replace file
      </button>
    </div>
  );
}
