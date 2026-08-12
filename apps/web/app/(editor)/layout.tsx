/**
 * (editor) route group — a bare full-viewport frame (amendment A6). The URL
 * space is unchanged (/studio/editor/[id] stays behind the /studio
 * middleware gate); only the chrome differs: no site navigation, no gutters —
 * the editor owns the whole viewport.
 */
export default function EditorGroupLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-dvh overflow-hidden">{children}</div>;
}
