import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";
import { isolatedEnv, makeTempRoot, PACKAGE_ROOT, run } from "./support.mjs";

const NAME = "pi-herdr-clean-craft";
const REPOSITORY = "giuseppecrj/pi-herdr-clean-craft";
const CHECKOUT = "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09";
const SETUP_NODE = "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444";
const WORKFLOW_TEXT = readFileSync(join(PACKAGE_ROOT, ".github", "workflows", "publish.yml"), "utf8");
const read = (path) => readFileSync(join(PACKAGE_ROOT, path), "utf8");
const PI_URL = "https://github.com/earendil-works/pi/releases/download/v1.1.0/pi-linux-x64.tar.gz";
const PI_ARCHIVE_SHA256 = "3faa94666cd3849d37af320ff749407d0271b07a9b94f420c87e30866e10e289";
const PI_BINARY_SHA256 = "5d527eae57d99f80f9397a84d0228528a92b3595b2c5f3d969e45b02ea72a6bc";

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
		const block = () => blockLines(lines, index + 1, indent + 2);
		if (match[2] === ">-")
			result[match[1]] = block()
				.map((part) => part.trim())
				.join(" ");
		else if (match[2] === "|")
			result[match[1]] = `${block()
				.map((part) => part.slice(indent + 2))
				.join("\n")}\n`;
		else result[match[1]] = match[2] ?? "";
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
	"Install dependencies",
	"Check formatting",
	"Run lint",
	"Provision Pi 1.1.0",
	"Run checks",
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
			"Install dependencies": "npm ci --ignore-scripts",
			"Check formatting": "npm run format:check",
			"Run lint": "npm run lint",
			"Provision Pi 1.1.0": runs["Provision Pi 1.1.0"],
			"Run checks": "npm run check",
			"Verify package contents": "npm pack --dry-run --ignore-scripts",
			"Publish, tag, and create GitHub release": "node scripts/release/release.mjs",
		});
		assert.equal(detect.steps[2].run, "node scripts/release/detect.mjs");
	});

	it("passes values through env, never interpolated into a shell line, and exposes secrets only to the mutation step", () => {
		for (const step of Object.values(WORKFLOW.jobs).flatMap((job) => job.steps)) assert.doesNotMatch(step.run ?? "", /\$\{\{/, step.name);
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
		for (const name of RELEASE_STEPS.slice(4, 10)) assert.deepEqual(steps[name].env, {}, name);
		assert.doesNotMatch(WORKFLOW_TEXT, /npm install -g|sudo |wget |self-hosted|pull_request|test:integration|herdr-agents|pstack/);
	});

	it("provisions only the pinned Pi 1.1.0 build, verified before extraction and use, through GITHUB_ENV", () => {
		const provision = WORKFLOW.jobs.release.steps.find((step) => step.name === "Provision Pi 1.1.0").run;
		assert.equal(WORKFLOW_TEXT.match(/curl /g)?.length, 1, "only the Pi download fetches anything");
		const lines = provision.split("\n").map((line) => line.trim());
		const at = (pattern) => lines.findIndex((line) => pattern.test(line));
		assert.ok(lines.includes(PI_URL));
		assert.match(provision, /curl --fail --silent --show-error --location --proto '=https' \\\n\s+--max-time 300 --max-filesize 67108864 --output "\$archive"/);
		assert.match(provision, /^archive="\$RUNNER_TEMP\/pi-linux-x64\.tar\.gz"$/m);
		assert.ok(at(new RegExp(PI_ARCHIVE_SHA256)) < at(/^tar /), "the archive digest is checked before extraction");
		assert.ok(at(/^tar /) < at(new RegExp(PI_BINARY_SHA256)), "the binary digest is checked after extraction");
		assert.ok(at(new RegExp(PI_BINARY_SHA256)) < at(/GITHUB_ENV/), "the binary is exported only after its digest matches");
		assert.equal(lines.filter((line) => line.endsWith("sha256sum --check --strict -")).length, 2);
		assert.equal(lines.at(-2), 'echo "CLEAN_CRAFT_PI_BIN=$dir/pi/pi" >> "$GITHUB_ENV"');
	});
});

