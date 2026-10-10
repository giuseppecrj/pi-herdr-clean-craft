import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { ADAPTER_CASES, DOMAIN_CASES } from "./fixtures/retry-eligibility/base/tests/cases.mjs";
import {
	diffWorkspace,
	FIXTURE_ROOT,
	loadFixture,
	materialize,
	mutantTrial,
	readSnapshot,
	release,
	runWorker,
	sha256,
	writeMutant,
} from "./fixture-workspace.mjs";
import { makeTempRoot } from "./support.mjs";

const BEHAVIOR = "tests/behavior.test.mjs";
const WEAK = "tests/weak.test.mjs";
const DOMAIN = "src/domain/retry.ts";
const BOUNDARY = "stops once attempts reach the maximum";
const BEHAVIOR_NAMES = [...DOMAIN_CASES, ...ADAPTER_CASES].map((behavior) => behavior.name);
const POLICY = {
	"src/domain/": ["src/domain/"],
	"src/adapters/": ["src/adapters/", "src/domain/", "src/infra/"],
	"src/infra/": ["src/infra/"],
};

const fixture = loadFixture();
const checkedIn = readSnapshot("checked-in fixture", FIXTURE_ROOT);

after(() => assert.deepEqual(diffWorkspace(FIXTURE_ROOT, checkedIn), []));

function outcomes(run, file) {
	return run.results.filter((result) => file === undefined || result.file === file);
}

function failures(run, file) {
	return outcomes(run, file)
		.filter((result) => result.outcome === "fail")
		.map(({ file: _file, outcome: _outcome, ...failure }) => failure);
}

function passed(run, file) {
	return outcomes(run, file)
		.filter((result) => result.outcome === "pass")
		.map((result) => result.name);
}

function forbiddenEdges(edges) {
	return edges.filter(({ from, to }) => {
		const layer = Object.keys(POLICY).find((prefix) => from.startsWith(prefix));
		return layer !== undefined && !POLICY[layer].some((allowed) => to.startsWith(allowed));
	});
}

function assertEvaluated(run, path, bytes) {
	assert.ok(run.ready, "worker sent no ready checkpoint");
	assert.equal(run.ready.loaded[path], sha256(bytes), `worker did not load the expected ${path}`);
	assert.deepEqual(run.ready.loadErrors, [], "worker failed to evaluate the loaded sources");
}

async function runState(t, state, tests) {
	const run = await runWorker(materialize(t, state), { tests });
	assert.equal(run.ending, "complete", run.stderr);
	return run;
}

describe("retry fixture: test-first evidence", () => {
	it("fails the named behavior by assertion before the fix and passes after it", async (t) => {
		const red = await runState(t, fixture.variant("defect"), [BEHAVIOR]);
		assertEvaluated(red, DOMAIN, fixture.variant("defect").bytes(DOMAIN));
		assert.deepEqual(failures(red), [
			{ name: "a permanent failure stops on the first attempt", kind: "assertion", actual: "retry", expected: "stop" },
			{ name: "an unrecognized error code stops", kind: "assertion", actual: "retry", expected: "stop" },
		]);
		const green = await runState(t, fixture.base, [BEHAVIOR]);
		assert.deepEqual(failures(green), []);
		assert.deepEqual(passed(green), BEHAVIOR_NAMES);
	});

	it("does not count a module that fails to load as a red test", async (t) => {
		const run = await runState(t, fixture.variant("load-failure"), [BEHAVIOR]);
		assert.equal(run.code, 0);
		assert.deepEqual(passed(run), []);
		assert.deepEqual(
			failures(run).map(({ name, kind }) => ({ name, kind })),
			[{ name: BEHAVIOR, kind: "load" }],
		);
		assert.match(failures(run)[0].message, /does not provide an export named 'decideRetry'/);
		assert.deepEqual(
			run.ready.loadErrors.map((error) => error.path),
			["src/adapters/job-runner.ts"],
		);
	});
});

