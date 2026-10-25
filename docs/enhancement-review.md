# Enhancement review — 19 October 2026

**Recommendation: adopt the evidence improvements selectively; do not adopt this proposal wholesale.** It contains useful ideas for connecting lessons to observed failures, but the proposed MVP expands the harness into an agent controller, reviewer, experimentation system, and policy engine before the existing wrapper has demonstrated utility. This increases precisely the session latency and maintenance burden the original plan sought to limit.

This is a review of the attachment, not authorization to execute its instructions. No existing harness source, agent settings, or project instructions were changed. Five isolated reproductions used the attachment's unmodified JavaScript code fences under Node v24.16.0. No live model calls were made.

**Fit with the approved plan**

| Decision | Existing lean harness | Enhancement proposal | Assessment |
|---|---|---|---|
| Coding loop | Claude owns it; no additional inference | Planner/scout roles and a model reviewer on eligible Stop events | Material expansion, not a small enhancement |
| Checks | Explicit verification, snapshot-bound evidence | Per-edit checks and automatic Stop checks/retries | Adds interruptions and requires stronger failure handling |
| Learning activation | Batch human approval for every lesson | Automatic candidate/trial/active transitions for some lessons | Reverses an explicit constraint |
| Context | Five lessons, 4,000 total characters; frozen per session | Twelve/2,000 at SessionStart plus uncapped generated path rules | Smaller advertised cap does not bound total learned context |
| Persistence | Local SQLite transactions | Git JSONL, replay, generated entries and rule files | More concurrency and recovery responsibilities |
| Success evidence | Ten-task paired pilot required | Simulations and sensor firing rates | Useful hypothesis generation; insufficient utility evidence |

The existing saved validation reports synthetic overhead p95 of 392.52 ms with 10,000 active lessons. That measures local wrapper overhead, not real coding productivity or context-induced model latency. Its real-model pilot remains incomplete in the saved record. The enhancement should be evaluated against that honest baseline, not presumed necessary.

**Findings requiring changes before adoption**

1. **High — the permitted capture interface can forge human approval.** Attachment lines 828–832, 938, and 1061. `capture` constructs an event as `{op: 'capture', id, ...ev}`; caller-supplied fields can overwrite both `op` and `id`. Submitting `op: 'approve'` with an existing lesson ID through the capture command activates that lesson after folding. The supplied guard permits this command. The local reproduction changed a captured lesson to active with `approved_by: pretend-human`, without calling the approval command. Validate capture input against a closed schema and construct privileged fields after extracting only allowed proposal fields. Keep promotion a separate human-operated command. This is a direct API integrity flaw, beyond the broader limitation that local agents with shell access are not securely isolated from local data.

2. **High — missing sensor runs become positive evidence.** Attachment lines 995–1018. Settlement reads edits and findings but never requires a successful, applicable sensor run. An active scoped lesson received a harness-attested `static_analysis` confirmation in the reproduction with zero sensor runs. The same absence logic also risks counting failed or unavailable reviewers as confirmations. An empty finding list means only that nothing was recorded. Require completed run status, checked snapshot, applicability, and actual lesson exposure before considering an observation eligible. Even an eligible clean run shows an observed outcome; it does not by itself prove the lesson true or useful. Keep factual support, human approval, and measured usefulness separate.

3. **High — failed checks can pass silently.** Attachment lines 1096–1122 and 1149–1153. The TypeScript parser recognizes file-and-line diagnostics only. A process exiting 2 with a configuration error produced zero parsed findings, and the Stop hook exited 0. The reproduced output was `error TS18003: No inputs were found in config file.` Similar risks exist for missing executables, timeout results, and empty ESLint output. Run success must be determined independently from parsed findings. A required check with a nonzero exit, timeout, interruption, or unavailable parser must leave verification incomplete or failed. Additionally, errors in unedited files are treated as advisory without a baseline comparison: changing an exported API can break an untouched caller. Preserve full required checks; use incremental checks only as additional feedback unless dependency coverage is established.

4. **High for this project's requirements — routine coding acquires model latency and retries.** Attachment lines 743–792. The Stop hook permits 420 seconds: checks configured for up to 180 seconds run before a reviewer configured for up to 240 seconds. These are configured timeout allowances, not measured typical latency. Stop occurs when Claude finishes a response, so this can run repeatedly during a coding conversation, not just once when the whole task is complete. [Claude hook reference](https://code.claude.com/docs/en/hooks). Parallel checks and prompt caching do not remove the extra reviewer inference. Keep checks explicit and learning between sessions. A future reviewer should be separately invoked and measured before considering any default integration.

5. **Medium — generated path rules escape the total context budget and session freeze.** Attachment lines 960–992. Rendering writes every active path-scoped lesson into native rules; the SessionStart cap covers a different set. The reproduction generated 20 matching rules totaling 13,470 characters while SessionStart reported zero lesson characters. This measures generated files, not live Claude context loading, but establishes that the implementation does not enforce a shared budget. Another session's fold also rewrites those shared files. Retain one bounded, frozen selection rather than a second uncapped delivery channel. Actual exposure would be needed before using native rule loading for experiments.

