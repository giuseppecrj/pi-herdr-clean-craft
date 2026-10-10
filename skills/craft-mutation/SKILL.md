---
name: craft-mutation
description: Check whether tests notice small seeded changes to the source, starting from a green baseline, then classify survivors, strengthen tests honestly, and verify the source is restored. Explicit invocation only.
disable-model-invocation: true
---

# Craft mutation

Find out whether the tests would catch a plausible mistake. Introduce small changes to the source, called mutants, run the tests against each, and see which changes go unnoticed. A mutant that survives points to missing behavior checks, weak assertions, or code that does not matter.

Inputs: a green baseline, a small source scope, an approved way to create mutants, a time and worker budget, and coverage data if it exists.

## Before you start

- **Authority.** Loading this skill grants nothing. Mutation testing rewrites source files, so it needs permission to do so in the working tree it uses. Installing a mutation tool needs its own permission.
- **Ownership.** If another workflow or a parent session owns the task, check only the scope you were given, return the report below to that owner, and stop. Do not re-plan the task or launch children.
- **Green baseline.** Run the tests that will judge the mutants on the unmutated source and record the result and revision. If anything fails, stop and report the mutation check as blocked. A failing test cannot reveal anything about a mutant.
- **A restoration path you have verified.** Before writing any mutant, record exactly what the source looks like, using the version-control state or a saved copy, and know how you will put it back. Never mutate a working tree that holds someone's uncommitted work unless you can restore it byte for byte. A disposable copy of the project is safer when one is permitted.
- **Scope and budget.** Start with one small file or behavior. State the time and worker limits before starting, and stop when you reach them.

## Choosing how to mutate

- **Project tool.** If the project already has an approved mutation tool, preflight it the way you would any analyzer. Check its version, what it writes, how it restores source, what its counts mean, and whether cached results are still valid after test or environment changes. Report its results in its own terms.
- **Manual probe.** With permission and no tool, you can seed a few mutants by hand. Change exactly one thing per mutant, such as a comparison boundary, a negated condition, a removed call, a changed constant, or a different return value. Before each write, confirm that the file still matches the recorded original. A handful of hand-made mutants is a probe of specific assertions, not a mutation score.
- **Neither.** Report the check as blocked/not measured and say what would be needed.

## Running and classifying

Run the judging tests against each mutant, then put every file back and confirm the restoration before going further. Classify each outcome only as far as the evidence supports. [Interpretation](references/interpretation.md) explains the categories and their pitfalls.

- **Killed:** a named test failed at an assertion because of the mutant.
- **Survived:** the judging tests ran to completion and all passed.
- **Not covered:** no test executed the mutated code.
- **Invalid:** the mutant did not compile or load.
- **Timed out**, or **infrastructure error:** the run did not finish normally.

A nonzero exit status alone is not a kill. Read which test failed and why.

## Responding to survivors

For each survivor, decide which of these it is:

- **Missing behavior check.** No test states the behavior the mutant changed. Add one.
- **Weak assertion.** A test reaches the code but accepts the wrong result. Strengthen that assertion to check the exact expected value or the boundary.
- **Equivalent mutant.** The change cannot alter observable behavior. Record your reasoning, because claims of equivalence are easy to get wrong.
- **Unneeded code.** The code has no effect anyone relies on. Report it as a candidate for removal in a separate task.

A new or strengthened test follows test-first discipline from [craft-tdd](../craft-tdd/SKILL.md). It must fail against the mutant for the predicted reason and pass on the original source. Never weaken, delete, or reshape assertions just to change a score, and never edit production code to make a mutant easier to kill.

## Finishing

1. Rerun the bounded mutation check for the mutants you addressed.
2. Run the full judging tests on the unmutated source.
3. Confirm that every source file matches the recorded original or the intended new version, with no leftover mutants, temporary files, or overlays.

If a run was interrupted or crashed, confirm the restoration before doing anything else. If you cannot confirm it, stop and report the affected paths. Keep any temporary copy so it can be inspected.

## Report

Return only the fields that apply:

- Scope, revision, budget, and whether the budget was reached.
- Method: the tool and its version, or a manual probe with the list of mutants.
- Baseline result.
- Counts in the tool's own categories and terms, with its documented counting rules. Do not compute a cleaner score from data the tool did not provide.
- Each survivor with its classification and the action taken. Equivalent mutants are listed with their reasoning.
- New or strengthened tests, with each one's red result against the mutant and green result on the original.
- Restoration evidence and the final working-tree state.
- Anything blocked or skipped, and remaining risks.

Use these outcome words: **pass** when a check ran and supports the claim, **fail** when it ran and contradicts the claim, **blocked/not measured** when it could not run, and **skipped** when it was deliberately not run, with the reason. A skipped required check is not a pass.
