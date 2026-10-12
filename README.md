# pi-herdr-clean-craft

An unofficial Pi methodology pack inspired by Robert C. Martin's engineering practices and public projects. It is not affiliated with or endorsed by him or those projects. The goal is a repeatable delivery process whose claims rest on observed evidence: failing then passing tests, real dependency edges, and qualified measurements.

The pack supplies instructions only. Child execution comes from [pi-herdr-agents](https://github.com/giuseppecrj/pi-herdr-agents), installed and activated separately.

## Status

Version 0.2.0 adds an optional sticky `/craft-mode` command to the six-skill edition first published as 0.1.0. A release must pass the same mandatory automated checks as pi-herdr-pstack: formatting, lint, typecheck, the default suite, and a package preview. The host integration check is a separate compatibility check, not part of those, and it still fails against pi-herdr-agents 3.2.1; [Releasing](RELEASING.md) describes both. The package ships six skills:

| Skill | Purpose |
| --- | --- |
| `craft-mode` | Hub that scopes a task, picks a workflow, and reports evidence. It routes to the five stage skills below and reports any missing stage as blocked rather than improvising it. |
| `craft-tdd` | Changes behavior test-first, starting from a test that fails for the predicted reason. |
| `craft-refactor` | Improves structure without changing behavior, in small steps from a green baseline. |
| `craft-architecture` | Reviews dependency and policy boundaries from observed edges. Read-only by default. |
| `craft-quality` | Assesses risk from qualified measurements and discloses missing or stale data. Report-only by default. |
| `craft-mutation` | Checks whether tests notice seeded source changes, and verifies that the source is restored. |

The lightweight change, refactor, architecture review, quality audit, and mutation routes are complete. Specification and final QA stage skills are planned but do not ship, so the full feature route is blocked at those stages. No external quality analyzer is supported. The sticky `/craft-mode` command, described below, is new in 0.2.0; 0.1.0 does not have it.

Known limitations:

- **Standalone host children do not receive skills through the host's `skills` argument.** With pi-herdr-agents 3.2.1 the child's actual task request lacks the instructions. Name the skill and reference paths in the task and have the child read them first, as the delegation reference describes. See [compatibility](docs/compatibility.md).
- **No live-model evaluation has been run.** The automated checks cover instruction delivery through tested paths, not model adherence.

## Use

Skills in this pack load only on explicit request. Start with the hub, or call a stage directly for one bounded job:

```text
/skill:craft-mode Fix the parser's empty-input behavior
/skill:craft-tdd Add retry-limit behavior
/skill:craft-refactor Simplify the billing calculation without changing results
/skill:craft-architecture Review domain-to-storage dependencies
/skill:craft-quality Assess the changed files; report only
/skill:craft-mutation Check assertions around the retry policy
```

Loading a skill grants no permission to commit, install, publish, or change settings. A stage skill invoked under another coordinator does its bounded part and returns evidence. It does not start a competing workflow.

### Sticky command

From 0.2.0 the package also registers `/craft-mode`, which keeps the hub in force for the current session branch instead of loading it once:

- `/craft-mode` or `/craft-mode status` reports the saved state, whether the hub resolved, and the ownership rule. It never calls the model.
- `/craft-mode on` and `/craft-mode off` take effect from the next model request. Off stops new additions; it does not remove instructions already in the conversation or stop a running request.
- `/craft-mode <task>` switches the mode on and submits the task once, only when Pi is idle. Use `/craft-mode -- <task>` for a task that starts with `on`, `off`, or `status`. The command reports submission, not that a run started.

While on, each model request gets the hub if the conversation does not already hold your own `/skill:craft-mode` copy, plus a short reminder. Neither is saved in the session. The mode follows tree navigation, forks, clones, reloads, and restarts. A delegated child started by pi-herdr-agents ignores activation copied from its parent until it makes its own decision. The command refuses to enable when the hub is missing, filtered, shadowed, or loaded twice. It cannot see another methodology's state, so with two modes on, the reminder asks the model to have you choose which coordinates. [Compatibility](docs/compatibility.md) lists what was measured and the limits.

## Installation

Once a version is on npm, install it through Pi:

```sh
pi install npm:pi-herdr-clean-craft@0.2.0
```

This registers the skills in your Pi configuration. The `0.0.0-bootstrap` versions on npm reserve the name and contain no skills, so name a version rather than relying on `latest`. The tested path is a local package source: the suites register this checkout, or its packed tarball, by absolute path in test-owned Pi settings, and `pi install /absolute/path/to/pi-herdr-clean-craft` does the same in your own settings. Installation from the npm registry is not exercised by the tests.

`package.json` declares `pi-herdr-agents` 3.2.1 as a peer. That is the exercised candidate, not a validated pairing: the integration gate fails one host check, the `skills` option for standalone children, and usually fails isolation on a later request that follows from it. It also declares Pi's coding-agent SDK as a peer at any version, as Pi asks of packages with extensions; Pi supplies it and nothing is bundled. An npm peer declaration does not activate a Pi extension. Install and configure the host separately through Pi, for example with `pi install npm:pi-herdr-agents@3.2.1`, if you want delegation. The hub's local route does not use it.

## Checks

`npm test` runs the default suite. It needs the Pi CLI, Git, Bash, and Linux `/proc`, but no installed dependencies, Herdr, the host, or pstack. `npm run test:integration` is a separate compatibility check. It is not one of the mandatory release checks and does not veto a release, but run it before a release and report its result as measured. It runs the packed package against a real host and pstack that you name with `CLEAN_CRAFT_HOST_ROOT` and `CLEAN_CRAFT_PSTACK_ROOT`, in a test-owned Herdr server on Linux. A failed run keeps its evidence even when `CLEAN_CRAFT_EVIDENCE_DIR` is unset, and prints where. Either command reports a missing prerequisite as `BLOCKED` and exits nonzero, because a check that could not run has not passed. `npm run check` runs the typecheck, lint, and formatting checks and then `npm test`. It needs the development tools from `npm ci --ignore-scripts`. [Verification](docs/verification.md) explains each command.

## Documentation

- [Compatibility](docs/compatibility.md): what has and has not been exercised.
- [Verification](docs/verification.md): how the tests isolate Pi and what they prove.
- [Provenance](docs/provenance.md): pinned sources and what was, and was not, reused.
- [Releasing](RELEASING.md): the release workflow, its mandatory checks, and the steps before a release.
- [Changelog](CHANGELOG.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

[MIT](LICENSE), for original contributions.
