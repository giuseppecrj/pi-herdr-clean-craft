export const SKILLS = [
	{
		name: "craft-mode",
		path: "skills/craft-mode/SKILL.md",
		description:
			"Scope and route an engineering task through explicit behavior, test-first evidence, and verification, then report what was proven. Explicit invocation only. Routes to five bundled stage skills and reports the unshipped specification and final QA stages as blocked instead of improvising them.",
		explicitOnly: true,
		references: [
			"references/authorization.md",
			"references/delegation.md",
			"references/reporting.md",
			"references/workflows.md",
		],
		siblings: ["craft-architecture", "craft-mutation", "craft-quality", "craft-refactor", "craft-tdd"],
	},
	{
		name: "craft-tdd",
		path: "skills/craft-tdd/SKILL.md",
		description:
			"Change behavior test-first. Write one focused test, confirm it fails for the predicted reason, make the smallest passing change, then tidy under green. Explicit invocation only. Says so plainly when a meaningful failing test could not be shown.",
		explicitOnly: true,
		references: [],
		siblings: ["craft-refactor"],
	},
	{
		name: "craft-refactor",
		path: "skills/craft-refactor/SKILL.md",
		description:
			"Improve the structure of existing code without changing its behavior, in small verified steps from a green baseline, adding characterization tests where protection is thin. Explicit invocation only.",
		explicitOnly: true,
		references: ["references/test-quality.md"],
		siblings: ["craft-architecture", "craft-mutation", "craft-tdd"],
	},
	{
		name: "craft-architecture",
		path: "skills/craft-architecture/SKILL.md",
		description:
			"Review policy and dependency boundaries from observed import edges, then report evidence-backed findings and the smallest useful correction. Read-only by default. Explicit invocation only.",
		explicitOnly: true,
		references: ["references/design-principles.md"],
		siblings: ["craft-refactor"],
	},
	{
		name: "craft-quality",
		path: "skills/craft-quality/SKILL.md",
		description:
			"Assess code risk from qualified measurements such as complexity, coverage, and duplication, and disclose missing or stale data instead of filling gaps. Report-only by default. Explicit invocation only. No upstream analyzer is supported in this release.",
		explicitOnly: true,
		references: ["references/tool-recipes.md"],
		siblings: ["craft-mutation", "craft-refactor"],
	},
	{
		name: "craft-mutation",
		path: "skills/craft-mutation/SKILL.md",
		description:
			"Check whether tests notice small seeded changes to the source, starting from a green baseline, then classify survivors, strengthen tests honestly, and verify the source is restored. Explicit invocation only.",
		explicitOnly: true,
		references: ["references/interpretation.md"],
		siblings: ["craft-tdd"],
	},
];

export const PACKAGED_DOCS = [
	"CHANGELOG.md",
	"LICENSE",
	"README.md",
	"RELEASING.md",
	"THIRD_PARTY_NOTICES.md",
	"docs/compatibility.md",
	"docs/provenance.md",
	"docs/verification.md",
];

export const PLANNED_SKILLS = ["craft-qa", "craft-spec"];

export function skillFiles() {
	return SKILLS.flatMap((skill) => {
		const dir = skill.path.slice(0, -"SKILL.md".length);
		return [skill.path, ...skill.references.map((ref) => dir + ref)];
	});
}

export function expectedPackFiles() {
	return ["package.json", ...PACKAGED_DOCS, ...skillFiles()].toSorted();
}
