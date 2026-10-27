---
paths:
  - "**/*.{uproject,uplugin,Build.cs,Target.cs}"
  - "**/Source/**/*.{h,hpp,cpp,cc,inl}"
  - "**/Plugins/**/Source/**/*.{h,hpp,cpp,cc,inl}"
---
# Unreal Engine 5 (C++) rules
Status: conventions from general UE knowledge; not yet verified against a project on the game machine.
Applies on top of the clean-code rulebook; where they conflict (e.g. UE naming, macros), these win for Unreal sources.

## C++ conventions
- Prefixes: `U` UObject, `A` Actor, `F` struct/plain type, `E` enum, `I` interface, `T` template, `S` Slate widget. Booleans start with `b` (`bIsDead`).
- Reflect only what needs it: `UPROPERTY` for any member that holds a UObject (the GC sees it only through reflection), editable data, or replication.
- `UFUNCTION` only for Blueprint exposure, delegates, RPCs, or timers by name; keep other functions plain C++.
- Never hold a raw `UObject*` as an owning reference outside `UPROPERTY`. Use `UPROPERTY() TObjectPtr<>` for owning members, `TWeakObjectPtr<>` for non-owning refs, `TSharedPtr`/`TUniquePtr` for non-UObject types.
- Create objects with `NewObject`/`CreateDefaultSubobject`/`SpawnActor`; never `new`/`delete` a UObject. Null-check weak and asset references before use.
- Prefer events, delegates, and timers (`FTimerManager`) over `Tick`; if a class needs no per-frame work, set `PrimaryActorTick.bCanEverTick = false`.
- Use engine types (`FString`, `FName`, `TArray`, `TMap`) at engine boundaries; `FName` for identifiers, `FText` for user-facing text.

## Blueprint vs C++
- C++: systems, generation, save/load, anything perf-critical or reused across many classes.
- Blueprint / data assets: tuning values, content, VFX/audio hookup, one-off level logic. Expose tuning as `UPROPERTY(EditAnywhere)` or a `UDataAsset`, not constants.

## Roguelike checklist
- Procedural generation is seeded and deterministic: one `FRandomStream` per system (map, loot, encounters), never the global `FMath::Rand`.
- Keep run-state (this run) and meta-progression (unlocks, currency) in separate save objects with separate lifetimes.
- Content (items, enemies, rooms, loot tables) is data-driven: data assets or data tables, not hard-coded in C++.
- Save games carry an explicit version number and an upgrade path; never change a saved field's meaning without bumping it.
- Every bug report includes the run seed; a seed must reproduce the same run.