describe("retry fixture: behavior-preserving refactor", () => {
	it("passes the same literal cases before and after a structurally different implementation", async (t) => {
		const refactor = fixture.variant("refactor");
		assert.notDeepEqual(refactor.bytes(DOMAIN), fixture.base.bytes(DOMAIN));
		const before = await runState(t, fixture.base, [BEHAVIOR]);
		const afterRefactor = await runState(t, refactor, [BEHAVIOR]);
		assertEvaluated(afterRefactor, DOMAIN, refactor.bytes(DOMAIN));
		assert.deepEqual(outcomes(afterRefactor), outcomes(before));
		assert.deepEqual(passed(afterRefactor), BEHAVIOR_NAMES);
	});
});

describe("retry fixture: runtime dependency edges", () => {
	it("records the adapter calling the domain and finds no forbidden edge", async (t) => {
		const run = await runState(t, fixture.base, [BEHAVIOR]);
		assert.deepEqual(run.ready.edges, [
			{ from: "src/adapters/job-runner.ts", to: "src/domain/retry.ts" },
			{ from: "src/adapters/job-runner.ts", to: "src/infra/error-codes.ts" },
		]);
		assert.deepEqual(forbiddenEdges(run.ready.edges), []);
	});

	it("reports a real domain-to-infrastructure import by file and edge while behavior tests stay green", async (t) => {
		const run = await runState(t, fixture.variant("leaky-domain"), [BEHAVIOR]);
		assert.deepEqual(forbiddenEdges(run.ready.edges), [{ from: "src/domain/retry.ts", to: "src/infra/error-codes.ts" }]);
		assert.deepEqual(passed(run), BEHAVIOR_NAMES);
	});
});

describe("retry fixture: seeded boundary mutant", () => {
	it("survives the weak assertions and is killed by the named boundary assertion", async (t) => {
		const trial = await mutantTrial(t, fixture, { mutant: "boundary", tests: [WEAK, BEHAVIOR] });
		assert.equal(trial.mutant.path, DOMAIN);
		assert.equal(trial.mutant.line, 12);
		assert.deepEqual(failures(trial.baseline), []);
		assert.equal(trial.mutated.ending, "complete", trial.mutated.stderr);
		assertEvaluated(trial.mutated, DOMAIN, trial.mutant.bytes());
		assert.deepEqual(failures(trial.mutated, WEAK), []);
		assert.deepEqual(passed(trial.mutated, WEAK), ["stops after too many attempts", "returns a decision at the limit"]);
		assert.deepEqual(failures(trial.mutated, BEHAVIOR), [
			{ name: BOUNDARY, kind: "assertion", actual: "retry", expected: "stop" },
		]);
		assert.deepEqual(failures(trial.final), []);
		assert.deepEqual(passed(trial.final, BEHAVIOR), BEHAVIOR_NAMES);
		assert.deepEqual(diffWorkspace(trial.workspace.dir, fixture.base), []);
	});

	for (const [ending, label] of [
		["worker-error", "a worker error"],
		["interrupted", "a controlled worker interruption"],
	]) {
		it(`restores the source and gives no verdict after ${label}`, async (t) => {
			const trial = await mutantTrial(t, fixture, { mutant: "boundary", tests: [WEAK, BEHAVIOR], ending });
			assert.equal(trial.mutated.ending, ending, trial.mutated.stderr);
			assertEvaluated(trial.mutated, DOMAIN, trial.mutant.bytes());
			assert.equal(trial.mutated.results, undefined);
			if (ending === "worker-error") assert.notEqual(trial.mutated.code, 0);
			else assert.equal(trial.mutated.signal, "SIGKILL");
			assert.deepEqual(diffWorkspace(trial.workspace.dir, fixture.base), []);
			assert.deepEqual(failures(trial.final), []);
			assert.deepEqual(passed(trial.final, BEHAVIOR), BEHAVIOR_NAMES);
		});
	}
});

