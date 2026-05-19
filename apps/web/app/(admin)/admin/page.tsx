/**
 * Admin review queue — placeholder for Slice 5.
 * Access gated by `users.role = 'admin'` once auth lands.
 */
export default function AdminHome() {
  return (
    <main className="px-gutter py-32">
      <p className="metadata">Editorial desk</p>
      <p className="font-serif text-lede max-w-measure mt-6">
        Submissions waiting on review will appear here.
      </p>
    </main>
  );
}
