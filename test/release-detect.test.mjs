import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isolatedEnv, makeTempRoot, PACKAGE_ROOT, run } from "./support.mjs";

const DETECT = join(PACKAGE_ROOT, "scripts", "release", "detect.mjs");
const NAME = "pi-herdr-clean-craft";
const MAIN = "refs/heads/main";
const ZERO = "0".repeat(40);

function manifest(version, extra = {}) {
	return { name: NAME, version, ...extra };
}

function gitFixture(t) {
	const root = makeTempRoot(t, "release-detect");
	const home = join(root, "home");
	const hooks = join(root, "no-hooks");
	const repo = join(root, "repo");
	for (const dir of [home, hooks, repo]) mkdirSync(dir);
	const gitconfig = join(root, "gitconfig");
	writeFileSync(gitconfig, "");
	const env = isolatedEnv(root, { HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: gitconfig, GIT_TERMINAL_PROMPT: "0" });
	const git = (...args) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8", timeout: 10_000 }).trim();
	git("init", "--quiet", "--initial-branch=main");
	git("config", "user.name", "Release Test");
	git("config", "user.email", "release-test@example.invalid");
	git("config", "commit.gpgsign", "false");
	git("config", "tag.gpgsign", "false");
	git("config", "core.hooksPath", hooks);
	const commit = (content, message) => {
		if (content === null) git("rm", "--quiet", "--cached", "--ignore-unmatch", "package.json");
		else {
			writeFileSync(join(repo, "package.json"), typeof content === "string" ? content : `${JSON.stringify(content)}\n`);
			git("add", "package.json");
		}
		git("commit", "--quiet", "--allow-empty", "-m", message);
		return git("rev-parse", "HEAD");
	};
	return { root, repo, env, commit };
}

