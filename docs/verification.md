# Verification

Run the whole suite from the package root:

```sh
npm test
```

It uses only Node's built-in test runner and needs no installed dependencies. The Pi CLI must be on `PATH`, or named by `CLEAN_CRAFT_PI_BIN`. Without it the discovery tests fail with a `BLOCKED` message. They are required checks and never pass by skipping.

## What each check proves

| Check | Proves | Does not prove |
| --- | --- | --- |
| Manifest | Name, private pre-release version, MIT license, `pi-package` keyword, a skills-only `pi` key, the single peer, no other dependencies, and no install or lifecycle scripts. | That the peer version works with this pack. |
| Skill contract | Each shipped skill has portable single-line frontmatter, a string name matching its directory, a unique name, a non-empty string description, explicit-only invocation set to the boolean `true`, local links that resolve to files inside its skill directory, and exactly its declared sibling skill links. The hub links every shipped stage, and no stage links back to the hub or to an unshipped skill. Small fixtures show the checks reject a missing reference, unclosed frontmatter, and a mismatched name. Generated cases show they reject descriptions YAML reads as null, booleans, or numbers, a numeric name, a blank description, and quoted invocation values, while accepting the same words quoted as strings. Padded and whitespace-only values are typed the same way after trimming. Generated link cases show sibling links are recorded apart from owned references, and that missing, internal, escaping, and symlinked sibling targets are rejected. | That the instructions are good, that a model follows a link, or that the checker accepts every form of YAML Pi accepts. |
| Package contents | `npm pack --dry-run --json --ignore-scripts` lists exactly the inventory, its references, and the packaged documents, and nothing from plans, contributor files, tests, fixtures, local settings, or evidence. A test-owned candidate shows that packing ignores a project `.npmrc` and keeps erroneously allowlisted plans, tests, and evidence visible to the inventory check. Every skill in the extracted tarball resolves the same owned references and sibling skills as in the source, and a candidate whose allowlist omits a linked sibling fails that check. | Registry behavior. No registry request is made. |
| Pi discovery | Pi 1.1.0 in RPC mode returns exactly the six `skill:craft-*` commands from `get_commands`, each with the expected path and package metadata, both from the checkout and from an extracted tarball. | That a model receives or follows the instructions. |
| Retry fixture | On Node 26.8.2, a small TypeScript fixture shows a named assertion failing before a fix and passing after it, a load failure that is not counted as red, two structurally different implementations passing the same literal cases, a forbidden runtime import found by file and edge, and one seeded mutant that survives weak assertions but is killed by a named boundary assertion. The source is restored and verified after normal completion, a worker error, and a controlled worker interruption. | That any upstream analyzer or mutation tool works, that the skills are followed by a model, or behavior on other Node versions. |

## Sibling links

A skill may link another shipped skill only at `../<name>/SKILL.md`, relative to the skills directory that holds both. That records a sibling dependency, not a file the linking skill owns. The checker does not follow the sibling's own links, because the sibling is checked on its own. Owned references remain the only input to the package allowlist. The checker rejects a link to a missing sibling, to any other file or directory inside a sibling, to anything outside the skills directory, and to a sibling whose real path, after symlinks, lies outside it. The same check runs against the source tree and the extracted tarball.

## Retry fixture

`test/fixtures/retry-eligibility` is test-only and never packed. It holds one small retry-eligibility program: a domain function that decides retry or stop from a transient or permanent failure and the attempt count, an adapter that maps error codes and calls it, a constant-only infrastructure module, and literal behavior cases. The cases include NaN attempt counts and maximums, which the domain's `number` type admits, so a refactor must preserve the base comparison's handling of them. `base/` is the correct program. Each directory under `variants/` replaces whole source files with a complete alternative: a behavior defect, a renamed export that fails to load, a structurally different correct implementation, and a domain module that imports infrastructure. `mutants/boundary` replaces one file and differs from the base by exactly one line. The main behavior, refactor, dependency, and boundary-mutant states are checked-in whole-file snapshots. Negative controls derive malformed or throwing mutants in test-owned copies. The loader rejects any mutant that changes zero or several lines, changes the line count, replaces several files, or targets a file outside the base `src/` tree.

