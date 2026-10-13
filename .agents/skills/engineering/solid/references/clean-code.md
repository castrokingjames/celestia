# Clean code (TypeScript)

- **Names say intent.** `reservePlotForQuest` not `handle2`. Domain values are named consts, not magic numbers (`conventions/formatting.md`).
- **Functions are small and single-level.** Extract until each does one thing at one level of abstraction. Pure where possible (reducers MUST be pure — `#G4`/`#G9`).
- **No comment that restates the code.** Comment the *why* / the non-obvious invariant. Match the file's existing comment density.
- **Boundaries are typed and validated.** Zod at the edge; one schema = validator + type. Don't let untyped `Dictionary`/`any` leak inward.
- **Fail with meaning.** Typed reason codes, not silent drops or bare `-1` (`conventions/error-handling.md`).
- **Delete dead code.** Don't comment it out "just in case" — git remembers.
