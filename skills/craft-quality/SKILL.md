---
name: craft-quality
description: Assess code risk from qualified measurements such as complexity, coverage, and duplication, and disclose missing or stale data instead of filling gaps. Report-only by default. Explicit invocation only. No upstream analyzer is supported in this release.
disable-model-invocation: true
---

# Craft quality

Find the code where defects are most likely and most costly, using measurements whose source, scope, and freshness you can state. Numbers are inputs to judgment. They do not prove correctness and are not targets.

Inputs: the target revision and scope, the project's test commands, and whatever analyzers the project already has.

## Before you start

- **Report-only by default.** Change code only when the request permits remediation, and then as a separate step.
- **Authority.** Loading this skill grants nothing. Running an analyzer can still change things: it may install packages, download toolchains, write caches, regenerate or delete coverage reports, or rewrite source temporarily. Preflight every tool as described in [tool recipes](references/tool-recipes.md), and ask before any step with side effects.
- **Ownership.** If another workflow or a parent session owns the task, assess only what you were given, return the report below to that owner, and stop. Do not re-plan the task or launch children.
- **No supported upstream analyzer.** This release supports no external quality analyzer. Use the project's own tooling, or report the measurement as not measured.

## Procedure

1. **Identify** the language, the revision, the files or change in scope, the test command, and which analyzers are actually installed. Check what is present. Do not assume it.
2. **Baseline.** Run the tests and record the result. A failing suite is a finding. Coverage collected from a failing or partial run does not describe the code.
3. **Check coverage provenance.** Establish which command produced the coverage data, on which revision, with which exclusions, and whether the source changed since. Absent coverage is not measured, never zero. Stale coverage is reported as stale, or not used.
4. **Measure what you can,** starting with the changed code when the task is about a change. Record each tool's name, version, command, and scope.
5. **Rank hotspots** by combining complexity, coverage, duplication, how often the code changes, and how much the behavior matters. Say which inputs each ranking used and which were missing.
6. **Read the code** behind each hotspot before recommending anything. A long function may be a clear sequence of steps, and similar code may change for different reasons.
7. **Recommend** the smallest useful action for each hotspot, such as a missing behavior test, a weak assertion to strengthen, an extraction that clarifies one responsibility, or no change. Remediation goes through [craft-refactor](../craft-refactor/SKILL.md) or a test-first change. When assertion strength is the question, a mutation check with [craft-mutation](../craft-mutation/SKILL.md) gives better evidence than coverage.
8. **If remediation is authorized,** change one bounded hotspot, then measure again with the same tool, version, scope, and coverage definition, and compare like with like.

## The CRAP heuristic

A commonly cited risk heuristic combines a function's cyclomatic complexity and its test coverage. It takes the complexity squared, multiplies it by the cube of the uncovered fraction, and adds the complexity. As a formula, CRAP equals CC squared times (1 minus coverage) cubed, plus CC, with coverage as a fraction between 0 and 1. Fully covered code scores its complexity. Uncovered code scores roughly the square of its complexity.

Treat it as a reference, not a measurement you can produce from guesses:

- Complexity counting rules differ between tools and languages.
- Coverage may be by line, statement, or branch, and mapping it to individual functions depends on the tool.
- No threshold is universal. Use the project's own policy, or present scores as a ranking.
- Do not compare scores across tool versions or coverage definitions without saying so.
- If you compute the score yourself from measured inputs, label it as your calculation and list the inputs and their sources. Never present an estimate as tool output.

## Report

Return only the fields that apply:

- Scope, revision, and test baseline.
- For each tool, its name, version, command, and scope. Unavailable tools are listed as blocked/not measured.
- Coverage source, freshness, kind, and exclusions, or the reason coverage is absent or unusable.
- Ranked hotspots with the evidence for each and what was missing.
- Recommendations, each tied to code you read.
- What the numbers cannot tell you here.
- Anything blocked or skipped, and remaining risks.

Use these outcome words: **pass** when a check ran and supports the claim, **fail** when it ran and contradicts the claim, **blocked/not measured** when it could not run, and **skipped** when it was deliberately not run, with the reason. A skipped required check is not a pass.
