# Releasing

The release workflow is set up, but publication is disabled. No usable skills version has been published, and the current workflow cannot publish one. A separate local bootstrap reserved the npm name. This page describes the workflow's checks and the steps required before it may publish the skills pack.

## Current state

`package.json` is `private` at version `0.0.0`, so a push that changes it is not even a release candidate. Even for a candidate, the release job stops at its readiness check, which fails while any of these gates remains open:

- `phase3-integration-gate`: `npm run test:integration` fails against pi-herdr-agents 3.2.1. The host's `skills` argument does not deliver the skill with a standalone child's task, and isolation of the later request that follows from it usually fails. See [compatibility](docs/compatibility.md).
- `phase6-live-model-evaluation`: no bounded live-model evaluation of the methodology has been run.
- `phase6-release-review`: the final compatibility matrix, source-rights review, and audited tarball review for a release candidate are not done.
- `hosted-test-provisioning`: nothing installs Pi, Herdr, pi-herdr-agents, or pi-herdr-pstack on the hosted runner, so the release job's `npm test` and `npm run test:integration` steps would report `BLOCKED` there.

The list lives in `scripts/release/readiness.mjs`, and the release tests pin it. A version bump, a rerun, a secret, or a file in the repository cannot clear it. Remove an entry only in a reviewed change that records the passing evidence for that gate and updates the tests. Do not replace a gate with an approval file, a skipped check, or a recorded result that was not measured.

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
3. Check release readiness. This step runs for every registry state, including an exact retry.
4. Install with `npm ci --ignore-scripts`, run `npm test`, run `npm run test:integration`, and preview the package. None of these is optional.
5. Publish, tag, and create the GitHub Release, in that order.

## Publishing, tagging, and the GitHub Release

The last step checks the readiness list again before doing anything else. It decides the npm credential and reads the existing tag and release before its first change:

- If the package does not exist on npm, the repository secret `NPM_TOKEN` must be set. It is used once to create the package.
- If the package exists, `NPM_TOKEN` must not be set, including on an exact retry. Publishing uses OIDC trusted publishing with no token, and needs npm 11.5.1 or later and Node 22.14.0 or later. The pinned Node 26.8.2 provides both.
- A tag `vX.Y.Z` that already exists must point at this commit, locally and on GitHub. Tags are never moved or force-pushed.
- An existing GitHub Release for the tag is reused unchanged. A draft release, or a release without its tag, stops the run.

Then it publishes with `npm publish --access public --provenance --ignore-scripts`, unless this is an exact retry. After publishing, it reads the remote tag again. If the tag now names another commit, or was there before and is now gone, the step stops before the GitHub Release and changes nothing. If the tag is absent, it creates an annotated tag on the commit and pushes it, then reads the remote tag once more. It creates the GitHub Release with generated notes and a link to the npm version, or reuses the existing release, only when that last read names this commit. `gh release create --verify-tag` checks only that the tag exists, and Git offers no way to lock a remote tag, so a tag moved after that last read is not detected. That gap is short but not closed. Each command runs once. When one fails, the step stops without retrying it, and the next run re-reads npm, the tag, and the release and continues only from a state it recognizes. The npm token and the GitHub token are each passed only to the commands that need them.

## Versions and the changelog

[CHANGELOG.md](CHANGELOG.md) is generated by `auto-changelog`, a development dependency that is not part of the package. Install it with `npm ci --ignore-scripts`. The project `.npmrc` sets `legacy-peer-deps=true`, so a development install never pulls the pi-herdr-agents peer from npm. `auto-changelog` builds its commit links from the URL of the Git remote `origin`, not from `package.json`. Without that remote, the entries have no links.

- `npm run changelog` regenerates the changelog without changing the version.
- `npm version <patch|minor|major> --no-git-tag-version` sets the version and runs the `version` hook, which regenerates the changelog for the new version and stages `CHANGELOG.md`. The flag stops npm from committing or tagging, but the hook still stages that one file. Stage `package.json` and `package-lock.json` yourself.

The workflow creates release tags. Do not push a version tag by hand.

## Name-reservation bootstrap