Each test writes its state into its own temporary directory. A worker process, started with the test-owned environment, preloads every source module under Node's synchronous module hooks. It then reports the hash of each loaded source file, the import edges it resolved, and any module that failed to evaluate, and waits. On receipt of that record, the parent tells it to run the fixture tests through `node:test` in the same process, tells it to fail, or kills it. The hash is taken from the bytes before evaluation, so a matching hash alone shows only that the mutated file was read. After worker closure, the test accepts the checkpoint as evidence that a state loaded only when the expected hash is present and no module failed to evaluate. A negative control interrupts a mutant whose first line throws and shows that the evidence gate refuses the checkpoint despite a matching hash. The worker never writes to the workspace, and the parent writes all files. Red and killed results require a named test that failed with a Node `AssertionError`. A load failure, a worker error, and a nonzero exit status are recorded as such and never count as red or killed.

The mutation trial checks for a green baseline and confirms the target still matches the base before writing the mutant. After the worker closes, the parent restores the file from the in-memory snapshot, compares the whole workspace with the snapshot byte for byte, and runs the unmutated tests again. A workspace that does not match is kept and its path reported instead of being deleted. Negative controls cover a red baseline, a drifted target, a stray file, and malformed mutants. Worker deadlines are explicit, but no test exercises a timeout, and nothing here recovers from the death of the test process itself.

The import edges come from runtime resolution. Type-only imports, which Node erases, and imports on paths that never execute do not appear, so the fixture's boundary check does not measure them. The fixture TypeScript runs through Node's built-in type stripping, which does not type-check. Type checking during development used an editor language server, which no test runs.

## Frontmatter grammar

The skill checker reads a deliberately small subset of YAML: one `key: value` pair per line, with each value either plain or double-quoted without escapes. Spaces and tabs around a value are ignored, while spaces inside double quotes are kept. Plain values resolve the way Pi's YAML 1.2 core-schema parser reads them, so `null`, `~`, an empty or whitespace-only value, `true`, `False`, `123`, `0x1F`, and `.inf` are not strings. Names and descriptions must be strings, so quote any that would otherwise read as another type. `disable-model-invocation` must be an unquoted boolean. Pi treats only the boolean `true` as explicit-only, and a quoted `"true"` is a string.

## Isolation

Each Pi or npm process runs with a test-owned temporary home, agent directory, XDG directories, working directory, npm cache, and empty npm configuration. The environment is built from an allowlist that carries no credentials. Pi runs offline with telemetry and version checks disabled, no extensions, context files, tools, prompt templates, or themes, no session file, and no project trust. The only package source in its settings is the path under test. Every process has an explicit timeout, and the temporary directories are removed afterwards.

npm reads project configuration from the package root's `.npmrc`, and empty user and global configuration do not prevent that. Therefore npm never runs in the checkout. The tests pack a staged copy inside a test-owned directory. The copy is faithful except for three exclusions. It omits `.npmrc` and `.git` at any depth, because npm never packs either. It also omits the root `node_modules`, because npm packs it only for bundled dependencies, which the manifest check forbids. Plans, tests, fixtures, `.audit`, and nested `node_modules` stay in the copy, so an allowlist that wrongly includes them still fails the exact inventory check. If the temporary directory sits inside the checkout, staging skips it rather than copying it into itself. A regression packs a test-owned candidate whose `.npmrc` redirects npm's logs to a sibling directory. It checks that the redirect target is never created, that npm's log lands in the test-owned cache, and that the extracted tarball holds exactly the allowlisted files with unchanged contents.

This registers the package only in temporary settings. It does not install anything into your own Pi configuration.

## Later gates

The suite lists these as todo items. They are not measured and must not be read as passing:

- Explicit skill invocation delivering the complete instructions on a model request.
- Fresh children launched through pi-herdr-agents resolving the skill.
- Live-model adherence to the methodology.
