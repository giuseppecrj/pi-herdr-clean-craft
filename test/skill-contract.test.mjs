import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { PLANNED_SKILLS, SKILLS, skillFiles } from "./inventory.mjs";
import { checkSkill, listFiles, localLinkTargets, makeTempRoot, PACKAGE_ROOT } from "./support.mjs";

const FIXTURES = join(PACKAGE_ROOT, "test", "fixtures");

const SCALAR_CASES = [
	{ dir: "null-description", description: "null", problems: ["description must be a string, found null"] },
	{ dir: "tilde-description", description: "~", problems: ["description must be a string, found null"] },
	{ dir: "true-description", description: "true", problems: ["description must be a string, found boolean"] },
	{ dir: "false-description", description: "FALSE", problems: ["description must be a string, found boolean"] },
	{ dir: "integer-description", description: "123", problems: ["description must be a string, found number"] },
	{ dir: "hex-description", description: "0x1F", problems: ["description must be a string, found number"] },
	{ dir: "float-description", description: "1.5e3", problems: ["description must be a string, found number"] },
	{ dir: "infinite-description", description: ".inf", problems: ["description must be a string, found number"] },
	{ dir: "blank-description", description: '"  "', problems: ["description is empty"] },
	{ dir: "quoted-null-description", description: '"null"', problems: [] },
	{ dir: "quoted-true-description", description: '"true"', problems: [] },
	{ dir: "quoted-integer-description", description: '"123"', problems: [] },
	{ dir: "padded-null-description", description: "null  ", problems: ["description must be a string, found null"] },
	{ dir: "tab-null-description", description: "null\t", problems: ["description must be a string, found null"] },
	{ dir: "leading-true-description", description: "  true", problems: ["description must be a string, found boolean"] },
	{ dir: "padded-integer-description", description: "123 ", problems: ["description must be a string, found number"] },
	{ dir: "whitespace-description", description: "   ", problems: ["description must be a string, found null"] },
	{ dir: "padded-plain-description", description: " A padded plain string.  ", value: "A padded plain string.", problems: [] },
	{ dir: "padded-quoted-null-description", description: '"null"  ', value: "null", problems: [] },
	{ dir: "padded-quoted-description", description: '  "  inner  spaces  " ', value: "  inner  spaces  ", problems: [] },
	{ dir: "123", name: "123", problems: ["name must be a string, found number"] },
	{ dir: "123", name: '"123"', problems: [] },
	{ dir: "quoted-true-invocation", invocation: '"true"', problems: ["disable-model-invocation must be a boolean, found string"] },
	{ dir: "quoted-false-invocation", invocation: '"false"', problems: ["disable-model-invocation must be a boolean, found string"] },
	{ dir: "yes-invocation", invocation: "yes", problems: ["disable-model-invocation must be a boolean, found string"] },
	{ dir: "null-invocation", invocation: "null", problems: ["disable-model-invocation must be a boolean, found null"] },
	{ dir: "capitalized-invocation", invocation: "True", problems: [] },
	{ dir: "false-invocation", invocation: "false", problems: [] },
	{ dir: "padded-invocation", invocation: " True  ", problems: [] },
	{ dir: "padded-quoted-invocation", invocation: ' "true" ', problems: ["disable-model-invocation must be a boolean, found string"] },
];

function writeSkill(skillsRoot, name, body, files = {}) {
	const skillDir = join(skillsRoot, name);
	for (const [path, content] of Object.entries({
		"SKILL.md": `---\nname: ${name}\ndescription: Generated link case.\ndisable-model-invocation: true\n---\n\n${body}\n`,
		...files,
	})) {
		mkdirSync(dirname(join(skillDir, path)), { recursive: true });
		writeFileSync(join(skillDir, path), content);
	}
	return skillDir;
}

const SIBLING_CASES = [
	{ link: "../absent/SKILL.md", problem: "SKILL.md links to a missing sibling skill: ../absent/SKILL.md" },
	{ link: "../peer/references/inner.md", problem: "SKILL.md links to a sibling skill path other than its SKILL.md: ../peer/references/inner.md" },
	{ link: "../peer", problem: "SKILL.md links to a sibling skill path other than its SKILL.md: ../peer" },
	{ link: "../../outside.md", problem: "SKILL.md links outside the skills directory: ../../outside.md" },
	{ link: "../escape/SKILL.md", problem: "SKILL.md links to a sibling skill that resolves outside the skills directory: ../escape/SKILL.md" },
];

