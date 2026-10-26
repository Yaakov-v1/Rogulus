# Harnestica compared with popular coding harnesses (2026-10-26)

**Question.** How does Harnestica compare with the popular coding harnesses on speed (token and time cost), delivery reliability, and code quality (maintainability and readability)? What should change so that it leads on all three?

**Method.** Three research sweeps were run on 2026-10-26:

1. Claude Code layer frameworks. About 16 were reviewed: README, source files, issues and release notes.
2. Standalone agents and benchmarks in which the harness varies while the model stays fixed.
3. Primary sources: the Claude Code docs, Anthropic and OpenAI engineering posts, and well-known practitioners.

Evidence tags:

- **[P]**: peer-reviewed paper or arXiv study.
- **[V]**: vendor or self-reported.
- **[S]**: secondary source only.

Star counts and leaderboard positions come from snapshots taken on 2026-10-26 and will drift.

## Verdict

On design, Harnestica already sits close to what the evidence favours, and on several points it is ahead of the most-starred frameworks:

- Its always-loaded text is small.
- Its "done" gate is deterministic.
- Its learning loop is human-approved and capped.
- It sizes the ritual to the task.

None of the popular frameworks has controlled evidence of quality gains. Superpowers comes closest, with repeated self-run trials.

Before this round, the gaps were mostly about waste and blind spots:

1. The Clean Code rulebook loaded in every session, and on code tasks it was then read a second time.
2. Check output reached the context in full.
3. Nothing noticed a deleted or skipped test.
4. The reviewer was told to apply every rule.
5. No test held the size budget.

This round fixes all five. The largest remaining gap is that **Harnestica has never run in a live session**. Every claim about its usefulness is untested until it does.

## What the evidence says matters

| Finding | Effect | Source |
|---|---|---|
| Changing the harness with the model held fixed | Spread of 8–22 pp on Terminal-Bench 2 (Opus 4.5: Terminus 57.8% vs Claude Code 52.1%) | TB2 paper, arXiv 2601.11868 [P] |
| …but small gaps are noise | 24 of 25 adjacent leaderboard pairs are statistically indistinguishable; differences of 3–5 pp mean nothing | LessWrong analysis, 2026-08-05 [S] |
| A minimal harness can compete | mini-swe-agent (~100 lines, bash only) scores >74% on SWE-bench Verified | github.com/swe-agent/mini-swe-agent [V] |
| Lint on edit | +3 pp; removing the edit tool cost −7.7 pp | SWE-agent ablations, arXiv 2405.15793 [P] |
| Collapsing old tool output | +3 pp with roughly half the cost | SWE-agent [P]; Lindenbauer et al., arXiv 2508.21433 [P] |
| Trimming the trajectory | −40–60% input tokens with no loss | AgentDiet, arXiv 2509.23586 [P] |
| LLM-written context files | −0.5% to −3% success and +20% cost; human-written files gave about +4% (not for Claude Code) | Gloaguen et al., arXiv 2602.11988 [P] |
| How many instructions are followed | ~94% at 100 instructions (Sonnet 4 / Opus 4), dropping sharply at 250+; models omit instructions rather than garble them | IFScale, arXiv 2507.11538 [P] |
| Agents edit tests to pass | Opus 4.1 cheats on 50% of conflicting tasks; >79% of Claude's cheating is editing tests; read-only tests stop it with no performance loss | ImpossibleBench, arXiv 2510.20270 [P] |
| A green grader is not the same as mergeable code | Maintainers merge about 24 pp less than the grader passes; rejections are now mostly about code quality | METR, 2026-03-10 [P/org] |
| AI code wears down maintainability | Static-analysis warnings +30%, complexity +41.6% after Cursor adoption | MSR 2026, arXiv 2511.04427 [P] |
| Procedural TDD text vs context | Plain "do TDD" instructions *increased* regressions; a map from tests to source cut them by 70% | TDAD, arXiv 2603.17973 [P, small models] |
| Larger skill catalogs | Precision of actual use fell from 29.6% to 3.3% as the pool grew from 5 to 100 skills | arXiv 2608.14036 [P] |
| Reviewers find something whenever asked | A reviewer told to look for gaps will report some, which pushes toward over-engineering; limit it to correctness | code.claude.com/docs/en/best-practices [V] |
| Deterministic checks vs prose rules | Prose rule followed 77% of the time vs 100% for a hook (n=30) | Braintrust, 2026-08-20 [V] |

The pattern: **small, deterministic, failure-focused harnesses win.** Prose ceremony, large catalogs, unapproved memory and self-critique each have evidence against them.

## Scorecard

Always-on cost is the context loaded in every session. "Gates" means deterministic checks, not prompts.

