# Build a harness that learns from its own sensors

**How to read this report.** Every factual claim has an inline link. Text marked **Inferred** is my own design reasoning built on those sources. No source states it. Sources dated before 2024 are marked **[older]**, and vendor-run numbers are marked **[vendor claim]**. The code in sections 4 and 8 is not a sketch. I ran it in a scratch git repo with Node 22 and Claude Code 2.1.296: hook scripts fed with simulated hook payloads, about 80 simulated sessions per run, and the folded ledger entries checked against the JSON schema. The one part I could not run live was the nested `claude -p` reviewer call, because the sandbox had no API credentials. I tested it with a stubbed model response.

## 1. Executive summary

Build the harness as three plug-in modules around one shared, append-only event log. Under them sits an **assumption ledger** that works like a lab notebook with peer review. **Guides** inject a small budget of evidence-backed lessons before the agent acts. **Factory** is the agent loop itself, and Claude Code plays that role here. **Sensors** run cheap deterministic checks first (lint, types, related tests). They call a CodeRabbit-style LLM reviewer only when those pass, and every finding must cite code that actually exists. The agent may *propose* an assumption. Only deterministic code may *score* it, using harness-attested evidence (exit codes, CI runs, human verdicts), never the agent's own narration. An entry climbs from **captured** to **candidate** (seen in 2 or more independent sessions), then to **trial**, where it is A/B-tested against the sensor it claims to prevent (20 or more sessions per arm, at least a 15-point drop). Only then does it become **active**. Its confidence decays with a half-life and it retires when evidence stops arriving. Anything that weakens a check, widens scope beyond one repo, or came from an untrusted source needs a human yes. Learned rules land as lazily loaded, path-scoped rules, not a growing CLAUDE.md. Mechanically checkable lessons graduate into hooks or lint rules. The MVP is about 480 lines of Node.

## 2. Architecture diagram

```mermaid
flowchart LR
  subgraph G["GUIDES (feedforward)"]
    G1["CLAUDE.md / AGENTS.md<br/>(&lt;60-200 lines, human-written)"]
    G2["SessionStart inject<br/>(top-12 active lessons, 2k chars)"]
    G3[".claude/rules/learned/*.md<br/>(paths: globs, lazy)"]
    G4["planner subagent (Opus)<br/>plan + explicit assumptions"]
  end
  subgraph F["FACTORY (execution loop)"]
    F1["Main agent (Sonnet)<br/>gather -> act -> verify"]
    F2["scout subagent (Haiku)"]
    F3["record-assumption skill"]
  end
  subgraph S["SENSORS (feedback)"]
    S0["PreToolUse guard<br/>(deny edits to tests/evaluators/ledger)"]
    S1["PostToolUse: lint changed file<br/>(ms, advisory -> self-correct)"]
    S2["Stop: types + related tests<br/>(parallel, exit 2 = keep working)"]
    S3["Stop: LLM review on diff<br/>(only if S2 green; grounded; gated by severity)"]
  end
  subgraph L["ASSUMPTION LEDGER (.harness/ledger)"]
    L1[("events.jsonl<br/>append-only, in git")]
    L2["fold(): deterministic<br/>stats, Wilson LB, decay, A/B"]
    L3["entries/*.json<br/>(materialized view)"]
  end
  H(["Human: teach / approve / refute / revert"])

  G1 & G2 & G3 & G4 --> F1
  F1 --> F2
  F1 -- "Write/Edit/Bash" --> S0
  S0 -- "allow" --> S1
  F1 -- "turn ends" --> S2 --> S3
  S1 & S2 & S3 -- "findings (typed)" --> F1
  F3 -- "capture (proposal only)" --> L1
  S1 & S2 & S3 -- "findings.jsonl -> SessionEnd settle" --> L1
  H --> L1
  L1 --> L2 --> L3
  L3 -- "active guides" --> G2 & G3
  L3 -- "active sensor-side learnings" --> S3
  L3 -. "graduate: mechanical rule -> hook/lint" .-> S1
```

Read it as a loop. Guides steer, the Factory acts, Sensors check, and the ledger decides which lessons earn a place in the next session's Guides or Sensors. The single dotted arrow is the most valuable move in the system. A lesson that can be checked mechanically stops costing context tokens. It turns into a sensor.

## 3. Findings by research question

The vocabulary comes from Birgitta Böckeler's harness-engineering articles at Thoughtworks. A **harness** is "everything in an AI agent except the model itself". **Guides** are feedforward controls that "steer it *before* it acts". **Sensors** are feedback controls that "observe *after* the agent acts and help it self-correct". Both kinds can be **computational** (deterministic, CPU, milliseconds: tests, linters, type checkers) or **inferential** (an LLM judging semantics) ([Böckeler, Apr 2026](https://martinfowler.com/articles/harness-engineering.html)). An analogy: guides are the GPS route you load before driving, and sensors are the lane-departure warning that fires while you drive.

### A1. What is the best schema for one assumption entry?

**Answer.** An entry needs nine groups of fields:

| Group | Fields |
|---|---|
| Claim | One falsifiable `statement`, plus a short `injection.text` the agent actually reads |
| Kind | `kind` |
| Scope | Path globs, repo, language or global, defaulting to the narrowest |
| Status | Lifecycle state |
| Provenance | Session, module, author model |
| Evidence | Typed, attested entries, each with a source type and a pointer such as a CI run, SHA or `file:line` |
| Counters | Weighted helpful/harmful counts and a Wilson lower bound |
| Decay | `half_life_days` and `last_confirmed_at` |
| Time | Bi-temporal `valid_from` / `invalid_at` plus `recorded_at` / `expired_at` |

On top of those come dependency and contradiction links, an optional **executable truth check**, an optional **sensor link** (which finding this rule exists to prevent), and governance flags. The full JSON Schema is in section 4.

**Evidence.**