On 2026-10-12, the maintainer authorized a local publication to reserve the name. npm accepted `pi-herdr-clean-craft@0.0.0-bootstrap.0`, submitted with the `bootstrap` tag and without provenance. Its inspected tarball contains only `package.json`, `README.md`, and `LICENSE`. It contains no skills, executable code, dependencies, or installation scripts.

npm briefly served its temporary `0.0.0-stage` placeholder while processing the upload. It then made `0.0.0-bootstrap.0` available under both `bootstrap` and `latest`, despite the upload requesting only `bootstrap`. The registry names `giuseppecrj` as maintainer. The downloaded tarball matches the inspected local artifact byte for byte, with SHA-256 `7bd04aa0a6fa7a6cd6104e3f431c24477d91c03288f2cfef49e23972fa470581`. Neither tag contains the skills pack. No second publication or manual tag change was needed.

The bootstrap used the maintainer's local npm authentication and browser approval. No repository `NPM_TOKEN` secret was created. The operator later reported configuring the trusted publisher, but no hosted OIDC publication has verified it. The source manifest remains private at `0.0.0`, and every release blocker remains. This reservation is not a completed skills release or a waiver of its gates.

## Metadata-only bootstrap job

The workflow's `bootstrap` job checks trusted publishing with `pi-herdr-clean-craft@0.0.0-bootstrap.1`, the `bootstrap` dist-tag, and provenance. It runs only on the first attempt of a push to `main` in this public repository. It reads Git history and publishes only when the bootstrap manifest did not exist before the push. Later pushes upload nothing. Reruns and manual dispatch skip the job. It validates and stages the three metadata files, records `gitHead`, and publishes without tokens or upload retries. It never publishes the root package or waives a skills-release gate. The hosted check is pending when this change is authored.

## Before the first skills publication

Publishing the skills pack needs the gates above and these remaining steps. External changes need separate approval:

1. Keep the GitHub repository public. Its public visibility was verified on 2026-10-12. npm does not generate provenance from a private repository.
2. Verify the operator-configured npm trusted publisher: GitHub Actions, owner `giuseppecrj`, repository `pi-herdr-clean-craft`, workflow file `publish.yml`.
3. Keep the repository secret `NPM_TOKEN` absent. The package now exists, so the workflow requires trusted publishing and refuses a bootstrap token, including on exact retries.
4. Provision the release job's test prerequisites in a reviewed change: the Pi CLI at the version the suites expect, Herdr, and exact pi-herdr-agents and pi-herdr-pstack package directories, from pinned and verified sources. Expose them through `CLEAN_CRAFT_PI_BIN`, `CLEAN_CRAFT_HERDR_BIN`, `CLEAN_CRAFT_HOST_ROOT`, and `CLEAN_CRAFT_PSTACK_ROOT`, as [verification](docs/verification.md) describes. No provisioning method has been chosen or tested on a hosted runner.
5. Complete the required gates, then remove `"private": true` and set the first stable version through the version flow above in a reviewed change. When that change reaches `main`, the push is a candidate.

## What has and has not been tested

The release tests run the workflow's own scripts locally, in test-owned Git repositories, with a loopback registry and command stand-ins for `npm` and `gh`. They also walk the workflow's steps in order and show that a version bump, an exact retry, and a first publication all stop at the readiness check. No test publishes, pushes to GitHub, or calls the real registry. The [first hosted workflow run](https://github.com/giuseppecrj/pi-herdr-clean-craft/actions/runs/38260824333) completed detection successfully and skipped the release job. Hosted release tests, OIDC trusted publishing, and provenance have not been exercised.

## Troubleshooting

- **No release happened.** Read the detect job's notice: a private manifest, a prerelease, an unchanged version, a first push, or an unreadable previous manifest is not released.
- **The readiness check failed.** That is expected while the gates above remain open.
- **npm already has this version from another commit.** Versions cannot be republished. Increase the version.
- **The tag points to another commit.** Do not move it. Increase the version.
- **The tag moved or disappeared during the run.** npm may already have the version. Find out who changed the tag before doing anything else. Do not move it back by force.
- **npm publish failed.** Check npm before rerunning. A rerun continues only if npm has this version from this commit, or does not have it at all.
