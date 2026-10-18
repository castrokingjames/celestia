# Code smells → the refactor it implies

- **Long function / deep nesting** → extract functions; early-return guards.
- **Feature envy** (a fn reaching into another object's internals) → move the behavior to that object (e.g. money math → `EconomyService`).
- **Shotgun surgery** (one change touches many files) → the concept is scattered; consolidate into one module/package.
- **Primitive obsession** (raw `number` for money, raw string for an intent type) → a named type / `bigint` / a `norma` const.
- **Magic literal** → a named constant or config value (`conventions/formatting.md`).
- **Switch on `host`/type in callers** → polymorphism via a port + adapters (`#G7`).
- **Duplicated logic across services** → extract to a `package/` (`conventions/organization.md`).
- **Leaky abstraction** (adapter name escaping the composition root) → a `#G7` violation, not just a smell.

Rule: name the smell, propose the *smallest* refactor that removes it, confirm tests still pass.
