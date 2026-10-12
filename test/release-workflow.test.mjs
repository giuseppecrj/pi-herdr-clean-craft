import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";
import { RELEASE_BLOCKERS } from "../scripts/release/readiness.mjs";
import { isolatedEnv, makeTempRoot, PACKAGE_ROOT, run } from "./support.mjs";

const NAME = "pi-herdr-clean-craft";
const REPOSITORY = "giuseppecrj/pi-herdr-clean-craft";
const CHECKOUT = "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09";
const SETUP_NODE = "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444";
const WORKFLOW_TEXT = readFileSync(join(PACKAGE_ROOT, ".github", "workflows", "publish.yml"), "utf8");
const read = (path) => readFileSync(join(PACKAGE_ROOT, path), "utf8");

function blockLines(lines, start, indent) {
	const body = [];
	for (let index = start; index < lines.length; index += 1) {
		const line = lines[index];
		if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
		if (line.length - line.trimStart().length < indent) break;
		body.push(line);
	}
	return body;
}

function mapping(lines, indent) {
	const result = {};
	for (const [index, line] of lines.entries()) {
		if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
		if (line.length - line.trimStart().length !== indent) continue;
		const match = /^\s*([A-Za-z_][\w-]*):(?: (.*))?$/.exec(line);
		assert.ok(match, `unexpected workflow line: ${line}`);
		result[match[1]] = match[2] === ">-" ? blockLines(lines, index + 1, indent + 2).map((part) => part.trim()).join(" ") : (match[2] ?? "");
	}
	return result;
}

function child(lines, key, indent) {
	const index = lines.findIndex((line) => line === `${" ".repeat(indent)}${key}:`);
	return index === -1 ? null : blockLines(lines, index + 1, indent + 2);
}

function parseSteps(jobLines) {
	const steps = [];
	const stepLines = child(jobLines, "steps", 4) ?? [];
	let current = null;
	for (const line of stepLines) {
		if (line.startsWith("      - ")) {
			current = [`        ${line.slice(8)}`];
			steps.push(current);
		} else current.push(line);
	}
	return steps.map((lines) => ({ ...mapping(lines, 8), env: mapping(child(lines, "env", 8) ?? [], 10), with: mapping(child(lines, "with", 8) ?? [], 10) }));
}

function parseWorkflow(text) {
	const lines = text.split("\n");
	const jobsAt = lines.indexOf("jobs:");
	const jobLines = blockLines(lines, jobsAt + 1, 2);
	const jobs = {};
	for (const name of Object.keys(mapping(jobLines, 2))) {
		const body = child(jobLines, name, 2);
		jobs[name] = {
			...mapping(body, 4),
			permissions: mapping(child(body, "permissions", 4) ?? [], 6),
			outputs: mapping(child(body, "outputs", 4) ?? [], 6),
			steps: parseSteps(body),
		};
	}
	const top = lines.slice(0, jobsAt);
	return {
		top: mapping(top, 0),
		on: child(top, "on", 0),
		concurrency: mapping(child(top, "concurrency", 0) ?? [], 2),
		defaults: child(top, "defaults", 0),
		jobs,
	};
}

const WORKFLOW = parseWorkflow(WORKFLOW_TEXT);
const RELEASE_STEPS = [
	"Check out repository",
	"Set up Node.js",
	"Confirm release candidate",
	"Check npm registry",
	"Check release readiness",
	"Install dependencies",
	"Run default suite",
	"Run host integration gate",
	"Verify package contents",
	"Publish, tag, and create GitHub release",
];

