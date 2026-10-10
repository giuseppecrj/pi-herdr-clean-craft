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
| Skill contract | Each shipped skill has portable single-line frontmatter, a string name matching its directory, a unique name, a non-empty string description, explicit-only invocation set to the boolean `true`, and local links that resolve to files inside its skill directory. Small fixtures show the checks reject a missing reference, unclosed frontmatter, and a mismatched name. Generated cases show they reject descriptions YAML reads as null, booleans, or numbers, a numeric name, a blank description, and quoted invocation values, while accepting the same words quoted as strings. Padded and whitespace-only values are typed the same way after trimming. | That the instructions are good, or that the checker accepts every form of YAML Pi accepts. |
| Package contents | `npm pack --dry-run --json --ignore-scripts` lists exactly the inventory, its references, and the packaged documents, and nothing from plans, contributor files, tests, fixtures, local settings, or evidence. A test-owned candidate shows that packing ignores a project `.npmrc` and keeps erroneously allowlisted plans, tests, and evidence visible to the inventory check. | Registry behavior. No registry request is made. |
| Pi discovery | Pi 1.1.0 in RPC mode returns `skill:craft-mode` from `get_commands` with the expected path and package metadata, both from the checkout and from an extracted tarball. | That a model receives or follows the instructions. |

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
