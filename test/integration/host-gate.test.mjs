import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { blockedGate, DISTINCTIONS } from "../phase3/evidence.mjs";
import { runHostGate } from "../phase3/gate.mjs";
import { locatePrerequisites } from "../phase3/prerequisites.mjs";
import { PACKAGE_ROOT } from "../support.mjs";

const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));

describe("host integration gate", () => {
	let report;

	before(async () => {
		const prerequisites = locatePrerequisites(process.env, { hostVersion: manifest.peerDependencies["pi-herdr-agents"] });
		report =
			prerequisites.kind === "ready"
				? await runHostGate({ prerequisites, evidenceDir: process.env.CLEAN_CRAFT_EVIDENCE_DIR })
				: { ...blockedGate(prerequisites.reasons), archived: null, teardown: null };
	});

	for (const distinction of DISTINCTIONS) {
		it(distinction, (t) => {
			const outcome = report.outcomes.find((entry) => entry.distinction === distinction);
			if (outcome.evidence.length > 0) t.diagnostic(`evidence: ${outcome.evidence.join(" ")}`);
			if (outcome.kind === "blocked") assert.fail(`BLOCKED: ${outcome.reason}`);
			assert.equal(outcome.kind, "pass", `FAIL: ${outcome.reason}`);
		});
	}

	it("keeps a failed run's evidence and leaves no owned runtime behind", (t) => {
		if (report.archived === null) assert.fail("BLOCKED: no runtime was started");
		if (report.archived.evidence) t.diagnostic(`evidence (${report.archived.source}): ${report.archived.evidence}`);
		if (report.archived.retainedRoot) t.diagnostic(`retained runtime root: ${report.archived.retainedRoot}`);
		for (const identity of report.teardown.survivors) t.diagnostic(`live ${identity.kind}: pid ${identity.pid} start ${identity.startTime}`);
		for (const entry of report.teardown.uncertain) t.diagnostic(`uncertain ${entry.kind ?? entry.label}${entry.pid ? ` pid ${entry.pid} start ${entry.startTime}` : ""}: ${entry.reason}`);
		assert.deepEqual(report.archived.errors, [], report.archived.errors.join("; "));
		if (!report.passed) {
			assert.ok(report.archived.evidence, "the failed run kept no evidence");
			assert.ok(existsSync(join(report.archived.evidence, "report.json")), `no report survived in ${report.archived.evidence}`);
		}
		assert.equal(report.archived.retainedRoot, null, `runtime retained at ${report.archived.retainedRoot}`);
	});
});
