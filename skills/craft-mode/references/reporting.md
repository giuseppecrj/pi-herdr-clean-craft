# Reporting

The final report lets a reader check every claim. Include only the fields that apply, and keep each one short.

## Fields

- **Goal and scope**: what was asked and what was in bounds.
- **Behavior reference**: the specification, issue, or acceptance criteria the work satisfies.
- **Changes**: files or revisions changed, and by whom when children wrote code.
- **Verification**: each command run and what it actually showed.
- **Red and green**: the failing test and its failure reason, then the passing result. Include this only when you observed it. If you could not demonstrate a meaningful failure first, say so instead of claiming a test-first cycle.
- **Measurements**: tool name and version, scope, revision, coverage source and freshness, exclusions, and what the numbers cannot tell you.
- **Review**: who reviewed, with which model, and whether the review was cross-family, context-isolated, or not independent.
- **Stages not completed**: every stage that is blocked/not measured or skipped, with the reason, including missing stage skills.
- **Risks**: unresolved questions and known limitations.
- **Handoff**: commit SHAs, worktree paths, branches, and uncommitted state when relevant.

## Outcomes

Use pass, fail, and blocked/not measured as defined in [workflows](workflows.md#stage-outcomes). A process that exits successfully is not a pass if the tool can report success after incomplete analysis. A skipped required check is not a pass.

## Limits

Scope every verdict to the revision and surface that were actually tested. Do not claim universal correctness, behavioral validation by a live model, or compatibility with versions that were not exercised.
