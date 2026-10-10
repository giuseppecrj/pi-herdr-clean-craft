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
