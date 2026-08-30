# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This is a single-context repository.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root when it exists and is relevant.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If either file or directory doesn't exist, proceed silently. Don't flag its absence; don't suggest creating it upfront. The `/domain-modeling` skill creates these lazily when terms or decisions actually get resolved.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, or a test name), use the term as defined in `CONTEXT.md`. If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