const CHECK_COMMANDS = {
	"Install dependencies": "ci --ignore-scripts",
	"Check formatting": "run format:check",
	"Run lint": "run lint",
	"Run checks": "run check",
	"Verify package contents": "pack --dry-run --ignore-scripts",
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function piArchive(root) {
	const stage = join(root, "pi-release");
	mkdirSync(join(stage, "pi"), { recursive: true });
	writeFileSync(join(stage, "pi", "pi"), "#!/bin/sh\necho 1.1.0\n");
	chmodSync(join(stage, "pi", "pi"), 0o755);
	const archive = join(root, "pi-linux-x64.tar.gz");
	execFileSync("tar", ["-czf", archive, "-C", stage, "pi"]);
	return { archive, archiveSha256: sha256(readFileSync(archive)), binarySha256: sha256(readFileSync(join(stage, "pi", "pi"))) };
}

async function walkWorkflow(t, { registryReply, failAt = null, pinnedPi = false }) {
	const root = makeTempRoot(t, "release-walk");
	const home = join(root, "home");
	const hooks = join(root, "no-hooks");
	const fakeBin = join(root, "fake-bin");
	const runnerTemp = join(root, "runner-temp");
	for (const dir of [home, hooks, fakeBin, runnerTemp]) mkdirSync(dir);
	const gitconfig = join(root, "gitconfig");
	writeFileSync(gitconfig, "");
	const log = join(root, "commands.log");
	const pi = piArchive(root);
	const passing = Object.entries(CHECK_COMMANDS)
		.filter(([step]) => step !== failAt)
		.map(([, args]) => `"${args}"`)
		.join("|");
	const failing = failAt ? `"${CHECK_COMMANDS[failAt]}") exit 1 ;;` : "";
	const scripts = {
		npm: `#!/bin/sh\necho "npm $* pi=\${CLEAN_CRAFT_PI_BIN:-}" >> "${log}"\ncase "$*" in\n  ${passing}) exit 0 ;;\n  ${failing}\nesac\nexit 2\n`,
		gh: `#!/bin/sh\necho "gh $*" >> "${log}"\nexit 2\n`,
		curl: `#!/bin/sh\necho "curl $*" >> "${log}"\nwhile [ "$1" != "--output" ]; do shift; done\ncp "${pi.archive}" "$2"\n`,
	};
	for (const [tool, script] of Object.entries(scripts)) {
		writeFileSync(join(fakeBin, tool), script);
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
	const githubEnvFile = join(root, "github-env");
	writeFileSync(githubEnvFile, "");
	const githubEnv = {
		GITHUB_EVENT_NAME: "push",
		GITHUB_REF: "refs/heads/main",
		GITHUB_SHA: sha,
		GITHUB_REPOSITORY: REPOSITORY,
		GITHUB_SERVER_URL: "https://github.com",
		GITHUB_ENV: githubEnvFile,
		RUNNER_ENVIRONMENT: "github-hosted",
		RUNNER_TEMP: runnerTemp,
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
	const keyValues = (path) =>
		existsSync(path)
			? Object.fromEntries(
					readFileSync(path, "utf8")
						.split("\n")
						.filter(Boolean)
						.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
				)
			: {};

	const runStep = async (step, outputs, index) => {
		const output = join(root, `output-${index}`);
		const stepEnv = Object.fromEntries(Object.entries(step.env).map(([key, value]) => [key, resolve(value, outputs)]));
		if (step.name === "Check npm registry") stepEnv.REGISTRY_URL = `http://127.0.0.1:${server.address().port}/`;
		let script = step.run;
		if (step.name === "Provision Pi 1.1.0" && !pinnedPi) {
			assert.ok(script.includes(PI_ARCHIVE_SHA256) && script.includes(PI_BINARY_SHA256));
			script = script.replace(PI_ARCHIVE_SHA256, pi.archiveSha256).replace(PI_BINARY_SHA256, pi.binarySha256);
		}
		const result = await run("/bin/bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
			cwd: repo,
			env: { ...env, ...keyValues(githubEnvFile), ...githubEnv, ...stepEnv, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(root, "summary.md") },
			timeoutMs: 30_000,
			root,
		});
		if (step.id) outputs.steps[step.id] = keyValues(output);
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
		commands: existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [],
		exported: keyValues(githubEnvFile),
		runnerTemp,
		remoteTags: git(origin, "tag", "--list"),
	};
}

const REGISTRY_REPLIES = {
	"a version bump": [() => ({ status: 200, body: { name: NAME, versions: {} } }), "version-absent"],
	"an exact same-commit retry": [(sha) => ({ status: 200, body: { name: NAME, versions: { "1.2.3": { name: NAME, version: "1.2.3", gitHead: sha } } } }), "same-commit-published"],
};
const ALL_STEPS = RELEASE_STEPS.slice(2);

function assertNothingReleased(walk) {
	assert.equal(
		walk.commands.some((line) => /^npm publish|^gh release create/.test(line)),
		false,
		walk.commands.join("\n"),
	);
	assert.equal(walk.remoteTags, "");
}

describe("release workflow walk", () => {
	for (const [label, [registryReply, state]] of Object.entries(REGISTRY_REPLIES)) {
		for (const failAt of Object.keys(CHECK_COMMANDS)) {
			it(`stops ${label} at a failing "${failAt}" step with no later step, publish, tag, or release`, async (t) => {
				const walk = await walkWorkflow(t, { registryReply, failAt });
				assert.equal(walk.registry, state);
				assert.equal(walk.stopped?.step, failAt);
				assert.deepEqual(walk.ran, ALL_STEPS.slice(0, ALL_STEPS.indexOf(failAt) + 1));
				assertNothingReleased(walk);
			});
		}

		it(`runs every mandatory check in order for ${label}, with the verified Pi, before reaching publication`, async (t) => {
			const walk = await walkWorkflow(t, { registryReply });
			assert.equal(walk.registry, state);
			assert.deepEqual(walk.ran, ALL_STEPS);
			assert.equal(walk.stopped?.step, "Publish, tag, and create GitHub release", "the stand-in npm and gh refuse the publication script's first query");
			const piBin = walk.exported.CLEAN_CRAFT_PI_BIN;
			assert.ok(piBin.startsWith(join(walk.runnerTemp, "pi.")) && piBin.endsWith("/pi/pi"), piBin);
			assert.equal(execFileSync(piBin, { encoding: "utf8" }), "1.1.0\n");
			const checks = walk.commands.filter((line) => line.startsWith("npm ") && !line.startsWith("npm --version"));
			assert.deepEqual(checks, ["npm ci --ignore-scripts pi=", "npm run format:check pi=", "npm run lint pi=", `npm run check pi=${piBin}`, `npm pack --dry-run --ignore-scripts pi=${piBin}`]);
			assert.deepEqual(
				walk.commands.filter((line) => line.startsWith("curl ")),
				[`curl --fail --silent --show-error --location --proto =https --max-time 300 --max-filesize 67108864 --output ${join(walk.runnerTemp, "pi-linux-x64.tar.gz")} ${PI_URL}`],
			);
			assertNothingReleased(walk);
		});
	}

	it("stops at provisioning when the downloaded Pi archive does not match the pinned digest", async (t) => {
		const [registryReply] = REGISTRY_REPLIES["a version bump"];
		const walk = await walkWorkflow(t, { registryReply, pinnedPi: true });
		assert.equal(walk.stopped?.step, "Provision Pi 1.1.0");
		assert.match(walk.stopped.stderr, /FAILED|did NOT match/);
		assert.deepEqual(walk.exported, {});
		assert.deepEqual(readdirSync(walk.runnerTemp), ["pi-linux-x64.tar.gz"], "nothing was extracted");
		assert.equal(
			walk.commands.some((line) => line.startsWith("npm run check")),
			false,
		);
		assertNothingReleased(walk);
	});
});

describe("release metadata and documentation", () => {
	const manifest = JSON.parse(read("package.json"));

	it("names the public repository and prepares the public 0.1.0 package", () => {
		assert.equal(manifest.version, "0.1.0");
		assert.equal(manifest.private, undefined);
		assert.deepEqual(manifest.repository, { type: "git", url: `git+https://github.com/${REPOSITORY}.git` });
		assert.equal(manifest.homepage, `https://github.com/${REPOSITORY}#readme`);
		assert.deepEqual(manifest.bugs, { url: `https://github.com/${REPOSITORY}/issues` });
		assert.deepEqual(manifest.publishConfig, { access: "public" });
		assert.deepEqual(manifest["auto-changelog"], { commitLimit: false, template: "keepachangelog", unreleased: true });
		assert.equal(manifest.scripts.changelog, "auto-changelog");
	});

	it("runs the mandatory checks through exact development tools and fails fast", () => {
		assert.deepEqual(manifest.scripts, {
			check: "npm run typecheck && npm run lint && npm run format:check && npm test",
			format: "biome format --write scripts test",
			"format:check": "biome format scripts test",
			lint: "oxlint scripts test",
			typecheck: "tsc -p test/fixtures/retry-eligibility/tsconfig.json",
			test: "node --test --test-concurrency=1 test/*.test.mjs",
			"test:integration": "node --test --test-concurrency=1 test/integration/*.test.mjs",
			changelog: "auto-changelog",
			version: "auto-changelog --package && git add CHANGELOG.md",
		});
		assert.equal(manifest.dependencies, undefined);
		const biome = JSON.parse(read("biome.json"));
		assert.deepEqual(biome.files.includes, ["scripts/**", "test/**", "!test/fixtures/**", "!**/*.md"]);
		assert.equal(biome.formatter.enabled, true);
		const oxlint = JSON.parse(read(".oxlintrc.json"));
		assert.deepEqual(oxlint.categories, { correctness: "error" });
		assert.ok(oxlint.ignorePatterns.includes("test/fixtures/**"));
		assert.equal(JSON.parse(read("test/fixtures/retry-eligibility/tsconfig.json")).compilerOptions.strict, true);
	});

	it("locks exact development tools from npm and installs no peer", () => {
		const lock = JSON.parse(read("package-lock.json"));
		assert.equal(lock.lockfileVersion, 3);
		assert.equal(lock.name, NAME);
		const tools = { "@biomejs/biome": "2.5.11", oxlint: "1.80.0", typescript: "5.9.3" };
		assert.deepEqual(lock.packages[""].devDependencies, { ...tools, "auto-changelog": "^2.6.0" });
		assert.deepEqual(manifest.devDependencies, lock.packages[""].devDependencies);
		assert.deepEqual(lock.packages[""].peerDependencies, { "pi-herdr-agents": "3.2.1" });
		assert.equal(lock.packages["node_modules/auto-changelog"].version, "2.7.0");
		for (const [name, version] of Object.entries(tools)) assert.equal(lock.packages[`node_modules/${name}`].version, version, name);
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

	it("documents the mandatory checks in order and keeps the separate host gate and its known failure visible", () => {
		const guide = read("RELEASING.md");
		const order = ["npm ci --ignore-scripts", "npm run format:check", "npm run lint", "npm run check", "npm pack --dry-run --ignore-scripts"].map((command) => guide.indexOf(`\`${command}\``));
		assert.ok(
			order.every((at, index) => at !== -1 && (index === 0 || at > order[index - 1])),
			"RELEASING.md lists the mandatory checks in workflow order",
		);
		assert.match(guide, /`npm run test:integration`/);
		assert.match(guide, /`skills` argument does not deliver the skill/);
		assert.doesNotMatch(guide, /readiness\.mjs|phase6-live-model-evaluation/);
		assert.match(read("README.md"), /\[[^\]]+\]\(RELEASING\.md\)/);
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
	return (
		blockLines(lines, start + 1, 10)
			.map((line) => line.slice(10))
			.join("\n") + "\n"
	);
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
		assert.deepEqual(
			job.steps.map((step) => step.uses?.split(" ")[0] ?? step.name),
			[CHECKOUT, SETUP_NODE, "Stage and publish bootstrap metadata"],
		);
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
		writeFileSync(join(work, "package.json"), '{"private":true}\n');
		writeFileSync(join(bin, "npm"), `#!/bin/sh\nprintf '%s\\n' "$PWD" "$@" > "${root}/npm.log"\n`);
		chmodSync(join(bin, "npm"), 0o755);
		const env = isolatedEnv(root, { RUNNER_TEMP: join(root, "runner"), NODE_AUTH_TOKEN: "", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" });
		env.PATH = `${bin}${delimiter}${env.PATH}`;
		const git = (...args) =>
			execFileSync("git", ["-c", "user.name=Workflow Test", "-c", "user.email=workflow@example.invalid", "-c", "commit.gpgsign=false", ...args], {
				cwd: work,
				env,
				encoding: "utf8",
				timeout: 10_000,
			}).trim();
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
		assert.deepEqual(readdirSync(stage).sort(), ["LICENSE", "README.md", "package.json"]);
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
