# Testing (what earns its keep)

- **Test the pure core hard.** Reducers (`apply`), `EconomyService` (idempotency, insufficient-balance refusal, integer math), `can()` policy, intent validation. These are deterministic and high-value (`#G4`/`#G5`/`#G6`).
- **Replay determinism is a test.** A recorded session replays to a byte-identical projection twice, reading logged `chosen_idx`, never re-inferring (`#G4`/`#G9`).
- **Serialization/contract tests** — an intent round-trips; the `protocolVersion`/structural hash matches client↔server.
- **Don't** write brittle tests of framework glue, or snapshot the world every tick. Prefer Vitest + `@colyseus/testing` for room behavior.
- **Right-size.** A pure function → a unit test. A multi-step flow → one integration test. No test for a one-line pass-through.

Test smells: tests that mirror the implementation line-for-line, mocks of your own pure code, a test that can't fail. Delete those.
