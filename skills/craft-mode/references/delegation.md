# Delegation

Work locally unless a fresh context or an independent reviewer would materially improve the result. Stages are not permanent agents, and a six-stage route does not need six processes.

## Who owns what

The execution host, pi-herdr-agents, owns launching children, panes, completion delivery, cancellation, managed worktrees, and task-model preferences. This pack owns only the instructions you give a child. Do not build polling loops, schedulers, worktree managers, or model stores around the host.

The host's parameter names can change between releases. Read the live tool description of the installed host before relying on any parameter described here. If the host is not installed, work locally and say that delegation was unavailable.

## Bare leaf contract

Delegate to bare children, not named roles. Every brief states:

- One bounded outcome, and the exact files the child may change.
- The input revision or working-tree state it starts from.
- The skill and reference paths it should read.
- An explicit model and an explicit thinking level the model supports. Do not let the child inherit yours by omission.
- A standalone session. When the brief travels as role or reference text, set the host's fork option to false. The inspected host drops that text for forked children, so a fork does not deliver the brief.
- The verification commands to run and the evidence to return.
- The commit policy.
- That it is a leaf: no children of its own, and no publishing, merging, pushing, deleting, or cleanup unless the brief grants it.

Repeat the constraints that matter in the task text itself, not only in the role text.

Measured with Pi 1.1.0 and pi-herdr-agents 3.2.1: a standalone child launched with the host's skills option received its task without that skill's instructions, which reached it only in a later request. Do not rely on the option to load a stage skill. Name the SKILL.md and reference file paths in the task text, and tell the child to read them before it starts work.

## Waiting and review

Results arrive on their own. Do not sleep, poll status lists, or tail session files while a child works.

When a result arrives, review it before accepting it. Inspect the diff, rerun the verification that matters, and compare the claims against the evidence. A child's summary is a claim, not proof.

## Independent review

For ordinary routing, use the host's configured task categories. For a review whose value depends on independence, choose an exact model from a different family than the author. When that is not available, a same-family reviewer in a fresh standalone session is acceptable if you disclose it as context-isolated rather than cross-family.

## Writers and worktrees

- Read-only reviewers run in ordinary panes.
- A single writer, or writers taking turns, can use the current checkout once the previous one has finished.
- Only genuinely independent parallel writers need separate managed worktrees, each based on an exact committed revision. Uncommitted parent files are not copied into a new worktree.
- A dependent writer must see its predecessor's accepted work, either in the same checkout after confirmed completion or from a committed base.
- The coordinator integrates and tests the combined result. Removing a worktree or branch needs its own explicit authorization.

See [authorization](authorization.md) for what a brief may grant.
