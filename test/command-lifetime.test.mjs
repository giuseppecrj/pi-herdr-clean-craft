import assert from "node:assert/strict";
import { existsSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { deadline, within } from "./phase3/event-log.mjs";
import { createRuntime } from "./phase3/runtime.mjs";
import * as support from "./support.mjs";

const NODE = realpathSync(process.execPath);
const ENV = { PATH: "/usr/bin:/bin", HOME: "/nonexistent" };
const KEEP_RUNNING = "setTimeout(() => {}, 20000);";

function holdOutput(ms) {
	return `require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, ${ms})"], { stdio: ["ignore", 1, 2] });`;
}

function ownedRoot(t, label) {
	const hooks = [];
	const root = support.makeTempRoot({ after: (hook) => hooks.push(hook) }, label);
	const end = async () => {
		for (const hook of hooks) await hook();
	};
	t.after(async () => {
		await lateClose(root);
		await end();
	});
	return { root, end };
}

async function rejection(promise) {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	return assert.fail("the command was expected to fail");
}

async function lateClose(root) {
	for (const entry of support.unresolvedUnder?.(root) ?? []) await within(entry.closed, deadline(10_000, `late close of ${entry.argv[0]}`));
}

describe("bounded command closure in the shared run helper", () => {
	it("bounds a timed-out command whose descendant keeps its output open, and keeps its root", async (t) => {
		const { root, end } = ownedRoot(t, "held");
		const started = performance.now();
		const error = await rejection(support.run(NODE, ["-e", `${holdOutput(3000)} ${KEEP_RUNNING}`], { cwd: root, env: ENV, timeoutMs: 200, root, graceMs: 300 }));
		const elapsed = performance.now() - started;
		assert.ok(elapsed < 2000, `run waited ${Math.round(elapsed)} ms after a 200 ms deadline and a 300 ms grace`);
		assert.match(error.message, /exceeded 200 ms/);
		assert.match(error.message, /did not close within 300 ms/);
		const [entry, ...others] = support.unresolvedUnder(root);
		assert.deepEqual(others, []);
		assert.ok(entry.identity, "the command's identity is kept for the report");
		assert.deepEqual(entry.exit, { code: null, signal: "SIGKILL" }, "only the direct child was signalled");
		await assert.rejects(end(), (failure) => failure.message.includes(`retained ${root}`) && failure.message.includes(`pid ${entry.identity.pid}`));
		assert.ok(existsSync(root), "a root whose command has not closed is not deleted");
		await lateClose(root);
		assert.deepEqual(support.unresolvedUnder(root), []);
		await end();
		assert.ok(!existsSync(root), "an observed late close releases the root");
	});

	it("reports a command that exited while its output stayed open as unresolved, not as a clean exit", async (t) => {
		const { root, end } = ownedRoot(t, "exited");
		const error = await rejection(support.run(NODE, ["-e", `${holdOutput(3000)} process.exit(0);`], { cwd: root, env: ENV, timeoutMs: 200, root, graceMs: 300 }));
		assert.match(error.message, /exited with code 0/);
		assert.match(error.message, /did not close within 300 ms/);
		assert.deepEqual(
			support.unresolvedUnder(root).map((entry) => entry.exit),
			[{ code: 0, signal: null }],
		);
		await lateClose(root);
		await end();
		assert.ok(!existsSync(root));
	});

	it("requires the owned root that a command may write into", async () => {
		await assert.rejects(support.run(NODE, ["-e", ""], { cwd: "/", env: ENV, timeoutMs: 5000 }), /owned root/);
	});

	it("resolves a clean exit with its output and releases its root", async (t) => {
		const { root, end } = ownedRoot(t, "clean");
		const result = await support.run(NODE, ["-e", "process.stdout.write('ok'); process.stderr.write('note'); process.exitCode = 3;"], { cwd: root, env: ENV, timeoutMs: 5000, root });
		assert.deepEqual(result, { code: 3, signal: null, stdout: "ok", stderr: "note" });
		await end();
		assert.ok(!existsSync(root));
	});

	it("passes input on stdin", async (t) => {
		const { root, end } = ownedRoot(t, "input");
		const result = await support.run(NODE, ["-e", "process.stdin.pipe(process.stdout)"], { cwd: root, env: ENV, timeoutMs: 5000, root, input: "line\n" });
		assert.equal(result.stdout, "line\n");
		await end();
	});

	it("rejects a timed-out command that closes after its signal and then releases its root", async (t) => {
		const { root, end } = ownedRoot(t, "killed");
		const error = await rejection(support.run(NODE, ["-e", KEEP_RUNNING], { cwd: root, env: ENV, timeoutMs: 200, root }));
		assert.match(error.message, /^node exceeded 200 ms\n/);
		await end();
		assert.ok(!existsSync(root));
	});

	it("rejects a command that cannot start", async (t) => {
		const { root, end } = ownedRoot(t, "missing");
		await assert.rejects(support.run("/nonexistent/clean-craft-command", [], { cwd: root, env: ENV, timeoutMs: 5000, root }), /ENOENT/);
		await end();
		assert.ok(!existsSync(root));
	});
});

describe("runtime teardown with a packing command that has not closed", () => {
	it("reports the command as uncertain and keeps the runtime root", async (t) => {
		const runtime = createRuntime({ pi: NODE, herdr: "/bin/true" });
		const packRoot = join(runtime.paths.pack, "npm");
		let archived = null;
		t.after(async () => {
			await lateClose(runtime.paths.root);
			if (archived?.evidence) rmSync(archived.evidence, { recursive: true, force: true });
			rmSync(runtime.paths.root, { recursive: true, force: true });
		});
		await rejection(support.run(NODE, ["-e", `${holdOutput(3000)} ${KEEP_RUNNING}`], { cwd: runtime.paths.pack, env: ENV, timeoutMs: 200, root: packRoot, graceMs: 300 }));
		const teardown = await runtime.close();
		assert.equal(teardown.kind, "retained", "a runtime whose packing command has not closed is not closed");
		const [pending] = support.unresolvedUnder(runtime.paths.root);
		assert.ok(
			teardown.uncertain.some((entry) => entry.pid === pending.identity.pid && entry.startTime === pending.identity.startTime),
			JSON.stringify(teardown.uncertain),
		);
		archived = runtime.archive({ "report.json": "{}\n" }, { passed: false, ownedArtifacts: [] });
		assert.equal(archived.retainedRoot, runtime.paths.root);
		assert.ok(existsSync(runtime.paths.root));
	});
});
