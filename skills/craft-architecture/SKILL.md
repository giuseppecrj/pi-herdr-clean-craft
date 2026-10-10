---
name: craft-architecture
description: Review policy and dependency boundaries from observed import edges, then report evidence-backed findings and the smallest useful correction. Read-only by default. Explicit invocation only.
disable-model-invocation: true
---

# Craft architecture

Check whether the code's real dependencies match the boundaries the project intends, and propose the smallest correction that matters. Every finding names the files and the edge that show it.

Inputs: the modules or change in scope, the project's stated architecture policy if one exists, and the tools it already uses to inspect dependencies.

## Before you start

- **Read-only by default.** Produce findings and a proposal. Edit structure only when the request or brief explicitly permits it, and then follow the refactor discipline in [craft-refactor](../craft-refactor/SKILL.md): a green baseline, small steps, and tests between them.
- **Authority.** Loading this skill grants nothing. Adding a lint rule, a dependency checker, or a configuration change is an edit, and installing a tool needs permission.
- **Ownership.** If another workflow or a parent session owns the task, review only what you were given, return the evidence below to that owner, and stop. Do not re-plan the task or launch children.

## Collect the actual edges

Prefer evidence the project already trusts, such as existing dependency rules, lint configuration, build-tool module graphs, or architecture tests. Otherwise read the import statements and call sites directly.

Record how you collected the edges, because each method sees something different:

- Reading import statements sees declared dependencies, including some that never run.
- Runtime resolution sees only the modules that actually load on the paths exercised. In TypeScript, type-only imports are erased before execution and leave no runtime edge.
- Neither method sees dependencies created through dependency-injection containers, reflection, string-based loading, configuration, or shared global state. Name those as unmeasured when they matter.

## What to review

- Does high-level policy depend on details such as the user interface, database, filesystem, network, framework, or vendor SDK? Policy should be usable and testable without them.
- Do framework or persistence types cross into the domain through signatures, return values, or exceptions?
- Are there cycles between modules or packages?
- Does each invariant have one owner, or do several modules each enforce part of it?
- Are internals exposed by accident, such as everything exported from a module that only needs to publish two functions?
- Do adapters repeat decisions that belong to the domain instead of calling it?
- Are there domain modules used only by tests while production code reimplements their rules elsewhere?
- Do existing boundary checks preserve the intended architecture, or merely freeze today's accidental structure?

[Design principles](references/design-principles.md) turns common principles into review questions.

## Policy versus observation

The graph you observe is a baseline, not a policy. When the project states a policy, judge the edges against it. When it does not, report the observed structure and propose a policy for the user to accept. Do not present a rule derived from today's edges as the intended architecture.

## Proposing corrections

- Tie each recommendation to a concrete change pressure or defect, such as a test that cannot run without a database or a change that touched six modules. When nothing hurts, it is fine to recommend no change.
- Prefer the smallest change that restores the boundary: move one function, invert one dependency, pass a value instead of a client. Do not add layers, interfaces, or patterns that the problem does not need.
- When a check is worth keeping, propose the lightest enforceable one the project's tooling supports, such as a forbidden import rule, a dependency-direction test, or a cycle check. Keep legitimate exceptions listed, each with its reason.
- Before relying on a new check, show that it fails on a real or seeded violation and passes without it. A check that has never failed has not been shown to work.

## Report

Return only the fields that apply:

- Scope, revision, and the method used to collect edges, including what that method cannot see.
- Findings. For each, give the edge as source file to target file, why it matters, and a severity tied to change pressure.
- The smallest useful correction for each finding, with its tradeoffs.
- Proposed or added checks. For each added one, show it failing on the violation and passing on the corrected code.
- Unmeasured areas, anything blocked or skipped, and remaining risks.

Use these outcome words: **pass** when a check ran and supports the claim, **fail** when it ran and contradicts the claim, **blocked/not measured** when it could not run, and **skipped** when it was deliberately not run, with the reason. A skipped required check is not a pass.
