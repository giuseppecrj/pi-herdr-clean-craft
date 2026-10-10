# Compatibility

This page separates executed tests and local CLI checks from documentation inspection. Nothing here is a supported-version promise.

## Candidate environment

Observed on 2026-10-10.

| Component | Version | Evidence |
| --- | --- | --- |
| Pi CLI | 1.1.0 | Exercised. The discovery tests start this binary in RPC mode and read its command list. |
| Node | 26.8.2 | Runs the test suite, including the retry fixture's TypeScript through built-in type stripping, synchronous module hooks, and programmatic `node:test` runs in one process. Not a minimum-version test. |
| TypeScript compiler | None on `PATH` | Not used. The fixture TypeScript is executed but not compiled or type-checked by any test. |
| npm | 11.19.1 | Produces the package file list and tarball used by the tests. |
| pi-herdr-agents | 3.2.1 | Inspected only. Declared as a peer because it is the candidate host. No test launches it. |
| pi-herdr-pstack | 0.3.0 | Inspected as a packaging reference. Coexistence has not been tested. |

## Exercised

- Pi 1.1.0 discovers all six skills, `skill:craft-mode`, `skill:craft-tdd`, `skill:craft-refactor`, `skill:craft-architecture`, `skill:craft-quality`, and `skill:craft-mutation`, from a package registered by absolute path in isolated settings, reporting the expected `SKILL.md` path, package origin, and base directory for each.
- The same discovery succeeds from the contents of the packed npm tarball.
- On Node 26.8.2 the retry fixture executes its TypeScript sources, records runtime import edges and loaded source hashes through `module.registerHooks`, and runs its tests with `node:test` `run()` in a single worker process. These features were exercised on this version only.
- During Phase 2 development, an editor TypeScript language server reported no diagnostics for the nine fixture `.ts` files, using the fixture's own `tsconfig.json`. A planted type error and unresolved import were reported, so the probe was live. This is development evidence, not a test the suite runs.
- A Phase 1 coordinator check ran `pi install <checkout> --no-approve` in two fresh temporary environments, then discovered the skill through RPC. Saved relative paths resolved from the temporary agent directory. The operator's Pi and Herdr settings hashes were unchanged during these checks. This exercised local-source registration, not registry or dependency installation.
- The package file list matches the manifest allowlist, and every bundled reference resolves.

## Not yet measured

- Delivery of the full skill instructions on an actual model request after any `/skill:craft-*` command.
- Any upstream quality or mutation analyzer, including crapper, mutator, dryer, dependency-checker, and SCRAP. None is supported or executed.
- Type checking of the fixture by a compiler.
- Resource resolution in fresh children launched by pi-herdr-agents, including standalone versus forked prompt delivery.
- Installation alongside pi-herdr-pstack.
- Whether a live model follows the methodology.
- Other Pi, Node, npm, or host versions.

[Verification](verification.md) describes how each exercised check runs.