describe("release workflow layout", () => {
	it("runs on root or bootstrap manifest pushes to main and manual dispatch only", () => {
		assert.deepEqual(WORKFLOW.on, ["  push:", "    branches:", "      - main", "    paths:", "      - package.json", "      - .github/npm-bootstrap/package.json", "  workflow_dispatch:"]);
		assert.equal(WORKFLOW.top.name, "Release");
		assert.equal(WORKFLOW.top.permissions, "{}");
		assert.deepEqual(WORKFLOW.concurrency, { group: `${NAME}-release`, "cancel-in-progress": "false" });
		assert.deepEqual(WORKFLOW.defaults, ["  run:", "    shell: bash"]);
	});

	it("keeps detection read-only and grants repository write only to the release job", () => {
		const { detect, release } = WORKFLOW.jobs;
		assert.deepEqual(Object.keys(WORKFLOW.jobs), ["detect", "release", "bootstrap"]);
		assert.deepEqual(detect.permissions, { contents: "read" });
		assert.deepEqual(release.permissions, { contents: "write", "id-token": "write" });
		for (const job of [detect, release]) assert.equal(job["runs-on"], "ubuntu-latest");
		assert.equal(release.needs, "detect");
		assert.equal(release.if, "needs.detect.outputs.decision == 'candidate' && github.ref == 'refs/heads/main'");
		assert.deepEqual(Object.keys(detect.outputs), ["decision", "name", "version", "tag", "sha"]);
		for (const [key, value] of Object.entries(detect.outputs)) assert.equal(value, `\${{ steps.detect.outputs.${key} }}`);
	});

	it("pins actions by commit, checks out full history without credentials, and pins Node 26.8.2", () => {
		const steps = [WORKFLOW.jobs.detect, WORKFLOW.jobs.release].flatMap((job) => job.steps);
		const uses = steps.filter((step) => step.uses);
		assert.deepEqual(
			uses.map((step) => step.uses.split(" ")[0]),
			[CHECKOUT, SETUP_NODE, CHECKOUT, SETUP_NODE],
		);
		for (const step of uses.filter((step) => step.uses.startsWith(CHECKOUT))) {
			assert.deepEqual(step.with, { "fetch-depth": "0", "persist-credentials": "false" });
		}
		const nodes = uses.filter((step) => step.uses.startsWith(SETUP_NODE));
		assert.deepEqual(nodes[0].with, { "node-version": "26.8.2", "package-manager-cache": "false" });
		assert.deepEqual(nodes[1].with, { "node-version": "26.8.2", "registry-url": "https://registry.npmjs.org", "package-manager-cache": "false" });
	});

	it("runs the release steps in order with no condition, skip, or continue-on-error", () => {
		const { detect, release } = WORKFLOW.jobs;
		assert.deepEqual(
			release.steps.map((step) => step.name),
			RELEASE_STEPS,
		);
		assert.deepEqual(
			detect.steps.map((step) => step.name),
			["Check out repository", "Set up Node.js", "Detect release candidate"],
		);
		for (const step of [...detect.steps, ...release.steps, ...WORKFLOW.jobs.bootstrap.steps]) {
			assert.equal(step.if, undefined, step.name);
			assert.equal(step["continue-on-error"], undefined, step.name);
		}
		assert.doesNotMatch(WORKFLOW_TEXT, /always\(\)|failure\(\)|continue-on-error|cancelled\(\)/);
		const runs = Object.fromEntries(release.steps.filter((step) => step.run).map((step) => [step.name, step.run]));
		assert.deepEqual(runs, {
			"Confirm release candidate": "node scripts/release/guard.mjs",
			"Check npm registry": "node scripts/release/registry.mjs",
			"Check release readiness": "node scripts/release/readiness.mjs",
			"Install dependencies": "npm ci --ignore-scripts",
			"Run default suite": "npm test",
			"Run host integration gate": "npm run test:integration",
			"Verify package contents": "npm pack --dry-run --ignore-scripts",
			"Publish, tag, and create GitHub release": "node scripts/release/release.mjs",
		});
		assert.equal(detect.steps[2].run, "node scripts/release/detect.mjs");
	});

	it("passes values through env, never interpolated into a shell line, and exposes secrets only to the mutation step", () => {
		for (const line of WORKFLOW_TEXT.split("\n").filter((line) => /^\s+run:/.test(line))) assert.doesNotMatch(line, /\$\{\{/);
		assert.equal(WORKFLOW_TEXT.match(/secrets\./g)?.length, 1);
		assert.equal(WORKFLOW_TEXT.match(/github\.token/g)?.length, 1);
		const steps = Object.fromEntries(WORKFLOW.jobs.release.steps.map((step) => [step.name, step]));
		assert.deepEqual(steps["Publish, tag, and create GitHub release"].env, {
			PACKAGE_NAME: "${{ needs.detect.outputs.name }}",
			VERSION: "${{ needs.detect.outputs.version }}",
			TAG: "${{ needs.detect.outputs.tag }}",
			REGISTRY_STATE: "${{ steps.registry.outputs.registry }}",
			BOOTSTRAP_NPM_TOKEN: "${{ secrets.NPM_TOKEN }}",
			GH_TOKEN: "${{ github.token }}",
		});
		assert.equal(steps["Check npm registry"].env.REGISTRY_URL, "https://registry.npmjs.org/");
		assert.equal(steps["Check npm registry"].id, "registry");
		assert.deepEqual(Object.keys(steps["Check release readiness"].env), []);
		assert.doesNotMatch(WORKFLOW_TEXT, /npm install -g|curl |wget |self-hosted|pull_request/);
	});
});

async function walkWorkflow(t, { registryReply }) {
	const root = makeTempRoot(t, "release-walk");
	const home = join(root, "home");
	const hooks = join(root, "no-hooks");
	const fakeBin = join(root, "fake-bin");
	for (const dir of [home, hooks, fakeBin]) mkdirSync(dir);
	const gitconfig = join(root, "gitconfig");
	writeFileSync(gitconfig, "");
	const log = join(root, "commands.log");
	for (const tool of ["npm", "gh"]) {
		writeFileSync(join(fakeBin, tool), `#!/bin/sh\necho "${tool} $*" >> "${log}"\nexit 2\n`);
		chmodSync(join(fakeBin, tool), 0o755);
	}
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
		["core.hooksPath", hooks],
	]) {
		git(repo, "config", key, value);
	}
	const manifest = (version) => ({
		...JSON.parse(read("package.json")),
		private: undefined,
		version,
	});
	writeFileSync(join(repo, "package.json"), `${JSON.stringify(manifest("1.2.2"), null, "\t")}\n`);
	git(repo, "add", "package.json");
	git(repo, "commit", "--quiet", "-m", "previous");
	const before = git(repo, "rev-parse", "HEAD");
	writeFileSync(join(repo, "package.json"), `${JSON.stringify(manifest("1.2.3"), null, "\t")}\n`);
	git(repo, "add", "package.json");
	git(repo, "commit", "--quiet", "-m", "bump");
	const sha = git(repo, "rev-parse", "HEAD");
	git(repo, "remote", "add", "origin", origin);
	git(repo, "push", "--quiet", "origin", "main");
	cpSync(join(PACKAGE_ROOT, "scripts"), join(repo, "scripts"), { recursive: true });

	const server = createServer((_request, response) => {
		response.writeHead(registryReply(sha).status, { "content-type": "application/json" });
		response.end(JSON.stringify(registryReply(sha).body));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));

	const context = {
		"github.event.before": before,
		"github.event.repository.private": "false",
		"github.event.repository.visibility": "public",
		"secrets.NPM_TOKEN": "",
		"github.token": "gh_walk_token",
	};
	const githubEnv = {
		GITHUB_EVENT_NAME: "push",
		GITHUB_REF: "refs/heads/main",
		GITHUB_SHA: sha,
		GITHUB_REPOSITORY: REPOSITORY,
		GITHUB_SERVER_URL: "https://github.com",
		RUNNER_ENVIRONMENT: "github-hosted",
	};
	const resolve = (value, outputs) =>
		value.replace(/\$\{\{ ([^}]+) \}\}/g, (_match, expression) => {
			const step = /^steps\.(\w+)\.outputs\.(\w+)$/.exec(expression);
			const need = /^needs\.detect\.outputs\.(\w+)$/.exec(expression);
			if (step) return outputs.steps[step[1]]?.[step[2]] ?? "";
			if (need) return outputs.detect[need[1]] ?? "";
			assert.ok(Object.hasOwn(context, expression), `unresolved workflow expression ${expression}`);
			return context[expression];
		});

	const runStep = async (step, outputs, index) => {
		const output = join(root, `output-${index}`);
		const stepEnv = Object.fromEntries(Object.entries(step.env).map(([key, value]) => [key, resolve(value, outputs)]));
		if (step.name === "Check npm registry") stepEnv.REGISTRY_URL = `http://127.0.0.1:${server.address().port}/`;
		const result = await run("/bin/bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.run], {
			cwd: repo,
			env: { ...env, ...githubEnv, ...stepEnv, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(root, "summary.md") },
			timeoutMs: 30_000,
			root,
		});
		const values = existsSync(output)
			? Object.fromEntries(
					readFileSync(output, "utf8")
						.split("\n")
						.filter(Boolean)
						.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
				)
			: {};
		if (step.id) outputs.steps[step.id] = values;
		return result;
	};

	const outputs = { steps: {}, detect: {} };
	const detectSteps = WORKFLOW.jobs.detect.steps.filter((step) => step.run);
	for (const [index, step] of detectSteps.entries()) {
		const result = await runStep(step, outputs, `detect-${index}`);
		assert.equal(result.code, 0, result.stderr);
	}
	outputs.detect = outputs.steps.detect;
	outputs.steps = {};
	assert.equal(outputs.detect.decision, "candidate");
	const ran = [];
	let stopped = null;
	for (const [index, step] of WORKFLOW.jobs.release.steps.entries()) {
		if (step.uses) continue;
		const result = await runStep(step, outputs, `release-${index}`);
		ran.push(step.name);
		if (result.code !== 0) {
			stopped = { step: step.name, stdout: result.stdout, stderr: result.stderr };
			break;
		}
	}
	return {
		ran,
		stopped,
		registry: outputs.steps.registry?.registry,
		commands: existsSync(log) ? readFileSync(log, "utf8") : "",
		remoteTags: git(origin, "tag", "--list"),
	};
}

