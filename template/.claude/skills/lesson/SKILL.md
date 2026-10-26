---
name: lesson
description: Manage Harnestica lessons in CLAUDE.md — propose, approve, merge, retire or re-review one. Use on "/lesson", after a LESSON? candidate, when the owner says "remember this" about this repo, or when the session-start audit reports an overdue or over-cap Lessons slot.
---

# lesson

A **lesson** is one line in the `## 6. Lessons` section of the project's `CLAUDE.md` that prevents a repeat mistake in this repo:

```
- [YYYY-MM-DD · scope] rule — evidence
```

- **scope**: `repo` or a repository-relative path prefix (`src/api`).
- **rule**: one imperative sentence, stated positively ("Run migrations through `make migrate`").
- **evidence**: what actually happened, briefly ("2026-10-12 test suite red after raw `prisma migrate`").

The slot holds at most **12** lessons, newest first. `.claude/harnestica/state/` records repeated check failures; read `failures.jsonl` there when citing one as evidence.

## Actions

Pick the action from the request, then follow its steps. Every change to the slot needs the owner's explicit yes in this conversation; a candidate stays a candidate until then.

### propose
1. Draft one candidate in the format above from the correction, repeated failure or rework at hand.
2. Compare it against every existing lesson. When one overlaps, draft a **merge** instead.
3. When the slot already holds 12, also name the lesson to retire or merge to make room.
4. Show the candidate (and any retire/merge) and ask for a yes.

Done when the owner has a concrete one-line candidate to accept or reject.

### approve
1. Insert the approved line at the top of the slot, below the format line, with today's date.
2. Apply any retire/merge agreed in the same answer.
3. Re-read the slot: ≤12 lines, each in the format, no duplicates.

### merge
Replace the overlapping lessons with one line that keeps the stronger rule, the union of scopes, the newest date and both evidence notes (shortened).

### retire
Remove the line. Retire a lesson when the codebase now enforces it (a lint rule, type, or test), when it is refuted, or when the owner says so.

### review (overdue lessons, older than 90 days)
For each overdue lesson, ask: keep (re-date it today), rewrite, or retire. Apply only the answers given.

## Report
End with the slot's line count (`n/12`) and every line you changed.
