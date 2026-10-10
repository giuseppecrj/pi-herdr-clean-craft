---
name: craft-tdd
description: Change behavior test-first. Write one focused test, confirm it fails for the predicted reason, make the smallest passing change, then tidy under green. Explicit invocation only. Says so plainly when a meaningful failing test could not be shown.
disable-model-invocation: true
---

# Craft TDD

Change one observable behavior at a time, and let a test that failed for the right reason, then passed, carry the claim that the change works.

Inputs: a behavior slice or a reproducible bug, the files in scope, and the project's own test conventions and commands.

## Before you start

- **Authority.** Loading this skill grants nothing. Ask before committing, installing, deleting, changing shared configuration, or contacting anyone, unless the request already allows it.
- **Ownership.** If another workflow or a parent session owns the task, do only the slice you were given, return the evidence below to that owner, and stop. Do not re-plan the task or launch children.
- **Behavior is settled.** You need to know what the behavior should be. If it is ambiguous, or new and substantial enough to need a written specification, stop and ask. Do not invent requirements so that a test can be written.
- **Project conventions.** Use the project's language, test runner, file layout, and naming. Read neighbouring tests before adding one.

## The cycle

1. **Baseline.** Run the tests that cover the area. Record anything already failing. A failing baseline is a finding to report, not something to repair silently inside this change.
2. **Pick one behavior.** State it as an input or situation and the observable result. For a bug, write down the steps that reproduce it and the result you see now.
3. **Write one focused test** that exercises the behavior through the narrowest public seam that shows it. Name the test after the behavior, not the function.
4. **Run it and read the failure.** Before writing production code, the test must fail for the reason the missing behavior predicts. See the next section.
5. **Make the smallest production change** that makes the test pass. Resist adding behavior the test does not ask for.
6. **Run the focused test, then the relevant regression tests.** Both must pass on the same revision.
7. **Tidy under green.** Clean up only what this change touched, one move at a time, rerunning the tests after each move. Restructuring beyond that belongs to [craft-refactor](../craft-refactor/SKILL.md). Mention it in your report instead of widening this change.
8. **Repeat** for the next slice.

## What counts as a meaningful red

A red result is evidence only if the test reached its assertion and the assertion failed in the way the missing behavior predicts. For example, the test expected stop and the code returned retry.

These are not a meaningful red, even though the run fails:

- The test file or the code under test failed to load because of a syntax error, a missing export, an import path, or a missing dependency.
- A fixture, database, network, permission, or environment problem.
- A timeout, or a crash in setup before the assertion ran.
- An assertion that failed for some other reason than the one predicted, such as a wrong value elsewhere.

A nonzero exit status on its own proves nothing. Read which test failed and why. If the failure is not the predicted one, fix the test or its setup and run it again before touching production code.

If the new test passes immediately, either the behavior already exists or the test does not exercise what you think it does. Find out which. Do not count it as red.

## When a meaningful red cannot be shown

Sometimes no honest failing test is possible. The behavior may already exist and only needs a characterization test, the defect may appear only in an environment you cannot reach, or the project may have no test seam at that level. Say so in the report, give the reason, and describe the evidence you do have. Do not describe the change as test-driven.

## Test quality

- Assert observable results such as return values, outputs, state visible through the public interface, and emitted effects. Avoid tests that only pin private structure, so that a later refactor does not break them for no behavioral reason.
- Cover the edge that the behavior turns on. If attempts stop at the limit, test the limit itself, not only values far past it.
- Prefer one clear assertion of the expected value over a loose check of its type or presence.
- Keep the test deterministic. Replace real clocks, randomness, and network access only where the project already has a convention for doing so.
- Acceptance tests do not replace focused unit tests where those give faster and more specific feedback. Use both when the project does.

## Report

Return only the fields that apply:

- The behavior, stated in one sentence.
- The test name and the exact command used to run it.
- The red result: the failing test and its failure reason, quoted briefly. If none, the reason no meaningful red was shown.
- The production change, as files and a short description.
- The green result for the focused test and the regression tests, with commands and the revision they ran on.
- Anything blocked or skipped, and remaining risks.

Use these outcome words: **pass** when a check ran and supports the claim, **fail** when it ran and contradicts the claim, **blocked/not measured** when it could not run, and **skipped** when it was deliberately not run, with the reason. A skipped required check is not a pass.