describe("release workflow walk", () => {
	for (const [label, registryReply, state] of [
		["a version bump", () => ({ status: 200, body: { name: NAME, versions: {} } }), "version-absent"],
		["an exact same-commit retry", (sha) => ({ status: 200, body: { name: NAME, versions: { "1.2.3": { name: NAME, version: "1.2.3", gitHead: sha } } } }), "same-commit-published"],
		["a first publication", () => ({ status: 404, body: { error: "Not found" } }), "absent"],
	]) {
		it(`stops ${label} at the readiness check before any install, test, publish, tag, or release`, async (t) => {
			const walk = await walkWorkflow(t, { registryReply });
			assert.equal(walk.registry, state);
			assert.deepEqual(walk.ran, ["Confirm release candidate", "Check npm registry", "Check release readiness"]);
			assert.equal(walk.stopped?.step, "Check release readiness");
			for (const blocker of RELEASE_BLOCKERS) assert.match(walk.stopped.stdout, new RegExp(blocker.id));
			assert.equal(walk.commands, "", "no npm or gh command ran");
			assert.equal(walk.remoteTags, "");
		});
	}
});

describe("release metadata and documentation", () => {
	const manifest = JSON.parse(read("package.json"));

	it("names the public repository and keeps the package private at 0.0.0", () => {
		assert.equal(manifest.version, "0.0.0");
		assert.equal(manifest.private, true);
		assert.deepEqual(manifest.repository, { type: "git", url: `git+https://github.com/${REPOSITORY}.git` });
		assert.equal(manifest.homepage, `https://github.com/${REPOSITORY}#readme`);
		assert.deepEqual(manifest.bugs, { url: `https://github.com/${REPOSITORY}/issues` });
		assert.deepEqual(manifest.publishConfig, { access: "public" });
		assert.deepEqual(manifest["auto-changelog"], { commitLimit: false, template: "keepachangelog", unreleased: true });
		assert.equal(manifest.scripts.changelog, "auto-changelog");
	});

	it("locks auto-changelog 2.7.0 from npm and installs no peer", () => {
		const lock = JSON.parse(read("package-lock.json"));
		assert.equal(lock.lockfileVersion, 3);
		assert.equal(lock.name, NAME);
		assert.deepEqual(lock.packages[""].devDependencies, { "auto-changelog": "^2.6.0" });
		assert.deepEqual(lock.packages[""].peerDependencies, { "pi-herdr-agents": "3.2.1" });
		assert.equal(lock.packages["node_modules/auto-changelog"].version, "2.7.0");
		assert.equal(lock.packages["node_modules/pi-herdr-agents"], undefined);
		for (const [path, entry] of Object.entries(lock.packages).filter(([path]) => path !== "")) {
			assert.equal(entry.dev, true, path);
			assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//, path);
			assert.match(entry.integrity, /^sha512-/, path);
		}
	});

	it("keeps peers out of development installs with a credential-free project .npmrc", () => {
		const npmrc = read(".npmrc");
		const settings = npmrc.split("\n").filter((line) => line.trim() && !line.startsWith("#"));
		assert.deepEqual(settings, ["legacy-peer-deps=true"]);
		assert.doesNotMatch(npmrc, /_auth|token|registry=|always-auth/i);
	});

	it("documents that the workflow is set up but publication is disabled, with every blocker", () => {
		const guide = read("RELEASING.md");
		assert.match(guide, /publication is disabled/i);
		for (const blocker of RELEASE_BLOCKERS) assert.ok(guide.includes(`\`${blocker.id}\``), blocker.id);
		assert.match(read("README.md"), /\[[^\]]+\]\(RELEASING\.md\)/);
		assert.match(read("README.md"), /publication is disabled/i);
	});

	it("generates the changelog from this repository's history", () => {
		const changelog = read("CHANGELOG.md");
		assert.match(changelog, /^# Changelog/);
		assert.match(changelog, /auto-changelog/);
		const links = [...changelog.matchAll(/https:\/\/github\.com\/([^/\s)]+\/[^/\s)]+)\//g)].map((match) => match[1]);
		assert.ok(links.length > 0);
		for (const repository of links) assert.equal(repository, REPOSITORY);
		assert.doesNotMatch(changelog, /pi-herdr-pstack/);
	});
});

