import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SKILLS } from "./inventory.mjs";
import { FIXED_REPLY, runSkillDelivery } from "./phase3/delivery.mjs";
import { expectedSkill, skillDeliveryProblem } from "./phase3/evidence.mjs";
import { resolveExecutable } from "./phase3/prerequisites.mjs";
import { extractPack, npmPack, PACKAGE_ROOT } from "./support.mjs";

function requirePi() {
	const pi = resolveExecutable(process.env, { variable: "CLEAN_CRAFT_PI_BIN", name: "pi" });
	if (pi.kind === "blocked") assert.fail(`BLOCKED: ${pi.reason}. Request delivery is a required gate and has not passed.`);
	return pi.path;
}

async function deliverAll(t, packageRoot) {
	const pi = requirePi();
	const root = realpathSync(mkdtempSync(join(tmpdir(), "clean-craft-delivery-")));
	const run = await runSkillDelivery({ pi, packageRoot, root, skills: SKILLS });
	const closed = run.cleanup.kind === "closed";
	t.after(() => {
		if (closed) rmSync(root, { recursive: true, force: true });
	});
	assert.equal(run.failure, null, `${run.failure}; retained ${root}`);
	assert.ok(closed, `Pi or the provider did not close; retained ${root}: ${JSON.stringify({ exit: run.exit, providerClosed: run.providerClosed, cleanup: run.cleanup })}`);
	assert.equal(run.exit.forced, null, `Pi needed ${run.exit.forced} to close`);
	assert.equal(run.exit.code, 0, run.stderr);
	for (const [label, faults] of Object.entries(run.faults)) assert.equal(faults.count, 0, `${label} lost observations: ${JSON.stringify(faults.samples)}`);
	assert.deepEqual(
		run.ledger.map((entry) => entry.origin.kind),
		SKILLS.map(() => "case"),
		"every received request belongs to this run, one per prompt",
	);
	for (const { skill, task, requests } of run.cases) {
		assert.equal(requests.length, 1, `${skill.name}: ${requests.length} requests for one prompt`);
		const [entry] = requests;
		assert.equal(entry.auth, "dummy", "only the test key reached the provider");
		assert.equal(entry.reply.text, FIXED_REPLY);
		const location = join(packageRoot, skill.path);
		const expected = expectedSkill({ name: skill.name, location, fileText: readFileSync(location, "utf8") });
		const problem = skillDeliveryProblem(entry, expected, task);
		assert.equal(problem, null, `${skill.name}: ${problem}`);
	}
}

describe("Pi request delivery of explicit skill commands", () => {
	it("delivers each source skill's complete instructions and a distinct task on the received request", async (t) => {
		await deliverAll(t, PACKAGE_ROOT);
	});

	it("delivers each extracted tarball skill's complete instructions and a distinct task on the received request", async (t) => {
		await deliverAll(t, await extractPack(await npmPack(t, { dryRun: false })));
	});
});
