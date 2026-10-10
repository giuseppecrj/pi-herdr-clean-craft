---
name: craft-mode
description: Scope and route an engineering task through explicit behavior, test-first evidence, and verification, then report what was proven. Explicit invocation only. Routes to five bundled stage skills and reports the unshipped specification and final QA stages as blocked instead of improvising them.
disable-model-invocation: true
---

# Craft mode

Coordinate one engineering task so that every claim in the final report rests on evidence you observed: a failing test before a fix, a passing suite after it, a real dependency edge, or a qualified measurement. Pick the smallest workflow that can produce that evidence.

This is a one-shot load. Reading this skill does not switch on a persistent mode, and it grants no permission beyond what the user has already given.

## What this release contains

This hub ships with five stage skills in sibling directories:

- [craft-tdd](../craft-tdd/SKILL.md): change behavior test-first, starting from a meaningful failing test.
- [craft-refactor](../craft-refactor/SKILL.md): improve structure without changing behavior.
- [craft-architecture](../craft-architecture/SKILL.md): review dependency and policy boundaries. Read-only by default.
- [craft-quality](../craft-quality/SKILL.md): assess risk from qualified measurements. Report-only by default.
- [craft-mutation](../craft-mutation/SKILL.md): check whether tests notice seeded changes.

Two planned stages are not part of this release: craft-spec, for specifying new behavior and acceptance criteria, and craft-qa, for independent verification through the public surface. Any route that needs them is blocked at that stage.

A stage skill counts as available only if you can actually read its `SKILL.md`. A partial install or a package filter can hide a bundled stage, so check before relying on one. When a stage you need is missing:

- Mark that stage **blocked: stage skill not installed** in your checklist.
- Tell the user which stage is missing and what it would have covered.
- Offer to continue with the project's own conventions under their direction, or to stop. Do not write a replacement procedure and present it as the craft stage.

## Decide who coordinates

If another workflow already owns this task, for example a parent session that delegated it to you or a different methodology hub that is running, you are a contributor. Do the bounded part you were given, return its evidence to that owner, and stop. Do not start a competing workflow, re-plan the whole task, or launch children of your own.

Otherwise you coordinate, and children you launch are leaves. Stage skills are procedures for one stage. When you read one, follow it for that stage and keep the route, the checklist, and the final report here.

## Procedure

1. **Classify the request.** Does it change behavior, preserve behavior while changing structure, diagnose quality, or verify an existing artifact? Ask when the request mixes these in a way that changes the route.
2. **Establish scope.** Record the goal, the files or modules in scope, the starting revision or working-tree state, the project's own test and check commands, the tools that are actually installed, and the limits in [authorization](references/authorization.md).
3. **Take a baseline.** Run or inspect the relevant checks before changing anything. A failing baseline is a finding to report, not something to fix silently.
4. **Choose a route** from [workflows](references/workflows.md). Prefer the lightweight route and say why when a heavier one is warranted.
5. **Check stage availability** for each stage on the route, as described above.
6. **Decide whether to delegate** using [delegation](references/delegation.md). Working locally is the default.
7. **Keep a visible checklist.** One line per stage with its state and evidence: pass, fail, blocked/not measured, or skipped with a reason.
8. **Report** using [reporting](references/reporting.md).

## Ground rules

- Follow the project's language, test runner, architecture policy, and verification commands. Do not import preferences from other ecosystems.
- Treat metrics as signals that need interpretation, never as proof of correctness or as targets to optimize.
- Detect optional tools before using them. Installing or configuring anything is a separate, authorized action.
- When code changes after a verification step, that step's verdict no longer covers the new revision.
