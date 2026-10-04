# Security Policy

Baxter is a publishing platform built by Toronto Creatives. This repository is
public; the service it builds handles creator accounts, publication files and
payments, so we take reports seriously.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting on this repository
(**Security → Report a vulnerability**). That channel is private between you
and the maintainers until a fix is published.

What helps most:

- what you did, in enough detail that we can reproduce it;
- what happened, and what you expected instead;
- the impact you think it has;
- anything you already tried that did or did not work.

Please do not run tests that could affect other people's data or availability
— no automated scanning against the production service, no attempts against
other users' publications or accounts. If a proof of concept would require
that, describe it instead and we will reproduce it ourselves.

## What to expect

We are a small team, so we will not pretend to a formal SLA. We will
acknowledge your report, tell you what we find, and tell you when it is fixed.
If we disagree that something is a vulnerability we will say so and explain
why, rather than going quiet.

We do not currently run a paid bounty programme.

## Scope

In scope: this repository, and the deployed application at
`baxter-publishing-web.vercel.app`.

Out of scope: the underlying platforms we build on — GitHub, Vercel, Supabase,
Stripe, Cloudflare and Resend — which have their own disclosure programmes.
Findings about their products belong with them.

## Supported versions

Baxter is a continuously deployed service rather than a versioned library. The
deployed `main` branch is the only supported version; there are no maintenance
branches and no backports.

---

*Internal operational security practice — credential handling, environment
boundaries and rotation procedure — is documented separately in
`docs/security-operations.md`. This file is the public-facing policy only.*
