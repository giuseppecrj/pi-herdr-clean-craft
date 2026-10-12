# Compatibility

This page separates executed tests and local CLI checks from documentation inspection. Nothing here is a supported-version promise.

## Candidate environment

Observed on 2026-10-10. The TypeScript, Biome, and oxlint rows were observed on 2026-10-12.

| Component | Version | Evidence |
| --- | --- | --- |
| Pi CLI | 1.1.0 | Exercised. The default suite starts this binary in RPC mode for discovery and request delivery. The integration gate also runs it as a parent and as host-launched children. |
| Node | 26.8.2 | Runs both suites, including the retry fixture's TypeScript through built-in type stripping, synchronous module hooks, and programmatic `node:test` runs in one process. Not a minimum-version test. |
| TypeScript compiler | 5.9.3 | Development tool only. `npm run typecheck` checks the retry fixture's TypeScript and the `/craft-mode` extension against their strict configurations with no diagnostics. The suites execute the fixture through Node's type stripping, and Pi loads the extension source directly. |
| Pi coding-agent SDK declarations | 1.1.0 | Development types only, with `@types/node` 26.6.5. The package declares the SDK as a peer at any version and bundles nothing; Pi supplies it at runtime. The `/craft-mode` cases also run from the extracted tarball, which has no dependencies installed. |
| Biome | 2.5.11 | Development tool only. `npm run format:check` reports the extension, scripts, and tests formatted. |
| oxlint | 1.80.0 | Development tool only. `npm run lint` reports no correctness findings in the extension, scripts, and tests. |
| npm | 11.19.1 | Produces the package file list and tarball used by the tests. Installed the development dependencies from the lockfile with `npm ci --ignore-scripts`. |
| Git | 2.55.0 | Runs the release tests' fixture repositories and local remotes. |
| Bash | 5.3.15 | Runs the workflow's `run` lines in the release walk test. |
| auto-changelog | 2.7.0 | Development tool only, not a runtime or install dependency of the package. Generated `CHANGELOG.md` and ran as the `version` hook in a disposable fixture. Locked from the `^2.6.0` range. |
| pi-herdr-agents | 3.2.1 | Exercised by the integration gate from a local package directory. One distinction fails against it, and isolation usually fails on a request that follows from that failure; see below. |
| pi-herdr-pstack | 0.3.0 | Exercised by the integration gate from a local package directory, with its extension active. The version is recorded, not pinned. |
| Herdr | 0.9.2-preview.2026-09-29-8e78f929d8f0, protocol 22 | Exercised by the integration gate as a test-owned named server. A preview build. |
| Linux kernel | 7.2.5 | Provides the `/proc` process and socket attribution that the gate and the default suite's harness lifecycle checks require. Other platforms are blocked, not supported. |

## Exercised

- Pi 1.1.0 discovers all six skills from a package registered by absolute path in isolated settings: `skill:craft-mode`, `skill:craft-tdd`, `skill:craft-refactor`, `skill:craft-architecture`, `skill:craft-quality`, and `skill:craft-mutation`. It reports the expected `SKILL.md` path, package origin, and base directory for each, from the checkout and from the packed tarball.
- For each of those skills, from the checkout and from the extracted tarball, Pi 1.1.0 sends the complete instruction body and the separate task argument on the request a loopback model endpoint actually receives. The body is the file without its frontmatter, trimmed. It arrives inside a `<skill>` block that names the skill's location and reference base.
- On Node 26.8.2 the retry fixture executes its TypeScript sources, records runtime import edges and loaded source hashes through `module.registerHooks`, and runs its tests with `node:test` `run()` in a single worker process. These features were exercised on this version only.
- During Phase 2 development, an editor TypeScript language server reported no diagnostics for the nine fixture `.ts` files, using the fixture's own `tsconfig.json`. A planted type error and an unresolved import were reported, so the probe was live. This is development evidence, not a test the suite runs.
- A Phase 1 coordinator check ran `pi install <checkout> --no-approve` in two fresh temporary environments, then discovered the skill through RPC. Saved relative paths resolved from the temporary agent directory. The operator's Pi and Herdr settings hashes were unchanged during these checks. This exercised local-source registration, not registry or dependency installation.
- The package file list matches the manifest allowlist, and every bundled reference resolves.

