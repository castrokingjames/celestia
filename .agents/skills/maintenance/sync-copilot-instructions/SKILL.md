---
name: sync-copilot-instructions
description: Regenerate .github/copilot-instructions.md from AGENTS.md + .context/ so GitHub Copilot (which can't crawl .context/) stays in sync. Triggers — "sync copilot", "the pre-commit sync gate blocked my commit", "update copilot-instructions", "I changed a .context rule".
---

# Sync copilot-instructions

`.github/copilot-instructions.md` is a **generated summary** of `AGENTS.md` + every `.context/` doc, because Copilot can't read `.context/`. The pre-commit hook blocks a commit that stages a `.context/` change without restaging this file. This skill regenerates it.

## Procedure

1. Read `AGENTS.md` and every file under `.context/`.
2. Rewrite `.github/copilot-instructions.md` as a concise summary: the mission, build commands, the guardrails (G1–G10), and the key conventions.
3. **Every bullet ends with a `Source:` line** citing the authoritative file (e.g. `Source: .context/architecture/guardrails.md#G1`). Copilot gets the rule; the citation keeps `.context/`/`docs/` as the single source of truth on conflict.
4. Do not add rules that aren't in `AGENTS.md`/`.context/` — this is a mirror, not a new authority.
5. Re-stage the file so the commit passes the gate.

Keep it a *summary* — if it starts to diverge or grow its own rules, that's a bug.