function writeScalarCase(root, { dir, name = dir, description = "A plain string description.", invocation = "true" }) {
	const skillDir = join(root, dir);
	mkdirSync(skillDir, { recursive: true });
	writeFileSync(join(skillDir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\ndisable-model-invocation: ${invocation}\n---\n\nBody.\n`);
	return skillDir;
}

describe("skill inventory", () => {
	it("has unique names matching the skills directory exactly", () => {
		const names = SKILLS.map((skill) => skill.name);
		assert.equal(new Set(names).size, names.length);
		const dirs = readdirSync(join(PACKAGE_ROOT, "skills"), { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.toSorted();
		assert.deepEqual(dirs, names.toSorted());
		assert.deepEqual(
			listFiles(join(PACKAGE_ROOT, "skills")),
			skillFiles()
				.map((path) => path.slice("skills/".length))
				.toSorted(),
		);
	});

	for (const skill of SKILLS) {
		describe(skill.name, () => {
			const dir = join(PACKAGE_ROOT, dirname(skill.path));
			const result = checkSkill(dir);

			it("has portable frontmatter whose name matches its directory", () => {
				assert.deepEqual(result.problems, []);
				assert.equal(result.fields.name, skill.name);
				assert.equal(result.fields.description, skill.description);
			});

			it("is explicit-only", () => {
				assert.equal(skill.explicitOnly, true);
				assert.equal(result.fields["disable-model-invocation"], true);
			});

			it("resolves every local markdown reference to a bundled file", () => {
				assert.deepEqual(result.references, skill.references.toSorted());
			});

			it("links exactly its declared sibling skills", () => {
				assert.deepEqual(result.siblings, skill.siblings.toSorted());
			});
		});
	}

	it("routes the hub to every shipped stage, and no stage back to the hub", () => {
		const names = SKILLS.map((skill) => skill.name);
		for (const skill of SKILLS) {
			for (const sibling of skill.siblings) {
				assert.ok(names.includes(sibling), `${skill.name} links unshipped ${sibling}`);
				assert.notEqual(sibling, skill.name);
			}
		}
		const [hub, ...stages] = SKILLS;
		assert.equal(hub.name, "craft-mode");
		assert.deepEqual(hub.siblings.toSorted(), stages.map((stage) => stage.name).toSorted());
		for (const stage of stages) assert.ok(!stage.siblings.includes(hub.name), `${stage.name} links the hub`);
	});

	it("does not link planned stage skills that are not shipped", () => {
		for (const path of skillFiles().filter((file) => file.endsWith(".md"))) {
			for (const target of localLinkTargets(readFileSync(join(PACKAGE_ROOT, path), "utf8"))) {
				for (const planned of PLANNED_SKILLS) assert.ok(!target.includes(planned), `${path} links ${target}`);
			}
		}
	});

	it("describes host parameters in prose rather than executable examples", () => {
		for (const path of skillFiles()) {
			const text = readFileSync(join(PACKAGE_ROOT, path), "utf8");
			assert.doesNotMatch(text, /^(```|~~~)/m, `${path} contains a fenced block`);
		}
	});
});

describe("contract checks reject broken skills", () => {
	it("reports a missing bundled reference", () => {
		const { problems } = checkSkill(join(FIXTURES, "missing-reference"));
		assert.deepEqual(problems, ["SKILL.md links to a missing file: references/absent.md"]);
	});

	it("reports malformed frontmatter", () => {
		const { problems } = checkSkill(join(FIXTURES, "malformed-frontmatter"));
		assert.ok(problems.includes("frontmatter has no closing ---"), problems.join("\n"));
	});

	it("reports a name that differs from its directory and an unportable value", () => {
		const { problems } = checkSkill(join(FIXTURES, "mismatched-name"));
		assert.deepEqual(problems, ["frontmatter value for description needs quoting to remain plain YAML", "name other-name does not match directory mismatched-name"]);
	});

	it("records sibling skills separately from owned references without following their files", (t) => {
		const skills = join(makeTempRoot(t, "siblings"), "skills");
		writeSkill(skills, "peer", "Read [a missing file](references/absent.md).");
		writeSkill(skills, "other", "Other skill.");
		const hub = writeSkill(skills, "hub", "Use [peer](../peer/SKILL.md) and [notes](references/notes.md).", {
			"references/notes.md": "Then use [other](../../other/SKILL.md).\n",
		});
		const result = checkSkill(hub);
		assert.deepEqual({ problems: result.problems, references: result.references, siblings: result.siblings }, { problems: [], references: ["references/notes.md"], siblings: ["other", "peer"] });
		assert.deepEqual(checkSkill(join(skills, "peer")).problems, ["SKILL.md links to a missing file: references/absent.md"]);
	});

	it("rejects missing, internal, escaping, and redirected sibling links", (t) => {
		const root = makeTempRoot(t, "sibling-cases");
		const skills = join(root, "skills");
		writeSkill(skills, "peer", "Peer.", { "references/inner.md": "Inner.\n" });
		writeFileSync(join(root, "outside.md"), "Outside.\n");
		writeSkill(root, "elsewhere", "Outside the skills directory.");
		symlinkSync(join(root, "elsewhere"), join(skills, "escape"));
		const observed = SIBLING_CASES.map(({ link }, index) => {
			const { problems, siblings } = checkSkill(writeSkill(skills, `probe-${index}`, `See [it](${link}).`));
			return { link, problem: problems.join("\n"), siblings };
		});
		assert.deepEqual(
			observed,
			SIBLING_CASES.map((siblingCase) => ({ ...siblingCase, siblings: [] })),
		);
	});

	it("keeps YAML core-schema scalar types that Pi sees", (t) => {
		const root = makeTempRoot(t, "scalars");
		const observed = SCALAR_CASES.map((scalarCase) => {
			const { fields, problems } = checkSkill(writeScalarCase(root, scalarCase));
			return { ...scalarCase, ...("value" in scalarCase && { value: fields.description }), problems };
		});
		assert.deepEqual(observed, SCALAR_CASES);
	});
});
