# Workflows

Choose a route by what the task needs to prove. Each stage is owned by one stage skill. Five of them ship with this hub. craft-spec and craft-qa do not, so any stage that needs them is blocked, as the hub describes.

## Routes

| Request | Route | Stage skills involved | Status in this release |
| --- | --- | --- | --- |
| Small feature or bug fix | Lightweight change | craft-tdd, craft-refactor | Available |
| Restructure existing behavior | Refactor, then architecture review if a boundary moves | craft-refactor, craft-architecture | Available |
| Architecture review | Read-only findings and a scoped proposal | craft-architecture | Available |
| Quality audit | Report-only assessment | craft-quality | Available |
| Weak tests or suspicious coverage | Bounded mutation check after a green baseline | craft-mutation | Available |
| Substantial new behavior | Full feature | all of the above, plus craft-spec and craft-qa | Blocked at specification and final QA |
| Final check of a candidate | Public-surface verification | craft-qa | Blocked |

When a request fits none of these, say so and ask rather than forcing it into a route.

## Lightweight change

Scope, baseline, test-first change, focused cleanup, relevant verification, report.

1. Scope and baseline as the hub describes.
2. Run craft-tdd for each behavior slice. A bug is reproduced before it is fixed. A test that fails for an unrelated reason, such as an import error or broken fixture, is not a meaningful red result.
3. Tidy only what the change touched, with tests green between steps. Use craft-refactor when the cleanup is more than a few local moves.
4. Add a stage only for a concrete reason: craft-architecture when the change adds a dependency across a module boundary, craft-mutation when the new or existing assertions look too weak to catch a regression in the changed code.
5. Run the relevant regression checks on the final revision and report.

One local writer is the default. A sequential delegate is fine when context is getting crowded.

If the requested behavior is ambiguous or substantial enough to need a written specification, stop and ask the user to settle it. Do not quietly write a specification in place of the missing craft-spec stage.

## Refactor

Scope, green baseline, characterization where protection is thin, small verified steps, report.

- Use craft-refactor. Its precondition is a green baseline. A red baseline is reported before any structural change.
- Behavior stays fixed. A defect found along the way becomes a separate test-first task, not part of the refactor.
- When the result adds, removes, or reverses a dependency between modules, follow with craft-architecture on the changed edges.

## Architecture review

Collect the actual dependency edges, compare them with the project's stated policy, and report findings with a scoped proposal.

- Use craft-architecture. It is read-only unless the user or brief permits structural edits, and then the edits follow the refactor route.
- An observed graph is a baseline, not a policy. When the project has no stated policy, report that and propose one for the user to accept rather than enforcing what exists.

## Quality audit

Preflight the tools, establish a passing baseline, measure what can be measured, and report hotspots with their caveats.

- Use craft-quality. It is report-only by default. Remediation is a separate, authorized step that uses craft-refactor or craft-tdd.
- Missing, stale, or failed measurements are reported as such. They never become zero coverage or a clean result.

## Mutation check

Green baseline, small scope and stated budget, seeded changes, survivor classification, restored source, report.

- Use craft-mutation. Do not start without a green baseline and a verified way to restore the source.
- New tests written in response to a survivor follow craft-tdd: each must fail against the mutant for the predicted reason and pass on the original.

## Full feature

Specification, user approval, test-first implementation, cleanup, architecture review, mutation hardening, independent public-surface verification, parent review.

This route is blocked in this release at its first and last stages, because craft-spec and craft-qa are not included. Tell the user. With their direction you can continue under the project's own specification and acceptance practices, recording those two stages as blocked, or stop. When continuing:

- Get explicit user approval of the behavior before implementing newly specified behavior.
- Stages that preserve behavior must not add requirements the user did not approve.
- Set a budget for correction rounds before starting. When a gate keeps failing or a requirement stays unclear, stop and escalate instead of looping.
- After any fix, rerun the downstream checks it affects.

## Stage outcomes

Each stage ends in one of these states, recorded with its evidence:

- **pass**: the check ran and its semantics support the claim.
- **fail**: the check ran and contradicts the claim.
- **blocked/not measured**: the check could not run, including when its stage skill or tool is missing.
- **skipped**: deliberately not run, with the reason. A skipped required stage is not a pass.

Continue to [reporting](reporting.md) for how these states appear in the final report.
