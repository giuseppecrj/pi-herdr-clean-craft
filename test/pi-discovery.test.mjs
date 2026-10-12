import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { EXTENSIONS, expectedPackFiles, SKILLS } from "./inventory.mjs";
import { resolveExecutable } from "./phase3/prerequisites.mjs";
import { extractPack, isolatedEnv, listFiles, makeTempRoot, npmPack, PACKAGE_ROOT, run } from "./support.mjs";

// --no-extensions would also drop the package's own extension, so only Pi's built-ins are switched off, in settings.
const PI_FLAGS = ["--mode", "rpc", "--no-session", "--offline", "--no-context-files", "--no-tools", "--no-prompt-templates", "--no-themes", "--no-approve"];
const BUILTIN_EXTENSIONS_OFF = ["-builtin:mcp", "-builtin:llama.cpp", "-builtin:codemode", "-builtin:tool-search"];

function requirePi() {
	const pi = resolveExecutable(process.env, { variable: "CLEAN_CRAFT_PI_BIN", name: "pi" });
	if (pi.kind === "blocked") assert.fail(`BLOCKED: ${pi.reason}. Package discovery is a required gate and has not passed.`);
	return pi.path;
}

function piEnv(root) {
	const agentDir = join(root, "agent");
	for (const dir of ["home", "agent", "cwd", "xdg/config", "xdg/cache", "xdg/data", "xdg/state"]) {
		mkdirSync(join(root, dir), { recursive: true });
	}
	return {
		agentDir,
		cwd: join(root, "cwd"),
		env: isolatedEnv(root, {
			PI_CODING_AGENT_DIR: agentDir,
			PI_OFFLINE: "1",
			PI_SKIP_VERSION_CHECK: "1",
			PI_TELEMETRY: "0",
		}),
	};
}

async function discoveredCommands(t, packageRoot) {
	const pi = requirePi();
	const root = makeTempRoot(t, "pi");
	const { agentDir, cwd, env } = piEnv(root);
	const version = await run(pi, ["--version"], { cwd, env, timeoutMs: 15_000, root });
	assert.equal(version.code, 0, version.stderr);
	t.diagnostic(`pi ${version.stdout.trim()} at ${pi}`);
	writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify({ packages: [packageRoot], extensions: BUILTIN_EXTENSIONS_OFF, enableInstallTelemetry: false }, null, "\t")}\n`);
	const result = await run(pi, PI_FLAGS, {
		cwd,
		env,
		root,
		timeoutMs: 30_000,
		input: `${JSON.stringify({ id: "discover", type: "get_commands" })}\n`,
	});
	assert.equal(result.code, 0, `pi exited ${result.code} ${result.signal ?? ""}\n${result.stderr}`);
	assert.equal(result.stderr, "", "Pi reported resource diagnostics");
	const response = result.stdout
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line))
		.find((record) => record.type === "response" && record.id === "discover");
	assert.ok(response, `no get_commands response in:\n${result.stdout}`);
	assert.equal(response.success, true, response.error);
	return response.data.commands;
}

function assertInventoryRegistered(commands, packageRoot) {
	assert.deepEqual(commands.map((command) => command.name).toSorted(), ["craft-mode", ...SKILLS.map((skill) => `skill:${skill.name}`)].toSorted());
	const mode = commands.find((entry) => entry.name === "craft-mode");
	assert.equal(mode.source, "extension");
	assert.deepEqual(
		{ path: mode.sourceInfo.path, source: mode.sourceInfo.source, scope: mode.sourceInfo.scope, origin: mode.sourceInfo.origin },
		{ path: join(packageRoot, EXTENSIONS[0]), source: packageRoot, scope: "user", origin: "package" },
	);
	for (const skill of SKILLS) {
		const command = commands.find((entry) => entry.name === `skill:${skill.name}`);
		assert.deepEqual(command, {
			name: `skill:${skill.name}`,
			description: skill.description,
			source: "skill",
			sourceInfo: {
				path: join(packageRoot, skill.path),
				source: packageRoot,
				scope: "user",
				origin: "package",
				baseDir: packageRoot,
			},
		});
	}
}

describe("Pi RPC discovery of a locally registered package", () => {
	it("registers the source checkout's skills and command from test-owned settings", async (t) => {
		assertInventoryRegistered(await discoveredCommands(t, PACKAGE_ROOT), PACKAGE_ROOT);
	});

	it("registers the skills and command from the extracted npm tarball", async (t) => {
		const packageRoot = await extractPack(await npmPack(t, { dryRun: false }));
		assert.deepEqual(listFiles(packageRoot), expectedPackFiles());
		assertInventoryRegistered(await discoveredCommands(t, packageRoot), packageRoot);
	});

	it.todo("host orchestration, fresh-child resources and pstack coexistence (separate required gate: npm run test:integration, not run here)");
	it.todo("follows the methodology with a live model (Phase 6 evaluation, not measured)");
});
