import { NewPublicationForm } from './new-publication-form';

export const metadata = {
  title: 'Begin a publication — Baxter',
};

export default function NewPublicationPage() {
  return (
    <main className="px-gutter py-24 max-w-[34rem]">
      <p className="metadata mb-4">Studio</p>
      <h1 className="font-serif text-h1 leading-[1.05] tracking-tight mb-6">
        Begin a publication.
      </h1>
      <p className="text-ink-soft mb-12 prose-editorial">
        A few details to begin.
      </p>

      <NewPublicationForm />
    </main>
  );
}
