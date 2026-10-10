export const SKILLS = [
	{
		name: "craft-mode",
		path: "skills/craft-mode/SKILL.md",
		description:
			"Scope and route an engineering task through explicit behavior, test-first evidence, and verification, then report what was proven. Explicit invocation only. This release ships only this hub, so it reports missing stage skills instead of improvising them.",
		explicitOnly: true,
		references: [
			"references/authorization.md",
			"references/delegation.md",
			"references/reporting.md",
			"references/workflows.md",
		],
	},
];

export const PACKAGED_DOCS = [
	"LICENSE",
	"README.md",
	"THIRD_PARTY_NOTICES.md",
	"docs/compatibility.md",
	"docs/provenance.md",
	"docs/verification.md",
];

export const PLANNED_SKILLS = [
	"craft-architecture",
	"craft-mutation",
	"craft-qa",
	"craft-quality",
	"craft-refactor",
	"craft-spec",
	"craft-tdd",
];

export function skillFiles() {
	return SKILLS.flatMap((skill) => {
		const dir = skill.path.slice(0, -"SKILL.md".length);
		return [skill.path, ...skill.references.map((ref) => dir + ref)];
	});
}

export function expectedPackFiles() {
	return ["package.json", ...PACKAGED_DOCS, ...skillFiles()].toSorted();
}
