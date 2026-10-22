# Releasing

This page describes how the release workflow decides, checks, and publishes a version, and what to do before a release. A separate local bootstrap reserved the npm name, and a metadata-only bootstrap verified OIDC trusted publishing and provenance; both are recorded below as dated history.

## Release scope

The first stable version, 0.1.0, ships six explicit-only skills: the craft-mode hub and the craft-tdd, craft-refactor, craft-architecture, craft-quality, and craft-mutation stages. Specification and final QA stage skills are planned and do not ship. Version 0.2.0 adds the optional `/craft-mode` extension command, which keeps the hub in force for a session branch; [compatibility](docs/compatibility.md) lists what was measured and its limits. Two limitations are known: the host's `skills` argument does not deliver a skill to a standalone child, so the child must read the named skill files itself, and no live-model evaluation of the methodology has been run. The [README](README.md) describes both.

## Mandatory checks

A candidate must pass the same mandatory automated checks that pi-herdr-pstack's release job runs, in this order, and any failure stops the job before publication:

1. `npm ci --ignore-scripts`
2. `npm run format:check`, Biome's formatter over `pi-extension`, `scripts`, and `test`, excluding the fixture data under `test/fixtures`.
3. `npm run lint`, oxlint's correctness rules over the same files.
4. `npm run check`, which runs `npm run typecheck` (TypeScript over the retry-eligibility fixture's strict `tsconfig.json` and over the `/craft-mode` extension against the Pi SDK 1.1.0 declarations), `npm run lint`, `npm run format:check`, and `npm test`, stopping at the first failure. Before this step the job downloads the official Pi 1.1.0 Linux x64 build to the runner's temporary directory, checks the archive's SHA-256 before extracting it and the `pi/pi` binary's SHA-256 after, and passes that binary to the default suite through `CLEAN_CRAFT_PI_BIN`. It installs nothing else. Without a verified Pi, the suite's Pi tests still report `BLOCKED` and fail.
5. `npm pack --dry-run --ignore-scripts`

These are automated checks of the package and its deterministic suite. They are not host evidence. The host integration check, `npm run test:integration`, is a separate compatibility check and is not part of the release job, as pstack's own host checks are not part of its CI. Its result does not veto a release. It needs Herdr, pi-herdr-agents, and pi-herdr-pstack, and still fails against pi-herdr-agents 3.2.1: the host's `skills` argument does not deliver the skill with a standalone child's task, and isolation of the later request that follows from it usually fails. The workaround is to name the skill and reference paths in the child's task and have the child read them first. Run the check locally before a release and report its result as measured. A passing hosted job does not mean it passed. No supported host combination has passed it, and no live-model evaluation of the methodology has been run. See [compatibility](docs/compatibility.md) and [verification](docs/verification.md).

## How the workflow decides

The workflow is `.github/workflows/publish.yml`. It runs when a push to `main` changes `package.json` or `.github/npm-bootstrap/package.json`, and on manual dispatch. Runs share one concurrency group and never cancel each other.

A read-only detect job reads `package.json` and, for a push, the previous commit's `package.json`:

| Situation | Result |
| --- | --- |
| Event other than push or dispatch, or any ref other than `main` | Refused, the run fails |
| `private` is `true` | No release |
| Public prerelease version | No release |
| First push of the branch, or the previous `package.json` cannot be read | No release |
| Same public version as before | No release |
| Same stable version, with `private` removed | Candidate |
| Higher stable version, or the core version after its prerelease | Candidate |
| Lower version, malformed version, or another package name | Refused |
| Dispatch from `main` of a public stable version | Candidate |

Versions are compared by SemVer precedence on exact integers. Every value passed to the release job is checked against a narrow pattern first.

The release job then runs these steps, and any failure stops the rest:

1. Confirm the candidate again: `main`, the detected commit checked out, the manifest's name and version, public access, repository metadata that names `giuseppecrj/pi-herdr-clean-craft`, a public repository, and a GitHub-hosted runner. npm provenance needs all of these.
2. Read the npm registry. The package is absent only when npm answers HTTP 404 with exactly `{"error":"Not found"}`, allowing only JSON whitespace between its tokens. The body is matched as text, so a repeated key, which a JSON parser would collapse to its last value, is refused. A redirect, a timeout, an authentication error, an unexpected body, or any other failure stops the run. If this version already exists, it must have been published from this commit, which makes the run an exact retry. A version published from another commit, or without a recorded commit, stops the run before any tag or release.
3. Run the mandatory checks listed above, for every registry state, including an exact retry. None of them is optional.
4. Publish, tag, and create the GitHub Release, in that order.

## Publishing, tagging, and the GitHub Release

The last step decides the npm credential and reads the existing tag and release before its first change:

- If the package does not exist on npm, the repository secret `NPM_TOKEN` must be set. It is used once to create the package.
- If the package exists, `NPM_TOKEN` must not be set, including on an exact retry. Publishing uses OIDC trusted publishing with no token, and needs npm 11.5.1 or later and Node 22.14.0 or later. The pinned Node 26.12.1 provides both.
- A tag `vX.Y.Z` that already exists must point at this commit, locally and on GitHub. Tags are never moved or force-pushed.
- An existing GitHub Release for the tag is reused unchanged. A draft release, or a release without its tag, stops the run.

Then it publishes with `npm publish --access public --provenance --ignore-scripts`, unless this is an exact retry. After publishing, it reads the remote tag again. If the tag now names another commit, or was there before and is now gone, the step stops before the GitHub Release and changes nothing. If the tag is absent, it creates an annotated tag on the commit and pushes it, then reads the remote tag once more. It creates the GitHub Release with generated notes and a link to the npm version, or reuses the existing release, only when that last read names this commit. `gh release create --verify-tag` checks only that the tag exists, and Git offers no way to lock a remote tag, so a tag moved after that last read is not detected. That gap is short but not closed. Each command runs once. When one fails, the step stops without retrying it, and the next run re-reads npm, the tag, and the release and continues only from a state it recognizes. The npm token and the GitHub token are each passed only to the commands that need them.

## Versions and the changelog

[CHANGELOG.md](CHANGELOG.md) is generated by `auto-changelog`, a development dependency that is not part of the package. Install it with `npm ci --ignore-scripts`. The project `.npmrc` sets `legacy-peer-deps=true`, so a development install never pulls the pi-herdr-agents peer from npm. `auto-changelog` builds its commit links from the URL of the Git remote `origin`, not from `package.json`. Without that remote, the entries have no links.

- `npm run changelog` regenerates the changelog without changing the version.
- `npm version <patch|minor|major> --no-git-tag-version` sets the version and runs the `version` hook, which regenerates the changelog for the new version and stages `CHANGELOG.md`. The flag stops npm from committing or tagging, but the hook still stages that one file. Stage `package.json` and `package-lock.json` yourself.

The workflow creates release tags. Do not push a version tag by hand.

## Name-reservation bootstrap, 2026-10-12

This section records observations made on 2026-10-12. Registry tags may have changed since.

On 2026-10-12, the maintainer authorized a local publication to reserve the name. npm accepted `pi-herdr-clean-craft@0.0.0-bootstrap.0`, submitted with the `bootstrap` tag and without provenance. Its inspected tarball contains only `package.json`, `README.md`, and `LICENSE`. It contains no skills, executable code, dependencies, or installation scripts.

At that time, npm briefly served its temporary `0.0.0-stage` placeholder while processing the upload. It then made `0.0.0-bootstrap.0` available under both `bootstrap` and `latest`, despite the upload requesting only `bootstrap`. The registry names `giuseppecrj` as maintainer. The downloaded tarball matches the inspected local artifact byte for byte, with SHA-256 `7bd04aa0a6fa7a6cd6104e3f431c24477d91c03288f2cfef49e23972fa470581`. Neither tag contains the skills pack. No second publication or manual tag change was needed.

The bootstrap used the maintainer's local npm authentication and browser approval. No repository `NPM_TOKEN` secret was created. The source manifest was then private at `0.0.0`. This reservation is not a skills release.

## Metadata-only bootstrap job

The workflow's `bootstrap` job checks trusted publishing with `pi-herdr-clean-craft@0.0.0-bootstrap.1`, the `bootstrap` dist-tag, and provenance. It runs only on the first attempt of a push to `main` in this public repository. It reads Git history and publishes only when the bootstrap manifest did not exist before the push. Later pushes upload nothing. Reruns and manual dispatch skip the job. It validates and stages the three metadata files, records `gitHead`, and publishes without tokens or upload retries. It never publishes the root package.

On 2026-10-12, the job had run once. [Workflow run 38285196535](https://github.com/giuseppecrj/pi-herdr-clean-craft/actions/runs/38285196535), the push of commit `597d8d67a1ca0d28d78f7855578700f2e01ef740` to `main`, published `0.0.0-bootstrap.1` through OIDC trusted publishing with provenance, while detection correctly skipped the skills release job. The public registry names GitHub Actions as the trusted publisher and records that commit as `gitHead`. The provenance names the commit, workflow, and run. `npm audit signatures` passed, and the downloaded tarball holds exactly the three metadata files, matching the merged source. On that date, `latest` still pointed to `0.0.0-bootstrap.0`. This verifies the trusted publisher and provenance path for metadata only. It is not a skills release.

## Before a release

External changes need separate approval:

1. Keep the GitHub repository public. Its public visibility was verified on 2026-10-12. npm does not generate provenance from a private repository.
2. Keep the repository secret `NPM_TOKEN` absent. The package exists, so the workflow requires trusted publishing and refuses a bootstrap token, including on exact retries.
3. Run the mandatory checks locally, and run `npm run test:integration` with the host prerequisites [verification](docs/verification.md) describes. Record what each actually reported, including the known host failure if it remains.
4. Set the new stable version through the version flow above in a reviewed change, with `private` absent. When that change reaches `main`, the push is a candidate. The first stable version, 0.1.0, follows the private `0.0.0` manifest, so its push is a version increase.

## What has and has not been tested

The release tests run the workflow's own scripts locally, in test-owned Git repositories, with a loopback registry and command stand-ins for `npm` and `gh`. They also walk the release job's own steps in order, for a version bump and for an exact retry, and show that a failure in installation, formatting, lint, the check aggregate, or the package preview stops the job before any later step, publication, tag, or release. A walk whose checks all pass reaches the publication script. A Pi download that does not match the pinned digest stops at provisioning, before extraction. No test publishes, pushes to GitHub, downloads Pi, or calls the real registry. On GitHub, the metadata-only bootstrap verified OIDC trusted publishing and provenance, as described above. These local tests do not show that the mandatory checks pass on a hosted runner or that a skills publication succeeds. Check the workflow run and the registry for that.

## Troubleshooting

- **No release happened.** Read the detect job's notice: a private manifest, a prerelease, an unchanged version, a first push, or an unreadable previous manifest is not released.
- **A mandatory check failed.** Reproduce it locally with the same command. `npm run format` rewrites formatting. A Pi provisioning failure means the download did not match the pinned digests; do not change the digests without verifying a new official build.
- **npm already has this version from another commit.** Versions cannot be republished. Increase the version.
- **The tag points to another commit.** Do not move it. Increase the version.
- **The tag moved or disappeared during the run.** npm may already have the version. Find out who changed the tag before doing anything else. Do not move it back by force.
- **npm publish failed.** Check npm before rerunning. A rerun continues only if npm has this version from this commit, or does not have it at all.
