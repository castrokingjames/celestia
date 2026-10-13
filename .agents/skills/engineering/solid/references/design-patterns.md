# Design patterns — when, and when not

Reach for a pattern to remove a *present* pain, not a hypothetical one.

- **Strategy / Ports+Adapters** — swappable behavior behind an interface. Our transport/auth/cognition. Default pattern here.
- **Adapter** — wrap a third-party (colyseus.js, a model API) behind our port so callers don't couple to it.
- **Reducer / Command** — event-sourced state: `apply(state, event)`; intents are commands validated before they become events (`#G4`).
- **Factory / Composition root** — the one place concretes are chosen (`#G7`).
- **Observer** — Colyseus/Godot signals; already idiomatic, don't reinvent.

Avoid: singletons-as-globals (hidden coupling), inheritance where composition fits, a pattern that adds a layer no caller benefits from. One impl behind a port is not "over-engineering"; a pattern with a single use and no second coming is.