const BOOTSTRAP_RUN = (() => {
	const lines = WORKFLOW_TEXT.split("\n");
	const start = lines.indexOf("        run: |", lines.indexOf("  bootstrap:"));
	return blockLines(lines, start + 1, 10).map((line) => line.slice(10)).join("\n") + "\n";
})();

describe("metadata-only bootstrap job", () => {
	const job = WORKFLOW.jobs.bootstrap;

	it("runs once, on the first attempt of the main push that first adds the bootstrap manifest", () => {
		assert.equal(
			job.if,
			"github.event_name == 'push' && github.ref == 'refs/heads/main' && github.repository == 'giuseppecrj/pi-herdr-clean-craft' && github.event.repository.private == false && github.run_attempt == 1",
		);
		assert.equal(job.needs, undefined);
		assert.equal(job["runs-on"], "ubuntu-latest");
		assert.equal(job["timeout-minutes"], "10");
		assert.deepEqual(job.permissions, { contents: "read", "id-token": "write" });
		assert.deepEqual(job.steps.map((step) => step.uses?.split(" ")[0] ?? step.name), [CHECKOUT, SETUP_NODE, "Stage and publish bootstrap metadata"]);
		assert.deepEqual(job.steps[0].with, { "fetch-depth": "0", "persist-credentials": "false" });
		assert.deepEqual(job.steps[1].with, { "node-version": "26.8.2", "registry-url": "https://registry.npmjs.org", "package-manager-cache": "false" });
		assert.deepEqual(job.steps[2].env, { NODE_AUTH_TOKEN: "''", BEFORE_SHA: "${{ github.event.before }}" });
		assert.doesNotMatch(job.if, /head_commit\.(added|modified|removed)/);
		assert.doesNotMatch(BOOTSTRAP_RUN, /\$\{\{|TOKEN|secrets|npm pack|git tag|gh /);
	});

	it("ships exactly three metadata files with the target version and no runtime fields", () => {
		const manifest = JSON.parse(read(".github/npm-bootstrap/package.json"));
		assert.equal(`${manifest.name}@${manifest.version}`, `${NAME}@0.0.0-bootstrap.1`);
		assert.deepEqual(manifest.publishConfig, { access: "public", tag: "bootstrap" });
		for (const key of ["main", "exports", "bin", "scripts", "dependencies", "pi", "private"]) assert.equal(manifest[key], undefined, key);
		assert.equal(read(".github/npm-bootstrap/LICENSE"), read("LICENSE"));
	});

	it("validates and stages only the bootstrap files, then publishes the staged copy", async (t) => {
		const root = makeTempRoot(t, "bootstrap-job");
		const work = join(root, "work");
		const bin = join(root, "bin");
		mkdirSync(join(root, "runner"));
		mkdirSync(bin);
		cpSync(join(PACKAGE_ROOT, ".github", "npm-bootstrap"), join(work, ".github", "npm-bootstrap"), { recursive: true });
		writeFileSync(join(work, "package.json"), "{\"private\":true}\n");
		writeFileSync(join(bin, "npm"), `#!/bin/sh\nprintf '%s\\n' "$PWD" "$@" > "${root}/npm.log"\n`);
		chmodSync(join(bin, "npm"), 0o755);
		const env = isolatedEnv(root, { RUNNER_TEMP: join(root, "runner"), NODE_AUTH_TOKEN: "", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" });
		env.PATH = `${bin}${delimiter}${env.PATH}`;
		const git = (...args) => execFileSync("git", ["-c", "user.name=Workflow Test", "-c", "user.email=workflow@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: work, env, encoding: "utf8", timeout: 10_000 }).trim();
		git("init", "--quiet");
		git("add", "package.json");
		git("commit", "--quiet", "-m", "before bootstrap");
		env.BEFORE_SHA = git("rev-parse", "HEAD");
		git("add", ".github");
		git("commit", "--quiet", "-m", "add bootstrap");
		env.GITHUB_SHA = git("rev-parse", "HEAD");
		const ok = await run("bash", ["-e", "-c", BOOTSTRAP_RUN], { cwd: work, env, root, timeoutMs: 30_000 });
		assert.equal(ok.code, 0, ok.stderr);
		const [stage, ...args] = readFileSync(join(root, "npm.log"), "utf8").trim().split("\n");
		assert.ok(stage.startsWith(join(root, "runner", "bootstrap.")), stage);
		assert.deepEqual(args, ["publish", "--ignore-scripts", "--access", "public", "--tag", "bootstrap", "--provenance", "--fetch-retries=0", "--registry", "https://registry.npmjs.org/"]);
		assert.deepEqual(execFileSync("ls", [stage], { encoding: "utf8" }).split("\n").filter(Boolean), ["LICENSE", "README.md", "package.json"]);
		const staged = JSON.parse(readFileSync(join(stage, "package.json"), "utf8"));
		assert.equal(staged.gitHead, env.GITHUB_SHA);
		assert.equal(JSON.parse(read(".github/npm-bootstrap/package.json")).gitHead, undefined);
		writeFileSync(join(root, "npm.log"), "no new publication");
		const skipped = await run("bash", ["-e", "-c", BOOTSTRAP_RUN], { cwd: work, env: { ...env, BEFORE_SHA: env.GITHUB_SHA }, root, timeoutMs: 30_000 });
		assert.equal(skipped.code, 0, skipped.stderr);
		assert.match(skipped.stdout, /already existed/);
		assert.equal(readFileSync(join(root, "npm.log"), "utf8"), "no new publication");
		const missing = await run("bash", ["-e", "-c", BOOTSTRAP_RUN], { cwd: work, env: { ...env, BEFORE_SHA: "f".repeat(40) }, root, timeoutMs: 30_000 });
		assert.notEqual(missing.code, 0);
		assert.equal(readFileSync(join(root, "npm.log"), "utf8"), "no new publication");

		writeFileSync(join(work, ".github", "npm-bootstrap", "package.json"), JSON.stringify({ ...staged, gitHead: undefined, scripts: { postinstall: "x" } }));
		const refused = await run("bash", ["-e", "-c", BOOTSTRAP_RUN], { cwd: work, env, root, timeoutMs: 30_000 });
		assert.notEqual(refused.code, 0);
		assert.match(refused.stderr, /unexpected manifest keys/);
	});
});
