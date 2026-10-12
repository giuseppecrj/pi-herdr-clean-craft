import { isEntryPoint, refuse, runMain } from "./lib.mjs";

export const RELEASE_BLOCKERS = Object.freeze(
	[
		{
			id: "phase3-integration-gate",
			gate: "Phase 3 host orchestration and coexistence",
			detail:
				"npm run test:integration fails against pi-herdr-agents 3.2.1: the host's skills argument does not deliver the skill with a standalone child's task, and isolation of the later request that follows from it usually fails.",
		},
		{
			id: "phase6-live-model-evaluation",
			gate: "Phase 6 evaluation",
			detail: "No bounded live-model evaluation of the methodology has been run or recorded.",
		},
		{
			id: "phase6-release-review",
			gate: "Phase 6 release checks",
			detail: "The final compatibility matrix, source-rights review, and audited tarball review for a release candidate are not complete.",
		},
		{
			id: "hosted-test-provisioning",
			gate: "Release job prerequisites",
			detail:
				"The hosted release job has no reviewed provisioning of Pi, Herdr, pi-herdr-agents, or pi-herdr-pstack, so its npm test and npm run test:integration steps would report BLOCKED.",
		},
	].map((blocker) => Object.freeze(blocker)),
);

export function assertReady(blockers) {
	if (blockers.length === 0) return;
	refuse(`BLOCKED: publication is disabled until these release gates pass: ${blockers.map((blocker) => blocker.id).join(", ")}. See RELEASING.md.`);
}

if (isEntryPoint(import.meta)) {
	await runMain(() => {
		for (const blocker of RELEASE_BLOCKERS) console.log(`BLOCKED: ${blocker.id} (${blocker.gate}). ${blocker.detail}`);
		assertReady(RELEASE_BLOCKERS);
		console.log("All release gates are recorded as passed.");
	});
}
