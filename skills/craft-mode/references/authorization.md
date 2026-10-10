# Authorization

Loading a craft skill grants nothing. Authority comes from the user's request, the project's own instructions, or a delegation brief, and a child receives no more than its brief states.

## Needs explicit permission

Ask before any of these unless the current request already grants it:

- Committing, pushing, merging, tagging, or opening and commenting on pull requests.
- Publishing a package or release.
- Deleting files, branches, or worktrees, or discarding uncommitted work.
- Installing dependencies, analyzers, or language toolchains.
- Changing user, shared, or global configuration, including Pi settings and host preferences.
- Regenerating reports, coverage data, or caches that other people or tools rely on.
- Contacting external services or upstream maintainers.

Permission for one action in one context does not carry over to the next.

## Read-only means read-only

A report-only audit or review must not hide setup work. Some analyzers install packages, write caches, regenerate coverage, or rewrite source temporarily. Check for those side effects before running a tool, and treat any that remain as actions needing permission.

## When unsure

Stop and ask, stating the action, why it is needed, and what happens if it is skipped. Record a declined or unanswered request as blocked in the [report](reporting.md).
