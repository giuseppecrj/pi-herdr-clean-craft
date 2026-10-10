# Workflows

Choose a route by what the task needs to prove. Every stage below names the stage skill that will own it. None of those stage skills ships in this release, so check availability first and mark a missing stage blocked, as the hub describes.

## Routes

| Request | Route | Stage skills involved |
| --- | --- | --- |
| Small feature or bug fix | Lightweight change | craft-tdd, craft-refactor |
| Restructure existing behavior | Refactor, then architecture review if a boundary moves | craft-refactor, craft-architecture |
| Architecture review | Read-only findings and a scoped proposal | craft-architecture |
| Quality audit | Report-only assessment | craft-quality |
| Weak tests or suspicious coverage | Bounded mutation run after a green baseline | craft-mutation |
| Substantial new behavior | Full feature | all of the above, plus craft-spec and craft-qa |
| Final check of a candidate | Public-surface verification | craft-qa |

When a request fits none of these, say so and ask rather than forcing it into a route.

## Lightweight change

Scope, baseline, test-first change, focused cleanup, relevant verification, report.

- Reproduce a bug before fixing it. A test that fails for an unrelated reason, such as an import error or broken fixture, is not a meaningful red result.
- Clean up only what the change touched, with tests green between steps.
- Add an architecture or mutation stage only when the change gives a concrete reason, such as a new cross-module dependency or assertions that look too weak to catch a regression.
- One local writer is the default. A sequential delegate is fine when context is getting crowded.

## Full feature

Specification, user approval, test-first implementation, cleanup, architecture review, mutation hardening, independent public-surface verification, parent review.

- Get explicit user approval of the specification before implementing newly specified behavior.
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
