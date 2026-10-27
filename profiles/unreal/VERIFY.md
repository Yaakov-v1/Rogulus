# Verifying the Unreal profile (run on the game machine)
Rule: promote only what actually ran. Nothing here becomes an active rule or check until its evidence is recorded below.
Evidence = the exact command, its quoted output (last ~10 lines), exit code, and the date.

First: `bash .claude/profiles/unreal/bootstrap-check.sh` from the project root. Fix every MISSING before continuing.

| Item | Run | Promote when |
|---|---|---|
| `unreal-build-editor` | the command in checks.unverified.json, with `<UE_ROOT>`, `<Project>` filled in | it exits 0 on a clean tree and non-zero after you introduce a deliberate compile error |
| `unreal-buildcookrun` | the BuildCookRun command, once | it exits 0 and a staged build exists; note the duration (decides pre-release vs per-edit) |
| `unreal-automation-tests` | the `UnrealEditor-Cmd` command with one real test as `<Filter>` | the test's pass is in the output, and a deliberately failing test gives a non-zero exit code |
| UNREAL.md conventions | open a real class; check the macros and `TObjectPtr`, `FRandomStream`, `FTimerManager` names against the installed engine headers | each name exists in the engine version; fix or delete the ones that do not |

To promote a check: copy the entry into `.claude/harnestica.json`, replace every `<placeholder>`, delete its `status` and `note` fields, and paste the evidence under "Evidence log" below. This step is manual on purpose; the runner does not detect leftover placeholders.
Re-running the installer never overwrites this file, so the log below survives upgrades.
To promote the rules: delete the `Status:` line in UNREAL.md and add `Verified: <date>, UE <version>`.

## Evidence log
(empty: nothing has been run yet)
