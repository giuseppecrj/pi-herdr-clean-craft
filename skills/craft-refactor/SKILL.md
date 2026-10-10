---
name: craft-refactor
description: Improve the structure of existing code without changing its behavior, in small verified steps from a green baseline, adding characterization tests where protection is thin. Explicit invocation only.
disable-model-invocation: true
---

# Craft refactor

Make code easier to understand and change while its observable behavior stays exactly the same. The claim of preserved behavior rests on the same tests passing before and after, run on known revisions.

Inputs: the target code, the intended improvement, the permitted scope, and the project's test commands.

## Before you start

- **Authority.** Loading this skill grants nothing. Ask before committing, installing, deleting, changing shared configuration, or editing outside the permitted scope, unless the request already allows it.
- **Ownership.** If another workflow or a parent session owns the task, do only the refactor you were given, return the evidence below to that owner, and stop. Do not re-plan the task or launch children.
- **Green baseline.** Run the tests that cover the target and record the result and revision. If anything fails, stop and report it. A refactor that starts red cannot show that behavior was preserved.
- **Protection.** Check whether the tests would notice a change in the behavior you are about to touch. Where they would not, add characterization tests first. Characterization tests record what the code does now, including behavior that looks wrong. Note the odd behavior as a finding and keep it unchanged here.

## What to look for

- Names that hide intent, or that no longer match what the code does.
- Units that mix responsibilities, such as parsing, deciding, and performing side effects in one place.
- Coupling that forces unrelated code to change together, and data that travels further than it needs to.
- Duplication. Before merging two similar pieces, ask whether they change for the same reason. Code that looks alike but serves different purposes should stay apart.
- Mutable state shared more widely than necessary.
- Error paths that are swallowed, inconsistent, or untested.
- Dead code. Before removing it, confirm through search and tests that nothing reaches it, including reflection, configuration, or public API consumers.
- Tests that are hard to read. See [test quality](references/test-quality.md).

## Making changes

1. Change one thing at a time: a rename, an extraction, a move, an inlining.
2. Run the relevant tests after every meaningful step. If something turns red, undo that step rather than debugging forward.
3. Extract a unit only when it gets a name that describes one responsibility and it owns a coherent set of inputs. Do not split a function that already does one thing just to make it shorter or to lower a complexity score.
4. Keep public interfaces stable unless the brief allows changing them. If one must change, update every caller in scope and say so.
5. Do not edit test assertions during a refactor. If a test pinned private structure and must change, make that a separate, visible step and explain why the behavior it checks is unchanged.

Stop if you find a defect. Record it, keep the current behavior, and propose a separate test-first fix using [craft-tdd](../craft-tdd/SKILL.md). A refactor that also fixes bugs cannot show that it preserved behavior.

When the result adds, removes, or reverses a dependency between modules or layers, recommend a boundary review with [craft-architecture](../craft-architecture/SKILL.md) and name the edges.

## Report

Return only the fields that apply:

- What was improved and why, with a before and after summary for each step.
- The preserved-behavior evidence: the test commands, with the baseline and final results and the revision of each.
- Any characterization tests you added, and the odd behaviors they recorded.
- Suspected defects or behavior changes, left for a separate task.
- Changed edges between modules, if any.
- Anything blocked or skipped, and remaining risks.

Use these outcome words: **pass** when a check ran and supports the claim, **fail** when it ran and contradicts the claim, **blocked/not measured** when it could not run, and **skipped** when it was deliberately not run, with the reason. A skipped required check is not a pass.
