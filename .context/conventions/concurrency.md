# .context/conventions/concurrency.md — Parallel agents & worktrees

> How multiple agents work in Celestia without colliding. Citable; `AGENTS.md` indexes this. Pairs with `agent-behavior.md` (AB2, AB3).

## C1 — One worktree per parallel agent.
Parallel agents run in isolated **git worktrees** (`isolation:'worktree'` in workflows). Each works only in its **assigned scope**; never read or write another agent's worktree.

## C2 — Ask before branching or merging.
Agents do not create branches or merge on their own — surface it to the user (AB3). No commits/pushes without an explicit ask.

## C3 — Detached verification.
Long-running verification (lint / test / build) is launched **detached** (the `verify-runner` agent) so it never blocks the main loop; results return as a compact pass/fail, not a flood of logs (AB1).

## C4 — Custom agents register from the main tree.
Custom agent types and workflows only register when a session loads them **from the main working tree** — a worktree-only session won't see freshly-added agents/workflows. Add or edit agents/workflows from the main tree, then re-enter.

## C5 — No shared-mutable-state assumptions.
Don't assume two agents' in-flight edits are visible to each other. Coordinate through the user or through committed state — never through in-memory assumptions.
