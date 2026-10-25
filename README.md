# Harnestica

Home of our self-improving ("auto-scaling") SDLC harness: a local CLI that wraps Claude Code coding sessions, records check evidence, and turns repeated mistakes into human-approved lessons that are injected into later sessions.

**"Auto scaling" here means** that guidance improves as session evidence accumulates, while context and processing stay bounded. It does **not** mean infrastructure autoscaling, spawning agents during coding, lessons approved without a human, or self-modifying code.

Current state: see [STATUS.md](STATUS.md). Next step: run [docs/build-prompt.md](docs/build-prompt.md) as the brief for the next build session.

## Map

| Path | What it is |
|---|---|
| [harness/](harness/) | The `lean-sdlc-harness` package (TypeScript, Node 24, local SQLite, CLI only). Its own [README](harness/README.md) has the full usage docs. |
| [docs/build-prompt.md](docs/build-prompt.md) | Brief for finishing the bounded enhancement: goal, constraints, acceptance table. Paths point into this folder. |
| [docs/enhancement-review.md](docs/enhancement-review.md) · [evidence](docs/enhancement-review-evidence.json) | Oct 19 review of the proposed design. Reproduces five defects in the *proposal's* sample scripts, not in the package. |
| [docs/design/self-evolving-sdlc-harness.md](docs/design/self-evolving-sdlc-harness.md) | Original design report: assumption ledger schema, lifecycle, Guides/Factory/Sensors contracts, phased build plan. Reference only; the package supersedes its sample scripts. |
| [docs/research/self-improving-harnesses.md](docs/research/self-improving-harnesses.md) | Research on self-improving and self-modifying agent harnesses (prior art, evaluation, guardrails), as of Oct 2026. |
| [docs/research/harness-engineering/](docs/research/harness-engineering/) | Background material: the "Harness Engineering" deck and transcript, plus two workflow synthesis notes. |
| [work/](work/) | Regression fixtures: `enhancement-review-2026-10-19` (defect reproductions) and `enhancement-baseline-2026-10-19` (the package snapshot before the Oct 19 edits, plus its benchmark). |
| [releases/](releases/) | `lean-sdlc-harness-0.1.0.tgz`, the MVP archive from Oct 13. |

## Quick start

```sh
cd harness
npm ci
npm test            # builds, then runs node --test
```

From a target Git repo:

```sh
node "/Users/yaakovins/Documents/Harnestica /harness/bin/lean-harness.mjs" init
lean-harness start --paths src/ui -- "Fix keyboard handling in the dialog"
lean-harness verify --session <harness-session-id>
lean-harness status
```

## Origins

Everything here was **copied** on 2026-10-26. The originals are untouched.

| Original | Here | Date | Made by |
|---|---|---|---|
| `~/Documents/Codex/2026-10-13/pl/outputs/lean-sdlc-harness/` (without node_modules) | `harness/` | Oct 13, edited Oct 19 | Codex (ChatGPT) |
| `…/pl/outputs/next-session-harness-prompt.md` | `docs/build-prompt.md` (paths rewritten) | Oct 19 | Codex |
| `…/pl/outputs/sdlc-harness-enhancement-review.md`, `enhancement-review-evidence.json` | `docs/` | Oct 19 | Codex |
| `…/pl/outputs/lean-sdlc-harness-0.1.0.tgz` | `releases/` | Oct 13 | Codex |
| `…/pl/work/enhancement-review-2026-10-19/`, `enhancement-baseline-2026-10-19/` | `work/` | Oct 19 | Codex |
| `~/Downloads/Self evolving SDLC harness.md` | `docs/design/self-evolving-sdlc-harness.md` | Oct 19 | research report |
| `~/Documents/Ariadne/Qadance-Aria/research_notes/Qadance Aria agentic workspace/self_improving_harness.md` | `docs/research/self-improving-harnesses.md` | Oct 6 | Claude research |
| `~/Downloads/Harness Engineering*`, `AI Dev Framework Workflow Synthesis.md`, `AI Web Development Orchestration Research.md` | `docs/research/harness-engineering/` | — | downloads |

Not copied: `pl/work/npm-cache` and `pl/work/package-smoke` (disposable).

## Related projects (linked, not copied)

- [Qadance-Aria](../Ariadne/Qadance-Aria/): Claude + Codex multi-agent SDLC harness plan (PLAN.md, DECISIONS.md, eval harness).
- [Astra SDLC](../Ariadne/Astra%20SDLC/): Markdown SDLC framework for Codex/Astra.
- [Katharon (CleanCodeHarness)](../Ariadne/CleanCodeHarness/): tool-neutral harness for coding agents with a Clean Code rule.
