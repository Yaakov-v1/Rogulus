---
paths:
  - "**/*.{js,jsx,ts,tsx,mjs,cjs,py,go,rs,java,kt,kts,rb,php,cs,swift,scala,c,cc,cpp,h,hpp,vue,svelte,sh}"
---
# Clean Code rulebook

Code is read far more often than it is written: write for the next reader. Tests are code too.
**MUST**: fix before the work is final. **SHOULD**: fix, or give a one-line reason in the report.
Cite rule IDs in findings; a correctness problem is `BUG`, any other real problem no rule covers is `UNLISTED`.
Apply the rules to the lines you change: a function- or file-level rule (`F1`–`F5`, `S4`–`S6`, `D3`) counts only when the change
creates or worsens the violation; whole-file cleanup is its own task. Formatters and linters own style.
Adapted from Katharon (`Ariadne/CleanCodeHarness`), with `S3` tightened and `S5`–`S6` added for Harnestica.

## Naming
| ID | Rule | Level |
|---|---|---|
| N1 | Name things for what they are or do, in the domain's words: no unexplained abbreviations or filler (`data`, `info`, `tmp`, `manager`); one-letter names only in tiny scopes. | MUST |
| N2 | A name never hides a side effect: `getUser` must not create, save, or change anything. | MUST |
| N3 | Use one word per concept across the codebase; never mix `fetch`, `get`, and `load` for one operation. | SHOULD |
| N4 | Booleans read as yes/no questions (`isReady`), functions as verbs, types as nouns. | SHOULD |

## Functions
| ID | Rule | Level |
|---|---|---|
| F1 | A function does one thing, every step one level below its name; a part you can extract under a name that is more than a restatement of its code is a second thing. | MUST |
| F2 | Keep functions short: aim for 20 lines, and give a reason past 40. | SHOULD |
| F3 | Take three parameters at most; more become one parameter object. | SHOULD |
| F4 | No boolean flag parameter that switches behavior: write two functions instead. | MUST |
| F5 | Prefer guard clauses to nesting; nesting deeper than two levels needs a reason. | SHOULD |

## Conditions, constants and structure
| ID | Rule | Level |
|---|---|---|
| S1 | Leave no dead code or leftovers (unused code or imports, unreachable branches, debug prints, TODOs without an owner); a public name is not dead just because this repository never calls it. | MUST |
| S2 | Name every literal that has meaning (`MAX_RETRIES = 3`, `REVIEW_DAYS = 90`), except 0, 1, -1, and plain test data. | MUST |
| S3 | **At most 2 conditions per decision.** A single `a ? b : c` is fine; a nested ternary is not. `if / else if / else` is fine; a third condition becomes a lookup table, guard clauses, or a named function. A condition with 3+ clauses (`a && b \|\| c`) gets a name (`isEligibleForRefund(order)`). | MUST |
| S4 | One concept per file; a file over 300 lines needs a reason. | SHOULD |
| S5 | One statement per line: no chained assignments, no side effects inside conditions or expressions, no multi-statement one-liners. | MUST |
| S6 | Keep the folder layout flat and obvious: group by feature, at most 3 levels below the source root, folder names say what is inside; no catch-all `utils`/`misc`/`helpers`/`common` unless scoped (`date-format/`). | SHOULD |

## Design
| ID | Rule | Level |
|---|---|---|
| D1 | Never write a third copy of the same logic: extract it; if you touch copies that have drifted apart, report them, since which one is right is the human's call. | MUST |
| D2 | Build only what is needed now: no option, parameter, layer, interface, or abstraction that no current caller needs. | MUST |
| D3 | A module has one reason to change: keep what changes together close, and what changes apart separate. | SHOULD |
| D4 | Keep business rules free of I/O and framework code, with time, randomness, network, and storage behind small boundaries. | SHOULD |

## Comments and errors
| ID | Rule | Level |
|---|---|---|
| C1 | A comment that contradicts the code is a bug: fix it or delete it in the same change. | MUST |
| C2 | Comments explain why (intent, constraints, trade-offs), never restate what the code says. | SHOULD |
| C3 | No commented-out code; version control remembers it. | MUST |
| E1 | Never swallow an error (no empty catch, no ignored error result): handle it, let it propagate, or, where failing open is the design, record it and say why at the site. | MUST |
| E2 | Error messages say what failed, with which input, and what to do next, and never contain secrets or personal data. | SHOULD |
| E3 | Validate at the boundary (user input, files, network, environment) and fail fast there; inside, trust what you validated. | SHOULD |

## Tests
| ID | Rule | Level |
|---|---|---|
| T1 | Every behavior change ships with a test that fails without it (a named manual check only where a test is impossible); for a bug, write that test first. | MUST |
| T2 | Test the boundaries that apply: empty, zero, one, many, maximum, invalid input, and the error path. | MUST |
| T3 | Never delete, skip, or weaken a test to reach green: fix the code, or stop and ask. | MUST |
| T4 | One behavior per test, with a name that states it. | SHOULD |
| T5 | Tests are fast, isolated, and repeatable: no real clock, network, sleeps, or shared mutable state. | SHOULD |
| T6 | Assert observable behavior, not internals, and mock only at boundaries. | SHOULD |
| T7 | Expected values come from a source independent of the code under test (a literal, a worked example, or the spec), never its logic recomputed. | MUST |

## Hygiene
| ID | Rule | Level |
|---|---|---|
| H1 | Make the smallest change that solves the problem, clean only what you touch, and keep refactoring and behavior changes in separate steps. | MUST |
| H2 | No secrets in code, tests, or logs, and never build SQL, shell commands, paths, or HTML by concatenating untrusted input. | MUST |
| H3 | Add no dependency without a one-line reason: what it replaces, and why writing it yourself is worse. | SHOULD |
| H4 | Never silence a check to reach green (suppressions, unchecked casts, disabled rules, lowered thresholds, skipped hooks); an unavoidable one is narrow and says why at the site. | MUST |

## Project exceptions
<!-- Add project-specific exceptions here as `- <rule ID>: <exception> — <reason>`. -->
