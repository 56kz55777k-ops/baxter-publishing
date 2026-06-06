'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UploadForm } from './upload-form';
import { acknowledgeWarnings } from './actions';

export type PreflightIssueView = {
  code: string;
  title: string;
  detail: string;
};

export type LatestArtifactView = {
  id: string;
  sizeBytes: number;
  uploadedAt: string;
  status: 'pending' | 'passed' | 'failed';
  blockers: PreflightIssueView[];
  warnings: PreflightIssueView[];
  warningsAcknowledged: boolean;
};

type Props = {
  publicationId: string;
  latestArtifact: LatestArtifactView | null;
};

/**
 * The file section of the publication page.
 *
 * Renders the situation the creator is in (D-013), never an internal status
 * word. A clean pass shows no success message — the file simply becomes the
 * active file, with a quiet receipt and a Replace affordance.
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

  return (
    <div>
      <StateBody artifact={latestArtifact} />
      <ReplaceButton onClick={() => setMode('replace')} />
    </div>
  );
}

function StateBody({ artifact }: { artifact: LatestArtifactView }) {
  if (artifact.status === 'pending') {
    return (
      <div>
        <p className="font-serif text-body text-ink">File received.</p>
        <p className="metadata text-ink-faint mt-3">Review in progress.</p>
      </div>
    );
  }

  if (artifact.status === 'failed') {
    return (
      <div>
        <p className="font-serif text-body text-ink">
          This file cannot proceed.
        </p>
        <IssueList issues={artifact.blockers} className="mt-8" />
      </div>
    );
  }

  // passed
  const hasWarnings = artifact.warnings.length > 0;
  return (
    <div>
      {hasWarnings ? (
        <>
          <p className="font-serif text-body text-ink">The file can proceed.</p>
          <IssueList issues={artifact.warnings} className="mt-8" />
          {!artifact.warningsAcknowledged && (
            <AcknowledgeButton artifactId={artifact.id} />
          )}
        </>
      ) : (
        // Clean pass: no success messaging. The file is simply the active file.
        <Receipt artifact={artifact} />
      )}
      {hasWarnings && <ReceiptLine artifact={artifact} className="mt-8" />}
    </div>
  );
}

function IssueList({
  issues,
  className,
}: {
  issues: PreflightIssueView[];
  className?: string;
}) {
  return (
    <ul className={`space-y-6 ${className ?? ''}`}>
      {issues.map((issue, i) => (
        <li key={`${issue.code}-${i}`}>
          <p className="metadata text-ink-faint">{issue.title}</p>
          <p className="font-serif text-body text-ink-soft mt-1">
            {issue.detail}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Receipt({ artifact }: { artifact: LatestArtifactView }) {
  const sizeMB = (artifact.sizeBytes / 1024 / 1024).toFixed(1);
  const uploaded = new Date(artifact.uploadedAt).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return (
    <p className="metadata text-ink-faint">
      {sizeMB} MB · uploaded {uploaded}
    </p>
  );
}

function ReceiptLine({
  artifact,
  className,
}: {
  artifact: LatestArtifactView;
  className?: string;
}) {
  return (
    <div className={className}>
      <Receipt artifact={artifact} />
    </div>
  );
}

function AcknowledgeButton({ artifactId }: { artifactId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await acknowledgeWarnings(artifactId);
          router.refresh();
        })
      }
      className="font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle mt-10 disabled:opacity-50"
    >
      Acknowledge
    </button>
  );
}

function ReplaceButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block font-shell text-[0.75rem] tracking-[0.08em] uppercase text-ink-soft hover:text-ink transition-colors duration-300 mt-12"
    >
      Replace file
    </button>
  );
}
