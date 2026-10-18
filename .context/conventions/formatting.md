# TypeScript style & formatting

Formatting is tool-enforced (Prettier) and lint is ESLint; these are the conventions an agent should respect that tooling won't always auto-fix.

## TypeScript

- **`strict` on.** No `any` without a written reason; prefer `unknown` + narrowing. No `@ts-ignore`/`@ts-expect-error` without a one-line justification (G-style suppression ban).
- **ESM + NodeNext.** Relative imports end in `.js` (NodeNext resolution), even from `.ts` source.
- **Validation at the edge with Zod.** One schema = runtime validator + inferred type; share it, don't re-declare the shape.
- **No magic numbers / bare string literals** for domain values — name them, or source them from `norma` (intent types, protocol version) / config. Tunable numbers (tick rate, speeds, thresholds) come from config, not inline literals.
- **Integer money.** `bigint` in process, `NUMERIC(38,0)` at rest, decimal string on the wire. Never `number` for currency.
- Prefer small pure functions; reducers are pure (G4/G9).

## Decorators (Colyseus schema)

`@colyseus/schema` needs `experimentalDecorators: true` + `useDefineForClassFields: false` (set in `tsconfig.base.json`). Keep schema classes thin and field-decorated.

## Format

Prettier defaults; 2-space indent; run `pnpm lint`/`pnpm format` before commit (the pre-commit hook checks it). GDScript uses **tabs** (Godot default).
