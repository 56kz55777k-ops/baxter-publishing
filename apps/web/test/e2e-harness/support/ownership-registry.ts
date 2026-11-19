/**
 * Slice D stage 8A — the ownership registry, the created-by-this-run set (plan §8.5 "Two records,
 * kept apart", "Declared creation" step 5). HARNESS-ONLY.
 *
 * One fsynced JSON line per ATTRIBUTED DECLARED CREATION: run id, intent sequence, intent kind, target
 * unit (label and page ids), the element id, and the page it landed on. `register` is the only writer.
 * Nothing else adds to it — not an id seen in a body or a snapshot, not absence from B0, not a reload.
 */
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';

export interface Ownership {
  runId: string;
  intentSeq: number;
  kind: string;
  unit: { label: string; pageIds: string[] };
  id: string;
  /** The page it landed on, when known at registration. */
  pageId: string | null;
  /** In-process high-resolution time of the registration (orders it against journal records). */
  hr?: number;
}

export class OwnershipRegistry {
  constructor(readonly path: string) {}

  register(o: Ownership) {
    const fd = openSync(this.path, 'a');
    try {
      writeSync(fd, JSON.stringify(o) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  entries(): Ownership[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Ownership);
  }

  ids(): Set<string> {
    return new Set(this.entries().map((e) => e.id));
  }

  /** Byte length — lets a test prove that journaling left the registry untouched. */
  size(): number {
    return existsSync(this.path) ? readFileSync(this.path).length : 0;
  }
}
