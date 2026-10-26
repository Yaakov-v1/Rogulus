# Harnestica

An efficient, auto-scaling development harness for Claude Code that lives in **one CLAUDE.md of at most 100 lines**: [template/CLAUDE.md](template/CLAUDE.md).

- **Efficient** = the smallest set of instructions and checks that keeps sessions both fast and correct.
- **Auto scaling** = ritual grows with task size (tiny → large), and guidance grows from evidence as human-approved *lessons*, inside a hard cap (12 lessons, 90-day re-review). It does not mean infrastructure autoscaling, lessons approved without a human, or self-modifying code.

## Use it in a project

1. Copy `template/CLAUDE.md` into the project as `CLAUDE.md`, or append it to an existing one.
2. Fill in the **Project checks** commands.
3. Work normally. When Claude ends a report with `LESSON? …`, answer yes or no. Approved lessons go in the Lessons section.

Lessons stay per project. Current state: [STATUS.md](STATUS.md).

## Map

| Path | What it is |
|---|---|
| [template/CLAUDE.md](template/CLAUDE.md) | **The harness.** Copy it into a project. |
| [archive/lean-sdlc-harness/](archive/lean-sdlc-harness/) | Retired: the TypeScript CLI version (0.2.0, 29/29 tests). Kept for reference; its ideas (evidence rules, bounded lessons, human approval) live on in the template. |
| [docs/build-prompt.md](docs/build-prompt.md) | Brief for the bounded enhancement (implemented in the archived CLI 0.2.0): goal, constraints, acceptance table. Paths point into this folder. |
| [docs/enhancement-review.md](docs/enhancement-review.md) · [evidence](docs/enhancement-review-evidence.json) | Oct 19 review of the proposed design. Reproduces five defects in the *proposal's* sample scripts, not in the package. |
| [docs/design/self-evolving-sdlc-harness.md](docs/design/self-evolving-sdlc-harness.md) | Original design report: assumption ledger schema, lifecycle, Guides/Factory/Sensors contracts, phased build plan. Reference only; the package supersedes its sample scripts. |
| [docs/research/self-improving-harnesses.md](docs/research/self-improving-harnesses.md) | Research on self-improving and self-modifying agent harnesses (prior art, evaluation, guardrails), as of Oct 2026. |
| [docs/research/harness-engineering/](docs/research/harness-engineering/) | Background material: the "Harness Engineering" deck and transcript, plus two workflow synthesis notes. |
| [work/](work/) | Regression fixtures: `enhancement-review-2026-10-19` (defect reproductions) and `enhancement-baseline-2026-10-19` (the package snapshot before the Oct 19 edits, plus its benchmark). |
| [releases/](releases/) | `lean-sdlc-harness-0.1.0.tgz` (MVP, Oct 13) and `lean-sdlc-harness-0.2.0.tgz` (enhancement, Oct 26). |

## Origins

Everything here was **copied** on 2026-10-26. The originals are untouched.

| Original | Here | Date | Made by |
|---|---|---|---|
| `~/Documents/Codex/2026-10-13/pl/outputs/lean-sdlc-harness/` (without node_modules) | `archive/lean-sdlc-harness/` | Oct 13, edited Oct 19 | Codex (ChatGPT) |
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
