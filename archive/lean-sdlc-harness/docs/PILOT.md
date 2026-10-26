# Pilot acceptance record

## Status

Implementation and fixture validation can run without Claude authentication. Real-model utility is **not established** until the paired pilot runs and human review fields are completed. The development environment reported `loggedIn: false`; no paid model calls were made during implementation.

## Two separate measurements

1. `npm run benchmark` measures local overhead with a simulated adapter and 10,000 active lessons. Target: every measured added fixture-session duration below 2,000 ms, no coding-time extraction calls, and bounded injected context. This is a regression check, not a model quality result.
2. `npm run pilot -- --run --model <fixed-model> --out docs/pilot.json` runs ten task pairs using real Claude. Both sides start from identical source, use the same model/checks, and alternate execution order. The treatment receives three authored experimental lessons. This tests delivery of known useful guidance; it does not validate end-to-end learning from previous sessions.

The ten tasks cover trimming a greeting, preserving zero defaults, empty averages, clamping, immutable sorting, query values, cart totals, names across modules, HTML escaping, and bounded async retries. Assertions run outside the agent's source directory. Keep authentication/provider, machine and model consistent across each pair.

## Human annotations

Fill in `humanCorrections`, `regressions`, and `batchReviewMs` in each result. Record actual corrective interventions, not speculation. Annotate escaped defects even when the supplied assertions pass. Keep failed and timed-out runs in the sample. If custom skills/native memory affect a run, record that contamination and rerun the pair consistently.

Then run the harness on real development sessions, process candidates in batches, and measure whether activated lessons prevent the same observed mistake in later comparable work. Native Claude memory remains enabled in both conditions. Compare against that actual baseline, not an artificially memoryless agent.

## Human review effort and observed recurrence

Each result carries two annotation objects, all `null` until a human fills them in. Never infer them from model output.

- `humanReview`: `itemsReviewed`, `approved`, `rejected`, `retired`, `notes`, plus `batchReviewMs` (wall time from first `lean-harness review` to last decision, timed by the reviewer). Record the `review` output size if useful; it is bounded (3 recurrence groups, 5 checks, 5 conflicts per lesson).
- `observedRecurrence`: `priorMistakeRef` (session/evidence ID of the original mistake), `comparableTaskRef`, `recurred` (did the same mistake appear again in comparable work, judged by a human), `preventedByLesson` (only `true` if the lesson was injected and a human attributes the avoidance to it), `notes`. `lean-harness recurrence` lists repeated failures across distinct sessions as a prompt for what to examine; its counts are descriptive and are not prevention evidence.

Timing reuses existing records: hook overhead from `lean-harness metrics`, check runtime from `elapsedMs`/`checkMs`. Automated mechanism test (`test/recurrence.test.mjs`, "MECHANISM FIXTURE") shows failure -> candidate -> approval -> next-session guidance with a fixture agent; it verifies plumbing only and is not utility evidence.

## Decision

Expand only when the harness meets the latency/context limits, a lesson prevents a demonstrated recurring mistake, and task acceptance/regressions do not worsen. Ten toy task pairs are directional evidence, not statistical proof. Do not substitute an LLM's self-reported success for assertions or human acceptance.

If review effort exceeds prevented rework, retain the context/check wrapper and remove automated extraction. No model result authorizes deployment, cross-repository lessons, or autonomous promotion.