function readOutputs(path) {
	if (!existsSync(path)) return {};
	return Object.fromEntries(
		readFileSync(path, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
	);
}

async function detect(t, { event = "push", ref = MAIN, previous, current, before }) {
	const fixture = gitFixture(t);
	let beforeSha = before ?? ZERO;
	if (previous !== undefined) {
		const sha = fixture.commit(previous, "previous");
		if (before === undefined) beforeSha = sha;
	}
	const sha = fixture.commit(current, "current");
	const output = join(fixture.root, "github-output");
	const result = await run(process.execPath, [DETECT], {
		cwd: fixture.repo,
		env: { ...fixture.env, GITHUB_EVENT_NAME: event, GITHUB_REF: ref, GITHUB_SHA: sha, BEFORE_SHA: beforeSha, GITHUB_OUTPUT: output },
		timeoutMs: 30_000,
		root: fixture.root,
	});
	return { ...result, sha, outputs: readOutputs(output), outputWritten: existsSync(output) };
}

function assertSkip(result, reason) {
	assert.equal(result.code, 0, result.stderr);
	assert.deepEqual(result.outputs, { decision: "skip", reason });
}

function assertCandidate(result, version, basis) {
	assert.equal(result.code, 0, result.stderr);
	assert.deepEqual(result.outputs, { decision: "candidate", basis, name: NAME, version, tag: `v${version}`, sha: result.sha });
}

function assertRefused(result, pattern) {
	assert.equal(result.code, 1, `expected a refusal\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
	assert.equal(result.outputWritten, false, "a refusal writes no step outputs");
	assert.match(`${result.stdout}${result.stderr}`, /::error::/);
	if (pattern) assert.match(`${result.stdout}${result.stderr}`, pattern);
}

describe("release detection: the actual manifest", () => {
	const actual = readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8");
	const parsed = JSON.parse(actual);
	const predecessor = `${JSON.stringify({ ...parsed, version: "0.0.0", private: true }, null, "\t")}\n`;

	it("is the public 0.1.0 manifest", () => {
		assert.equal(parsed.version, "0.1.0");
		assert.equal(parsed.private, undefined);
	});

	it("makes the push from the private 0.0.0 predecessor a candidate", async (t) => {
		assertCandidate(await detect(t, { previous: predecessor, current: actual }), "0.1.0", "version-increase");
	});

	it("skips a later push that keeps the same public version", async (t) => {
		assertSkip(await detect(t, { previous: actual, current: actual }), "unchanged");
	});

	it("makes a main-branch dispatch a candidate", async (t) => {
		assertCandidate(await detect(t, { event: "workflow_dispatch", current: actual }), "0.1.0", "dispatch");
	});
});

describe("release detection: skips", () => {
	it("skips a private manifest at any version, before reading the predecessor", async (t) => {
		assertSkip(await detect(t, { previous: manifest("0.1.0"), current: manifest("0.2.0", { private: true }) }), "private");
		assertSkip(await detect(t, { event: "workflow_dispatch", current: manifest("1.0.0", { private: true }) }), "private");
		assertSkip(await detect(t, { previous: "not json", current: manifest("0.1.0-rc.1", { private: true }) }), "private");
	});

	it("skips a public prerelease", async (t) => {
		assertSkip(await detect(t, { previous: manifest("0.1.0"), current: manifest("0.2.0-rc.1") }), "prerelease");
		assertSkip(await detect(t, { event: "workflow_dispatch", current: manifest("1.0.0-beta.1") }), "prerelease");
	});

	it("does not release on initial branch creation", async (t) => {
		assertSkip(await detect(t, { current: manifest("1.0.0") }), "initial-push");
	});

	it("does not infer a release when the predecessor cannot be read", async (t) => {
		assertSkip(await detect(t, { before: "f".repeat(40), current: manifest("1.0.0") }), "unreadable-predecessor");
		assertSkip(await detect(t, { previous: null, current: manifest("1.0.0") }), "unreadable-predecessor");
		assertSkip(await detect(t, { previous: "{ not json", current: manifest("1.0.0") }), "unreadable-predecessor");
	});

	it("does not release an unchanged public version", async (t) => {
		assertSkip(await detect(t, { previous: manifest("0.1.0"), current: manifest("0.1.0") }), "unchanged");
	});
});

describe("release detection: candidates", () => {
	it("emits a validated tuple for an increased stable version", async (t) => {
		assertCandidate(await detect(t, { previous: manifest("0.1.0"), current: manifest("0.1.1") }), "0.1.1", "version-increase");
		assertCandidate(await detect(t, { previous: manifest("0.9.9"), current: manifest("1.0.0") }), "1.0.0", "version-increase");
		assertCandidate(await detect(t, { previous: manifest("0.1.0", { private: true }), current: manifest("0.2.0") }), "0.2.0", "version-increase");
	});

	it("treats removing private at the same stable version as a candidate only", async (t) => {
		assertCandidate(await detect(t, { previous: manifest("0.1.0", { private: true }), current: manifest("0.1.0") }), "0.1.0", "private-removed");
	});

	it("releases the core version after its prerelease", async (t) => {
		assertCandidate(await detect(t, { previous: manifest("0.1.0-rc.1"), current: manifest("0.1.0") }), "0.1.0", "prerelease-to-core");
		assertCandidate(await detect(t, { previous: manifest("0.1.0-experimental.0", { private: true }), current: manifest("0.1.0") }), "0.1.0", "prerelease-to-core");
	});

	it("compares numeric parts without losing precision", async (t) => {
		// Both values round to the same IEEE double, so a Number comparison would call them equal.
		assertCandidate(await detect(t, { previous: manifest("9007199254740992.0.0"), current: manifest("9007199254740993.0.0") }), "9007199254740993.0.0", "version-increase");
		assertRefused(await detect(t, { previous: manifest("1.0.9007199254740993"), current: manifest("1.0.9007199254740992") }), /lower/);
	});

	it("makes a main-branch dispatch of a public stable version a candidate", async (t) => {
		assertCandidate(await detect(t, { event: "workflow_dispatch", current: manifest("0.3.0") }), "0.3.0", "dispatch");
	});
});

describe("release detection: refusals", () => {
	it("refuses dispatch and push from any ref other than main", async (t) => {
		assertRefused(await detect(t, { event: "workflow_dispatch", ref: "refs/heads/release-test", current: manifest("1.0.0") }), /main/);
		assertRefused(await detect(t, { ref: "refs/heads/feature", previous: manifest("0.1.0"), current: manifest("0.2.0") }), /main/);
		assertRefused(await detect(t, { event: "workflow_dispatch", ref: "refs/tags/v1.0.0", current: manifest("1.0.0", { private: true }) }), /main/);
	});

	it("refuses unsupported events", async (t) => {
		assertRefused(await detect(t, { event: "pull_request_target", current: manifest("1.0.0") }), /event/);
	});

	it("refuses a version lower than its predecessor", async (t) => {
		assertRefused(await detect(t, { previous: manifest("0.1.1"), current: manifest("0.1.0") }), /lower/);
		assertRefused(await detect(t, { previous: manifest("0.2.0-rc.1"), current: manifest("0.1.0") }), /lower/);
		assertRefused(await detect(t, { previous: manifest("0.1.0", { private: true }), current: manifest("0.0.9") }), /lower/);
	});

	it("refuses a malformed predecessor version", async (t) => {
		for (const version of ["0.1", "01.0.0", "0.1.0-01", "0.1.0-", "0.1.0-..", "0.1.0-rc.01", "0.1.0+build.1", " 0.1.0", 1]) {
			assertRefused(await detect(t, { previous: manifest(version), current: manifest("0.2.0") }), /predecessor/);
		}
	});

	it("refuses a predecessor with another package identity", async (t) => {
		assertRefused(await detect(t, { previous: { name: "other-package", version: "0.1.0" }, current: manifest("0.2.0") }), /name/);
		assertRefused(await detect(t, { previous: [], current: manifest("0.2.0") }), /predecessor/);
	});

	it("refuses a malformed public current version instead of skipping it", async (t) => {
		for (const version of ["0.2", "1.0.0+build", "v1.0.0", "1.0.0-", 2]) {
			assertRefused(await detect(t, { event: "workflow_dispatch", current: manifest(version) }), /version/);
		}
	});

	it("refuses another package name, including one that would inject outputs", async (t) => {
		assertRefused(await detect(t, { event: "workflow_dispatch", current: { name: "other-package", version: "1.0.0" } }), /name/);
		assertRefused(await detect(t, { event: "workflow_dispatch", current: { name: `${NAME}\ndecision=candidate`, version: "1.0.0" } }), /name/);
		assertRefused(await detect(t, { event: "workflow_dispatch", current: manifest("1.0.0", { private: "true" }) }), /private/);
	});

	it("refuses a malformed predecessor SHA", async (t) => {
		assertRefused(await detect(t, { before: "HEAD", current: manifest("1.0.0") }), /BEFORE_SHA/);
	});
});