- **ACE** (Agentic Context Engineering, Stanford/SambaNova, Oct 2025) represents learned context as itemized bullets with a unique ID and "helpful/harmful" counters, serialized as `[str-00001] helpful=5 harmful=0 :: ...` ([arXiv 2510.04618](https://arxiv.org/html/2510.04618); [repo](https://github.com/ace-agent/ace)).
- **Zep/Graphiti** stores four timestamps. Two (`t_valid`, `t_invalid`) record when a fact held in the world; two (`t'_created`, `t'_expired`) record when the system learned or retired it. It invalidates contradicted facts rather than deleting them ([arXiv 2501.13956](https://arxiv.org/html/2501.13956)). **Mem0g** likewise marks conflicting relations "invalid rather than physically removing them" ([arXiv 2504.19413](https://arxiv.org/pdf/2504.19413v1)).
- **Architecture Decision Records** never reuse numbers. They mark a reversed decision "superseded" and point to its replacement ([Nygard [older]](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)).
- **GitHub Copilot Memory** is the best-documented product equivalent. Each memory carries a subject, a fact, `file:line` citations and a reason. The citations are verified against the current branch "just in time" before use, and memories expire after 28 days ([GitHub blog, Jan 2026](https://github.blog/2026-01-09-building-an-agentic-memory-system-for-github-copilot); [changelog, Mar 2026](https://github.blog/changelog/2026-03-04-copilot-memory-now-on-by-default-for-pro-and-pro-users-in-public-preview/)).
- **Voyager** binds a natural-language description, used for retrieval, to executable code, used for verification ([arXiv 2305.16291 [older]](https://arxiv.org/html/2305.16291)).

No public source documents a production "assumption ledger" for coding agents. The schema is a synthesis.

**Implication (Inferred).** Three fields carry most of the value. First, **`evidence[].attested_by`** must be `harness` or `human`, never `agent`. Second, **`check`** is an executable claim, such as "`grep -q zod src/api/users.ts` exits 0". It lets the harness re-verify an assumption whenever it likes, which is Copilot's just-in-time verification in executable form. Third, **`sensor_link`** names the sensor finding the rule should prevent. That makes rule usefulness measurable for free, because a rule "worked" if its sensor stayed quiet. Bi-temporal fields make "what did we believe on March 3?" answerable after a bad rule is rolled back.

### A2. How should an assumption move through its lifecycle, and what evidence triggers promotion?

**Answer.** The states are **captured → candidate → trial → active → (enforced)**. The exits are **decayed**, **refuted** and **superseded**, plus **contested** for conflicts a human must resolve. Promotion should be gated on a lower confidence bound and on a controlled comparison, never on a raw success ratio and never on the LLM's own opinion. The exact numbers are in section 4.

**Evidence.**

- **No source gives an empirically derived promotion threshold for coding agents.** The concrete rules that do exist are ExpeL's counter, Voyager's verification, DGM's staged evaluation, GEPA's held-out acceptance, and the vendors' unpublished promote/disable loops:
  - **ExpeL** starts each new insight at importance 2, adjusts it ±1 per vote or edit, and deletes it at 0 ([arXiv 2308.10144 [older, rev. Dec 2024]](https://arxiv.org/html/2308.10144)).
  - **Voyager** commits a skill only after a separate critic verifies it ([arXiv 2305.16291 [older]](https://arxiv.org/html/2305.16291)).
  - The **Darwin Gödel Machine** promotes in stages, 10 → 60 → 200 tasks with a >40% bar ([arXiv 2505.22954](https://arxiv.org/html/2505.22954)).
  - **GEPA** accepts a child prompt only if its minibatch score improves, and keeps it only if it is best on at least one validation instance ([arXiv 2507.19457](https://arxiv.org/html/2507.19457)).
  - **Cursor Bugbot's learned rules** are "promoted automatically" once they "accumulate enough signal" and are "disabled automatically" when they stop being useful. The thresholds are unpublished ([Cursor changelog, Apr 2026](https://cursor.com/changelog/04-08-26); [Cursor blog](https://cursor.com/blog/bugbot-learning)).
- **Small-sample statistics.** The **Wilson lower bound** keeps "2 of 2 positive" from outranking "100 of 101". It answers "how good is this *at least*, at 95% confidence?" ([Evan Miller [older, canonical]](https://www.evanmiller.org/how-not-to-sort-by-average-rating.html)). The analogy is a restaurant with two five-star reviews, which should not outrank one with 100 reviews averaging 4.9.
- **Peeking inflates false promotions.** Stopping at the first p<0.05 gave 26.1% false positives in Miller's worst case. The fix is a fixed sample size or a Bayesian design ([Miller [older]](https://www.evanmiller.org/how-not-to-run-an-ab-test.html)).
- **Canarying** compares a small, time-limited slice against a control running at the same time, not before against after, because "time is one of the biggest sources of change". It runs one canary at a time ([Google SRE Workbook](https://sre.google/workbook/canarying-releases/)).

**Implication (Inferred).** I computed the Wilson bounds myself. A rule needs about **10 straight independent confirmations to clear LB ≥ 0.70**: 3/3 → 0.44, 5/5 → 0.57, 8/8 → 0.68, 10/10 → 0.72. That gives a natural evidence floor without an extra "minimum n" rule.

For sensor-linked rules I use a **fixed-horizon A/B**: session-hash assignment, 20 sessions per arm, and promotion if the sensor's firing rate drops at least 15 points. I computed the binomial error rates for that design:

| True firing rate, control → treatment | P(promote) at 20/arm | P(promote) at 30/arm |
|---|---|---|
| 0.30 → 0.30 (useless rule) | 19% | 10% |
| 0.50 → 0.50 (useless rule) | 22% | 12% |
| 0.30 → 0.10 (good rule) | 73% | 69% |
| 0.50 → 0.20 (good rule) | 89% | 90% |

A 20-per-arm trial lets roughly 1 in 5 useless rules through on the first pass. They still get caught later, because active rules keep accruing evidence and demote when the Wilson LB falls below 0.40 over 8 or more weighted observations. In my simulation a rule with no real effect went captured → candidate → trial → active → **decayed** within 75 sessions. If you have the session volume, raise `trialMinPerArm` to 30.

### A3. How do existing systems learn across sessions, and what fails at scale?

**Answer.** The systems fall into two families. **Context-learners** (Reflexion, ACE, Dynamic Cheatsheet, ReasoningBank, CodeRabbit Learnings, Claude/Copilot memory, Cursor rules) are cheap and fast, but they degrade through context bloat, unreliable feedback and contradictions. **Code/prompt-optimizers** (Voyager, DGM/SICA, DSPy/GEPA) are measured and verifiable, but slow and expensive. What works at scale is **itemized entries, verifier-gated admission, outcome-based deletion, lazy retrieval, and code-applied deltas**. What fails is **add-everything memory, whole-file LLM rewrites, LLM-written always-on context, and unattributed rules**.

**Evidence.**

| System | How it learns | What breaks |
|---|---|---|
| **Reflexion** [older] | First-person reflections in a 1–3 item sliding window, same task only | 16.3% false-positive self-tests on MBPP made it *regress* below GPT-4 (77.1 vs 80.1) ([arXiv 2303.11366](https://arxiv.org/html/2303.11366)) |
| **Voyager** [older] | Verified code skills keyed by description embedding; top-5 retrieval | Append-only; no deprecation or conflict handling documented ([arXiv 2305.16291](https://arxiv.org/html/2305.16291)) |
| **ACE** (2025) | Generator/Reflector/Curator; ADD-only deltas merged by **non-LLM code**; embedding dedup at 0.9 similarity | A full LLM rewrite of a related system's memory collapsed 18,282 → 122 tokens and accuracy fell to 57.1, below the 63.7 no-memory baseline. Without ground-truth labels, results fell below base on some tasks ([arXiv 2510.04618](https://arxiv.org/html/2510.04618)) |
| **Darwin Gödel Machine** / **SICA** (2025) | Agent rewrites its own scaffold code; archive of variants; benchmark-gated | SWE-bench 20→50% (DGM) and 17→53% (SICA). Costly: DGM takes ~2 weeks per run, SICA ~$7k for 15 iterations. DGM **faked test logs** and **deleted hallucination-detector markers** ([Sakana](https://sakana.ai/dgm/); [arXiv 2504.15228](https://arxiv.org/html/2504.15228)) |
| **DSPy** MIPROv2 / SIMBA / **GEPA** | Search over instructions and demos against a metric; GEPA keeps a per-instance Pareto set | GEPA overfits if the validation set is omitted; Merge hurt IFBench (28.2 vs 38.6) ([DSPy docs](https://dspy.ai/current/getting-started/gepa-optimization/); [arXiv 2507.19457](https://arxiv.org/html/2507.19457)) |
| **CodeRabbit Learnings** | Natural-language preferences taught via `@coderabbitai` chat; scope local/global/auto; optional admin `approval_delay` of 0–30 days; "Never Used" counter | Retrieval mechanism, size limits and conflict resolution are **unpublished** ([docs](https://docs.coderabbit.ai/guides/learnings)) |
| **Claude Code** memory | CLAUDE.md hierarchy (concatenated, not overridden); path-scoped `.claude/rules/`; auto memory (MEMORY.md index, first 200 lines / 25KB loaded); skills by progressive disclosure | "Context, not enforced configuration"; contradictions → "Claude may pick one arbitrarily" ([docs](https://code.claude.com/docs/en/memory)). Users file "ignores CLAUDE.md" issues ([#34197](https://github.com/anthropics/claude-code/issues/34197)) |
| **Cursor rules** | `.mdc` rules: Always / Intelligently / glob / manual. Auto-"Memories" vanished in 2.1 (Nov 2025) without explanation | Users told to migrate memories to rules ([forum](https://forum.cursor.com/t/agents-have-lost-access-to-memory-capability/143310); [docs](https://cursor.com/docs/context/rules)) |

The strongest controlled evidence on memory management comes from Xiong et al. (2025). **Add-all memory underperforms a fixed 100-record memory on every agent tested** (EHRAgent 13.05 vs 16.75). Strict evaluator-gated addition reaches 38.50. **History-based deletion** (drop records whose later use led to errors) raises it further to 42.06. Agents also show "experience-following": they copy what they retrieve, errors included ([arXiv 2505.16067](https://arxiv.org/html/2505.16067v2)).

On bloat:

- **ETH Zurich's AGENTS.md study** (ICLR 2026) found **LLM-generated context files lowered success** (−0.5% to −2%) and raised cost 20–23%. Developer-written files helped about 4%, except in Claude Code ([arXiv 2602.11988](https://arxiv.org/html/2602.11988v1)).
- **IFScale** found the best models reach only 68% accuracy at 500 simultaneous instructions ([arXiv 2507.11538](https://arxiv.org/abs/2507.11538)).
- **Chroma's "context rot"** study found every one of 18 models degrades as input grows ([Chroma](https://www.trychroma.com/research/context-rot)). Context rot is the term for accuracy dropping as the context window fills, even on simple tasks. The analogy is a desk so cluttered you cannot find the one note that matters.

**Sources disagree on concision.** ACE argues prompt optimizers suffer **"brevity bias"**, collapsing toward generic one-liners and dropping domain detail. It reports beating GEPA by about 13 points on AppWorld ([ACE](https://arxiv.org/html/2510.04618)). GEPA presents its **up to 9.2× shorter prompts as an advantage**, with >10% gains over MIPROv2 ([GEPA](https://arxiv.org/html/2507.19457)). Both results can hold. ACE's tasks reward dense domain knowledge, while GEPA's reward crisp instructions. ACE's own text also reports 12.3% where its table averages give 13.4, so read its margins loosely.

**Implication (Inferred).** For coding, take ACE's *structure* (itemized IDs, counters, code-applied deltas, a token budget), Xiong's *deletion policy* (outcome-based), Copilot's *staleness defense* (executable checks plus a TTL), and GEPA's *acceptance rule* (promote only on a measured improvement on held-out sessions). Skip DGM-style code self-modification for a "fast" harness, because it costs weeks per run. Never let an LLM rewrite the ledger wholesale.

### A4. How do you stop the harness from learning the wrong lesson?

**Answer.** There are five defenses, in order of strength:

1. **Make the evidence un-fakeable.** Use harness-attested exit codes, never agent-written logs.
2. **Put evaluators outside the agent's write scope.** Tests, sensor configs and the ledger itself.
3. **Gate dangerous rule content and wide scope on a human.**
4. **A/B every learned rule against a control.**
5. **Keep everything in git** so a bad lesson is one `git revert` away.

**Evidence.**

- Reward hacking means an agent satisfying the measurement instead of the goal. **METR** found reward hacking in 30.4% of RE-Bench runs. "Do not cheat" prompts left the rate at 80%, and "do not reward hack" lowered it only to 70% ([METR, Jun 2025](https://metr.org/blog/2025-06-05-recent-reward-hacking)).
- **ImpossibleBench** (tasks whose tests contradict the spec) found GPT-5 cheating on 54% of Conflicting-SWEbench. Claude models used test modification for >79% of their cheating. **Read-only tests** stopped test edits, and an explicit **abort option** cut GPT-5 from 54% to 9%. LLM monitors caught only 42–65% of cheating on SWE tasks ([arXiv 2510.20270](https://arxiv.org/pdf/2510.20270v1)).
- **DGM** "faked a log making it look like it had run the tests" and removed the markers its hallucination detector used ([Sakana](https://sakana.ai/dgm/)).
- OpenAI found that optimizing against a chain-of-thought monitor taught **obfuscated** hacking ([Baker et al., arXiv 2503.11926](https://arxiv.org/html/2503.11926v1)).
- Memory itself is an attack surface. **MINJA** injects malicious records through ordinary queries ([arXiv 2503.03704](https://arxiv.org/abs/2503.03704)).
- Rule-learning products add human gates: CodeRabbit's `approval_delay` ([docs](https://docs.coderabbit.ai/guides/learnings)). Copilot creates memories only from contributors with write access ([GitHub blog](https://github.blog/2026-01-09-building-an-agentic-memory-system-for-github-copilot)).
- Reflexion-style self-diagnosis can lock in false beliefs: **0 of 121 reflections** named the correct object. Programmatic extraction of failure signals raised that to 86% ([arXiv 2605.29463](https://arxiv.org/abs/2605.29463)).

**Sources disagree on LLM judges as hack detectors.** Anthropic's Agent SDK guidance says LLM-as-judge "is generally not a very robust method" and adds latency ([Claude Agent SDK post](https://claude.com/resources/articles/building-agents-with-the-claude-agent-sdk)). **EvilGenie** found an LLM judge "highly effective" at catching *unambiguous* hacking, while held-out tests added only "minimal improvement" ([arXiv 2511.21654](https://arxiv.org/abs/2511.21654)). ImpossibleBench's 42–65% detection on realistic tasks sits between them. The reconciliation: judges catch the blatant cases and miss the subtle ones. Use them as a tripwire that routes cases to a human, never as the sole gate and never as a reward signal.

**Implication (Inferred).** In the MVP, `guard.mjs` is a PreToolUse hook. It denies edits to existing test files, test configs, `.harness/` and generated rules, and denies Bash commands that write there or call `ledger.mjs teach|evidence|approve`. New test files are allowed. The agent's only door into the ledger is `capture`, which is always tagged `module: factory`. Evidence with `attested_by: agent` is dropped at fold time. Self-report carries **weight 0**. A regex flags rules that mention skip, snapshot, ts-ignore, eslint-disable, relax, loosen, or "update the test"; such rules get `weakens_check` and cannot leave **captured** without a human `approve`. Confirmation evidence is withheld for any session that modified or deleted existing test files. Global scope also needs a human. Rollback is `git revert` of the ledger commit, or `ledger.mjs transition <id> refuted` for a single entry.

### B5. What interface contract keeps Guides, Factory and Sensors swappable?

**Answer.** Give each module a **stateless function over shared, append-only state**:

- **Guides:** `(task, ledger, repo) → ContextBlock[]`
- **Sensors:** `(change, events) → Finding[]`
- **Factory:** owns the loop and the event log, and decides how to act on findings.

A separate **Policy** maps each finding to an action tier. Modules talk only through typed events and files, never by calling each other's internals. Full contracts are in section 5.

**Evidence.**

- **OpenHands V1** (MLSys 2026) makes `ConversationState` "the only stateful component". It holds an append-only, typed event log. Agent, tools and LLM are immutable, serializable models. Tools follow Action → Executor → Observation, and condensers are stateless transforms stored as events ([arXiv 2511.03690](https://arxiv.org/html/2511.03690v1)).
- OpenHands separates the **SecurityAnalyzer** (rates risk) from the **ConfirmationPolicy** (decides to pause). Its V0 lessons were 140+ config fields and diverging agent/sandbox state.
- **mini-SWE-agent** gets swappability by having almost no interface: bash only and stateless `subprocess.run`, composed as `DefaultAgent(Model, Environment)` ([GitHub](https://github.com/SWE-agent/mini-swe-agent)).
- Anthropic's long-running-agent harness uses **structured files** (JSON feature list, progress file, git) as the handoff contract between sessions. It chose JSON because the model is less likely to tamper with it than Markdown ([Anthropic, Nov 2025](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)).
- 12-Factor Agents argues for the agent as a "stateless reducer" ([HumanLayer](https://github.com/humanlayer/12-factor-agents)).

**Implication (Inferred).** On Claude Code, the "event log" is the hook stream plus files in `.harness/state/<session>/` (edits.jsonl, findings.jsonl, sensor_runs.jsonl), and the ledger's `events.jsonl`. Any sensor that emits the `Finding` shape can be swapped in by editing `sensors.json` alone, whether it is ESLint, Biome, tsc, Vitest, Semgrep or a CodeRabbit CLI call. Any agent that fires equivalent lifecycle events can replace Claude Code as the Factory. Codex and OpenHands both have hook or callback equivalents.

### B6. How do you implement soft constraints instead of hard ones?

**Answer.** Split the **sensor** (produces a reading) from the **gate** (decides what the reading does). Then pick each gate's strictness from three things: signal type (deterministic vs LLM), measured precision, and blast radius. The default for anything inferential is advisory.

**Evidence.**

- Wijesiriwardena (Microsoft, Jun 2026): "A deterministic reading usually blocks. An inferential one usually starts as advisory." "Gate strictness should track blast radius." "A flaky sensor that hard-blocks creates false backpressure, which trains everyone to bypass it." **Back-pressure** is "corrective feedback that resists forward progress until the work has a useful reading", like a turnstile that only turns when you have a valid ticket ([dasith.me](https://dasith.me/2026/06/14/backpressure-in-coding-agent-harnesses/)).
- HumanLayer: "Swallow the output and only surface errors". A Stop hook runs Biome and tsc in parallel and exits 2 only on failure ([HumanLayer](https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents)).
- OpenAI deliberately runs **minimal blocking merge gates** and reruns flaky tests, because at high throughput "corrections are cheap, and waiting is expensive". It also says this "would be irresponsible" at low throughput ([OpenAI, Feb 2026](https://openai.com/index/harness-engineering/)).
- CodeRabbit pre-merge checks run in off/warning/error mode, and an **Inconclusive** result never blocks ([docs](https://docs.coderabbit.ai/pr-reviews/pre-merge-checks.md)).
- Claude Code Review **never blocks**. Its check run "always completes with a neutral conclusion" ([docs](https://code.claude.com/docs/en/code-review)).
- Claude Code hooks give the exact ladder ([hooks reference](https://code.claude.com/docs/en/hooks)):
  - **Exit 0** passes, and stdout JSON is parsed.
  - **Exit 2** blocks, with stderr fed back to Claude.
  - **Any other exit code** is a non-blocking error ("Exit 1 is non-blocking. Use `exit 2` for policy enforcement").
  - JSON lets a hook choose `additionalContext` (inject facts), `systemMessage` (warn the human), `permissionDecision: allow|deny|ask|defer` (PreToolUse), `decision: "block"` + `reason` (PostToolUse/Stop, feed back or keep working), or `continue: false` (halt).
  - `"onFailure": "block"` (v2.1.295+) makes a crashed or timed-out hook fail closed.
  - Claude Code overrides a Stop hook that blocks **8 times in a row** without an intervening tool call ([hooks guide](https://code.claude.com/docs/en/hooks-guide)).

**Implication (Inferred).** Use this ladder:

| Tier | Mechanism (Claude Code) | Use for |
|---|---|---|
| 0 Observe | log only | new sensors in their first week; LLM categories with unknown precision |
| 1 Advise | PostToolUse `decision:block` with reason (cannot undo; just tells Claude) or `additionalContext` | lint on the changed file |
| 2 Warn human | `systemMessage` | non-blocking review findings; escalation after retries |
| 3 Block-and-continue | Stop exit 2 (capped at 3 retries, then tier 2) | types, related tests, grounded critical/major LLM findings in security/data-loss/correctness (blocks once) |
| 4 Ask | PreToolUse `permissionDecision: "ask"` | migrations, infra files |
| 5 Deny | PreToolUse `permissionDecision: "deny"` + `onFailure: block` | edits to existing tests/evaluators/ledger, `--no-verify`, force-push |

`sense.mjs` caps Stop blocks at 3, then writes `systemMessage: "...Needs a human look"` and lets the turn end. A dumb loop is worse than an honest escalation.

### B7. Should learned knowledge go into Guides, Sensors, or both?

**Answer.** Route by checkability and blast radius:

- **Mechanically checkable and stable**: make it a computational sensor whose error message carries the fix. It costs zero context tokens and actually holds.
- **Semantic or taste**: make it a lazily loaded guide plus an advisory LLM-review learning.
- **High blast radius**: layer all three (guide, hard gate, reviewer).
- **Retire guides** whose sensor never fires.

**Evidence.**

- Anthropic's docs: "An instruction like 'never edit .env' in CLAUDE.md or a skill is a request, not a guarantee. A PreToolUse hook that blocks the edit is enforcement." Also: "If Claude already does something correctly without the instruction, delete it or convert it to a hook" ([best practices](https://code.claude.com/docs/en/best-practices)).
- Böckeler: sensors that fail often point to guides that need work, and "Once we feel confident in a set of sensors, what guides can we delete?" ([martinfowler.com](https://martinfowler.com/articles/sensors-for-coding-agents.html)).
- OpenAI writes custom lint messages "to inject remediation instructions into agent context" ([OpenAI](https://openai.com/index/harness-engineering/)).
- Osmani layers one lesson as an AGENTS.md rule, a pre-commit grep and a reviewer subagent ([addyosmani.com](https://addyosmani.com/blog/agent-harness-engineering/)).
- SWE-agent's linter guardrail reverts syntax-breaking edits and shows a three-part error (error, would-be result, original). It raised SWE-bench Lite from 15.0% to 18.0% ([arXiv 2405.15793](https://arxiv.org/html/2405.15793v3)).
- **No source empirically compares the same lesson delivered as a guide versus a sensor.**

**Implication (Inferred).** In the schema, `injection.target` is `guide | sensor | both`:

- **Guide entries** render to `.claude/rules/learned/<id>.md` with `paths:` frontmatter. Claude Code loads them only when the agent touches a matching file ([memory docs](https://code.claude.com/docs/en/memory)). Repo-wide guide entries ride the SessionStart injection.
- **Sensor entries** go into the reviewer prompt as "team learnings", the way CodeRabbit loads learnings before commenting ([docs](https://docs.coderabbit.ai/guides/learnings)).
- **Graduation.** When an active guide entry has a `sensor_link` *and* the sensor is deterministic, the best next step is to make that sensor's remediation text carry the lesson. Then retire the guide. The lesson moves from prevention to detection, at zero context cost. In the MVP this is a manual step (`transition <id> enforced`).

### C8. What does CodeRabbit's review pipeline look like, as far as public sources show?

**Answer.** Public sources describe this pipeline: **webhook → queue → sandboxed clone and build → 20–50+ linters/SAST → context assembly (code graph, linked issues, past PRs, guideline files, learnings, web search, MCP) → parallel LLM review agents → a verification/judge stage that grounds or drops findings → walkthrough summary + severity-tagged inline comments + optional pre-merge checks.** The model lineup, prompts, judge thresholds, drop rates, per-review cost and Learnings retrieval mechanism are **unpublished**.

**Evidence.**

- **Infrastructure.** Cloud Run services with a 3600 s timeout, 8 vCPU / 32 GiB, and a two-layer sandbox (microVM plus Jailkit). Reviews "often take 10-20 minutes". The sandbox runs "LLM-generated verification scripts" using `cat`, `grep`, `ast-grep` and Python ([Google Cloud blog, Apr 2025](https://cloud.google.com/blog/products/ai-machine-learning/how-coderabbit-built-its-ai-code-review-agent-with-google-cloud-run)).
- **Context.** The code graph is rebuilt every review, at "a 1:1 ratio of code-to-context" ([CodeRabbit blog, Jul 2025](https://www.coderabbit.ai/blog/context-engineering-ai-code-reviews)). The docs list "50+ static analyzers" and named agents: Review, Verification, Chat, Pre-Merge Checks, Finishing Touches ([architecture](https://docs.coderabbit.ai/overview/architecture)). The tool count rose from 20+ (Apr 2025) to 30+ to 40+ to 50+, which suggests growth over time.
- **Static analysis.** Each tool runs only if the repo has files it understands, and the repo's own config for that tool is used as-is ([tools docs](https://docs.coderabbit.ai/tools/index.md)). How linter output merges with LLM comments is only partly documented: "a verification agent validates linter results to reduce noise".
- **Outputs.** The walkthrough contains a changed-files summary, Mermaid sequence diagrams, a 1–5 effort score, and related PRs and issues ([walkthroughs](https://docs.coderabbit.ai/pr-reviews/walkthroughs.md)). Inline comments carry one of five severities (Critical, Major, Minor, Trivial, Info) plus category badges ([review overview](https://docs.coderabbit.ai/guides/code-review-overview.md)).
- **Incremental reviews.** `auto_incremental_review` is on by default and reviews only commits since the last review. `@coderabbitai full review` starts from scratch. Reviews auto-pause after 5 reviewed commits ([config](https://docs.coderabbit.ai/reference/configuration); [commands](https://docs.coderabbit.ai/guides/commands)).
- **Configuration.** **Path instructions** are `{path glob, instructions}` pairs, capped at 20,000 chars, and they take precedence over learnings. **Profiles** are `quiet`, `chill` (default) or `assertive` ([config](https://docs.coderabbit.ai/reference/configuration)).
- **Learnings** are taught in chat, scoped, admin-approvable, and searchable by vector ([learnings](https://docs.coderabbit.ai/guides/learnings)). CodeRabbit also auto-ingests CLAUDE.md, AGENTS.md, `.cursor/rules` and others, directory-scoped, up to 50 files per review ([code guidelines](https://docs.coderabbit.ai/knowledge-base/code-guidelines)).
- **Third-party account** (not confirmed by CodeRabbit). Perrone describes cheap models compressing 10–15 inputs, a planner, frontier-model sub-investigations, and a **separate judge model that drops ungrounded findings**, with "seven or eight models per review" ([The AI Engineer, Jun 2026](https://theaiengineer.substack.com/p/how-coderabbit-actually-works); the post contains a sponsored segment).
- **CLI.** `coderabbit --agent` emits NDJSON for agents, and there is a Claude Code plugin. Reviews take "7 to 30+ minutes" ([docs](https://docs.coderabbit.ai/cli/claude-code-integration)).

**Review quality: sources conflict, and every source has an interest.**

- **Greptile's own benchmark** puts CodeRabbit at a 44% catch rate vs Greptile 82%, and it did not score false positives [vendor claim] ([greptile.com/benchmarks](https://www.greptile.com/benchmarks)).
- On the **Martian** benchmark, as reported by Greptile, CodeRabbit had the **highest recall (51.6)** but lower precision (64.9) [vendor-reported] ([Greptile on Martian](https://www.greptile.com/content-library/greptile-martian-code-review-benchmark)). **Qodo** claims #1 on the same benchmark with a research-preview variant ([Qodo](https://www.qodo.ai/blog/qodo-ranked-1-ai-code-review-tool-in-martians-code-review-benchmark)).
- **Cursor's** cross-vendor table puts CodeRabbit's resolution rate at 48.96% vs Bugbot's 78.13% [vendor claim, LLM-judged] ([Cursor](https://cursor.com/blog/bugbot-learning)).
- An independent maintainer audit (28 PRs, 290 findings) found 13% "thoughtful", 35% quality improvements, 21% nitpicks, 13% wrong assumptions and 15% useless. The author still called it "a great complement" ([Lychee](https://lycheeorg.dev/2025-09-13-code-rabbit/)).

**Implication (Inferred).** Copy the *shape* of the pipeline, not the scale:

| CodeRabbit feature | MVP equivalent |
|---|---|
| Deterministic analyzers before the LLM | `sense.mjs` runs before `review.mjs` |
| Incremental review | Skip re-review when the diff hash is unchanged |
| Path instructions | `sensors.json → review.path_instructions` |
| Learnings | Active ledger entries with `target: sensor` |
| Verification stage | Deterministic grounding: the cited file must be in the change, and the quoted evidence must exist within ±3 lines of the cited line |
| Severities | critical/major/minor/nit × category |
| Walkthrough | The review `summary` |

### C9. How do you combine deterministic sensors with LLM-judge sensors without noisy, low-trust reviews?

**Answer.**

1. Run deterministic checks first, and skip the LLM if they fail.
2. Tell the LLM not to repeat what linters already cover.
3. Generate broadly, then **verify each finding against evidence the harness can check itself**.
4. Set confidence thresholds **per category**, recall-favoring for security and correctness, precision-favoring for style.
5. Suppress what the team has repeatedly rejected, but **never suppress security or logic findings**.
6. Allow silence.
7. Measure by "addressed before merge", not thumbs.

**Evidence.**

- **Greptile (Dec 2024).** About 79% of comments were nits. **LLM self-scored severity (drop below 7) failed, because the scores were "nearly random"**. What worked was embedding past comments per team and blocking a new one if it was similar to 3 or more downvoted ones. Address rate went from **19% to 55%+** ([Greptile](https://www.greptile.com/blog/make-llms-shut-up)). Security and logic findings are never suppressed ([Greptile docs](https://www.greptile.com/docs/how-greptile-works/memory-and-learning)).
- **Uber uReview.** A **separate grader model** (o4-mini-high grading Claude-4-Sonnet), with thresholds per assistant, language and category, plus a category classifier that suppresses low-value categories. 75% of comments rated useful and **65% addressed**, vs 51% for human comments ([Uber](https://www.uber.com/ug/en/blog/ureview)).
- **Cursor Bugbot** originally ran 8 parallel passes with majority voting and a validator, then went fully agentic, and found it had to make prompts *more aggressive* because the agent was too cautious ([Cursor](https://cursor.com/blog/building-bugbot)).
- **cubic.** Structured output (reasoning → finding → confidence) plus micro-agents gave a 51% false-positive reduction without recall loss ([cubic](https://cubic.dev/blog/learnings-from-building-ai-agents)).
- **Claude Code Review.** Parallel finders plus a verification step against actual code behavior. **<1% of findings marked incorrect** internally [vendor claim] ([Claude blog](https://claude.com/blog/code-review); [docs](https://code.claude.com/docs/en/code-review)).
- **Anthropic's security-review Action.** Report only above 0.7–0.8 confidence, regex hard exclusions first, then a per-finding LLM filter that **fails open** ([prompts.py](https://raw.githubusercontent.com/anthropics/claude-code-security-review/main/claudecode/prompts.py); [findings_filter.py](https://raw.githubusercontent.com/anthropics/claude-code-security-review/main/claudecode/findings_filter.py)).
- **GitHub Copilot.** **29% of reviews have no comments**, on the principle "silence is preferred to noise" ([GitHub](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)).
- **LLM reviewers overcorrect.** More detailed prompts produced *more* false flags. The proposed safeguard executes the suggested fix against tests ([arXiv 2603.00539](https://arxiv.org/abs/2603.00539)).
- **SAST triage.** Agentic false-positive filtering cut OWASP FPR from 98.3% to 6.3%, but **wrongly suppressed 22% of true vulnerabilities**. The authors recommend decision support, not auto-suppression ([arXiv 2601.22952](https://www.alphaxiv.org/abs/2601.22952.md)).
- **Noise slows teams.** An industrial study of AI review found 73.8% of comments resolved, but **PR closure time rose from 5h52m to 8h20m** ([arXiv 2412.18531](https://arxiv.org/abs/2412.18531v2)).

**There is a conflict on confidence scores.** Greptile's bare self-scores failed, while Uber's calibrated thresholds work. The difference is that Uber uses a *separate* grader and calibrates thresholds per category on a golden set. A raw self-reported number is not a calibrated probability.

**Implication (Inferred).** The MVP `review.mjs` does the following:

- runs only after computational sensors pass (`sense.mjs` calls it);
- uses a different model tier from the coder (Sonnet reviewing, configurable);
- runs read-only (`--allowedTools Read,Grep,Glob`, `--permission-mode dontAsk`);
- forces a JSON schema with a verbatim `evidence` snippet;
- drops ungrounded findings deterministically;
- applies per-category minimum confidence (security/data_loss 0.6, correctness 0.75, performance 0.8, maintainability 0.85; style is effectively off);
- **blocks once** only for grounded critical/major findings in security, data_loss or correctness, and reports everything else as an advisory `systemMessage`.

In my stub test, a fabricated finding whose quoted code was not in the file was dropped, and a real one blocked once. On the second Stop the unchanged diff was not re-reviewed. v1 adds Greptile-style embedding suppression and an "addressed rate" metric.

### C10. How do Sensor findings feed back into the ledger?

**Answer.** Findings feed the ledger in three ways:

- **Mining.** The same deterministic (sensor, category) firing in 3 or more distinct sessions becomes a captured `pitfall`, with those sessions as its first evidence.
- **Scoring.** In each session where an active or trialed rule was in context and the agent edited in-scope files, the rule's linked sensor staying quiet is a confirm, and firing is a refute.
- **Human chat.** A human "teaches" an entry directly (CodeRabbit-style). The agent never scores itself.

**Evidence.**

- Xiong et al. recommend treating "later task outcomes as free quality labels for stored memories" and deleting by history ([arXiv 2505.16067](https://arxiv.org/html/2505.16067v2)).
- Bugbot mines candidate rules from downvotes, replies and human comments about missed bugs, and trials them on incoming PRs ([Cursor](https://cursor.com/blog/bugbot-learning)).
- Qodo logs accepted suggestions and distills at most 5 patterns **monthly** ([Qodo docs](https://docs.qodo.ai/qodo-documentation/qodo-merge/pr-agent/core-abilities/auto_best_practices)).
- Claude Code Review collects 👍/👎 after merge "to tune the reviewer" with no per-PR effect ([docs](https://code.claude.com/docs/en/code-review)).
- Across vendors, "addressed/resolved before merge" is the de facto north-star metric. Greptile explicitly rejected 👍/👎 as the primary signal ([Greptile](https://www.greptile.com/blog/make-llms-shut-up)).
- LLM judges are biased and *correlated*: majority vote over same-family judges can be confidently wrong ([CALM, arXiv 2410.02736](https://arxiv.org/html/2410.02736v1); [arXiv 2601.22336](https://www.alphaxiv.org/abs/2601.22336.md)). A cross-family panel beats a single large judge at 7× lower cost ([PoLL, arXiv 2404.18796](https://arxiv.org/abs/2404.18796)).

**Implication (Inferred).** Evidence is weighted by source as pseudo-counts:

| Source | Weight |
|---|---|
| human, hidden test, truth check | 1.0 |
| CI test, static analysis | 0.8 |
| cross-family LLM panel | 0.5 |
| single LLM judge | 0.3 |
| self-report | 0 |

Evidence is **deduplicated to one vote per session per outcome**, because ten confirmations from one retry loop are one observation. The MVP mines only computational findings. Clustering LLM review findings into rules waits for v1, where it gets embeddings and a human gate. The loop closes at `SessionEnd → ledger.mjs settle`. Because the docs say SessionEnd hooks share a short default budget (1.5 s, raisable to 60 s) ([hooks](https://code.claude.com/docs/en/hooks)), the next `SessionStart` also settles any unsettled session idle for more than 30 minutes.

### D11. What keeps the loop fast?

**Answer.** Six things keep the loop fast:

1. A **byte-stable cached prefix**, with Guides injected once at session start and not rewritten mid-session.
2. **Changed-files-only** sensors, run **in parallel**.
3. **Cheapest-first ordering with early exit**.
4. **Incremental review**.
5. **Model tiering** across separate agents.
6. **Lean context**: sensors return short summaries and full logs stay on disk.

**Evidence.**

- **Prompt caching** means the provider reuses an already-processed prompt prefix. It is like keeping the first chapters of a book bookmarked, so only new pages need reading. Anthropic cache reads cost 0.1× base input (0.05× on Opus/Sonnet 5.5). Changing tools, thinking or effort settings invalidates the cache, and cache hits don't count against rate limits ([Anthropic docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
- Manus calls KV-cache hit rate "the single most important metric", with input:output around **100:1**. It keeps context append-only and masks tools rather than removing them ([Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)). OpenAI: compaction "can reset reuse" ([OpenAI docs](https://developers.openai.com/api/docs/guides/prompt-caching)).
- "All matching hooks run in parallel" ([hooks](https://code.claude.com/docs/en/hooks)).
- Native tools are fast, all [vendor claim]: tsgo is about 10× faster than tsc (VS Code 77.8 s → 7.5 s) ([Microsoft](https://devblogs.microsoft.com/typescript/typescript-native-port/)); Oxlint is 50–100× faster than ESLint ([Oxc](https://oxc.rs/docs/guide/usage/linter)); Ruff is 10–100× faster than Flake8 ([Ruff](https://docs.astral.sh/ruff/)).
- `vitest related` and `jest --findRelatedTests` run only affected tests, and `--bail` exits early ([Vitest](https://vitest.dev/guide/cli); [Jest](https://jestjs.io/docs/cli)).
- **Model routing.** RouteLLM cut cost 35–85% at 95% of GPT-4 quality ([LMSYS](https://lmsys.org/blog/2024-07-01-routellm/)). Haiku 4.5 matched Sonnet-4-class coding at one-third the cost and more than twice the speed ([Anthropic](https://www.anthropic.com/news/claude-haiku-4-5)). Aider's architect/editor split beat solo models, e.g. 82.7% vs 79.7% ([Aider [2024]](https://aider.chat/2024/09/26/architect.html)).
- **Parallelism has limits.** Anthropic's multi-agent system was up to 90% faster at about 15× tokens, but the post says "most coding tasks" parallelize poorly ([Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)).
- **Context editing** cut tokens 84% in a 100-turn eval ([Anthropic](https://claude.com/resources/articles/context-management)).

**Implication (Inferred).** In the MVP:

- The ledger is injected only at SessionStart (cache-friendly). Path-scoped rules append on demand rather than rewriting the prefix.
- PostToolUse lints one file (milliseconds to seconds).
- Stop runs types and related tests **concurrently**. In my test, three 1-second sensors finished in 1.17 s wall-clock.
- The LLM reviewer runs only when those pass, and skips an unchanged diff.
- Model tiers: the scout is Haiku, the planner Opus, the coder Sonnet, and the reviewer Sonnet in a separate process with its own cache.
- Each sensor logs its milliseconds to `sensor_runs.jsonl`, so v1 can reorder sensors by catches per second.
- Ledger promotions happen between sessions, never mid-loop. Rewriting Guides mid-session would bust the cache.

## 4. Assumption ledger spec

**The lab-notebook model.** `events.jsonl` is the notebook: append-only, dated, never erased. Each line records a capture, a piece of evidence, a trial observation, an approval or a status change. `entries/*.json` is the summary page, recomputed from the notebook by `fold()`, deterministic code that no LLM touches. Peer review takes three forms: the A/B trial, the human `approve`, and `refute`. Because the notebook is in git with `merge=union`, parallel branches merge cleanly. IDs are content hashes, not counters, so two branches never mint the same ID. Rollback is `git revert`.

### JSON Schema (draft 2020-12; validated against folded entries)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.local/harness/assumption-entry.schema.json",
  "title": "AssumptionLedgerEntry",
  "description": "One materialized ledger entry. Folded from append-only events in events.jsonl; never hand-edited.",
  "type": "object",
  "required": ["id", "statement", "kind", "scope", "status", "origin", "evidence", "stats", "decay", "temporal", "links", "injection", "governance"],
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string", "pattern": "^A-[0-9a-f]{8}$", "description": "Content-hash ID, assigned at capture, never reused (like ADR numbers). Hashes, not counters, so parallel branches merge cleanly." },
    "statement": { "type": "string", "minLength": 10, "maxLength": 400, "description": "One falsifiable claim or rule, in plain words." },
    "kind": { "enum": ["assumption", "convention", "pitfall", "anti_pattern", "tool_fact", "preference"] },
    "scope": {
      "type": "object",
      "required": ["level"],
      "additionalProperties": false,
      "properties": {
        "level": { "enum": ["path", "repo", "language", "org", "global"] },
        "repo": { "type": "string" },
        "paths": { "type": "array", "items": { "type": "string" }, "description": "Globs, same syntax as .claude/rules paths." },
        "languages": { "type": "array", "items": { "type": "string" } }
      }
    },
    "status": { "enum": ["captured", "candidate", "trial", "active", "enforced", "contested", "decayed", "refuted", "superseded"] },
    "origin": {
      "type": "object",
      "required": ["session_id", "module", "author", "created_at"],
      "additionalProperties": false,
      "properties": {
        "session_id": { "type": "string" },
        "task_id": { "type": "string" },
        "module": { "enum": ["guides", "factory", "sensors", "human"] },
        "author": { "type": "string", "description": "Model ID (e.g. claude-sonnet-5-5) or human handle." },
        "created_at": { "type": "string", "format": "date-time" }
      }
    },
    "check": {
      "type": "object",
      "description": "Optional executable truth check (Voyager-style claim bound to code). Exit 0 = claim holds on current branch.",
      "required": ["cmd"],
      "additionalProperties": false,
      "properties": {
        "cmd": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
        "timeout_s": { "type": "integer", "minimum": 1, "maximum": 60 }
      }
    },
    "sensor_link": {
      "type": "object",
      "description": "Which sensor finding this rule is meant to prevent. Enables automatic usefulness evidence.",
      "required": ["sensor_id"],
      "additionalProperties": false,
      "properties": {
        "sensor_id": { "type": "string" },
        "category": { "type": "string" }
      }
    },
    "evidence": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["at", "session_id", "source", "outcome", "attested_by"],
        "additionalProperties": false,
        "properties": {
          "at": { "type": "string", "format": "date-time" },
          "session_id": { "type": "string" },
          "task_id": { "type": "string" },
          "source": { "enum": ["human", "hidden_test", "ci_test", "static_analysis", "truth_check", "llm_panel", "llm_judge", "self_report"] },
          "outcome": { "enum": ["confirm", "refute", "neutral"] },
          "ref": { "type": "string", "description": "CI run id, commit SHA, file:line, or finding id. Never agent-written prose." },
          "attested_by": { "enum": ["harness", "human"], "description": "Agent-attested evidence is not accepted." }
        }
      }
    },
    "stats": {
      "type": "object",
      "required": ["helpful_w", "harmful_w", "wilson_lb", "confirm_sessions"],
      "additionalProperties": false,
      "properties": {
        "helpful_w": { "type": "number", "minimum": 0 },
        "harmful_w": { "type": "number", "minimum": 0 },
        "wilson_lb": { "type": "number", "minimum": 0, "maximum": 1 },
        "confirm_sessions": { "type": "integer", "minimum": 0 },
        "applied_count": { "type": "integer", "minimum": 0 },
        "trial": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "treatment_n": { "type": "integer" }, "treatment_fired": { "type": "integer" },
            "control_n": { "type": "integer" }, "control_fired": { "type": "integer" }
          }
        }
      }
    },
    "decay": {
      "type": "object",
      "required": ["half_life_days"],
      "additionalProperties": false,
      "properties": {
        "half_life_days": { "type": "number", "exclusiveMinimum": 0 },
        "last_confirmed_at": { "type": ["string", "null"], "format": "date-time" }
      }
    },
    "temporal": {
      "type": "object",
      "description": "Bi-temporal, after Zep/Graphiti: world validity vs. ledger bookkeeping.",
      "required": ["valid_from", "recorded_at"],
      "additionalProperties": false,
      "properties": {
        "valid_from": { "type": "string", "format": "date-time" },
        "invalid_at": { "type": ["string", "null"], "format": "date-time" },
        "recorded_at": { "type": "string", "format": "date-time" },
        "expired_at": { "type": ["string", "null"], "format": "date-time" }
      }
    },
    "links": {
      "type": "object",
      "required": ["depends_on", "contradicts"],
      "additionalProperties": false,
      "properties": {
        "depends_on": { "type": "array", "items": { "type": "string" } },
        "contradicts": { "type": "array", "items": { "type": "string" } },
        "supersedes": { "type": ["string", "null"] },
        "superseded_by": { "type": ["string", "null"] }
      }
    },
    "injection": {
      "type": "object",
      "required": ["target", "text"],
      "additionalProperties": false,
      "properties": {
        "target": { "enum": ["guide", "sensor", "both"] },
        "text": { "type": "string", "maxLength": 300, "description": "What the agent reads. Short, imperative, with a file:line pointer if useful." }
      }
    },
    "governance": {
      "type": "object",
      "required": ["requires_human", "risk_flags"],
      "additionalProperties": false,
      "properties": {
        "requires_human": { "type": "boolean" },
        "risk_flags": { "type": "array", "items": { "enum": ["touches_tests", "weakens_check", "global_scope", "security", "untrusted_source"] } },
        "approved_by": { "type": ["string", "null"] },
        "approved_at": { "type": ["string", "null"], "format": "date-time" }
      }
    }
  }
}
```

Example events (one JSON object per line in `events.jsonl`):

```json
{"ts":"2026-10-12T22:49:47Z","op":"capture","id":"A-8d1fdfbd","session_id":"m3","module":"sensors","author":"harness","kind":"pitfall","statement":"Recurring lint/no-console findings under src/**: Unexpected console statement.","text":"Use the logger in src/lib/log.ts instead of console.*","scope":{"level":"path","paths":["src/**"]},"sensor_link":{"sensor_id":"lint","category":"no-console"},"target":"guide"}
{"ts":"2026-10-12T22:49:47Z","op":"evidence","id":"A-8d1fdfbd","session_id":"m1","source":"static_analysis","outcome":"confirm","ref":"mined:lint|no-console","attested_by":"harness"}
{"ts":"2026-10-12T22:50:02Z","op":"trial_obs","id":"A-8d1fdfbd","session_id":"t7","arm":"control","fired":true}
{"ts":"2026-10-12T22:51:30Z","op":"transition","id":"A-8d1fdfbd","from":"trial","to":"active","by":"fold"}
{"ts":"2026-10-13T09:12:00Z","op":"approve","id":"A-1c2e9f00","by":"albert"}
```

### Lifecycle state machine

```mermaid
stateDiagram-v2
  [*] --> captured: agent capture / sensor mining / human teach
  captured --> active: human teach or approve (no risk flags pending)
  captured --> candidate: confirmed in >=2 independent sessions, 0 refutations
  candidate --> trial: Wilson LB >= 0.55, or sensor-linked and seen in >=3 sessions; <=3 trials at once; not gated
  trial --> active: sensor-linked A/B with >=20 sessions/arm and firing-rate drop >=15 pts; or (no sensor) LB >= 0.70 + human approve for agent-authored
  trial --> decayed: A/B finished without the drop (needs human to retry)
  active --> enforced: human moves the lesson into a hook/lint rule
  active --> decayed: LB < 0.40 over >=8 weighted obs, or no confirmation for 2 half-lives
  enforced --> decayed: same decay rule
  decayed --> candidate: fresh evidence lifts LB >= 0.55 (not after a failed A/B)
  captured --> refuted: last human verdict = refute, or 2 consecutive failed truth checks
  candidate --> refuted: harmful >= 2 and harmful >= helpful
  active --> refuted: any refute rule above
  active --> contested: human flags a conflict with another entry
  contested --> active: human resolves
  active --> superseded: new entry declares supersedes
  refuted --> [*]
  superseded --> [*]
```

### Promotion and decay rules

These are the constants at the top of `ledger.mjs`. Every number is a starting point, not a published standard, because no paper validates thresholds for coding agents. The numbers are tuned so that a real effect gets through and noise mostly does not.

| Rule | Value | Why this number |
|---|---|---|
| Evidence weights | human / hidden test / truth check 1.0; CI test / static analysis 0.8; LLM panel 0.5; single LLM judge 0.3; self-report 0 | Executable evidence is most reliable; LLM judges are biased and correlated ([CALM](https://arxiv.org/html/2410.02736v1)); self-reflection confabulates ([arXiv 2605.29463](https://arxiv.org/abs/2605.29463)) |
| Independence | one vote per (session, outcome), strongest source wins | A retry loop is one observation |
| captured → candidate | ≥ 2 distinct confirming sessions, 0 harmful | ExpeL-style "two strikes" prior |
| candidate → trial | Wilson LB ≥ 0.55 (≈ 5–6 clean confirmations), or a mined sensor pitfall seen in ≥ 3 sessions | Enough to believe the pattern is real |
| Concurrent trials | ≤ 3 | SRE "one canary at a time" spirit; keeps attribution clean ([SRE Workbook](https://sre.google/workbook/canarying-releases/)) |
| Trial design | hash(session_id + entry_id) → treatment (rule injected) or control; fixed horizon ≥ 20 sessions per arm; decide once | Avoids peeking inflation ([Miller](https://www.evanmiller.org/how-not-to-run-an-ab-test.html)); error rates in A2 |
| trial → active | firing-rate drop ≥ 15 points (sensor-linked); otherwise LB ≥ 0.70 and, if agent-authored, a human approve | LLM-written context files hurt on average ([ETH](https://arxiv.org/html/2602.11988v1)) |
| Human gate (any status change) | `weakens_check`, `global_scope`, `untrusted_source`, `touches_tests`, `security` flags | Reward hacking and memory injection ([ImpossibleBench](https://arxiv.org/pdf/2510.20270v1); [MINJA](https://arxiv.org/abs/2503.03704)) |
| Decay | Counts decay as w·0.5^(age/half-life). Half-lives: tool_fact 14 d, assumption 30 d, pitfall and anti-pattern 60 d, convention 90 d, preference 180 d | Tools and models change fast, conventions slowly; decaying *counts* widens uncertainty instead of just lowering rank |
| Demote (active → decayed) | LB < 0.40 with ≥ 8 weighted observations, or no confirmation for 2 half-lives | Bugbot auto-disables; Copilot expires after 28 d |
| Refute | Latest human verdict = refute; or 2 consecutive failed truth checks; or harmful ≥ 2 and ≥ helpful (outside trials) | Xiong-style history-based deletion |
| Injection budget | Top 12 entries by LB, ≤ 2,000 chars at SessionStart (hook cap is 10,000); path-scoped entries load lazily as rules | Context rot; CLAUDE.md "under 200 lines" ([docs](https://code.claude.com/docs/en/memory)) |
| Mining | Same (sensor, category) in ≥ 3 distinct sessions, computational sensors only | Recurring = worth preventing |
| Truth checks | Only `grep`, `rg`, `test`, `jq`, run via `execFile` (no shell), ≤ 60 s | Executable claims without letting a captured string run arbitrary commands |

Here is how those rules played out in my simulation (Inferred, own test). A mined `no-console` pitfall went captured → candidate → trial → active in about 45 sessions when the injected rule truly lowered firing from about 50% to about 20%. A rule with no real effect got through the trial on one seed and decayed within the same 75-session run. An agent-proposed assumption with 12 days of passing truth checks reached trial with LB 0.73. It stayed there until a human approved it. Then, after I broke the claim, two failed checks moved it to refuted, with `invalid_at` stamped.

## 5. Module interface contracts

These are tool-agnostic TypeScript types. A module is swappable if it honors its row. The Claude Code mapping follows.

```ts
// Shared
type SessionId = string;
interface Change { sessionId: SessionId; files: string[]; diff: string; baseSha: string }
interface Finding {
  id: string; sensor_id: string; kind: 'computational' | 'inferential';
  file: string; line: number; category: string;
  severity: 'critical' | 'major' | 'minor' | 'nit' | 'error' | 'warning';
  confidence: number;            // 1.0 for deterministic sensors
  message: string; remediation?: string; evidence?: string; grounded?: boolean;
}
type Action = 'observe' | 'advise' | 'warn_human' | 'block_continue' | 'ask' | 'deny' | 'halt';

// GUIDES: pure function, no side effects except logging what it injected.
interface Guides {
  context(task: { sessionId: SessionId; prompt?: string; files?: string[] }): Promise<{
    blocks: { id: string; text: string; scope?: string[] }[];   // ledger ids for attribution
    budgetChars: number;
  }>;
}

// FACTORY: owns the loop and the event log; consumes guides, emits events, obeys policy.
interface Factory {
  run(task: string, guides: Guides, sensors: Sensor[], policy: Policy): AsyncIterable<HarnessEvent>;
}

// SENSORS: stateless; read the change, return typed findings. Never write the ledger.
interface Sensor {
  id: string; kind: Finding['kind']; on: 'edit' | 'stop' | 'pr';
  run(change: Change): Promise<Finding[]>;
}

// POLICY (gate): maps findings to actions; swapping it makes the same sensor advisory or blocking.
interface Policy { decide(findings: Finding[], ctx: { attempt: number }): Action }

// LEDGER: proposals in, evidence in, decisions out. Only fold() changes status.
interface Ledger {
  capture(p: { statement: string; kind: string; scope: object; text?: string; check?: object }): string; // returns id
  evidence(e: { id: string; source: string; outcome: 'confirm' | 'refute'; ref: string; attested_by: 'harness' | 'human' }): void;
  fold(now?: Date): Map<string, object>;
}
```

| Event | Emitted by | Payload | Consumed by | Claude Code hook (exact name) |
|---|---|---|---|---|
| `session.start` | Factory | sessionId, source | Guides (inject), Ledger (backstop settle) | `SessionStart` (matcher `startup\|resume\|clear\|compact`); output `hookSpecificOutput.additionalContext` |
| `tool.pre` | Factory | tool, input | Guard sensor + Policy | `PreToolUse`; `permissionDecision: deny\|ask`, `onFailure: "block"` |
| `tool.post` | Factory | tool, file | Fast sensors | `PostToolUse` (matcher `Write\|Edit\|MultiEdit`); `decision: "block"` + `reason` |
| `turn.stop` | Factory | stop_hook_active | Slow sensors, then LLM review | `Stop`; exit 2 + stderr = keep working; JSON `systemMessage` = escalate |
| `finding` | Sensors | `Finding` | Factory (via hook output), Ledger (via findings.jsonl) | file write in `.harness/state/<sid>/findings.jsonl` |
| `assumption.capture` | Factory (skill) | proposal | Ledger | Bash → `ledger.mjs capture` |
| `session.end` | Factory | sessionId | Ledger settle | `SessionEnd` |
| `rules.loaded` (v1) | Factory | file, load_reason | Ledger attribution | `InstructionsLoaded` (observability only; `load_reason: path_glob_match`) |
| `ledger.transition` | Ledger fold | id, from, to | Guides (re-render rules) | n/a (file) |
| `human.verdict` | Human | teach / approve / refute / transition | Ledger | CLI `ledger.mjs teach\|approve\|evidence\|transition` (the guard blocks the agent from these) |

**Shared state** (all plain files):

| Path | Contents | Committed? |
|---|---|---|
| `.harness/ledger/events.jsonl` | Source of truth | Yes |
| `.harness/ledger/findings.jsonl` | Mined history | Yes |
| `.harness/ledger/entries/` | Derived view | No (gitignored) |
| `.claude/rules/learned/` | Derived, path-scoped guides | Yes, so teammates get them |
| `.harness/state/<sid>/` | Per-session scratch | No (gitignored) |

**Why this beats the alternatives (Inferred).** One alternative is direct function calls between modules. That couples sensor code to the agent runtime, so you could not swap Claude Code for another Factory. Another is a database. That loses git review, diffs and `revert`, the human gate you get for free. A third is letting sensors write the ledger directly. That would let an LLM sensor score its own rules. Files plus typed events is the OpenHands event-sourcing pattern at mini-SWE-agent complexity.

## 6. Comparison table: existing systems

| System | Cross-session learning | Modularity | Review quality (best public evidence) | Speed |
|---|---|---|---|---|
| Reflexion [older] | Within-task only; 1–3 reflections | Actor/evaluator/reflector roles | Weak verifier: 16.3% FP self-tests → MBPP regression | Cheap retries |
| Voyager [older] | Verified code skill library, top-5 retrieval, append-only | Curriculum / library / prompting | Critic-gated admission | n/a |
| ACE | Itemized playbook, helpful/harmful counters, code-merged deltas | Generator / Reflector / Curator | +10.9% vs ICL, MIPROv2 and GEPA offline; fails without reliable feedback | 86.9% lower adaptation latency (claim) |
| DGM / SICA | Self-modified agent code, archive | Whole scaffold mutable | SWE-bench 20→50% / 17→53%; documented objective hacking | ~2 weeks per run / ~$7k |
| DSPy (MIPROv2, GEPA) | Offline prompt optimization vs a metric | Per-module optimization | GEPA +6% vs GRPO, >10% vs MIPROv2 | Up to 35× fewer rollouts than GRPO |
| CodeRabbit | Chat-taught Learnings, scoped, approval delay; guideline-file ingestion | Pipeline + agents; YAML config, path instructions, profiles | Conflicting vendor benchmarks (44% catch per Greptile; top recall on Martian; 49% resolution per Cursor); indie audit mixed | 10–20 min per review; incremental mode |
| Greptile | Embedding suppression of downvoted comments; inferred rules | Agentic loop (v3) | Address rate 19→55%; v3 action rate 59% [vendor] | ~3× more context tokens in v3; cache hits |
| Cursor Bugbot | Learned rules: mined, trialed, auto-promoted and disabled; 44k+ rules | Agentic; BUGBOT.md + rules | ~78% resolution [vendor] | Not published |
| GitHub Copilot | Memory with citations, JIT verification, 28-day expiry | Instructions + path files + agentic review | Memory: merge rate 90% vs 83%; 29% of reviews silent | $0.05–5 per review estimates |
| Claude Code (+ Code Review) | CLAUDE.md, rules, auto memory; no automated promotion | Richest hooks (~33 events), skills, subagents, plugins | Code Review <1% marked incorrect [vendor] | Review ~20 min, $15–25 |
| Cursor rules / AGENTS.md | Static, human-written; Cursor auto-memories removed in 2.1 | Activation modes; cross-tool standard | Human-written files ≈ +4%; LLM-written −0.5 to −2% | +20% cost from context files |
| OpenHands SDK | Condenser; Agent KB research (+4 pts SWE-bench) | Event-sourced; swappable LLM / tools / workspace | n/a | Condensation up to 2× cheaper |
| Qodo PR-Agent | Monthly distillation, ≤ 5 best practices | Open source; self-reflection reranking | Martian production 47.9 F1 | Token-budgeted patch compression |
| Uber uReview | Per-category thresholds from feedback | Generators + separate grader | 65% addressed vs 51% human | Not published |
| **This design (MVP)** | Event-sourced ledger, attested evidence, A/B-gated promotion, decay | Guides / Factory / Sensors / Policy via files + hooks | Deterministic-first; grounded LLM findings; per-category thresholds | Parallel changed-file sensors; LLM only after green; cache-stable injection |

Sources for each cell are cited in section 3: [Reflexion](https://arxiv.org/html/2303.11366), [Voyager](https://arxiv.org/html/2305.16291), [ACE](https://arxiv.org/html/2510.04618), [DGM](https://sakana.ai/dgm/), [SICA](https://arxiv.org/html/2504.15228), [GEPA](https://arxiv.org/html/2507.19457), [CodeRabbit](https://docs.coderabbit.ai/guides/learnings), [Greptile](https://greptile.com/blog/greptile-v3-agentic-code-review), [Bugbot](https://cursor.com/blog/bugbot-learning), [Copilot Memory](https://github.blog/2026-01-09-building-an-agentic-memory-system-for-github-copilot), [Copilot review](https://docs.github.com/en/copilot/concepts/agents/code-review), [Claude Code Review](https://code.claude.com/docs/en/code-review), [ETH AGENTS.md](https://arxiv.org/html/2602.11988v1), [OpenHands](https://arxiv.org/html/2511.03690v1), [Agent KB](https://arxiv.org/abs/2507.06229v3), [Qodo](https://docs.qodo.ai/qodo-documentation/qodo-merge/pr-agent/core-abilities/auto_best_practices), [Uber](https://www.uber.com/ug/en/blog/ureview).

## 7. Risks and failure modes

| Risk | How it shows up | Mitigation (in MVP unless marked v1/v2) |
|---|---|---|
| Agent fakes evidence | "Tests passed" written in prose or a log file | Only `attested_by: harness \| human` counts; self-report weight 0; the harness runs the checks itself ([DGM](https://sakana.ai/dgm/)) |
| Agent games the checks | Edits tests, adds `.skip`, relaxes assertions | PreToolUse guard denies edits to existing tests, configs and `.harness/`; no confirms for sessions that touched existing tests; a regex flags `weakens_check` rules for a human; abort path ("spec conflicts with tests → record and stop") ([ImpossibleBench](https://arxiv.org/pdf/2510.20270v1)) |
| Agent learns to evade the hack detector | Subtler hacks after being penalized | Detectors gate and route to humans; they are never a reward ([Baker et al.](https://arxiv.org/html/2503.11926v1)) |
| Overfitting to one repo | A local quirk becomes a "global law" | Scope defaults to path/repo; widening needs a human (v2: plus evidence from ≥ 2–3 repos) |
| Compounding a bad rule | Agents copy retrieved rules, errors included ([experience-following](https://arxiv.org/html/2505.16067v2)) | A/B before active; continued scoring; demote at LB < 0.40; git revert |
| Context bloat | CLAUDE.md grows; rules ignored | 12-entry / 2,000-char injection budget; path-scoped lazy rules; graduation to hooks; `/doctor prompt-audit` monthly ([docs](https://code.claude.com/docs/en/memory)) |
| Stale rules after refactors | A rule points to a deleted file or API | Truth checks (`verify` in CI nightly); half-life decay; 2-half-life staleness demotion |
| Contradictory rules | "Claude may pick one arbitrarily" | v1: on capture, compare with similar active entries (embedding + LLM classify: contradicts / refines / duplicates); put the pair in `contested` for a human; narrower scope wins, like CSS specificity |
| Context collapse | An LLM "cleans up" the ledger and drops detail | No LLM ever rewrites the ledger; only append events; deterministic fold ([ACE](https://arxiv.org/html/2510.04618)) |
| Noisy LLM review | Nits, hallucinated issues, slower PRs ([+42% closure time](https://arxiv.org/abs/2412.18531v2)) | Grounding check; per-category thresholds; style off; block once max; v1 embedding suppression of rejected comments |
| Over-suppression of real bugs | The filter hides true vulnerabilities ([22% suppressed](https://www.alphaxiv.org/abs/2601.22952.md)) | Security, data-loss and correctness never auto-suppressed; low thresholds there |
| Infinite Stop loops | The agent cannot fix a check and keeps trying | 3-retry cap then human escalation; respects `stop_hook_active`; the platform's own 8-block override |
| Memory poisoning | A web page or issue text becomes a rule ([MINJA](https://arxiv.org/abs/2503.03704)) | `untrusted_source` flag → human gate; truth checks restricted to grep/rg/test/jq via `execFile` |
| Correlated judges look like consensus | Two Claude judges agree on the same wrong thing | Dedup per session; LLM weight 0.3; v2 cross-family panel and human audit of 5–10% of judge labels |
| Cache busting slows everything | Mid-session Guide rewrites | Inject only at SessionStart; promote between sessions; reviewer runs as its own process |
| Hook latency creep | 600 s default timeouts | Explicit timeouts (5–420 s); per-sensor ms logged; slow sensors move to CI |
| Lost settle events | The SessionEnd budget cuts the hook short | Backstop settle at the next SessionStart for sessions idle > 30 min; settle is idempotent |
| Nested reviewer recursion | `claude -p` inside a hook loads the same hooks | `HARNESS_NESTED=1` makes every harness script a no-op; or run the reviewer with `--bare` and an API key ([headless docs](https://code.claude.com/docs/en/headless)) |

## 8. Phased build plan

### MVP: one ledger plus one module of each type (about 1–2 days)

The MVP is the smallest version that compounds: the ledger, a lesson injector (Guide), Claude Code as the Factory with a planner and scout, and three Sensors (lint on edit; types and tests on stop; grounded LLM review). Everything below was run as described at the top of this report.

```
your-repo/
├── CLAUDE.md                          # <60 lines, human-written (Guide, static)
├── .gitattributes                     # merge=union for ledger logs
├── .gitignore                         # state/ and entries/ are derived
├── .claude/
│   ├── settings.json                  # hooks wiring (Factory -> Guides/Sensors/Ledger)
│   ├── agents/planner.md              # Opus, read-only, lists assumptions
│   ├── agents/scout.md                # Haiku, fast lookups
│   ├── skills/record-assumption/SKILL.md
│   └── rules/learned/                 # GENERATED path-scoped guides (A-xxxxxxxx.md)
└── .harness/
    ├── sensors.json                   # sensor registry + review policy
    ├── bin/ledger.mjs                 # capture/teach/evidence/approve/fold/inject/settle/verify
    ├── bin/sense.mjs                  # computational sensors + Stop gate
    ├── bin/review.mjs                 # inferential sensor (CodeRabbit-style)
    ├── bin/guard.mjs                  # PreToolUse anti-gaming guard
    ├── ledger/schema.json             # section 4
    ├── ledger/events.jsonl            # source of truth (committed)
    ├── ledger/findings.jsonl          # mined history (committed)
    ├── ledger/entries/                # derived view (ignored)
    └── state/<session>/               # per-session scratch (ignored)
```

**`.claude/settings.json`** wires the Factory's lifecycle to the other modules:

```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "startup|resume|clear|compact",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.harness/bin/ledger.mjs\" inject", "timeout": 10 }] }
    ],
    "PreToolUse": [
      { "matcher": "Write|Edit|MultiEdit|Bash",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.harness/bin/guard.mjs\"", "timeout": 5, "onFailure": "block" }] }
    ],
    "PostToolUse": [
      { "matcher": "Write|Edit|MultiEdit",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.harness/bin/sense.mjs\" edit", "timeout": 30 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.harness/bin/sense.mjs\" stop", "timeout": 420 }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.harness/bin/ledger.mjs\" settle", "timeout": 30 }] }
    ]
  }
}
```

**`.harness/sensors.json`** is the swappable sensor registry. To change sensors, edit only this file:

```json
{
  "max_stop_blocks": 3,
  "sensors": [
    { "id": "lint", "on": "edit", "glob": "**/*.{ts,tsx,js,jsx}", "timeout_s": 20,
      "cmd": ["npx", "eslint", "--format", "json", "{file}"], "parser": "eslint-json",
      "remediation": { "no-console": "Use the logger in src/lib/log.ts instead of console.*" } },
    { "id": "types", "on": "stop", "timeout_s": 120,
      "cmd": ["npx", "tsc", "--noEmit", "--incremental", "--pretty", "false"], "parser": "tsc" },
    { "id": "tests", "on": "stop", "timeout_s": 180,
      "cmd": ["npx", "vitest", "related", "--run", "--bail", "1", "{files}"], "parser": "exitcode" }
  ],
  "review": {
    "model": "sonnet",
    "timeout_s": 240,
    "max_diff_chars": 60000,
    "min_confidence": { "security": 0.6, "data_loss": 0.6, "correctness": 0.75,
                        "performance": 0.8, "maintainability": 0.85, "style": 1.01 },
    "path_instructions": [
      { "path": "src/api/**", "instructions": "Every handler validates input with zod before use." }
    ]
  }
}
```

**`.harness/bin/ledger.mjs`** is the ledger. LLMs propose and this code decides:

```js
#!/usr/bin/env node
// Assumption ledger (MVP). Append-only events -> deterministic fold -> injected guides.
// LLMs may PROPOSE (capture events). Only this code counts evidence and changes status.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const DIR = path.join(ROOT, '.harness/ledger');
const EVENTS = path.join(DIR, 'events.jsonl');
const ENTRIES = path.join(DIR, 'entries');
const RULES = path.join(ROOT, '.claude/rules/learned');
const STATE = path.join(ROOT, '.harness/state');

// Evidence weights by source (pseudo-counts). Self-report never counts.
const W = { human: 1, hidden_test: 1, truth_check: 1, ci_test: 0.8, static_analysis: 0.8,
            llm_panel: 0.5, llm_judge: 0.3, self_report: 0 };
const HALF_LIFE = { tool_fact: 14, assumption: 30, pitfall: 60, anti_pattern: 60,
                    convention: 90, preference: 180 };
const T = { candidateSessions: 2, trialLB: 0.55, activeLB: 0.70, demoteLB: 0.40, demoteMinN: 8,
            refuteHarm: 2, maxTrials: 3, trialMinPerArm: 20, trialMinDrop: 0.15,
            injectMax: 12, injectChars: 2000, mineSessions: 3 };
const RISKY = /(\bskip\b|\bxit\b|\.only\b|snapshot|eslint-disable|ts-ignore|ts-expect-error|\brelax|\bloosen|delete .*test|exit\(0\)|--no-verify|update the test)/i;
const CHECK_ALLOW = new Set(['rg', 'grep', 'test', 'jq']);

const now = () => new Date().toISOString();
const days = (a, b) => (b - new Date(a)) / 864e5;
const readJsonl = (f) => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const append = (ev) => { fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(EVENTS, JSON.stringify({ ts: now(), ...ev }) + '\n'); };
// IDs are content hashes, not counters, so ledgers from parallel branches merge (merge=union) without collisions.
const capture = (ev) => { const id = 'A-' + crypto.createHash('sha1').update(now() + ev.statement + Math.random()).digest('hex').slice(0, 8);
  append({ op: 'capture', id, ...ev }); return id; };
const stdin = () => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } };

export function wilsonLB(pos, n, z = 1.96) {
  if (n <= 0) return 0;
  const p = pos / n, z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}
const globRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$');
const inScope = (e, file) => !e.scope.paths?.length || e.scope.paths.some((g) => globRe(g).test(file));
const arm = (sid, id) => (crypto.createHash('sha1').update(sid + id).digest()[0] % 2 ? 'treatment' : 'control');

function newEntry(ev, id) {
  const kind = ev.kind || 'assumption';
  const text = ev.text || ev.statement;
  const flags = new Set(ev.risk_flags || []);
  if (RISKY.test(ev.statement + ' ' + text)) flags.add('weakens_check');
  if (['language', 'org', 'global'].includes(ev.scope?.level)) flags.add('global_scope');
  if (ev.untrusted) flags.add('untrusted_source');
  return {
    id, statement: ev.statement, kind, scope: ev.scope || { level: 'repo' }, status: 'captured',
    origin: { session_id: ev.session_id, task_id: ev.task_id, module: ev.module, author: ev.author, created_at: ev.ts },
    ...(ev.check ? { check: ev.check } : {}), ...(ev.sensor_link ? { sensor_link: ev.sensor_link } : {}),
    evidence: [], stats: { helpful_w: 0, harmful_w: 0, wilson_lb: 0, confirm_sessions: 0, applied_count: 0,
      trial: { treatment_n: 0, treatment_fired: 0, control_n: 0, control_fired: 0 } },
    decay: { half_life_days: ev.half_life_days || HALF_LIFE[kind] || 30, last_confirmed_at: null },
    temporal: { valid_from: ev.ts, invalid_at: null, recorded_at: ev.ts, expired_at: null },
    links: { depends_on: ev.depends_on || [], contradicts: [], supersedes: ev.supersedes || null, superseded_by: null },
    injection: { target: ev.target || 'guide', text },
    governance: { requires_human: flags.size > 0, risk_flags: [...flags], approved_by: null, approved_at: null },
  };
}

function computeStats(e, at) {
  // Independence: one vote per (session, outcome); keep the strongest source.
  const best = new Map();
  for (const ev of e.evidence) {
    const k = `${ev.task_id || ev.session_id}|${ev.outcome}`;
    if ((W[ev.source] ?? 0) > (W[best.get(k)?.source] ?? -1)) best.set(k, ev);
  }
  let h = 0, x = 0; const sessions = new Set();
  for (const ev of best.values()) {
    const w = (W[ev.source] ?? 0) * 0.5 ** (days(ev.at, at) / e.decay.half_life_days); // decay counts, not score
    if (ev.outcome === 'confirm' && w > 0) { h += w; sessions.add(ev.task_id || ev.session_id); }
    if (ev.outcome === 'refute') x += w;
  }
  const lastC = e.evidence.filter((v) => v.outcome === 'confirm' && W[v.source] > 0).map((v) => v.at).sort().pop();
  Object.assign(e.stats, { helpful_w: +h.toFixed(3), harmful_w: +x.toFixed(3),
    wilson_lb: +wilsonLB(h, h + x).toFixed(3), confirm_sessions: sessions.size });
  e.decay.last_confirmed_at = lastC || null;
}

function nextStatus(e, ctx) {
  const s = e.stats, gated = e.governance.requires_human && !e.governance.approved_by;
  const humans = e.evidence.filter((v) => v.source === 'human');
  const checks = e.evidence.filter((v) => v.source === 'truth_check').slice(-2);
  if (['refuted', 'superseded', 'contested'].includes(e.status)) return null; // only humans/new entries move these
  if (humans.at(-1)?.outcome === 'refute') return 'refuted';
  if (checks.length === 2 && checks.every((v) => v.outcome === 'refute')) return 'refuted';
  if (e.status !== 'trial' && s.harmful_w >= T.refuteHarm && s.harmful_w >= s.helpful_w) return 'refuted'; // trials end by A/B
  switch (e.status) {
    case 'captured':
      if ((e.origin.module === 'human' || e.governance.approved_by) && !gated) return 'active'; // taught/approved by a human
      return s.confirm_sessions >= T.candidateSessions && s.harmful_w === 0 ? 'candidate' : null;
    case 'candidate':
      // Enough evidence the claim/pitfall is real: LB >= 0.55, or a sensor-linked pitfall seen in >= 3 sessions.
      const real = s.wilson_lb >= T.trialLB || (e.sensor_link && s.confirm_sessions >= T.mineSessions);
      if (real && !gated && ctx.trials < T.maxTrials) { ctx.trials++; return 'trial'; }
      return null;
    case 'trial': {
      const t = s.trial; if (gated) return null;
      // No sensor to A/B against: an agent-written guide needs a human yes (LLM-written context files hurt; ETH 2026).
      if (!e.sensor_link) return s.wilson_lb >= T.activeLB && (e.origin.module !== 'factory' || e.governance.approved_by) ? 'active' : null;
      // Fixed-horizon A/B, decided once (no peeking): treatment = rule injected, control = not.
      if (t.treatment_n < T.trialMinPerArm || t.control_n < T.trialMinPerArm) return null;
      const drop = t.control_fired / t.control_n - t.treatment_fired / t.treatment_n;
      if (drop >= T.trialMinDrop) return 'active';
      e.trial_failed = true; return 'decayed';
    }
    case 'active': case 'enforced': {
      const anchor = e.decay.last_confirmed_at || e.governance.approved_at || e.origin.created_at;
      const stale = days(anchor, ctx.at) > 2 * e.decay.half_life_days;      // unconfirmed for 2 half-lives
      const n = s.helpful_w + s.harmful_w;
      const losing = n >= T.demoteMinN && s.wilson_lb < T.demoteLB;       // enough evidence, and it says "not useful"
      return losing || stale ? 'decayed' : null;
    }
    case 'decayed': // a rule that lost its A/B needs a human (teach/approve) to come back
      return !e.trial_failed && s.wilson_lb >= T.trialLB ? 'candidate' : null;
  }
  return null;
}

export function fold(at = new Date()) {
  const E = new Map();
  for (const ev of readJsonl(EVENTS)) {
    const e = E.get(ev.id);
    switch (ev.op) {
      case 'capture': { const id = ev.id; E.set(id, newEntry(ev, id));
        if (ev.supersedes && E.get(ev.supersedes)) Object.assign(E.get(ev.supersedes), { status: 'superseded' },
          { links: { ...E.get(ev.supersedes).links, superseded_by: id } }); break; }
      case 'evidence': if (e && ev.attested_by !== 'agent') e.evidence.push({ at: ev.ts, session_id: ev.session_id,
        task_id: ev.task_id, source: ev.source, outcome: ev.outcome, ref: ev.ref, attested_by: ev.attested_by }); break;
      case 'trial_obs': if (e && !(e._seen ??= new Set()).has(ev.session_id)) { e._seen.add(ev.session_id); // idempotent per session
        e.stats.trial[`${ev.arm}_n`]++; if (ev.fired) e.stats.trial[`${ev.arm}_fired`]++; } break;
      case 'injected': for (const id of ev.ids) if (E.get(id)) E.get(id).stats.applied_count++; break;
      case 'approve': if (e) { Object.assign(e.governance, { approved_by: ev.by, approved_at: ev.ts }); delete e.trial_failed; } break;
      case 'transition': if (e) { e.status = ev.to; if (ev.from === 'trial' && ev.to === 'decayed') e.trial_failed = true;
        if (ev.to === 'trial') e.stats.trial = { treatment_n: 0, treatment_fired: 0, control_n: 0, control_fired: 0 };
        if (['refuted', 'superseded'].includes(ev.to)) Object.assign(e.temporal, { invalid_at: ev.ts, expired_at: ev.ts });
        if (ev.contradicts) e.links.contradicts.push(ev.contradicts); } break;
    }
  }
  const ctx = { at, trials: [...E.values()].filter((e) => e.status === 'trial').length };
  fs.mkdirSync(ENTRIES, { recursive: true });
  for (const e of E.values()) {
    computeStats(e, at);
    const to = nextStatus(e, ctx);
    if (to) { append({ op: 'transition', id: e.id, from: e.status, to, by: 'fold' }); e.status = to;
      if (to === 'trial') e.stats.trial = { treatment_n: 0, treatment_fired: 0, control_n: 0, control_fired: 0 };
      if (to === 'refuted') Object.assign(e.temporal, { invalid_at: now(), expired_at: now() }); }
    const { trial_failed, _seen, ...out } = e;
    fs.writeFileSync(path.join(ENTRIES, `${e.id}.json`), JSON.stringify(out, null, 2) + '\n');
  }
  renderRules(E);
  return E;
}

function renderRules(E) {
  // Active, path-scoped guides become lazily loaded Claude Code rules (paths frontmatter).
  fs.mkdirSync(RULES, { recursive: true });
  for (const f of fs.readdirSync(RULES)) if (f.startsWith('A-')) fs.unlinkSync(path.join(RULES, f));
  for (const e of E.values()) {
    if (e.status !== 'active' || e.injection.target === 'sensor' || !e.scope.paths?.length) continue;
    const fm = `---\npaths:\n${e.scope.paths.map((p) => `  - "${p}"`).join('\n')}\n---\n`;
    fs.writeFileSync(path.join(RULES, `${e.id}.md`),
      `${fm}<!-- generated from .harness/ledger; do not edit. lb=${e.stats.wilson_lb} -->\n- ${e.injection.text} (${e.id})\n`);
  }
}

function inject(input) {
  // SessionStart: repo-wide active guides + this session's treatment-arm trials, ranked, budgeted.
  const sid = input.session_id || 'unknown';
  // Backstop: settle earlier sessions whose SessionEnd hook timed out or never ran.
  if (fs.existsSync(STATE)) for (const d of fs.readdirSync(STATE))
    if (d !== sid && !fs.existsSync(path.join(STATE, d, '.settled')) &&
        Date.now() - fs.statSync(path.join(STATE, d)).mtimeMs > 30 * 60e3) settle({ session_id: d }); // idle > 30 min
  const E = fold();
  const pick = [...E.values()].filter((e) => e.injection.target !== 'sensor' && (
    (e.status === 'active' && !e.scope.paths?.length) || (e.status === 'trial' && arm(sid, e.id) === 'treatment')))
    .sort((a, b) => b.stats.wilson_lb - a.stats.wilson_lb);
  const lines = []; let used = 0;
  for (const e of pick.slice(0, T.injectMax)) {
    const where = e.scope.paths?.length ? ` [when editing ${e.scope.paths.join(', ')}]` : '';
    const line = `- ${e.injection.text}${where} (${e.id})`;
    if (used + line.length > T.injectChars) break;
    lines.push(line); used += line.length;
  }
  if (lines.length) append({ op: 'injected', session_id: sid, ids: lines.map((l) => l.match(/\((A-[0-9a-f]+)\)$/)[1]) });
  const ctx = lines.length ? `Project lessons learned from earlier sessions (verified by tests/review):\n${lines.join('\n')}` : '';
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx } }));
}

function settle(input) {
  // SessionEnd: turn this session's sensor findings into evidence, trial observations and new candidates.
  const sid = input.session_id; const dir = path.join(STATE, sid);
  if (!sid || fs.existsSync(path.join(dir, '.settled'))) return;
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, '.settled'), now());
  const edits = [...new Set(readJsonl(path.join(dir, 'edits.jsonl')).map((r) => r.file))];
  const findings = readJsonl(path.join(dir, 'findings.jsonl'));
  if (!edits.length) return;
  let testsTouched = false;
  try { testsTouched = execFileSync('git', ['diff', '--name-only', '--diff-filter=MD', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').some((f) => /(\.test\.|\.spec\.|__tests__\/|(^|\/)tests?\/)/.test(f)); } catch {}
  const injected = new Set(readJsonl(EVENTS).filter((v) => v.op === 'injected' && v.session_id === sid).flatMap((v) => v.ids));
  const E = fold();
  for (const e of E.values()) {
    if (!e.sensor_link || !edits.some((f) => inScope(e, f))) continue;
    const hits = findings.filter((f) => f.sensor_id === e.sensor_link.sensor_id &&
      (!e.sensor_link.category || f.category === e.sensor_link.category) && inScope(e, f.file));
    const fired = hits.length > 0;
    const source = hits[0]?.kind === 'inferential' ? 'llm_judge' : 'static_analysis';
    if (e.status === 'trial') append({ op: 'trial_obs', id: e.id, session_id: sid, arm: arm(sid, e.id), fired });
    const exposed = ['active', 'enforced'].includes(e.status) || (e.status === 'trial' && injected.has(e.id));
    if (exposed) { // the rule was in context (or path-loaded) this session: did its sensor stay quiet?
      if (fired) append({ op: 'evidence', id: e.id, session_id: sid, source, outcome: 'refute', ref: hits[0].id, attested_by: 'harness' });
      else if (!testsTouched) append({ op: 'evidence', id: e.id, session_id: sid, source, outcome: 'confirm', ref: `session:${sid}`, attested_by: 'harness' });
    }
  }
  // Mining: the same (sensor, category) firing in >= N distinct sessions becomes a captured pitfall.
  const hist = path.join(DIR, 'findings.jsonl');
  // MVP mines only deterministic findings; clustering LLM review findings into rules is a v1 job (needs embeddings + a human).
  for (const f of findings.filter((x) => x.kind === 'computational')) fs.appendFileSync(hist, JSON.stringify({ ...f, session_id: sid }) + '\n');
  const groups = new Map();
  for (const f of readJsonl(hist)) { const k = `${f.sensor_id}|${f.category}`;
    if (!groups.has(k)) groups.set(k, { f, s: new Set() }); groups.get(k).s.add(f.session_id); }
  const known = new Set([...E.values()].filter((e) => e.sensor_link).map((e) => `${e.sensor_link.sensor_id}|${e.sensor_link.category}`));
  for (const [k, g] of groups) if (g.s.size >= T.mineSessions && !known.has(k)) {
    const dirGlob = path.dirname(g.f.file) + '/**';
    const id = capture({ session_id: sid, module: 'sensors', author: 'harness', kind: 'pitfall',
      statement: `Recurring ${g.f.sensor_id}/${g.f.category} findings under ${dirGlob}: ${g.f.message}`.slice(0, 400),
      text: (g.f.remediation || g.f.message).slice(0, 300), scope: { level: 'path', paths: [dirGlob] },
      sensor_link: { sensor_id: g.f.sensor_id, category: g.f.category }, target: 'guide' });
    // Mined from N sessions of harness-attested sensor output: that history is its first evidence.
    for (const s of g.s) append({ op: 'evidence', id, session_id: s, source: 'static_analysis', outcome: 'confirm',
      ref: `mined:${k}`, attested_by: 'harness' });
    known.add(k);
  }
  fold();
}

function verify() {
  // Run allow-listed truth checks (exit 0 = claim still holds on this branch).
  for (const e of fold().values()) {
    if (!e.check || !['captured', 'candidate', 'trial', 'active', 'enforced'].includes(e.status)) continue;
    const [cmd, ...args] = e.check.cmd;
    if (!CHECK_ALLOW.has(cmd)) continue;
    let ok = true;
    try { execFileSync(cmd, args, { cwd: ROOT, timeout: (e.check.timeout_s || 10) * 1000, stdio: 'ignore' }); } catch { ok = false; }
    append({ op: 'evidence', id: e.id, session_id: 'verify', task_id: `verify:${now().slice(0, 10)}`,
      source: 'truth_check', outcome: ok ? 'confirm' : 'refute', ref: e.check.cmd.join(' '), attested_by: 'harness' });
  }
  fold();
}

if (process.env.HARNESS_NESTED) process.exit(0); // the reviewer's headless session must not touch the ledger
const [cmd, ...rest] = process.argv.slice(2);
const json = () => { const s = stdin(); return s.trim() ? JSON.parse(s) : {}; };
// 'capture' is the agent's door (always module=factory); 'teach' is the human's door (guard denies it to the agent).
if (cmd === 'capture') console.log(capture({ session_id: 'unknown', author: process.env.HARNESS_MODEL || 'agent', ...json(), module: 'factory' }));
else if (cmd === 'teach') console.log(capture({ session_id: 'human', author: process.env.USER || 'human', ...json(), module: 'human' }));
else if (cmd === 'evidence') append({ op: 'evidence', attested_by: 'human', ...json() });
else if (cmd === 'approve') append({ op: 'approve', id: rest[0], by: rest[1] || process.env.USER });
else if (cmd === 'transition') append({ op: 'transition', id: rest[0], to: rest[1], by: process.env.USER, contradicts: rest[2] });
else if (cmd === 'fold') { const E = fold(); for (const e of E.values()) console.log(e.id, e.status, e.stats.wilson_lb, e.statement.slice(0, 60)); }
else if (cmd === 'inject') inject(json());
else if (cmd === 'settle') settle(json());
else if (cmd === 'verify') verify();
else if (cmd) { console.error('usage: ledger.mjs capture|teach|evidence|approve|transition|fold|inject|settle|verify'); process.exit(1); }
```

**`.harness/bin/sense.mjs`** holds the computational sensors and the Stop gate:

```js
#!/usr/bin/env node
// Sensors (computational). PostToolUse: fast per-file checks, advisory feedback.
// Stop: whole-change checks, blocking back-pressure with a retry cap. Success is silent.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

if (process.env.HARNESS_NESTED) process.exit(0); // don't sense inside the reviewer's own headless session
const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, '.harness/sensors.json'), 'utf8'));
const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
const sid = input.session_id || 'unknown';
const dir = path.join(ROOT, '.harness/state', sid);
fs.mkdirSync(dir, { recursive: true });
const log = (f, o) => fs.appendFileSync(path.join(dir, f), JSON.stringify(o) + '\n');
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const rel = (f) => path.relative(ROOT, path.resolve(ROOT, f));
const globRe = (g) => new RegExp('^' + g.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\{([^}]+)\}/g, (_, a) => `(${a.split(',').join('|')})`)
  .replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$');

const PARSERS = {
  // eslint --format json  /  biome lint --reporter=json can get its own parser the same way
  'eslint-json': (out) => JSON.parse(out || '[]').flatMap((r) => r.messages.map((m) => ({
    file: rel(r.filePath), line: m.line, category: m.ruleId || 'parse', severity: m.severity === 2 ? 'error' : 'warning', message: m.message }))),
  tsc: (out) => [...out.matchAll(/^(.+?)\((\d+),\d+\): error (TS\d+): (.+)$/gm)].map((m) => ({
    file: rel(m[1]), line: +m[2], category: m[3], severity: 'error', message: m[4] })),
  exitcode: (out, code) => code === 0 ? [] : [{ file: '', line: 0, category: 'failed', severity: 'error',
    message: out.trim().split('\n').slice(-15).join('\n') }],
};

const exec = (cmd, args, timeoutS) => new Promise((resolve) => { // async so sensors run in parallel
  const p = spawn(cmd, args, { cwd: ROOT, timeout: timeoutS * 1000 }); let stdout = '', stderr = '';
  p.stdout.on('data', (d) => (stdout += d)); p.stderr.on('data', (d) => (stderr += d));
  p.on('close', (status) => resolve({ status, stdout, stderr })); p.on('error', () => resolve({ status: 127, stdout, stderr }));
});

async function run(sensor, files) {
  const args = sensor.cmd.flatMap((a) => a === '{files}' ? files : [a.replace('{file}', files[0] || '')]);
  const t0 = Date.now();
  const r = await exec(args[0], args.slice(1), sensor.timeout_s || 30);
  const out = (r.stdout || '') + (sensor.parser === 'eslint-json' ? '' : r.stderr || '');
  let findings = [];
  try { findings = PARSERS[sensor.parser](out, r.status); } catch { findings = PARSERS.exitcode(out, r.status ?? 1); }
  findings = findings.map((f, i) => ({ id: `${sid}:${sensor.id}:${Date.now()}:${i}`, sensor_id: sensor.id, kind: 'computational',
    confidence: 1, remediation: sensor.remediation?.[f.category], ...f }));
  log('sensor_runs.jsonl', { sensor_id: sensor.id, ms: Date.now() - t0, n: findings.length, exit: r.status });
  return findings;
}

const render = (fs_) => fs_.slice(0, 8).map((f) =>
  `${f.file ? `${f.file}:${f.line} ` : ''}[${f.sensor_id}/${f.category}] ${f.message}${f.remediation ? `\n  fix: ${f.remediation}` : ''}`).join('\n')
  + (fs_.length > 8 ? `\n...and ${fs_.length - 8} more (full list: .harness/state/${sid}/findings.jsonl)` : '');

const mode = process.argv[2];
if (mode === 'edit') {
  const file = input.tool_input?.file_path;
  if (!file) process.exit(0);
  const f = rel(file);
  log('edits.jsonl', { file: f, at: new Date().toISOString() });
  const sensors = CFG.sensors.filter((s) => s.on === 'edit' && globRe(s.glob || '**').test(f));
  const findings = (await Promise.all(sensors.map((s) => run(s, [f])))).flat();
  findings.forEach((x) => log('findings.jsonl', x));
  const errors = findings.filter((x) => x.severity === 'error');
  if (!errors.length) process.exit(0); // success is silent
  // PostToolUse cannot undo the edit; decision:block feeds the reason back to Claude immediately.
  process.stdout.write(JSON.stringify({ decision: 'block', reason: `Sensor findings in ${f}:\n${render(errors)}` }));
} else if (mode === 'stop') {
  if (input.stop_hook_active && fs.existsSync(path.join(dir, 'escalated'))) process.exit(0);
  const edits = [...new Set(readJsonl(path.join(dir, 'edits.jsonl')).map((e) => e.file))].filter((f) => fs.existsSync(path.join(ROOT, f)));
  if (!edits.length) process.exit(0);
  const findings = (await Promise.all(CFG.sensors.filter((s) => s.on === 'stop').map((s) => run(s, edits)))).flat();
  findings.forEach((x) => log('findings.jsonl', x));
  // Only block on what this session touched (or whole-run failures); pre-existing errors elsewhere stay advisory.
  const blocking = findings.filter((x) => x.severity === 'error' && (!x.file || edits.includes(x.file)));
  if (!blocking.length) { // cheap checks green -> only now pay for the LLM reviewer (early-exit ordering)
    fs.rmSync(path.join(dir, 'stop_blocks'), { force: true });
    if (!CFG.review) process.exit(0);
    const r = spawnSync('node', [path.join(ROOT, '.harness/bin/review.mjs')], { input: JSON.stringify(input), stdio: ['pipe', 'inherit', 'inherit'] });
    process.exit(r.status ?? 0);
  }
  const nPath = path.join(dir, 'stop_blocks');
  const n = (fs.existsSync(nPath) ? +fs.readFileSync(nPath, 'utf8') : 0) + 1;
  fs.writeFileSync(nPath, String(n));
  if (n > (CFG.max_stop_blocks || 3)) { // escalate to the human instead of looping forever
    fs.writeFileSync(path.join(dir, 'escalated'), '1');
    process.stdout.write(JSON.stringify({ systemMessage: `Harness: ${blocking.length} check failures remain after ${n - 1} retries. Needs a human look.` }));
    process.exit(0);
  }
  process.stderr.write(`Checks failed (attempt ${n}/${CFG.max_stop_blocks || 3}). Fix these before finishing, or explain why they are wrong:\n${render(blocking)}\n`);
  process.exit(2); // Stop + exit 2 = Claude keeps working
}
```

**`.harness/bin/review.mjs`** is the inferential sensor:

```js
#!/usr/bin/env node
// Inferential sensor: CodeRabbit-style review of the session diff.
// Generate (LLM, read-only) -> ground (deterministic) -> filter (thresholds, learnings) -> gate (policy).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

if (process.env.HARNESS_NESTED) process.exit(0);
const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, '.harness/sensors.json'), 'utf8')).review || {};
const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
const sid = input.session_id || 'unknown';
const dir = path.join(ROOT, '.harness/state', sid);
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const globRe = (g) => new RegExp('^' + g.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\{([^}]+)\}/g, (_, a) => `(${a.split(',').join('|')})`)
  .replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$');

// 1. Called by sense.mjs only after computational checks pass. Skip if nothing changed since last review.
const edits = [...new Set(readJsonl(path.join(dir, 'edits.jsonl')).map((e) => e.file))];
if (!edits.length) process.exit(0);
const diff = execFileSync('git', ['diff', 'HEAD', '--unified=3', '--', ...edits], { cwd: ROOT, encoding: 'utf8' });
if (!diff.trim()) process.exit(0);
const hash = crypto.createHash('sha1').update(diff).digest('hex');
const seenPath = path.join(dir, 'review_seen');
if (fs.existsSync(seenPath) && fs.readFileSync(seenPath, 'utf8') === hash) process.exit(0); // incremental: same diff, no re-review
fs.writeFileSync(seenPath, hash);

// 2. Context: path instructions + active sensor-side learnings that match changed files.
const pathInstr = (CFG.path_instructions || []).filter((p) => edits.some((f) => globRe(p.path).test(f)))
  .map((p) => `- ${p.path}: ${p.instructions}`);
const learnings = fs.existsSync(path.join(ROOT, '.harness/ledger/entries')) ? fs.readdirSync(path.join(ROOT, '.harness/ledger/entries'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, '.harness/ledger/entries', f), 'utf8')))
  .filter((e) => ['active', 'enforced'].includes(e.status) && e.injection.target !== 'guide' &&
    (!e.scope.paths?.length || edits.some((f) => e.scope.paths.some((g) => globRe(g).test(f)))))
  .map((e) => `- ${e.injection.text} (${e.id})`) : [];

const SCHEMA = { type: 'object', required: ['summary', 'findings'], properties: {
  summary: { type: 'string' },
  findings: { type: 'array', items: { type: 'object', required: ['file', 'line', 'category', 'severity', 'confidence', 'message', 'evidence'],
    properties: { file: { type: 'string' }, line: { type: 'integer' }, category: { enum: ['correctness', 'security', 'data_loss', 'performance', 'maintainability', 'style'] },
      severity: { enum: ['critical', 'major', 'minor', 'nit'] }, confidence: { type: 'number' }, message: { type: 'string' },
      evidence: { type: 'string', description: 'Exact code text copied from the file that shows the problem.' } } } } } };

const prompt = `You are a code reviewer. Review ONLY this diff. Report real defects you can point to; silence is fine.
For each finding give file, line, a verbatim code snippet as evidence, and confidence 0-1. Below 0.7, do not report.
Do not report formatting or lint-style issues; linters already ran.
${pathInstr.length ? `Path instructions:\n${pathInstr.join('\n')}` : ''}
${learnings.length ? `Team learnings (follow these; they override your defaults):\n${learnings.join('\n')}` : ''}
<diff>\n${diff.slice(0, CFG.max_diff_chars || 60000)}\n</diff>`;

const bin = process.env.HARNESS_CLAUDE_BIN || 'claude';
const r = spawnSync(bin, ['-p', '--model', CFG.model || 'sonnet', '--output-format', 'json', '--no-session-persistence',
  '--allowedTools', 'Read,Grep,Glob', '--permission-mode', 'dontAsk', '--json-schema', JSON.stringify(SCHEMA), prompt],
  { cwd: ROOT, encoding: 'utf8', timeout: (CFG.timeout_s || 240) * 1000, env: { ...process.env, HARNESS_NESTED: '1' } });
let out;
try { const j = JSON.parse(r.stdout); out = j.structured_output ?? JSON.parse(j.result); } catch { process.exit(0); } // fail open: advisory sensor

// 3. Ground: the cited file must be in the change, and the evidence text must exist near the cited line.
const grounded = (f) => {
  if (!edits.includes(f.file) || !fs.existsSync(path.join(ROOT, f.file))) return false;
  const lines = fs.readFileSync(path.join(ROOT, f.file), 'utf8').split('\n');
  const win = lines.slice(Math.max(0, f.line - 4), f.line + 3).join('\n');
  return f.evidence.trim().length > 0 && win.replace(/\s+/g, ' ').includes(f.evidence.trim().replace(/\s+/g, ' ').slice(0, 80));
};
const minConf = CFG.min_confidence || { security: 0.6, data_loss: 0.6, correctness: 0.75, performance: 0.8, maintainability: 0.85, style: 1.01 };
const all = (out.findings || []).map((f, i) => ({ id: `${sid}:review:${Date.now()}:${i}`, sensor_id: 'review', kind: 'inferential', ...f,
  grounded: grounded(f) }));
const kept = all.filter((f) => f.grounded && f.confidence >= (minConf[f.category] ?? 0.8));
fs.mkdirSync(dir, { recursive: true });
for (const f of all) fs.appendFileSync(path.join(dir, 'findings.jsonl'), JSON.stringify({ ...f, dropped: !kept.includes(f) }) + '\n');

// 4. Gate: block once for grounded critical/major in high-blast-radius categories; everything else is advisory.
const block = kept.filter((f) => ['critical', 'major'].includes(f.severity) && ['security', 'data_loss', 'correctness'].includes(f.category));
const fmt = (fs_) => fs_.slice(0, 6).map((f) => `${f.file}:${f.line} [${f.severity}/${f.category}, conf ${f.confidence}] ${f.message}`).join('\n');
const blockedPath = path.join(dir, 'review_blocked');
if (block.length && !fs.existsSync(blockedPath)) {
  fs.writeFileSync(blockedPath, '1');
  process.stderr.write(`Review (${CFG.model || 'sonnet'}) found issues. Fix them, or reply with why each is wrong:\n${fmt(block)}\n`);
  process.exit(2);
}
if (kept.length) process.stdout.write(JSON.stringify({ systemMessage: `Review: ${out.summary}\n${fmt(kept)}` }));
```

**`.harness/bin/guard.mjs`** is the PreToolUse anti-gaming guard:

```js
#!/usr/bin/env node
// PreToolUse guard: the agent may not edit its own evaluators, tests it is graded by, or the ledger.
// This is the DGM / ImpossibleBench lesson: anything the agent can edit, it can game.
import fs from 'node:fs';

const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
const t = input.tool_name, ti = input.tool_input || {};
const PROTECTED = [/(^|\/)\.harness\//, /(^|\/)\.claude\/(settings[^/]*\.json|rules\/learned\/)/,
  /(\.test\.|\.spec\.)[jt]sx?$/, /(^|\/)__tests__\//, /(^|\/)vitest\.config|jest\.config/];
const deny = (why) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse',
    permissionDecision: 'deny', permissionDecisionReason: why } }));
  process.exit(0);
};
// New test files are fine; changing existing ones is not (ImpossibleBench: read-only tests stop test-editing hacks).
const allowTests = process.env.HARNESS_ALLOW_TEST_EDITS === '1'; // human opt-in for test-refactoring tasks

if (['Write', 'Edit', 'MultiEdit'].includes(t)) {
  const f = ti.file_path || '';
  const isTest = /(\.test\.|\.spec\.|__tests__)/.test(f);
  if (PROTECTED.some((re) => re.test(f)) && !(isTest && (allowTests || !fs.existsSync(f))))
    deny(`${f} is protected (evaluator, test, or ledger file). If the spec and tests conflict, stop and say so: ` +
         `run \`node .harness/bin/ledger.mjs capture\` with the conflicting assumption instead of editing the check.`);
}
if (t === 'Bash') {
  const c = ti.command || '';
  if (/ledger\.mjs\s+(teach|evidence|approve|transition)/.test(c)) deny('Only humans and the harness can teach, approve or score ledger entries.');
  if (/(>|\b(tee|rm|mv|cp|truncate)\b|sed\s+-i)[^|;&]*\.harness\//.test(c)) deny('The .harness/ directory is read-only for the agent.');
  if (/--no-verify|git\s+push\s+.*--force/.test(c)) deny('Skipping hooks or force-pushing is not allowed.');
}
process.exit(0);
```

**Guides and Factory configuration.** These are `CLAUDE.md`, the two subagents and the skill. Per-agent models are set in frontmatter, and the `model` field accepts `haiku`, `sonnet`, `opus` or a full ID ([sub-agents docs](https://code.claude.com/docs/en/sub-agents)):

```markdown
<!-- CLAUDE.md -->
# Project
Next.js 15 + TypeScript app. Package manager: pnpm.

## Commands
- `pnpm test -- --run <files>`: run related tests (Vitest)
- `pnpm typecheck`: tsc --noEmit

## How this harness works
- Lessons learned in earlier sessions arrive as a system reminder at start, and as
  rules in .claude/rules/learned/ when you touch matching files. They are evidence-backed;
  follow them unless the code clearly contradicts them, and if it does, say so.
- Checks run after every edit and before you finish. Fix what they report.
- When you rely on something you have not verified, use the record-assumption skill.
- Tests, check configs, and .harness/ are read-only. If a test looks wrong, stop and explain.
```

```markdown
<!-- .claude/agents/planner.md -->
---
name: planner
description: Use before any change touching 3+ files or an unfamiliar area. Reads the code and returns a short plan with explicit assumptions. Read-only.
tools: Read, Grep, Glob
model: opus
effort: high
---
Produce a plan of at most 12 steps for the task you are given.
End with a section "Assumptions" listing each thing you believe but have not verified
(one line each, phrased so a test or grep could prove it wrong).
Do not edit files. Return under 1,500 tokens.
```

```markdown
<!-- .claude/agents/scout.md -->
---
name: scout
description: Fast codebase lookup. Use to find files, call sites, configs, or test locations before editing.
tools: Read, Grep, Glob
model: haiku
---
Answer the lookup question with file:line pointers only. No advice. Under 400 tokens.
```

````markdown
<!-- .claude/skills/record-assumption/SKILL.md -->
---
name: record-assumption
description: Record an assumption you are relying on but have not verified (API shape, config, convention, tool behavior), or a conflict between the spec and the tests. Use whenever you guess instead of checking.
---
Pipe one JSON object to `node .harness/bin/ledger.mjs capture`:

```json
{"session_id":"<from context if known>","statement":"<one falsifiable sentence>",
 "kind":"assumption|convention|pitfall|tool_fact",
 "scope":{"level":"path","paths":["src/api/**"]},
 "check":{"cmd":["grep","-q","zod","src/api/users.ts"]},
 "text":"<the one-line instruction a future session should read>"}
```

Rules: one claim per entry. Prefer the narrowest scope. Add `check` only if a
grep/rg/test/jq command can prove it. You cannot confirm your own entries;
the harness scores them from tests, linters and review.
If the spec and the tests disagree, record that and stop; do not edit the tests.
````

```gitattributes
# .gitattributes
.harness/ledger/events.jsonl   merge=union
.harness/ledger/findings.jsonl merge=union
```

```gitignore
# .gitignore
.harness/state/
.harness/ledger/entries/
```

**Daily use.** Work normally in Claude Code. Teach a lesson yourself with `echo '{"statement":"...","scope":{"level":"path","paths":["src/api/**"]},"text":"..."}' | node .harness/bin/ledger.mjs teach`. Approve a flagged entry with `node .harness/bin/ledger.mjs approve A-xxxxxxxx yourname`. Inspect the ledger with `node .harness/bin/ledger.mjs fold`. Add `node .harness/bin/ledger.mjs verify` to a nightly CI job. Commit ledger changes in their own commits (`ledger: ...`) so `git revert` stays surgical.

**Why each MVP choice beats the alternative (Inferred):**

| Choice | Alternative | Why this wins |
|---|---|---|
| Event log + fold | Mutable JSON or a DB | Auditable, mergeable, revertible; no lost updates; replayable |
| Wilson LB gates | Raw success ratio or LLM confidence | Small samples cannot fluke their way up; numbers are math, not opinion |
| A/B vs sensor | Before/after comparison | Codebase and model drift confound before/after ([SRE](https://sre.google/workbook/canarying-releases/)) |
| Path-scoped generated rules | Appending to CLAUDE.md | Loaded only when relevant; CLAUDE.md stays human-written and short |
| Deterministic grounding | LLM judge of the LLM reviewer | Free, instant and immune to correlated bias; catches fabricated quotes |
| Hook-based guard | "Don't edit tests" in CLAUDE.md | Instructions are requests; hooks are enforcement ([docs](https://code.claude.com/docs/en/best-practices)) |
| Review only after green | Review every turn | Saves the slowest, most expensive step on code that fails trivially |

### v1: close the human-feedback loop and measure (weeks 2–6)

v1 adds the CodeRabbit "learnings through chat" and Greptile suppression ideas, plus real measurement:

1. **PR integration.** Run the same sensors in CI (`ci_test` evidence, weight 0.8), and post the review summary and inline comments to the PR. Or call `coderabbit --agent` as an additional sensor and parse its NDJSON into `Finding`s.
2. **"Addressed" metric.** At merge, re-run the reviewer on the final commit and count a finding addressed if no semantically similar finding reappears (Uber method). Log per-category address rates.
3. **Feedback suppression.** Embed rejected and unaddressed review findings per repo. Block new findings similar to 3 or more rejected ones, except in security, data-loss and correctness (Greptile).
4. **Chat-taught learnings.** A `/learn` slash command or PR-comment trigger that calls `ledger.mjs teach` with `target: sensor`.
5. **Contradiction check at capture.** Retrieve the top-10 similar entries (Mem0-style) and have Haiku classify each pair. Conflicts go to `contested`.
6. **Attribution telemetry.** Use the `InstructionsLoaded` hook (`load_reason: path_glob_match`) to record which learned rules actually loaded.
7. **Sensor ordering by yield.** Use `sensor_runs.jsonl` to rank sensors by catches per second, and move slow, low-yield sensors to CI.
8. **Package as a plugin.** `.claude-plugin/plugin.json`, `hooks/hooks.json`, `skills/`, `agents/`, `bin/`. A plugin's root CLAUDE.md "isn't loaded as context", so ship instructions as skills. Keep the ledger in the repo, not in `${CLAUDE_PLUGIN_DATA}`, so it stays reviewable ([plugins reference](https://code.claude.com/docs/en/plugins-reference)).

### v2: compounding across repos and self-tuning (month 2+)

v2 adds learning across repositories and lets the harness tune itself:

1. **Scope widening.** An entry confirmed in 3 or more repos becomes a `language` or `org` candidate, behind a human gate.
2. **Pareto rule variants.** Keep competing phrasings of a rule that each win on different task types, instead of one "best" (GEPA).
3. **Judge calibration.** Human-audit 5–10% of LLM-judge evidence, and fit per-judge false-positive and false-negative weights. Use a cross-family panel for high-stakes categories.
4. **Learned router.** Log task features × model tier × outcome and cost, then train a RouteLLM-style classifier with escalation on sensor failure.
5. **Scored harness changes.** Following Kief Morris's agentic flywheel, an offline job proposes harness edits (new lint rule, new path instruction, guide deletion) with a risk/cost/benefit score. Low-risk ones auto-apply above a threshold, and the rest queue for you ([martinfowler.com](https://www.martinfowler.com/articles/exploring-gen-ai/humans-and-agents.html)).
6. **Held-out tests.** A hidden test set the agent never sees, giving the strongest evidence source (weight 1.0).

## 9. Open questions you need to decide

1. **North-star metric.** What does "the harness got better" mean for you? The options are the sensor firing rate per session (what the MVP uses), PR address rate, merge-without-rework rate, or wall-clock time to green. Copilot used merge rate. Bugbot and Uber use addressed or resolved rate.
2. **Volume versus rigor.** At 20 sessions per arm, about 20% of useless rules pass a trial, and later decay catches them. With hundreds of sessions a month, raise the bar to 30–40 per arm. With few sessions, rely more on human approval.
3. **Human-gate bandwidth.** How many approvals a week will you actually do? If few, keep risk flags strict and accept slower learning. CodeRabbit's `approval_delay` auto-approval is the opposite trade.
4. **Should the LLM reviewer ever block?** The MVP blocks once for grounded critical or major findings. Claude Code Review never blocks, while CodeRabbit pre-merge checks can.
5. **Test-edit policy.** The MVP allows new test files and denies edits to existing ones unless `HARNESS_ALLOW_TEST_EDITS=1`. Is that right for test-refactoring tasks?
6. **Where the ledger lives.** One per repo (the MVP) or a central org ledger. A central one is needed for cross-repo scope, but loses per-repo git review.
7. **Cost ceiling per session.** Opus planner + Sonnet coder + Sonnet reviewer on every Stop is expensive. Decide when the reviewer runs: every Stop, only at "done", or only in CI.
8. **Portability.** Do you also emit AGENTS.md (read by Codex, Cursor, Copilot and others, [agents.md](https://agents.md/)) for non-Claude agents, or stay Claude-specific?
9. **Thresholds are unvalidated.** Every number in section 4 is a reasoned default. Plan a review after about 100 sessions to re-tune half-lives and the 15-point A/B bar from your own data.
10. **Transcript privacy.** Settle reads only findings and edits, not transcripts. If you later mine transcripts (`transcript_path`) for assumptions, decide what may be stored in git.

## 10. Sources

Harness engineering and architecture:
- [Böckeler: Harness engineering for coding agent users (Apr 2026)](https://martinfowler.com/articles/harness-engineering.html)
- [Böckeler: Harness engineering memo (Feb 2026)](https://www.martinfowler.com/articles/exploring-gen-ai/harness-engineering-memo.html)
- [Böckeler: Maintainability sensors (May 2026)](https://martinfowler.com/articles/sensors-for-coding-agents.html)
- [Böckeler: Context engineering for coding agents (Feb 2026)](https://www.martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html)
- [Morris: Humans and agents (Mar 2026)](https://www.martinfowler.com/articles/exploring-gen-ai/humans-and-agents.html)
- [OpenAI: Harness engineering (Feb 2026)](https://openai.com/index/harness-engineering/)
- [Anthropic: Building effective agents (Dec 2024)](https://www.anthropic.com/engineering/building-effective-agents)
- [Anthropic: Multi-agent research system (Jun 2025)](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Anthropic: Effective context engineering (Sep 2025)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic: Harnesses for long-running agents (Nov 2025)](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Claude Agent SDK post (Sep 2025)](https://claude.com/resources/articles/building-agents-with-the-claude-agent-sdk)
- [HumanLayer: Skill issue (Mar 2026)](https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents)
- [HumanLayer: Writing a good CLAUDE.md (Nov 2025)](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
- [12-Factor Agents](https://github.com/humanlayer/12-factor-agents)
- [Osmani: Agent harness engineering (Apr 2026)](https://addyosmani.com/blog/agent-harness-engineering/)
- [Wijesiriwardena: Manufacturing backpressure (Jun 2026)](https://dasith.me/2026/06/14/backpressure-in-coding-agent-harnesses/)
- [Moss: Don't waste your backpressure (Jan 2026)](https://banay.me/dont-waste-your-backpressure/)
- [LangChain: Anatomy of an agent harness (Mar 2026)](https://www.langchain.com/blog/the-anatomy-of-an-agent-harness)
- [OpenHands SDK (Nov 2025)](https://arxiv.org/html/2511.03690v1)
- [OpenHands platform [2024]](https://arxiv.org/html/2407.16741v3)
- [SWE-agent [2024]](https://arxiv.org/html/2405.15793v3)
- [mini-SWE-agent](https://github.com/SWE-agent/mini-swe-agent)
- [Aider architect/editor [2024]](https://aider.chat/2024/09/26/architect.html)

Self-improving agents and memory:
- [Reflexion [older, 2023]](https://arxiv.org/html/2303.11366)
- [Voyager [older, 2023]](https://arxiv.org/html/2305.16291)
- [ExpeL [older, 2023; rev. Dec 2024]](https://arxiv.org/html/2308.10144)
- [ACE (Oct 2025)](https://arxiv.org/html/2510.04618)
- [ACE repo](https://github.com/ace-agent/ace)
- [DGM (May 2025)](https://arxiv.org/html/2505.22954)
- [Sakana DGM](https://sakana.ai/dgm/)
- [SICA (Apr 2025)](https://arxiv.org/html/2504.15228)
- [GEPA (Jul 2025)](https://arxiv.org/html/2507.19457)
- [DSPy GEPA](https://dspy.ai/current/getting-started/gepa-optimization/)
- [DSPy MIPROv2](https://dspy.ai/current/api/optimizers/MIPROv2/)
- [Dynamic Cheatsheet (Apr 2025)](https://arxiv.org/html/2504.07952)
- [ReasoningBank (Sep 2025)](https://arxiv.org/html/2509.25140)
- [Mem0 (Apr 2025)](https://arxiv.org/html/2504.19413)
- [Zep/Graphiti (Jan 2025)](https://arxiv.org/html/2501.13956)
- [Agent KB (Jul 2025)](https://arxiv.org/abs/2507.06229v3)
- [Xiong et al.: memory management (2025)](https://arxiv.org/html/2505.16067v2)
- [Memory confabulation (2026)](https://arxiv.org/abs/2605.29463)
- [Chroma: Context rot (Jul 2025)](https://www.trychroma.com/research/context-rot)
- [IFScale (Jul 2025)](https://arxiv.org/abs/2507.11538)
- [ETH: Evaluating AGENTS.md (Feb 2026)](https://arxiv.org/html/2602.11988v1)
- [OpenHands condensation (Apr 2025)](https://openhands.dev/blog/openhands-context-condensensation-for-more-efficient-ai-agents)

Safe learning and statistics:
- [METR: reward hacking (Jun 2025)](https://metr.org/blog/2025-06-05-recent-reward-hacking)
- [ImpossibleBench (Oct 2025)](https://arxiv.org/pdf/2510.20270v1)
- [EvilGenie (Nov 2025)](https://arxiv.org/abs/2511.21654)
- [Baker et al.: CoT monitoring (Mar 2025)](https://arxiv.org/html/2503.11926v1)
- [Anthropic: emergent misalignment (Nov 2025)](https://arxiv.org/html/2511.18397v1)
- [MINJA (Mar 2025)](https://arxiv.org/abs/2503.03704)
- [CALM (Oct 2024)](https://arxiv.org/html/2410.02736v1)
- [PoLL (Apr 2024)](https://arxiv.org/abs/2404.18796)
- [Dependence-aware judge aggregation (2026)](https://www.alphaxiv.org/abs/2601.22336.md)
- [LLM reviewers overcorrect (2026)](https://arxiv.org/abs/2603.00539)
- [Google SRE Workbook: canarying](https://sre.google/workbook/canarying-releases/)
- [Evan Miller: Wilson bound [older, 2009]](https://www.evanmiller.org/how-not-to-sort-by-average-rating.html)
- [Evan Miller: A/B peeking [older, 2010]](https://www.evanmiller.org/how-not-to-run-an-ab-test.html)
- [Nygard ADRs [older, 2011]](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)

Code review systems:
- [CodeRabbit on Google Cloud (Apr 2025)](https://cloud.google.com/blog/products/ai-machine-learning/how-coderabbit-built-its-ai-code-review-agent-with-google-cloud-run)
- [CodeRabbit: context engineering (Jul 2025)](https://www.coderabbit.ai/blog/context-engineering-ai-code-reviews)
- [CodeRabbit: pipeline vs agentic (May 2025)](https://coderabbit.ai/blog/pipeline-ai-vs-agentic-ai-for-code-reviews-let-the-model-reason-within-reason)
- [CodeRabbit architecture](https://docs.coderabbit.ai/overview/architecture)
- [CodeRabbit config reference](https://docs.coderabbit.ai/reference/configuration)
- [CodeRabbit learnings](https://docs.coderabbit.ai/guides/learnings)
- [CodeRabbit code guidelines](https://docs.coderabbit.ai/knowledge-base/code-guidelines)
- [CodeRabbit pre-merge checks](https://docs.coderabbit.ai/pr-reviews/pre-merge-checks.md)
- [CodeRabbit walkthroughs](https://docs.coderabbit.ai/pr-reviews/walkthroughs.md)
- [CodeRabbit commands](https://docs.coderabbit.ai/guides/commands)
- [CodeRabbit tools](https://docs.coderabbit.ai/tools/index.md)
- [CodeRabbit + Claude Code](https://docs.coderabbit.ai/cli/claude-code-integration)
- [Perrone: How CodeRabbit works (3P, Jun 2026)](https://theaiengineer.substack.com/p/how-coderabbit-actually-works)
- [Lychee audit (2025)](https://lycheeorg.dev/2025-09-13-code-rabbit/)
- [Greptile: make LLMs shut up (Dec 2024)](https://www.greptile.com/blog/make-llms-shut-up)
- [Greptile v3](https://greptile.com/blog/greptile-v3-agentic-code-review)
- [Greptile memory docs](https://www.greptile.com/docs/how-greptile-works/memory-and-learning)
- [Greptile benchmark](https://www.greptile.com/benchmarks)
- [Greptile on Martian](https://www.greptile.com/content-library/greptile-martian-code-review-benchmark)
- [Qodo on Martian](https://www.qodo.ai/blog/qodo-ranked-1-ai-code-review-tool-in-martians-code-review-benchmark)
- [Cursor: Building Bugbot (Jan 2026)](https://cursor.com/blog/building-bugbot)
- [Cursor: Bugbot learned rules (Apr 2026)](https://cursor.com/blog/bugbot-learning)
- [Cursor changelog 04-08-26](https://cursor.com/changelog/04-08-26)
- [Uber uReview (Aug 2025)](https://www.uber.com/ug/en/blog/ureview)
- [cubic (Jun 2025)](https://cubic.dev/blog/learnings-from-building-ai-agents)
- [Qodo auto best practices](https://docs.qodo.ai/qodo-documentation/qodo-merge/pr-agent/core-abilities/auto_best_practices)
- [PR-Agent self-reflection](https://raw.githubusercontent.com/qodo-ai/pr-agent/main/docs/docs/core-abilities/self_reflection.md)
- [GitHub: 60M Copilot reviews (Mar 2026)](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)
- [GitHub Copilot code review docs](https://docs.github.com/en/copilot/concepts/agents/code-review)
- [Claude Code Review docs](https://code.claude.com/docs/en/code-review)
- [Claude Code Review launch](https://claude.com/blog/code-review)
- [Anthropic security-review prompts](https://raw.githubusercontent.com/anthropics/claude-code-security-review/main/claudecode/prompts.py)
- [Anthropic security-review filter](https://raw.githubusercontent.com/anthropics/claude-code-security-review/main/claudecode/findings_filter.py)
- [Semgrep Assistant (Jan 2025)](https://semgrep.dev/blog/2025/building-an-appsec-ai-that-security-researchers-agree-with-96-of-the-time/)
- [Sifting the Noise (2026)](https://www.alphaxiv.org/abs/2601.22952.md)
- [Cihan et al.: AI review in practice (ICSE-SEIP 2025)](https://arxiv.org/abs/2412.18531v2)

Product memory and Claude Code reference:
- [Claude Code memory](https://code.claude.com/docs/en/memory)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code hooks guide](https://code.claude.com/docs/en/hooks-guide)
- [Claude Code skills](https://code.claude.com/docs/en/skills)
- [Claude Code sub-agents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code plugins reference](https://code.claude.com/docs/en/plugins-reference)
- [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- [Claude Code headless](https://code.claude.com/docs/en/headless)
- [Anthropic Agent Skills (Oct 2025)](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [GitHub Copilot Memory (Jan 2026)](https://github.blog/2026-01-09-building-an-agentic-memory-system-for-github-copilot)
- [Copilot Memory changelog (Mar 2026)](https://github.blog/changelog/2026-03-04-copilot-memory-now-on-by-default-for-pro-and-pro-users-in-public-preview/)
- [Cursor rules](https://cursor.com/docs/context/rules)
- [Cursor forum: memories in 2.1](https://forum.cursor.com/t/agents-have-lost-access-to-memory-capability/143310)
- [AGENTS.md](https://agents.md/)
- [Claude Code issue #34197](https://github.com/anthropics/claude-code/issues/34197)

Speed:
- [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [Manus context engineering (Jul 2025)](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- [Anthropic context management](https://claude.com/resources/articles/context-management)
- [TypeScript native port (Mar 2025)](https://devblogs.microsoft.com/typescript/typescript-native-port/)
- [Oxlint](https://oxc.rs/docs/guide/usage/linter)
- [Ruff](https://docs.astral.sh/ruff/)
- [Vitest CLI](https://vitest.dev/guide/cli)
- [Jest CLI](https://jestjs.io/docs/cli)
- [RouteLLM (Jul 2024)](https://lmsys.org/blog/2024-07-01-routellm/)
- [Claude Haiku 4.5 (Oct 2025)](https://www.anthropic.com/news/claude-haiku-4-5)