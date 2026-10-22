# Source provenance

This is an unofficial methodology pack inspired by Robert C. Martin's engineering practices and public projects. It is not affiliated with or endorsed by their authors. The underlying engineering ideas have many contributors.

## Material policy

The pack's instructions are original prose. The selected artifact scope through Phase 2 includes no upstream prompts, source code, articles, analyzers, or acceptance specifications. Attribution records inspiration, not permission to redistribute another project's files.

Phase 2 added five stage skills, their four references, and a test-only TypeScript fixture, all written for this pack. The test-quality and design-principles references restate widely shared engineering ideas as original review questions. The tool-recipes reference names the upstream analyzers below only as unsupported inspirations. It describes none of their commands or behavior. craft-quality states the commonly published CRAP formula as a qualified reference. That is general knowledge in original wording, not text or output taken from crapper or crap4clj, and no tool computed any score for this pack.

Before introducing copied or adapted material, inspect the complete relevant files and license at an exact commit. Record the source path, modifications, license, and required notices. Exclude material with unresolved rights. Public visibility alone is not a redistribution license.

## Pinned upstream inventory

Pins were resolved through the GitHub API on 2026-10-10. A commit identifies a source snapshot, not a tested tool version.

| Source | Commit | Relevant paths | Inspected license evidence | Package decision |
| --- | --- | --- | --- | --- |
| [SwarmForge main](https://github.com/unclebob/swarm-forge/tree/f4f5fbcae0de6f7dcc26e82400334227647cfdb2) | `f4f5fbcae0de6f7dcc26e82400334227647cfdb2` | `README.md`; `swarmforge/constitution/articles/engineering.prompt` | No license-like file name in the root tree | Workflow inspiration only. No copied article or runtime. |
| [SwarmForge two-pack](https://github.com/unclebob/swarm-forge/tree/b75d16062b619e6eab06e03995e344676bc755cd) | `b75d16062b619e6eab06e03995e344676bc755cd` | `README.md` | No license-like file name in the root tree | Original lightweight workflow. No copied prompts. |
| [SwarmForge six-pack](https://github.com/unclebob/swarm-forge/tree/066a62ffa6cbc8c859262536dc579fecf8535ebb) | `066a62ffa6cbc8c859262536dc579fecf8535ebb` | `README.md`; `swarmforge/roles/*.prompt` identified by tree/blob only | No license-like file name in the root tree | Stage-responsibility inspiration only. No copied prompts. |
| [Acceptance Pipeline Specification](https://github.com/unclebob/Acceptance-Pipeline-Specification/tree/accaa33d503340c56513ef387258f8da929ba902) | `accaa33d503340c56513ef387258f8da929ba902` | `README.md` | No license-like file name in the root tree | Excluded from Phases 1 and 2. No adapter or copied specification. |
| [crapper](https://github.com/unclebob/crapper/tree/9f1bead298b5a9d576bdd6319289fcf426e5b18a) | `9f1bead298b5a9d576bdd6319289fcf426e5b18a` | `README.md`; `LICENSE` | Complete root `LICENSE` read. BSD Zero Clause, Robert C. Martin, 2026. | No bundled tool or copied artifact. |
| [mutator](https://github.com/unclebob/mutator/tree/c57f03879a08d2afe8c7e044e86c80bb164afd30) | `c57f03879a08d2afe8c7e044e86c80bb164afd30` | `README.md`; `LICENSE` | Complete root `LICENSE` read. BSD Zero Clause, Robert C. Martin, 2026. | No bundled tool or copied artifact. |
| [dryer](https://github.com/unclebob/dryer/tree/66ff6d21a42c04afcad89c78a80066176d1294b0) | `66ff6d21a42c04afcad89c78a80066176d1294b0` | `README.md`; `LICENSE` | Complete root `LICENSE` read. BSD Zero Clause, Robert C. Martin, 2026. | No bundled tool or copied artifact. |
| [dependency-checker](https://github.com/unclebob/dependency-checker/tree/61097ea222a377b781f003712bc54a73bb8a2d4d) | `61097ea222a377b781f003712bc54a73bb8a2d4d` | `README.md` | No license-like file name in the root tree | No bundled tool. Future review questions must be original. |
| [SCRAP](https://github.com/unclebob/scrap/tree/f793b28906d3c60e30b128e1ec08df6269a72b13) | `f793b28906d3c60e30b128e1ec08df6269a72b13` | `README.md` | No license-like file name in the root tree | No bundled tool or copied text. |
| [crap4clj](https://github.com/unclebob/crap4clj/tree/e90be2e7aa02c2ec5d6544e9cecddc6b73ad3e4d) | `e90be2e7aa02c2ec5d6544e9cecddc6b73ad3e4d` | `SKILL.md` | No license-like file name in the root tree | No copied skill text. |

The license absence observations concern root file names containing `license`, `copying`, or `notice`. They do not establish the absence of permissions elsewhere. No upstream installer or analyzer was executed.

## Inspection depth

The Phase 0 coordinator read all three pinned SwarmForge READMEs and the complete pinned licenses for crapper, mutator, and dryer. The engineering article and six role files were reconciled by tree/blob identity, not re-read as complete text in this run. They remain excluded.

The other README and skill files were identified by blob and headings during reconnaissance. That is not a complete content review. Their earlier research observations remain historical until a later phase reads the relevant pinned files in full. The Phase 2 implementation read no further upstream files. No executable recipe or compatibility claim depends on those observations in Phases 1 or 2.

All recorded upstream blob observations in the original plan were reconciled against the pinned trees. In particular, the shared engineering article blob `d07dd19f783d70e4865baa75e76908ef7819ea9f` is at `swarmforge/constitution/articles/engineering.prompt` in the pinned SwarmForge main commit. A blob identity is not a runnable revision.

## Local API and packaging references

| Source | Candidate snapshot | Use |
| --- | --- | --- |
| Pi | Installed `1.1.0` documentation | Skill frontmatter, package resources, and isolated resource discovery. |
| pi-herdr-agents | `e18fb59b8ba98b8ecf7c011c684f4ce833adf321`, source manifest `3.2.1` | Delegation and worktree contracts. No copied host implementation. |
| pi-herdr-pstack | `135c0fc7514afc1af7560c17f53bf25cf05b18db` | Packaging and coordinator ownership reference. No runtime dependency or copied implementation. |

The pstack root `LICENSE` at the local snapshot is MIT, copyright 2026 HazAT. This record does not use the README's license declaration as a substitute for that file. No pstack material is redistributed by the selected artifact scope.

## Phase 3 test references

The Phase 3 delivery checks and integration gate are original, dependency-free test code using Node builtins. They read the following as behavior contracts. No code, prompt, or test harness was copied from any of them, and nothing from them is packaged.

| Source | Snapshot | What the tests rely on |
| --- | --- | --- |
| Pi documentation | Installed `1.1.0` | RPC framing, commands, dispositions, events, and extension UI records; message types; `models.json` custom endpoints; settings for packages, filters, built-in extensions, retries, compaction, and telemetry; CLI options; skill expansion. The exact expansion format and `@file` placement are measured, not taken from the documentation. |
| pi-herdr-agents | Installed `3.2.1` | The public `subagent` and `subagents_write_task_models` tool schemas, the task-model configuration location and shape, and the launch, session-seeding, and child-completion source, read to choose observable assertions. The gate uses only the public tool through a real parent. No private hook, test harness, or `__test__` export is used. |
| pi-herdr-pstack | Installed `0.3.0` | README command descriptions and the mode, setup, and resource source, read to choose observable assertions for `/setup-pstack report`, `/poteto-mode`, the writer gate, and hub delivery. Its skill names come from its own manifest at run time. |
| Herdr CLI | `0.9.2-preview.2026-09-29-8e78f929d8f0` | `--help` output for `server`, `status`, `session stop`, `workspace create`, `pane process-info`, and `pane current`, and its default configuration keys. |
| Linux `proc(5)` | Kernel `7.2.5` | Process start time, thread `children` lists, `fd` socket links, `environ`, `/proc/net/tcp`, and `/proc/net/unix`. The Phase 3 correction also relies on behavior it measured with throwaway probes: `ENOENT` for a departed process and `EACCES` for a denied read; a zombie's `exe` reads `ENOENT` and its `environ` reads `ESRCH`; a process whose main thread has exited can keep running threads, which the gate reads through `task/<tid>`; and a client socket that no process holds shows inode 0. The third correction relies on row shapes it measured the same way: every `/proc/net/tcp` row ends with a newline, a live socket's row has 17 fields, and a `TIME_WAIT` row has 12 fields with inode 0. A `/proc/net/unix` row has 7 fields when unnamed, and a bound path follows the inode after one space and may itself contain spaces. |
| Node.js runtime | `26.8.2` | Child-process event order measured by throwaway probes: a spawn failure emits `error` and then `close`, a signal sent after exit returns `false`, and `close` waits for every output stream. The third correction also measured that a child's output stream emits `end` before the child's `close`, and that bytes written without a final newline arrive before `end`. HTTP server `clientError`, request `complete`, and response `writableFinished`. Tests use `module.syncBuiltinESMExports` to inject failures at individual `fs` reads. No code was copied. |

Three throwaway probes outside the package measured the Herdr isolation, Pi delivery, and single host-chain shapes before this code was written. Their scripts were not reused.

## Sticky command design references

The optional `/craft-mode` command is under development. Its design uses the following behavior and API references. New implementation, tests, and instructions must be original; no pstack code or prompt text is copied.

| Source | Snapshot | Reference use |
| --- | --- | --- |
| pi-herdr-pstack | `135c0fc7514afc1af7560c17f53bf25cf05b18db`, installed `0.3.0` | `pi-extension/pstack/mode.ts`, `resources.ts`, and their callers and tests inform the command and lifecycle requirements. They are behavior references, not implementation templates. |
| Pi documentation and SDK declarations | Installed Pi `1.1.0`; coding-agent SDK `1.1.0` in the host checkout | Extension events, command contexts, branch entries, effective session projections, resource identity, RPC commands, and compaction. Grounding also traced the SDK's prompt preparation and custom-message paths. These observations still need real-Pi verification for the new command. |
| pi-herdr-agents | Source `9d4c956af1885af4e2e8ab20368d6445779cf96c`, package `3.2.1` | Launch environment, forked-session seeding, and completion delivery establish the child-ownership and automatic-wake cases. `PI_SUBAGENT_ID` is a host hint, not a Pi API or security boundary. |

The extension in `pi-extension/clean-craft/`, its reminder text, and its tests are original. The skill envelope it reproduces is Pi 1.1.0's own `/skill:` expansion format, read from the SDK, so the hub it adds matches what a user load produces. The child-session seeding in the tests follows the host's fork-mode file shape as observed, without its code. A throwaway real-Pi probe measured the delivery hook, wake path, and command behavior first; its scripts were not reused, and the tests build on the existing Phase 3 harness instead.

## Release infrastructure references

The release workflow, its helper scripts under `scripts/release/`, and the release tests are original code using Node builtins, Git, and Bash. They follow the release sequence of pi-herdr-pstack, read as a behavior contract. No workflow text, script, test, or guide prose was copied, and none of these files is packaged. The workflow and scripts stay out of the tarball.

| Source | Snapshot | Files read in full | What this pack relies on |
| --- | --- | --- | --- |
| pi-herdr-pstack, MIT, copyright 2026 HazAT | `135c0fc7514afc1af7560c17f53bf25cf05b18db` | `.github/workflows/publish.yml`, `RELEASING.md`, `package.json`, `.npmrc`, `test/release-workflow.test.ts`, and the `auto-changelog` entries of `package-lock.json`. The head of `CHANGELOG.md` was read for its format only. | The job split into a read-only detect job and a release job. The order publish, then tag, then GitHub Release. Same-commit retry by npm `gitHead`. A temporary bootstrap token for a package that does not exist, and OIDC otherwise. The `auto-changelog` range `^2.6.0`, which that lockfile resolves to `2.7.0`, and its `changelog` and `version` scripts and settings. The checkout and setup-node commit pins `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` and `a0853c24544627f65ddf259abe73b1d18a591444`. CLI names, flags, and action inputs are used as facts. |
| npm documentation, [trusted publishers](https://docs.npmjs.com/trusted-publishers/) | Fetched 2026-10-10 | Whole page | Trusted publishing needs npm 11.5.1 or later and Node 22.14.0 or later, `id-token: write`, and a cloud-hosted runner; self-hosted runners are not supported. Provenance is not generated from a private repository. |
| npm documentation, [generating provenance statements](https://docs.npmjs.com/generating-provenance-statements/) | Fetched 2026-10-10 | Whole page | `--provenance` needs a supported cloud provider and cloud-hosted runner, and `package.json` must name a public repository that matches the publishing one. |
| GitHub Actions [default variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables) | Fetched 2026-10-12 | The `GITHUB_RUN_ATTEMPT` entry | The counter starts at 1 for a workflow run and increases with each rerun. The bootstrap job runs only on attempt 1. |
| GitHub Actions [workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) | Fetched 2026-10-12 | The push-event payload note | Actions omits the commit's added, removed, and modified file lists. The bootstrap job reads Git history instead. |
| pi-herdr-pstack, MIT, copyright 2026 HazAT | `135c0fc7514afc1af7560c17f53bf25cf05b18db` | `biome.json`, `.oxlintrc.json`, `tsconfig.json`, and the `scripts` and `devDependencies` of `package.json`, read with the release files above. | The mandatory release checks and their order: install, `format:check`, `lint`, a `check` script that chains typecheck, lint, format check, and tests, then the package preview. Biome 2.5.11 as a formatter only, oxlint with its correctness category as errors, and TypeScript 5.9.3. This pack's `biome.json` and `.oxlintrc.json` are written for its own files: they exclude the fixture data, set a line width that matches the existing code, and typecheck only the retry fixture's own `tsconfig.json`. No configuration text was copied beyond the tools' documented option names. |
| Pi, [v1.1.0 release](https://github.com/earendil-works/pi/releases/tag/v1.1.0), MIT | Asset `pi-linux-x64.tar.gz`, read 2026-10-12 | The release's asset list and published digest | The release job downloads `https://github.com/earendil-works/pi/releases/download/v1.1.0/pi-linux-x64.tar.gz` and requires archive SHA-256 `3faa94666cd3849d37af320ff749407d0271b07a9b94f420c87e30866e10e289`, the digest the release publishes, and `pi/pi` SHA-256 `5d527eae57d99f80f9397a84d0228528a92b3595b2c5f3d969e45b02ea72a6bc`. The maintainer's downloaded archive matched the published digest, and its `pi/pi` was byte-identical to the Pi 1.1.0 binary the suites were measured with. Nothing from the archive is redistributed. |
| GitHub CLI, local `gh release create --help` | `gh` 2.102.0 | The `--verify-tag` entry | `--verify-tag` aborts only when the tag does not exist on the remote. It does not check which commit the tag names, so the release script reads the tag's commit itself. |

This pack departs from the reference on purpose in a few places. It pins Node 26.12.1, the October 2026 security release of the 26.8.2 line its suites were first measured on, instead of the reference's 26.3.0. It pins Node in the detect job too. It refuses a malformed current version instead of skipping it. It reads the remote tag's commit before publishing, again after publishing, and again after its own push, and refuses before the GitHub Release if the tag moved or disappeared. It refuses a bootstrap token on an exact retry. It checks repository visibility and the runner type before any mutation. It installs with `--ignore-scripts` and previews the package with `--ignore-scripts`. And because its default suite needs a real Pi CLI, it downloads the pinned and verified Pi 1.1.0 build before the check step, which the reference does not need.
