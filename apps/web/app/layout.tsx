import type { Metadata } from 'next';
import { Fraunces, DM_Sans } from 'next/font/google';
import './globals.css';

/**
 * Fraunces — body, editorial headlines.
 * Variable axes: opsz 24 (settled optical size), SOFT 50 (moderate softness).
 * These match the type specimen evaluated in the Pairing-B selection.
 */
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['opsz', 'SOFT'],
});

/**
 * DM Sans — DIN proxy.
 * Used for the shell, navigation, metadata, captions.
 * Production Baxter will license DIN proper; DM Sans is the holding choice.
 */
const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-din-proxy',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Baxter — Independent publishing, made carefully.',
  description:
    'A curated marketplace for independent print and digital publications. Reviewed within five business days. Held to a standard.',
  openGraph: {
    title: 'Baxter Publishing',
    description: 'Independent publishing, made carefully.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${fraunces.variable} ${dmSans.variable}`}>
      <body className="bg-canvas text-ink">{children}</body>
    </html>
  );
}