| Harness (stars) | Sizes ritual to the task | Deterministic gates | Learning loop | Always-on cost | Measured evidence |
|---|---|---|---|---|---|
| **Harnestica** | Yes: tiny / small / medium / large | Stop gate (every check must pass after the last edit; resists masking) + tamper sensor | Human-approved, capped at 12, re-reviewed every 90 days | ~67-line block; rulebook path-scoped | Fixture tests only; **not yet live** |
| Superpowers (305k) | Yes (v7: quick / small / project) | None; prompts only | None | ~0.8–3.3k tokens | Self-run repeated trials, the best in the field |
| Spec Kit (143k) | Barely | `converge` loop (prompt) | Constitution | Low; 2–5k per command | None |
| BMAD (55k) | Yes (oneshot / full) | Parallel reviewers (prompt) | Retrospective | Low (stub skills) | None |
| GSD Core (11k; 64k archived) | Yes (fast / quick / full) | Context-headroom hooks | LEARNINGS.md | Lean main session, heavy subagents | None |
| Compound Engineering (26k) | Yes | Review receipt | `docs/solutions` with a "durable bar" test | Low | Anecdotes |
| everything-claude-code (289k) | Hook profiles | Pre/PostToolUse and Stop hooks | Auto-observed "instincts" (≥0.7 confidence, max 6 injected) | Capped at 8k characters | None |
| HumanLayer RPI→QRSPI (12.5k) | Optional steps | Stop runs checks; blocks filtered test output | None | <60-line CLAUDE.md | Case studies, including failures |
| gstack (138k) | Scope modes | Regression test must fail first | `/learn` | Measured (`context-bill`) | Self-measured |
| planning-with-files (28k) | Optional | Stop gate with block cap and stall detection | progress.md | ~1.0k tokens | Self-run A/B |
| Ralph loop | No | Stop hook + iteration cap | AGENT.md notes | Tiny | Anecdotes |
| SuperClaude (24k), Ruflo (79k) | Modes / no | Few | Automatic | Heavy (~19k for SuperClaude; ~60% boilerplate per Ruflo issue #1476) | Unverified claims |

Agent OS v3 (5.5k) is a useful cautionary case. It deleted its own spec, task and subagent phases because "Claude Code's plan mode … and improved models now handle much of the scaffolding" (github.com/buildermethods/agent-os/discussions/310).

## Keep (already best-in-class)

- **A deterministic Stop gate that resists masking.** Every configured check must pass after the last edit, and `npm test | tail`, `|| true` and `;` do not count. Only HumanLayer and planning-with-files gate this way; most frameworks only ask.
- **A capped, human-approved lessons loop.** It is more conservative than ECC's auto-observer or claude-mem. The ETH study and a token-budget-matched memory study (arXiv 2606.15017) both favour minimal, curated context.
- **Sizing by task.** This matches where Superpowers v7, GSD, BMAD and the Claude Code docs converged: "If you could describe the diff in one sentence, skip the plan."
- **A small always-on block.** Under 100 lines is well inside both the docs' 200-line ceiling and HumanLayer's guidance of 150–200 instructions.
- **Fail-open hooks with no dependencies.** A broken harness never breaks the session.

## Gaps, ranked by impact

| # | Gap | Why it matters | Status |
|---|---|---|---|
| 1 | `CLEAN-CODE.md` had no `paths:` header, so it loaded at launch in every session, and CLAUDE.md then told Claude to read it again | ~6 KB (~1.5k tokens) per session, doubled on code tasks. "Rules without `paths` frontmatter are loaded at launch" (code.claude.com/docs/en/memory) | **Fixed**: path-scoped to code extensions |
| 2 | Check output arrived in full | Docs (costs page), Spotify's verifier hooks and HumanLayer all say to be silent on success and verbose on failure | **Fixed**: `harnestica-check.mjs` runner prints one line per check plus a capped failure excerpt |
| 3 | No sensor for test tampering | ImpossibleBench: editing tests is Claude's dominant way to cheat. Anthropic: "It is unacceptable to remove or edit tests" | **Fixed**: the Stop hook blocks once when tests were deleted, skipped or lost assertions. CLAUDE.md gains a stop-and-report exit |
| 4 | The reviewer applied every rule | Over-reporting leads to over-engineering. Compound Engineering: "An adequate change needs no findings" | **Fixed**: limited to bugs, requirement gaps, MUST violations and reuse |
| 5 | Nothing enforced the size budget | Bloat is the field's main failure mode (Ruflo #1476, SuperClaude, Superpowers #762) | **Fixed**: `tests/budget.test.mjs` |
| 6 | The explorer loaded the full CLAUDE.md on every spawn | The built-in Explore skips it; `omitClaudeMd` (v2.1.271+) makes that possible | **Fixed**: `omitClaudeMd`, `effort: low`, `maxTurns` |
| 7 | Lessons could duplicate what code already says | Compound Engineering's "durable bar" test; OpenAI: "promote the rule into code" | **Fixed**: `/lesson` propose step |
| 8 | **Never run live** | Usefulness is unproven. Superpowers' own trials show prompts regressing silently (24/24 → 3/24) | **Open**: next step is a live trial, then a small with/without eval |
| 9 | Lintable rules are still prose | Deterministic beats prose (Braintrust, Factory, Böckeler). Harnestica can't ship a linter config for every language | Deferred: a `/lesson` retire path exists; per-project lint promotion |
| 10 | One Node process per matching tool call (~50 ms) | Exec-form hooks, the `if` field, `PostToolBatch` and `async` could cut this. Some of these postdate the installed CLI (2.1.285), and `async` could race the Stop gate | Deferred: measure first |
| 11 | Distributed by copying through an installer | Plugins version and update cleanly but can't ship CLAUDE.md or rules (plugins/components docs) | Deferred: a hybrid plugin plus a bootstrap |
| 12 | Tests are prescribed by procedure, not by context | TDAD: a map from tests to source beats "do TDD" | Deferred: research question |
| 13 | Medium and large plans are prose | HumanLayer's 2026 QRSPI admits that long plan files were a mistake; it reviews a short structure outline instead | Deferred: try in the live trial |

## Avoid

- Large always-loaded catalogs of agents, skills or commands. Precision collapses as they grow, and every listing costs tokens.
- Automatic memory capture without approval.
- LLM-generated CLAUDE.md content.
- Spec-markdown ceremony on small changes. Böckeler: "I'd rather review code than all these markdown files."
- Mandatory subagent review of plans. Superpowers measured identical quality with about 25 minutes saved when it removed this.
- Uncapped loops of the Ralph kind.
- Headline speed or savings claims with no method (SuperClaude, Ruflo).

## Sources

Frameworks:

- obra/superpowers: README, RELEASE-NOTES.md, issues #190, #762, #1600, #1803; blog.fsck.com 2026-03-25
- github/spec-kit
- bmad-code-org/BMAD-METHOD
- buildermethods/agent-os discussions/310
- SuperClaude-Org/SuperClaude_Framework
- ruvnet/ruflo issue #1476
- EveryInc/compound-engineering-plugin (skills `ce-compound`, `ce-code-review`)
- open-gsd/gsd-core
- affaan-m/everything-claude-code
- wshobson/agents
- ghuntley.com/ralph
- anthropics/claude-plugins-official, plugin `ralph-loop`
- eyaltoledano/claude-task-master
- kiro.dev/docs
- humanlayer/humanlayer (`.claude/hooks`)
- garrytan/gstack
- OthmanAdi/planning-with-files
- Fission-AI/OpenSpec
- Böckeler, "Exploring SDD tools", martinfowler.com, 2025-10-15

Benchmarks and studies:

- arXiv 2601.11868 (Terminal-Bench 2)
- arXiv 2405.15793 (SWE-agent)
- arXiv 2508.21433 (observation masking)
- arXiv 2509.23586 (AgentDiet)
- arXiv 2602.11988 (context files)
- arXiv 2607.27250 (context strategy)
- arXiv 2507.11538 (IFScale)
- arXiv 2505.16944 (AgentIF)
- arXiv 2510.20270 (ImpossibleBench)
- arXiv 2511.04427 (Cursor maintainability)
- arXiv 2603.17973 (TDAD)
- arXiv 2606.15017 (memory under a budget)
- arXiv 2608.14036 (skill catalogs)
- arXiv 2603.28052 (Meta-Harness)
- arXiv 2607.14004 (optimizers and regression control)
- metr.org/notes/2026-03-10
- aider.chat/docs/unified-diffs.html
- lesswrong.com Terminal-Bench luck-or-skill analysis

Primary guidance:

- code.claude.com/docs/en/memory, /hooks, /sub-agents, /best-practices, /costs, /plugins/components (accessed 2026-10-26)
- anthropic.com/engineering: effective-harnesses-for-long-running-agents (2025-11-26), effective-context-engineering-for-ai-agents (2025-09-29), harness-design-long-running-apps (2026-03-24)
- openai.com/index/harness-engineering (2026-02-11, via secondary summaries)
- humanlayer.dev/blog/writing-a-good-claude-md (2025-11-25)
- martinfowler.com/articles/exploring-gen-ai/harness-engineering.html (2026-04-02)
- engineering.atspotify.com feedback-loops part 3 (2025-12-09)
- factory.com/using-linters-to-direct-agents
- braintrust.dev/evals/behavior-vs-output-scoring (2026-08-20)
