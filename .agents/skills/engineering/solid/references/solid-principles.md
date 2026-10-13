# SOLID (TypeScript)

- **S — Single Responsibility.** A module has one reason to change. A room handler that also computes money and formats a message is three responsibilities — the money belongs in `EconomyService` (`guardrails.md#G5`).
- **O — Open/Closed.** Extend via new implementations, not by editing stable code. New transport = a new `ITransport` adapter, not an `if (host===…)` in callers.
- **L — Liskov.** An adapter must honor its port's contract fully — no "throws on this method." If it can't, the port is wrong.
- **I — Interface Segregation.** Small, role-specific ports. `SystemOneProvider` and `GenerativeProvider` are separate, not one fat `LLM` interface.
- **D — Dependency Inversion.** Depend on the port; the concrete is wired at the composition root only (`#G7`). This is literally our ports/adapters rule.

Heuristic: if applying a principle adds indirection without removing a real future pain, skip it (YAGNI).