## `/craft-mode` command

Version 0.2.0 adds an optional `/craft-mode` command; 0.1.0 ships the six skills only. Measured on 2026-10-12 with Pi 1.1.0, a scripted loopback model, and test-owned sessions; see [Verification](verification.md). This is request-level evidence, not model behavior.

Exercised:

- `/craft-mode`, `status`, `on`, `off`, invalid forms, and repeated intents never call the model. On and off take effect from the next model request, including between tool turns of a running request, and do not retract a request already sent.
- While on, each task request carries the hub when the effective context lacks the user's own `/skill:craft-mode` expansion, plus one reminder of at most 600 characters, after the conversation. Nothing the command adds is saved in the session. User-loaded copies are never removed or deduplicated. An assistant reply or tool result that quotes the hub does not count as delivery.
- A simulated completion wake, sent with `sendMessage` from a test extension, bypasses `before_agent_start` and still receives the guidance, as does its tool continuation. The pi-herdr-agents completion path itself was not exercised.
- After manual compaction the hub is supplied again only when the user's copy was evicted. Automatic compaction between tool turns of one run evicts it and the next request in the run carries it. Compaction summary requests carry no guidance.
- Activation follows the active branch through restart, reload, tree navigation, fork, clone, and a new session. A human fork or clone inherits it.
- In a child seeded the way pi-herdr-agents 3.2.1 seeds fork-mode children, with `PI_SUBAGENT_ID` set, the copied parent record is present but ignored. The child's own on and off work and survive a resume with the same hint.
- A missing, filtered, shadowed, non-explicit, unreadable, or linked-from-elsewhere hub blocks `on` and tasks. A record that is already on then gets a short notice instead of the hub. A future or malformed activation record blocks guidance rather than reviving an earlier one, until an explicit on or off.
- With two copies of the package loaded, Pi registers `craft-mode:1` and `craft-mode:2`. Both refuse on and tasks, neither adds guidance, and bare `/craft-mode` input is stopped with an error instead of reaching the model.
- Foreign system prompt changes, persisted messages, and context additions are kept, beside a second test mode with its own reminder; each mode switches off independently. An optional run, outside `npm test`, did the same beside pi-herdr-pstack 0.3.0's `/poteto-mode`, loaded read-only from its installed directory.

Limits:

- `PI_SUBAGENT_ID` is a host hint, not a security boundary. A child session resumed without it treats copied parent activation like a human fork does.
- A task is reported as submitted, not as started. The activation record is written before the task is handed to Pi, so an input handler that swallows the task, a later preparation failure, or a crash between the two leaves the mode on without a run. The task is never resent.
- Off stops future additions only. Instructions already in the conversation stay, and a running request is not cancelled.
- The command cannot read another methodology's activation. Status names other loaded `*-mode` commands, and the reminder asks the model to have the user choose which mode coordinates. Nothing enforces an exclusive mode.
- Guidance is added in Pi's non-system `context` stage. In the measured runs, test extensions loaded with `-e` ran before the package's extension; a handler that runs after it and removes the hub cannot be detected.
- Pi 1.1.0 still lists and expands `/skill:craft-mode` with `enableSkillCommands: false`, so that setting is not treated as a filter. A package `skills` filter is.
- Completion wakes run without `before_agent_start`, so other extensions' system prompt changes are absent from those requests. That is Pi behavior, not something this command repairs.
- Token, cache, and cost effects of the per-request reminder, parallel tool calls, and live-model adherence were not measured.

## Host integration gate, measured 2026-10-12

With the `/craft-mode` candidate packed and active, the gate ran against pi-herdr-agents 3.2.1 and pi-herdr-pstack 0.3.0 from their installed directories: 12 distinctions passed, and the known upstream skills-argument failure and the late-request isolation failure remained. Discovery passed with the candidate's single extension command. The baseline commit, run the same day through the same gate, gave the same result. The 2026-10-10 details below still apply.

## Host integration gate, measured 2026-10-10

