import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";
import { runRelease } from "../scripts/release/release.mjs";
import { isolatedEnv, makeTempRoot, PACKAGE_ROOT, run } from "./support.mjs";

const SCRIPTS = join(PACKAGE_ROOT, "scripts", "release");
const NAME = "pi-herdr-clean-craft";
const REPOSITORY = "giuseppecrj/pi-herdr-clean-craft";
const VERSION = "1.2.3";
const TAG = `v${VERSION}`;
const BOOTSTRAP = "npm_bootstrap_secret_value";
const GH = "gh_secret_value";
const SETUP_NODE_PLACEHOLDER = "XXXXX-XXXXX-XXXXX-XXXXX";

const PUBLIC_MANIFEST = {
	name: NAME,
	version: VERSION,
	repository: { type: "git", url: `git+https://github.com/${REPOSITORY}.git` },
	homepage: `https://github.com/${REPOSITORY}#readme`,
	bugs: { url: `https://github.com/${REPOSITORY}/issues` },
	publishConfig: { access: "public" },
};

const FAKE_PRELUDE = `#!/usr/bin/env node
"use strict";
const { appendFileSync, renameSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const args = process.argv.slice(2);
function remoteTag() {
	try {
		return execFileSync("git", ["--git-dir", process.env.FAKE_ORIGIN, "rev-parse", "-q", "--verify", "refs/tags/" + process.env.FAKE_TAG + "^{commit}"], { encoding: "utf8" }).trim();
	} catch {
		return null;
	}
}
function record(tool) {
	appendFileSync(process.env.FAKE_LOG, JSON.stringify({ tool, args, nodeAuthToken: process.env.NODE_AUTH_TOKEN ?? null, ghToken: process.env.GH_TOKEN ?? null, remoteTag: remoteTag() }) + "\\n");
}
`;

const FAKE_NPM = `${FAKE_PRELUDE}
record("npm");
if (args[0] === "--version") {
	process.stdout.write((process.env.FAKE_NPM_VERSION ?? "11.19.1") + "\\n");
} else if (args[0] === "publish") {
	if (process.env.FAKE_RACE_TAG_SHA) {
		execFileSync("git", ["--git-dir", process.env.FAKE_ORIGIN, "update-ref", "refs/tags/" + process.env.FAKE_TAG, process.env.FAKE_RACE_TAG_SHA]);
	}
	if (process.env.FAKE_RACE_TAG_DELETE) {
		execFileSync("git", ["--git-dir", process.env.FAKE_ORIGIN, "update-ref", "-d", "refs/tags/" + process.env.FAKE_TAG]);
	}
	if (process.env.FAKE_RACE_BREAK_ORIGIN) renameSync(process.env.FAKE_ORIGIN, process.env.FAKE_ORIGIN + ".moved");
	process.exitCode = Number(process.env.FAKE_NPM_PUBLISH_EXIT ?? 0);
} else {
	process.stderr.write("unexpected npm call\\n");
	process.exitCode = 2;
}
`;

const FAKE_GH = `${FAKE_PRELUDE}
record("gh");
const view = process.env.FAKE_GH_VIEW ?? "absent";
if (args[0] === "auth" && args[1] === "setup-git") {
} else if (args[0] === "release" && args[1] === "view") {
	if (view === "absent") {
		process.stderr.write("release not found\\n");
		process.exitCode = 1;
	} else if (view === "error") {
		process.stderr.write("HTTP 401: Bad credentials (https://api.github.com/graphql)\\n");
		process.exitCode = 1;
	} else {
		process.stdout.write(JSON.stringify({ tagName: process.env.FAKE_TAG, isDraft: view === "draft" }) + "\\n");
	}
} else if (args[0] === "release" && args[1] === "create") {
	process.exitCode = Number(process.env.FAKE_GH_CREATE_EXIT ?? 0);
} else {
	process.stderr.write("unexpected gh call\\n");
	process.exitCode = 2;
}
`;

