---
name: solid
description: Senior-engineer craftsmanship pass for TypeScript — SOLID, clean code, right-sized tests, code smells, design patterns. Triggers — "apply SOLID", "clean this up", "is this well-designed", "refactor for maintainability", "craft review".
---

# SOLID & craft

A craftsmanship lens for TypeScript in this repo. The point is maintainable, honest code — not pattern-maximalism. Apply judgment; a 10-line module doesn't need an abstraction.

## Use it to

- design or review a module/class/function for responsibility, coupling, and testability;
- spot and name code smells, then propose the minimal refactor;
- decide where a test earns its keep (and where it doesn't).

## How it fits Celestia

- **Ports/adapters is our DIP** — depend on interfaces; name concretes only at the composition root (`guardrails.md#G7`).
- **Pure reducers / small functions** — the event-sourced core is pure (`#G4`/`#G9`); keep side effects at the edges.
- **Don't over-abstract.** YAGNI (`AGENTS.md`). One shipping impl behind a port is fine; a second adapter earns the abstraction.

## References (read the one you need)

- `references/solid-principles.md` — the five, with TS examples.
- `references/clean-code.md` — naming, functions, comments, boundaries.
- `references/code-smells.md` — the catalog + the refactor each implies.
- `references/design-patterns.md` — when (and when not) to reach for one.
- `references/testing.md` — what to test, test sizing, test smells.

Match the surrounding code's idiom. Propose the smallest change that removes the smell.