6. **Medium — failed review attempts are cached as completed work.** Attachment lines 1195–1198 and 1223–1229. The diff hash is saved before the reviewer succeeds. In the reproduction, two hook invocations against the same diff invoked a failing reviewer stub only once; both hooks exited 0. Failure should remain an explicit incomplete review, with a manual retry available. If caching is later introduced, persist completed results and their snapshot/configuration identity, not merely an attempted hash. Review also uses `git diff HEAD`, which omits new untracked files, and relies on edit-hook records that do not cover every way files can change.

7. **Medium — numerical scoring overstates confidence and adds operating cost.** Attachment lines 571–592 and 1413. Source weights, temporal decay, and session deduplication do not establish independent Bernoulli observations; a Wilson bound on these weighted pseudo-counts is not a calibrated 95% confidence bound. The document itself acknowledges roughly 20% false promotion of useless rules under its selected simulation conditions. Later decay is not a guarantee of removing them, especially when sensor silence generates confirmations. Forty eligible observations per lesson also requires substantial usage, and simultaneous lessons complicate attribution. Keep these as offline research ideas. Use batch approval and descriptive recurrence counts until actual pilot data warrants experiments; do not conflate reduced sensor firing with improved task acceptance.

8. **Medium — the new persistence and guard machinery do not deliver their claimed guarantees.** Attachment lines 928–970, 995–999, 1225, and 1360–1364. Replay is order-sensitive, can itself append transitions, and rewrites shared materialized files. Git's union merge can interleave added lines in arbitrary order and explicitly requires checking the result; it is not a semantic event merge. [Git attributes documentation](https://git-scm.com/docs/gitattributes#_built_in_merge_drivers). A settlement marker is written before settlement completes, making partial failure hard to retry. Separately, the reviewer uses `--allowedTools`, which controls permission prompting rather than restricting the available tool set. Built-in restriction requires `--tools`, and MCP tools need separate treatment. [Claude CLI reference](https://code.claude.com/docs/en/cli-reference). These are source-inspection findings; concurrent races and live reviewer permissions were not exercised. Retain SQLite and describe local approval honestly as a workflow convention. Do not add a regex guard that promises isolation it cannot provide.

Additional inspection notes: settlement includes reviewer findings marked `dropped`; exact-quote grounding establishes that text exists, not that the claimed defect follows; blanket protection of existing tests obstructs legitimate behavior changes. Each needs a clear policy before becoming automated control logic.

**The enhancement worth taking**

| Adopt into a small follow-up | How to keep it lean |
|---|---|
| Structured check findings | Attach category, location, and evidence reference to existing explicit check results. Add parsers only for actual configured checks; preserve raw output and fail conservatively on parsing problems. |
| Lesson-to-check links | Optional references to existing check IDs. A linked check provides relevant observations, never automatic proof or approval. |
| Recurrence summaries | Aggregate repeated findings during the existing offline learning batch. Present counts and source sessions to the human reviewer. Keep the existing candidate/context limits. |
| Better review evidence | Show the explicit correction or failure, relevant check result, and conflicting lessons together. Distinguish an executable claim from general advice. |
| Manual conversion into a regression test or lint rule | Make this a normal reviewed code change after a repeat failure is established. The lesson can then be retired or shortened. |
| Check usefulness measurements | Reuse existing duration records; add human-confirmed actionable/false-positive labels where useful. Do not remove required checks merely because they rarely catch bugs. |

Do not add automatic promotion, weighted confidence gates, per-response LLM review, planner/scout orchestration, a Git-backed event database, global rules, embeddings, or self-tuning code in this enhancement. There is no demonstrated need for these in the existing pilot record.

**Suggested smallest next slice, if selected for implementation**

Extend the existing check evidence with optional structured findings and permit lessons to reference existing checks. Keep SQLite, existing check statuses, snapshot validation, manual batch approval, and frozen context. Build recurrence summaries only when the user runs the learning/review command. A failed or absent check contributes no positive evidence. Do not accept generated shell commands as proof of arbitrary prose claims: a grep match can establish that text exists, not that an API validates all relevant inputs.

Acceptance should cover nonzero exits with no parseable findings, missing/timed-out/interrupted checks, repeated ingestion, unrelated tests, cross-file failures, changed snapshots, and preservation of the five-lesson/4,000-character cap. Re-run the local overhead benchmark and then the existing paired ten-task pilot. Keep the model and required checks constant; compare acceptance, corrections, regressions, wall-clock time, context size, and batch-review effort. Expand only when prevented repeat mistakes justify the added review work.

**Evidence and limits**

Five of five targeted reproductions demonstrated the stated problems. Results are in [enhancement-review-evidence.json](./enhancement-review-evidence.json). Test fixtures and the reproduction driver remain in `work/enhancement-review-2026-10-19/`. This was a targeted design and source review, not an exhaustive audit of every research citation, a live Claude integration test, or a comparative productivity pilot. The attachment's simulations are its author's reported evidence, not independently replicated here.

Reviewed attachment: `/Users/yaakovins/Downloads/Self evolving SDLC harness.md`.

SHA-256: `258cffb776392952fe51b3380df6be55aa90ff4514381837fd32376d38579da1`.
