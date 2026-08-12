# ADR-002 — Runtime environment flags

**Status:** Accepted (2026-08-03, Slice A hardening) · **Origin:** the Slice A flag-leak finding (deviation D5).

## Decision

Feature flags and other server-toggled configuration use **plain (server-read)
environment variables**, read at request time in server code. The
`NEXT_PUBLIC_` prefix is reserved for values a client bundle genuinely needs —
and is understood to mean **build-time inlining, everywhere**, including
server components. A `NEXT_PUBLIC_` value is part of the build artifact, not
of the runtime environment.

## Context

Slice A's discovery flag began as `NEXT_PUBLIC_NATIVE_PUBLISHING`, checked in
a server component. The dark-flag verification failed live: with the runtime
variable set to `0`, the link still rendered, because Next.js had inlined the
build-time value `'1'` into the compiled output. Renaming to server-read
`NATIVE_PUBLISHING` made the same build serve both light and dark
configurations (proven on one artifact, two serve configs).

## Rules

1. Server-only toggle → plain env var, request-time read, added to
   `turbo.json`'s build env allowlist.
2. Flags gate **discovery only** — authorization is always its own check
   (Slice A: the editor route enforces ownership + status regardless of the
   flag; verified: dark build hides the link while the owner's direct URL
   works and denied states never fetch the island chunk).
3. Local-dev footnote: under `next dev`/`next start`, `.env.local` values
   **override** already-exported shell variables. To run a dark configuration
   locally, change the file, not the shell. Deployed environments carry no
   `.env.local`, so runtime variables behave as expected there.
4. No client bundle may read a flag that exists to stay server-side — the
   Slice A verification greps compiled chunks when in doubt.