These results come from the deterministic integration gate, run with the components listed above and a scripted model. They establish delivery, orchestration, and ownership plumbing, not model behavior. Fresh cross-family review found no remaining defects in the targeted harness corrections. The parent repeated the regression checks and both suites. The gate still has not passed.

Passed:

- **Ownership.** With host, pstack, and the packed candidate active together, command ownership is distinct. The six `craft-*` skills come only from the candidate, and no command name repeats. At this date the candidate had no extension command.
- **Standalone and fork.** A bare `systemPrompt` with `fork: false` reaches the host child's first task request in full, before the task. With `fork: true`, the new forked task omits the supplied role, while inherited history keeps earlier launch arguments.
- **Fresh-child reads.** A fresh host child read the packaged craft-mode skill, its delegation reference, and the craft-tdd sibling through the read tool, and received their exact contents.
- **Completion and handoff.** Child results reached the parent only as real host `subagent_result` messages. A dependent child received the value the parent accepted from its predecessor.
- **Resource controls.** A package filter hides a skill's registration but not its file. An agent-directory skill and a same-named decoy package both win registration and are identifiable by location. Unknown slash text reaches the model as raw text. A host with its extension disabled declares no `subagent` tool.
- **pstack coexistence.** `/setup-pstack report` stays report-only on test-owned configuration. `/poteto-mode` on, status, and off behave as documented, and the craft-tdd instructions stay complete beside pstack's mode guidance. pstack refuses a direct `subagents_write_task_models` call without a dialog or a write.
- **Teardown.** Every recorded process identity was confirmed gone, none was uncertain, and no owned socket remained.

Failed, upstream:

- **The host's `skills` argument does not deliver the skill with the task for standalone children.** The host launches the child with an empty first prompt, then `/skill:craft-mode`, then `@<task artifact>`. Pi attaches the artifact to the first prompt, so the child's actual task request carries the role and task but not the craft-mode instructions. The result the host delivers to the parent is the one created for that task request. A later request on the connection proven for that child carries the craft-mode block. The gate records model requests and host messages in separate streams, so it does not show whether that later request comes before or after the host's completion. Until this changes, do not rely on the host's `skills` argument to give a standalone child its instructions. Name the skill and reference paths in the task and have the child read them first, as the delegation reference says for this pair. Fork-mode skill loading was not exercised.

Usually failed, attribution of that later request:

- **Isolation depends on when the later skills request arrives, and it usually fails.** The request is sent while the child process is exiting. In most runs its main thread had already exited, and its remaining threads were releasing their memory and descriptors. At that moment `/proc` shows neither a live process whose executable and environment can be read again, nor a sender that is confirmed gone with its socket closed. The endpoint therefore refuses the request, and isolation fails. In the remaining run the request arrived while a thread could still be read, every recorded check passed again, and isolation passed. After the final local corrections, implementation runs and independent parent runs failed attribution of that later request. The parent exercised both requested and default evidence retention. In one parent run the sender was still running but no owned holder of its socket was found. The request remained unattributed rather than inheriting an earlier proof. Every other request in these runs was attributed. An earlier version of the harness passed isolation by treating unreadable state as absence. Its results are not evidence of isolation.

## Not yet measured

- Any upstream quality or mutation analyzer, including crapper, mutator, dryer, dependency-checker, and SCRAP. None is supported or executed.
- Host cancellation, worktrees, parallel writers, persistent children, and failure-result delivery.
- pstack's setup change and init flows, and which commands a child session lists.
- Whether a live model follows the methodology, honors a delegated role, or avoids starting a competing coordinator.
- Other Pi, Node, npm, Herdr, host, or pstack versions, and platforms other than Linux.
- The release job on GitHub Actions. Its scripts, step order, and fail-fast mandatory checks are tested locally. As of 2026-10-12 it had not run on a hosted runner, so neither the hosted Pi download nor the hosted checks had been exercised, and no skills version, tag, or GitHub Release existed. This page does not record a later run; check the workflow and the registry. The metadata-only bootstrap job did run there and verified OIDC trusted publishing and provenance for metadata only; see [Releasing](../RELEASING.md).
- Installing a published version with `pi install npm:pi-herdr-clean-craft@<version>`. The tests register only a local checkout or extracted tarball.

[Verification](verification.md) describes how each exercised check runs.