describe("retry fixture: harness negative controls", () => {
	it("refuses to mutate when the baseline is not green", async (t) => {
		const red = { ...fixture, base: fixture.variant("defect") };
		await assert.rejects(mutantTrial(t, red, { mutant: "boundary", tests: [BEHAVIOR] }), /baseline is not green/);
	});

	it("refuses to overwrite source that no longer matches the base", (t) => {
		const workspace = materialize(t, fixture.base);
		const drift = Buffer.from("export {};\n");
		writeFileSync(join(workspace.dir, DOMAIN), drift);
		assert.throws(() => writeMutant(workspace, fixture.base, fixture.mutant("boundary")), /does not match base/);
		assert.deepEqual(diffWorkspace(workspace.dir, fixture.base), [`changed ${DOMAIN}`]);
		writeFileSync(join(workspace.dir, DOMAIN), fixture.base.bytes(DOMAIN));
	});

	it("retains a workspace whose contents cannot be verified", (t) => {
		const workspace = materialize(t, fixture.base, makeTempRoot(t, "retain"));
		writeFileSync(join(workspace.dir, "src/stray.ts"), "");
		assert.throws(() => release(workspace), (error) => error.message.endsWith(`retained ${workspace.root}`));
		assert.ok(existsSync(join(workspace.dir, "src/stray.ts")));
		rmSync(join(workspace.dir, "src/stray.ts"));
		release(workspace);
		assert.equal(existsSync(workspace.root), false);
	});

	const MALFORMED = [
		{ label: "identical", content: (base) => base, problem: "mutant probe leaves src/domain/retry.ts unchanged" },
		{
			label: "two lines",
			content: (base) => base.replace(">=", ">").replace('=== "permanent"', '!== "permanent"'),
			problem: "mutant probe changes 2 lines of src/domain/retry.ts",
		},
		{
			label: "added line",
			content: (base) => `${base}\n`,
			problem: "mutant probe changes the line count of src/domain/retry.ts",
		},
		{
			label: "misplaced",
			path: "src/domain/policy.ts",
			content: (base) => base,
			problem: "mutant probe must replace existing base files under src/, not src/domain/policy.ts",
		},
		{
			label: "test file",
			path: "tests/weak.test.mjs",
			content: (base) => base,
			problem: "mutant probe must replace existing base files under src/, not tests/weak.test.mjs",
		},
	];

	for (const { label, path = DOMAIN, content, problem } of MALFORMED) {
		it(`rejects a malformed mutant: ${label}`, (t) => {
			const source = fixture.base.bytes(DOMAIN).toString("utf8");
			const root = copyFixtureWith(t, join("mutants", "probe", path), content(source));
			assert.throws(() => loadFixture(root), { message: problem });
		});
	}

	it("does not accept a loaded hash as evidence when the mutant fails to evaluate", async (t) => {
		const source = fixture.base.bytes(DOMAIN).toString("utf8").split("\n");
		source[0] = `${source[0]} throw new Error("seeded evaluation failure");`;
		const throwing = loadFixture(copyFixtureWith(t, join("mutants", "throwing", DOMAIN), source.join("\n")));
		const trial = await mutantTrial(t, throwing, { mutant: "throwing", tests: [WEAK, BEHAVIOR], ending: "interrupted" });
		assert.equal(trial.mutant.line, 1);
		assert.equal(trial.mutated.ending, "interrupted", trial.mutated.stderr);
		assert.equal(trial.mutated.signal, "SIGKILL");
		assert.equal(trial.mutated.results, undefined);
		assert.equal(trial.mutated.ready.loaded[DOMAIN], sha256(trial.mutant.bytes()));
		assert.deepEqual(
			trial.mutated.ready.loadErrors.map(({ path, message }) => ({ path, message })),
			[
				{ path: "src/adapters/job-runner.ts", message: "seeded evaluation failure" },
				{ path: DOMAIN, message: "seeded evaluation failure" },
			],
		);
		assert.throws(() => assertEvaluated(trial.mutated, DOMAIN, trial.mutant.bytes()), {
			name: "AssertionError",
			message: /^worker failed to evaluate the loaded sources\n/,
		});
		assert.deepEqual(diffWorkspace(trial.workspace.dir, throwing.base), []);
		assert.deepEqual(failures(trial.final), []);
		assert.deepEqual(passed(trial.final, BEHAVIOR), BEHAVIOR_NAMES);
	});

	it("rejects a mutant that replaces two files", (t) => {
		const root = copyFixtureWith(t, "mutants/boundary/src/infra/error-codes.ts", "export const TRANSIENT_ERROR_CODES: readonly string[] = [];\n");
		assert.throws(() => loadFixture(root), { message: "mutant boundary must replace exactly one file, found 2" });
	});
});

function copyFixtureWith(t, path, content) {
	const root = join(makeTempRoot(t, "mutant"), "fixture");
	cpSync(FIXTURE_ROOT, root, { recursive: true });
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), content);
	return root;
}
