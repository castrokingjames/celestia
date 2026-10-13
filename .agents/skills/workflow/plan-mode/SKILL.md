---
name: plan-mode
description: Read-only planning. Research the codebase and the relevant docs/.context, then propose an implementation plan; change NOTHING until the user approves. Triggers — "/plan", "plan this", "how would you approach X", "don't write code yet, just plan", "think before you build".
---

# Plan mode

A disciplined read-only pass that produces a plan, not changes.

## Rules

- **Touch nothing.** No edits, no new files, no commits. Read, grep, trace — then propose.
- **Ground the plan in the repo.** Cite the files you'd change, the `docs/` design decision, and the `.context/` rules that constrain the work (especially `architecture/guardrails.md`).
- **Surface the risks and the unknowns.** Call out what could go wrong, what you're unsure of, and what you'd verify first (prefer proving the risky unknown before building — see `AGENTS.md` working principles).

## Output

1. **Goal** — one line.
2. **Approach** — the steps, each naming the file(s)/package(s) touched.
3. **Guardrails in play** — which `guardrails.md#G<n>` the change must respect.
4. **Risks / open questions** — and the first thing to verify.
5. **Out of scope** — what you are deliberately NOT doing.

Stop after the plan. Wait for the user to approve before any implementation.
