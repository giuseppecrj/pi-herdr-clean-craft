import assert from "node:assert/strict";
import { accessSync, constants, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { expectedPackFiles, SKILLS } from "./inventory.mjs";
import { extractPack, findExecutable, isolatedEnv, listFiles, makeTempRoot, npmPack, PACKAGE_ROOT, run } from "./support.mjs";

const PI_FLAGS = [
	"--mode",
	"rpc",
	"--no-session",
	"--offline",
	"--no-extensions",
	"--no-context-files",
	"--no-tools",
	"--no-prompt-templates",
	"--no-themes",
	"--no-approve",
];

function requirePi() {
	const pi = process.env.CLEAN_CRAFT_PI_BIN ?? findExecutable("pi");
	try {
		accessSync(pi ?? "", constants.X_OK);
	} catch {
		assert.fail(
			"BLOCKED: no executable Pi CLI on PATH or in CLEAN_CRAFT_PI_BIN. Package discovery is a required gate and has not passed.",
		);
	}
	return pi;
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
	const version = await run(pi, ["--version"], { cwd, env, timeoutMs: 15_000 });
	assert.equal(version.code, 0, version.stderr);
	t.diagnostic(`pi ${version.stdout.trim()} at ${pi}`);
	writeFileSync(
		join(agentDir, "settings.json"),
		`${JSON.stringify({ packages: [packageRoot], enableInstallTelemetry: false }, null, "\t")}\n`,
	);
	const result = await run(pi, PI_FLAGS, {
		cwd,
		env,
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
	assert.deepEqual(
		commands.map((command) => command.name).toSorted(),
		SKILLS.map((skill) => `skill:${skill.name}`).toSorted(),
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
	it("registers the source checkout's skills from test-owned settings", async (t) => {
		assertInventoryRegistered(await discoveredCommands(t, PACKAGE_ROOT), PACKAGE_ROOT);
	});

	it("registers the skills from the extracted npm tarball", async (t) => {
		const packageRoot = await extractPack(await npmPack(t, { dryRun: false }));
		assert.deepEqual(listFiles(packageRoot), expectedPackFiles());
		assertInventoryRegistered(await discoveredCommands(t, packageRoot), packageRoot);
	});

	it.todo("delivers complete /skill:craft-mode instructions on a model request (later gate, not measured)");
	it.todo("resolves skills in fresh pi-herdr-agents children (Phase 3 host gate, not measured)");
	it.todo("follows the methodology with a live model (Phase 6 evaluation, not measured)");
});