function releaseFixture(t, { manifest = PUBLIC_MANIFEST } = {}) {
	const root = makeTempRoot(t, "release-publish");
	const home = join(root, "home");
	const hooks = join(root, "no-hooks");
	const fakeBin = join(root, "fake-bin");
	for (const dir of [home, hooks, fakeBin]) mkdirSync(dir);
	const gitconfig = join(root, "gitconfig");
	writeFileSync(gitconfig, "");
	writeFileSync(join(fakeBin, "npm"), FAKE_NPM);
	writeFileSync(join(fakeBin, "gh"), FAKE_GH);
	chmodSync(join(fakeBin, "npm"), 0o755);
	chmodSync(join(fakeBin, "gh"), 0o755);
	const base = isolatedEnv(root, { HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: gitconfig, GIT_TERMINAL_PROMPT: "0" });
	const env = { ...base, PATH: [fakeBin, base.PATH].join(delimiter) };
	const origin = join(root, "origin.git");
	const repo = join(root, "repo");
	const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", timeout: 10_000 }).trim();
	git(root, "init", "--quiet", "--bare", "--initial-branch=main", origin);
	git(root, "init", "--quiet", "--initial-branch=main", repo);
	for (const [key, value] of [
		["user.name", "Release Test"],
		["user.email", "release-test@example.invalid"],
		["commit.gpgsign", "false"],
		["tag.gpgsign", "false"],
		["core.hooksPath", hooks],
	]) {
		git(repo, "config", key, value);
	}
	git(repo, "commit", "--quiet", "--allow-empty", "-m", "earlier");
	const earlier = git(repo, "rev-parse", "HEAD");
	writeFileSync(join(repo, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
	git(repo, "add", "package.json");
	git(repo, "commit", "--quiet", "-m", "release candidate");
	const sha = git(repo, "rev-parse", "HEAD");
	git(repo, "remote", "add", "origin", origin);
	git(repo, "push", "--quiet", "origin", "main");
	const log = join(root, "commands.jsonl");
	const summary = join(root, "step-summary.md");
	const releaseEnv = (extra = {}) => ({
		...env,
		GITHUB_REF: "refs/heads/main",
		GITHUB_SHA: sha,
		GITHUB_REPOSITORY: REPOSITORY,
		GITHUB_STEP_SUMMARY: summary,
		PACKAGE_NAME: NAME,
		VERSION,
		TAG,
		REGISTRY_STATE: "version-absent",
		GH_TOKEN: GH,
		NODE_AUTH_TOKEN: SETUP_NODE_PLACEHOLDER,
		FAKE_LOG: log,
		FAKE_ORIGIN: origin,
		FAKE_TAG: TAG,
		...extra,
	});
	const commands = () =>
		existsSync(log)
			? readFileSync(log, "utf8")
					.split("\n")
					.filter(Boolean)
					.map((line) => JSON.parse(line))
			: [];
	const tagAt = (cwd) => {
		try {
			return git(cwd, "rev-parse", "-q", "--verify", `refs/tags/${TAG}^{commit}`);
		} catch {
			return null;
		}
	};
	return { root, repo, origin, sha, earlier, git, env, releaseEnv, commands, summary, remoteTag: () => tagAt(origin), localTag: () => tagAt(repo) };
}

function inProcess(fixture, extra) {
	const lines = [];
	let error = null;
	try {
		runRelease({ cwd: fixture.repo, env: fixture.releaseEnv(extra), stdio: "pipe", say: (line) => lines.push(line) });
	} catch (caught) {
		error = caught;
	}
	return { error, output: lines.join("\n") };
}

const calls = (commands) => commands.map((entry) => `${entry.tool} ${entry.args.slice(0, entry.tool === "gh" ? 2 : 1).join(" ")}`);
const mutations = (commands) => commands.filter((entry) => ["npm publish", "gh release create"].includes(`${entry.tool} ${entry.args[0]}${entry.tool === "gh" ? ` ${entry.args[1]}` : ""}`));

function pushTagAtCandidate(fixture) {
	fixture.git(fixture.repo, "-c", "user.name=Earlier Run", "-c", "user.email=earlier@example.invalid", "tag", "-a", TAG, "-m", `Release ${TAG}`, fixture.sha);
	fixture.git(fixture.repo, "push", "--quiet", "origin", `refs/tags/${TAG}`);
}

function assertNoMutation(fixture) {
	assert.deepEqual(mutations(fixture.commands()), [], "no publish or GitHub Release");
	assert.equal(fixture.remoteTag(), null, "no remote tag");
	assert.equal(fixture.localTag(), null, "no local tag");
}

describe("release mutation script: entry point", () => {
	it("runs the full plan from the command line, with no readiness list of its own", async (t) => {
		const fixture = releaseFixture(t);
		const result = await run(process.execPath, [join(SCRIPTS, "release.mjs")], { cwd: fixture.repo, env: fixture.releaseEnv(), timeoutMs: 30_000, root: fixture.root });
		assert.equal(result.code, 0, result.stdout + result.stderr);
		assert.deepEqual(calls(fixture.commands()), ["npm --version", "gh auth setup-git", "gh release view", "npm publish", "gh release create"]);
		assert.equal(fixture.remoteTag(), fixture.sha);
		assert.equal(existsSync(join(SCRIPTS, "readiness.mjs")), false);
	});
});

describe("release mutation script: publication plan", () => {
	it("publishes a new version through OIDC with no token, then tags, then creates the release", (t) => {
		const fixture = releaseFixture(t);
		const { error, output } = inProcess(fixture);
		assert.equal(error, null, output);
		const commands = fixture.commands();
		assert.deepEqual(calls(commands), ["npm --version", "gh auth setup-git", "gh release view", "npm publish", "gh release create"]);
		const publish = commands[3];
		assert.deepEqual(publish.args, ["publish", "--access", "public", "--provenance", "--ignore-scripts"]);
		assert.equal(publish.nodeAuthToken, null, "OIDC publish sees no NODE_AUTH_TOKEN, not even setup-node's placeholder");
		assert.equal(publish.ghToken, null, "npm never sees the GitHub token");
		assert.equal(publish.remoteTag, null, "npm publish precedes the tag");
		const create = commands[4];
		assert.equal(create.remoteTag, fixture.sha, "the tag exists on the remote before the release");
		assert.equal(create.nodeAuthToken, null);
		assert.equal(create.ghToken, GH);
		assert.deepEqual(create.args.slice(0, 5), ["release", "create", TAG, "--repo", REPOSITORY]);
		assert.ok(create.args.includes("--verify-tag"));
		assert.equal(fixture.remoteTag(), fixture.sha);
		assert.match(readFileSync(fixture.summary, "utf8"), new RegExp(`${NAME}@${VERSION}`));
		assert.doesNotMatch(output, new RegExp(`${GH}|${BOOTSTRAP}`));
	});

	it("publishes a package that does not exist yet only with the bootstrap token", (t) => {
		const fixture = releaseFixture(t);
		const { error, output } = inProcess(fixture, { REGISTRY_STATE: "absent", BOOTSTRAP_NPM_TOKEN: BOOTSTRAP });
		assert.equal(error, null, output);
		const publish = fixture.commands().find((entry) => entry.tool === "npm" && entry.args[0] === "publish");
		assert.equal(publish.nodeAuthToken, BOOTSTRAP);
		assert.equal(publish.ghToken, null);
		assert.match(output, /bootstrap/i);
		assert.match(output, /[Rr]evoke/);
		assert.doesNotMatch(output, new RegExp(BOOTSTRAP));
		assert.equal(fixture.remoteTag(), fixture.sha);
	});

	for (const [label, extra, pattern] of [
		["a package that does not exist without a bootstrap token", { REGISTRY_STATE: "absent" }, /NPM_TOKEN/],
		["a bootstrap token for an existing package", { REGISTRY_STATE: "version-absent", BOOTSTRAP_NPM_TOKEN: BOOTSTRAP }, /bootstrap-only/],
		["a bootstrap token on an exact retry", { REGISTRY_STATE: "same-commit-published", BOOTSTRAP_NPM_TOKEN: BOOTSTRAP }, /bootstrap-only/],
		["npm older than trusted publishing supports", { FAKE_NPM_VERSION: "11.5.0" }, /11\.5\.1/],
		["an unknown registry state", { REGISTRY_STATE: "published" }, /REGISTRY_STATE/],
		["a tag that does not match the version", { TAG: "v1.2.4" }, /TAG/],
		["another package name", { PACKAGE_NAME: "other-package" }, /PACKAGE_NAME/],
		["a ref other than main", { GITHUB_REF: "refs/heads/feature" }, /main/],
		["another repository", { GITHUB_REPOSITORY: "someone/pi-herdr-clean-craft" }, /GITHUB_REPOSITORY/],
		["a SHA that is not the checked-out commit", { GITHUB_SHA: "b".repeat(40) }, /HEAD/],
		["a prerelease version", { VERSION: "1.2.3-rc.1", TAG: "v1.2.3-rc.1" }, /VERSION/],
	]) {
		it(`refuses ${label} with no mutation`, (t) => {
			const fixture = releaseFixture(t);
			const { error, output } = inProcess(fixture, extra);
			assert.ok(error, "expected a refusal");
			assert.match(error.message, pattern);
			assertNoMutation(fixture);
			assert.doesNotMatch(`${output}${error.message}`, new RegExp(`${GH}|${BOOTSTRAP}`));
		});
	}

	it("accepts npm at exactly the trusted-publishing minimum", (t) => {
		const fixture = releaseFixture(t);
		const { error, output } = inProcess(fixture, { FAKE_NPM_VERSION: "11.5.1" });
		assert.equal(error, null, output);
	});
});

describe("release mutation script: exact retries", () => {
	it("skips npm publish for a same-commit retry and still tags and releases", (t) => {
		const fixture = releaseFixture(t);
		const { error, output } = inProcess(fixture, { REGISTRY_STATE: "same-commit-published" });
		assert.equal(error, null, output);
		assert.deepEqual(calls(fixture.commands()), ["gh auth setup-git", "gh release view", "gh release create"]);
		assert.equal(fixture.remoteTag(), fixture.sha);
	});

	it("reuses a tag already on this commit and an existing release without changing either", (t) => {
		const fixture = releaseFixture(t);
		fixture.git(fixture.repo, "-c", "user.name=Earlier Run", "-c", "user.email=earlier@example.invalid", "tag", "-a", TAG, "-m", `Release ${TAG}`, fixture.sha);
		fixture.git(fixture.repo, "push", "--quiet", "origin", `refs/tags/${TAG}`);
		const before = fixture.git(fixture.origin, "rev-parse", `refs/tags/${TAG}`);
		const { error, output } = inProcess(fixture, { REGISTRY_STATE: "same-commit-published", FAKE_GH_VIEW: "present" });
		assert.equal(error, null, output);
		assert.deepEqual(calls(fixture.commands()), ["gh auth setup-git", "gh release view"]);
		assert.equal(fixture.git(fixture.origin, "rev-parse", `refs/tags/${TAG}`), before, "the tag object is unchanged");
		assert.match(output, /already exists/);
	});

	it("tags after a remote tag appeared on this commit since checkout without pushing again", (t) => {
		const fixture = releaseFixture(t);
		execFileSync("git", ["--git-dir", fixture.origin, "update-ref", `refs/tags/${TAG}`, fixture.sha], { env: fixture.env });
		const { error, output } = inProcess(fixture, { REGISTRY_STATE: "same-commit-published" });
		assert.equal(error, null, output);
		assert.equal(fixture.remoteTag(), fixture.sha);
		assert.equal(fixture.localTag(), null, "no local tag was created to push");
	});
});

describe("release mutation script: conflicts and failures", () => {
	it("refuses a remote tag on another commit before publishing", (t) => {
		const fixture = releaseFixture(t);
		execFileSync("git", ["--git-dir", fixture.origin, "update-ref", `refs/tags/${TAG}`, fixture.earlier], { env: fixture.env });
		const { error } = inProcess(fixture);
		assert.match(error.message, new RegExp(`${TAG}.*${fixture.earlier}`));
		assert.deepEqual(mutations(fixture.commands()), []);
		assert.equal(fixture.remoteTag(), fixture.earlier, "the tag was not moved");
	});

	it("refuses a local tag on another commit before publishing", (t) => {
		const fixture = releaseFixture(t);
		fixture.git(fixture.repo, "tag", TAG, fixture.earlier);
		const { error } = inProcess(fixture, { REGISTRY_STATE: "same-commit-published" });
		assert.match(error.message, /another commit|points to/);
		assert.deepEqual(mutations(fixture.commands()), []);
		assert.equal(fixture.remoteTag(), null);
	});

	it("refuses an ambiguous release lookup before publishing", (t) => {
		const fixture = releaseFixture(t);
		const { error } = inProcess(fixture, { FAKE_GH_VIEW: "error" });
		assert.match(error.message, /gh release view/);
		assertNoMutation(fixture);
	});

	it("refuses a draft release, and a release whose tag is missing, before publishing", (t) => {
		const draft = releaseFixture(t);
		assert.match(inProcess(draft, { FAKE_GH_VIEW: "draft" }).error.message, /draft/);
		assertNoMutation(draft);
		const orphan = releaseFixture(t);
		assert.match(inProcess(orphan, { FAKE_GH_VIEW: "present" }).error.message, /no tag/);
		assertNoMutation(orphan);
	});

	it("stops after a failed npm publish without retrying, tagging, or releasing", (t) => {
		const fixture = releaseFixture(t);
		const { error } = inProcess(fixture, { FAKE_NPM_PUBLISH_EXIT: "1" });
		assert.match(error.message, /npm publish/);
		const commands = fixture.commands();
		assert.equal(commands.filter((entry) => entry.args[0] === "publish").length, 1);
		assert.equal(
			commands.some((entry) => entry.args[1] === "create"),
			false,
		);
		assert.equal(fixture.remoteTag(), null);
		assert.equal(fixture.localTag(), null);
	});

	it("never moves a tag that another commit took during publish, and creates no release", (t) => {
		const fixture = releaseFixture(t);
		const { error } = inProcess(fixture, { FAKE_RACE_TAG_SHA: fixture.earlier });
		assert.match(error.message, new RegExp(`${TAG} now points to ${fixture.earlier}`));
		assert.equal(fixture.remoteTag(), fixture.earlier);
		assert.equal(
			fixture.commands().some((entry) => entry.args[1] === "create"),
			false,
		);
	});

	for (const [label, extra] of [
		["creating", {}],
		["reusing", { FAKE_GH_VIEW: "present" }],
	]) {
		it(`refuses before ${label} the release when a tag already on this commit is moved during publish`, (t) => {
			const fixture = releaseFixture(t);
			pushTagAtCandidate(fixture);
			const { error, output } = inProcess(fixture, { FAKE_RACE_TAG_SHA: fixture.earlier, ...extra });
			assert.ok(error, `expected a refusal\n${output}`);
			assert.match(error.message, new RegExp(`${TAG} now points to ${fixture.earlier}, not ${fixture.sha}`));
			assert.equal(fixture.commands().filter((entry) => entry.args[0] === "publish").length, 1);
			assert.equal(
				fixture.commands().some((entry) => entry.args[1] === "create"),
				false,
			);
			assert.doesNotMatch(output, /reusing|Released/);
			assert.equal(fixture.remoteTag(), fixture.earlier, "the moved tag was not moved back");
			assert.equal(existsSync(fixture.summary), false);
		});
	}

	it("refuses before the release when a tag already on this commit disappears during publish, and does not push it again", (t) => {
		const fixture = releaseFixture(t);
		pushTagAtCandidate(fixture);
		const { error, output } = inProcess(fixture, { FAKE_RACE_TAG_DELETE: "1" });
		assert.ok(error, `expected a refusal\n${output}`);
		assert.match(error.message, new RegExp(`${TAG} disappeared from the remote`));
		assert.equal(
			fixture.commands().some((entry) => entry.args[1] === "create"),
			false,
		);
		assert.equal(fixture.remoteTag(), null);
	});

	it("refuses before the release when the remote tag cannot be read again after publish", (t) => {
		const fixture = releaseFixture(t);
		pushTagAtCandidate(fixture);
		const { error, output } = inProcess(fixture, { FAKE_RACE_BREAK_ORIGIN: "1" });
		assert.ok(error, `expected a refusal\n${output}`);
		assert.match(error.message, /git ls-remote for v1\.2\.3 failed/);
		assert.equal(
			fixture.commands().some((entry) => entry.args[1] === "create"),
			false,
		);
		assert.equal(fixture.git(fixture.root, "--git-dir", `${fixture.origin}.moved`, "rev-parse", `refs/tags/${TAG}^{commit}`), fixture.sha);
	});

	it("creates the release without pushing when a tag on this commit stays put through publish", (t) => {
		const fixture = releaseFixture(t);
		pushTagAtCandidate(fixture);
		const before = fixture.git(fixture.origin, "rev-parse", `refs/tags/${TAG}`);
		const { error, output } = inProcess(fixture);
		assert.equal(error, null, output);
		assert.deepEqual(calls(fixture.commands()), ["npm --version", "gh auth setup-git", "gh release view", "npm publish", "gh release create"]);
		assert.equal(fixture.commands().at(-1).remoteTag, fixture.sha);
		assert.equal(fixture.git(fixture.origin, "rev-parse", `refs/tags/${TAG}`), before, "the tag object is unchanged");
	});

	it("creates the release without pushing when a tag on this commit appears during publish", (t) => {
		const fixture = releaseFixture(t);
		const { error, output } = inProcess(fixture, { FAKE_RACE_TAG_SHA: fixture.sha });
		assert.equal(error, null, output);
		assert.match(output, /already on/);
		assert.equal(fixture.localTag(), null, "no local tag was created to push");
		assert.equal(fixture.commands().at(-1).remoteTag, fixture.sha);
	});

	it("stops after a failed release creation without retrying", (t) => {
		const fixture = releaseFixture(t);
		const { error } = inProcess(fixture, { FAKE_GH_CREATE_EXIT: "1" });
		assert.match(error.message, /gh release create/);
		assert.equal(fixture.commands().filter((entry) => entry.args[1] === "create").length, 1);
		assert.equal(fixture.remoteTag(), fixture.sha);
	});
});

describe("release guard", () => {
	function guardEnv(fixture, extra = {}) {
		return {
			...fixture.env,
			GITHUB_EVENT_NAME: "push",
			GITHUB_REF: "refs/heads/main",
			GITHUB_SHA: fixture.sha,
			GITHUB_REPOSITORY: REPOSITORY,
			GITHUB_SERVER_URL: "https://github.com",
			RUNNER_ENVIRONMENT: "github-hosted",
			REPOSITORY_PRIVATE: "false",
			REPOSITORY_VISIBILITY: "public",
			CANDIDATE_NAME: NAME,
			CANDIDATE_VERSION: VERSION,
			CANDIDATE_TAG: TAG,
			CANDIDATE_SHA: fixture.sha,
			...extra,
		};
	}

	async function guard(t, { extra, manifest } = {}) {
		const fixture = releaseFixture(t, manifest ? { manifest } : {});
		return run(process.execPath, [join(SCRIPTS, "guard.mjs")], { cwd: fixture.repo, env: guardEnv(fixture, extra), timeoutMs: 30_000, root: fixture.root });
	}

	it("accepts a public, main, github-hosted candidate whose manifest matches", async (t) => {
		const result = await guard(t);
		assert.equal(result.code, 0, result.stderr);
		assert.equal(result.stdout.includes("::error::"), false);
	});

	for (const [label, extra, pattern] of [
		["a dispatch from another ref", { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/feature" }, /main/],
		["an unsupported event", { GITHUB_EVENT_NAME: "pull_request" }, /event/],
		["a private repository", { REPOSITORY_PRIVATE: "true", REPOSITORY_VISIBILITY: "private" }, /public/],
		["an internal repository", { REPOSITORY_VISIBILITY: "internal" }, /public/],
		["a missing visibility", { REPOSITORY_VISIBILITY: "" }, /public/],
		["a self-hosted runner", { RUNNER_ENVIRONMENT: "self-hosted" }, /github-hosted/],
		["a missing runner type", { RUNNER_ENVIRONMENT: "" }, /github-hosted/],
		["a fork", { GITHUB_REPOSITORY: "someone/pi-herdr-clean-craft" }, /GITHUB_REPOSITORY/],
		["another GitHub server", { GITHUB_SERVER_URL: "https://github.example.com" }, /GITHUB_SERVER_URL/],
		["a detected SHA that is not this run's", { CANDIDATE_SHA: "c".repeat(40) }, /SHA/],
		["a run SHA that is not the checkout", { GITHUB_SHA: "c".repeat(40), CANDIDATE_SHA: "c".repeat(40) }, /HEAD/],
		["a detected version that is not the manifest's", { CANDIDATE_VERSION: "1.2.4", CANDIDATE_TAG: "v1.2.4" }, /version/],
		["a tag that is not the version's", { CANDIDATE_TAG: "1.2.3" }, /tag/],
		["a detected name that is not the manifest's", { CANDIDATE_NAME: "other-package" }, /name/],
	]) {
		it(`refuses ${label}`, async (t) => {
			const result = await guard(t, { extra });
			assert.equal(result.code, 1, result.stdout);
			assert.match(result.stdout + result.stderr, pattern);
		});
	}

	for (const [label, manifest, pattern] of [
		["a private manifest", { ...PUBLIC_MANIFEST, private: true }, /private/],
		["a prerelease manifest", { ...PUBLIC_MANIFEST, version: "1.2.3-rc.1" }, /version/],
		["a manifest without public access", { ...PUBLIC_MANIFEST, publishConfig: undefined }, /publishConfig/],
		["a manifest naming another repository", { ...PUBLIC_MANIFEST, repository: { type: "git", url: "git+https://github.com/someone/else.git" } }, /repository/],
		["a manifest with a bare repository string", { ...PUBLIC_MANIFEST, repository: `github:${REPOSITORY}` }, /repository/],
		["a manifest with another homepage", { ...PUBLIC_MANIFEST, homepage: "https://example.com" }, /homepage/],
		["a manifest with another issue tracker", { ...PUBLIC_MANIFEST, bugs: { url: "https://example.com/issues" } }, /bugs/],
	]) {
		it(`refuses ${label}`, async (t) => {
			const result = await guard(t, { manifest });
			assert.equal(result.code, 1, result.stdout);
			assert.match(result.stdout + result.stderr, pattern);
		});
	}
});
