import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { EXTENSIONS, expectedPackFiles, PACKAGED_DOCS, SKILLS } from "./inventory.mjs";
import { checkSkill, extractPack, listFiles, localLinkTargets, makeTempRoot, npmPack, PACKAGE_ROOT } from "./support.mjs";

const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));

const AMBIENT_CANDIDATE = {
	"package.json": `${JSON.stringify({ name: "ambient-candidate", version: "0.0.0", private: true, files: ["kept.md", "PLAN.md", "test/", ".audit/"] }, null, "\t")}\n`,
	"kept.md": "Allowlisted resource.\n",
	"PLAN.md": "Plan that an erroneous allowlist publishes.\n",
	"test/leak.test.mjs": "export {};\n",
	"test/node_modules/helper/index.js": "export {};\n",
	".audit/phase.md": "Evidence that an erroneous allowlist publishes.\n",
	"unlisted.md": "Not allowlisted.\n",
};
const AMBIENT_PACKED = ["package.json", "kept.md", "PLAN.md", "test/leak.test.mjs", "test/node_modules/helper/index.js", ".audit/phase.md"].toSorted();

function writeCandidate(candidate, files) {
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(candidate, path)), { recursive: true });
		writeFileSync(join(candidate, path), content);
	}
}

function generatedSkill(name, body) {
	return `---\nname: ${name}\ndescription: Generated packing case.\ndisable-model-invocation: true\n---\n\n${body}\n`;
}

function writeAmbientCandidate(t) {
	const owner = makeTempRoot(t, "ambient");
	const candidate = join(owner, "candidate");
	writeCandidate(candidate, AMBIENT_CANDIDATE);
	const redirectedLogs = join(owner, "redirected-logs");
	writeFileSync(join(candidate, ".npmrc"), `logs-dir=${redirectedLogs}\n`);
	return { candidate, redirectedLogs };
}

const LIFECYCLE_SCRIPTS = [
	"preinstall",
	"install",
	"postinstall",
	"prepare",
	"preprepare",
	"postprepare",
	"prepack",
	"postpack",
	"prepublish",
	"prepublishOnly",
	"publish",
	"postpublish",
	"preversion",
	"version",
	"postversion",
	"dependencies",
	"preuninstall",
	"uninstall",
	"postuninstall",
	"pretest",
	"posttest",
];

describe("manifest", () => {
	it("identifies the public 0.1.0 MIT Pi package", () => {
		assert.equal(manifest.name, "pi-herdr-clean-craft");
		assert.equal(manifest.version, "0.1.0");
		assert.equal(manifest.private, undefined);
		assert.deepEqual(manifest.publishConfig, { access: "public" });
		assert.equal(manifest.license, "MIT");
		assert.ok(manifest.keywords.includes("pi-package"));
	});

	it("exposes the skills directory and exactly the one owned extension", () => {
		assert.deepEqual(manifest.pi, { extensions: EXTENSIONS.map((path) => `./${path}`), skills: ["./skills"] });
	});

	it("declares the Pi SDK and the inspected host candidate as peers, exact SDK and Node types plus the check tools for development, and no other dependencies", () => {
		assert.deepEqual(manifest.peerDependencies, { "@earendil-works/pi-coding-agent": "*", "pi-herdr-agents": "3.2.1" });
		assert.deepEqual(manifest.devDependencies, {
			"@biomejs/biome": "2.5.11",
			"@earendil-works/pi-coding-agent": "1.1.0",
			"@types/node": "26.6.5",
			"auto-changelog": "^2.6.0",
			oxlint: "1.80.0",
			typescript: "5.9.3",
		});
		for (const field of ["dependencies", "optionalDependencies", "bundleDependencies", "bundledDependencies"]) {
			assert.equal(manifest[field], undefined, field);
		}
	});

	it("has no install or lifecycle hooks except the changelog version hook", () => {
		const hooks = Object.fromEntries(Object.entries(manifest.scripts ?? {}).filter(([name]) => LIFECYCLE_SCRIPTS.includes(name)));
		assert.deepEqual(hooks, { version: "auto-changelog --package && git add CHANGELOG.md" });
		assert.equal(manifest.gypfile, undefined);
	});

	it("allowlists exactly the packaged files", () => {
		assert.deepEqual(
			manifest.files.toSorted(),
			expectedPackFiles().filter((path) => path !== "package.json"),
		);
		assert.equal(expectedPackFiles().length, 24);
	});
});

describe("npm pack --dry-run", () => {
	it("lists exactly the inventory, its references, and packaged documentation", async (t) => {
		const { entry } = await npmPack(t, { dryRun: true });
		assert.equal(entry.name, "pi-herdr-clean-craft");
		const files = entry.files.map((file) => file.path).toSorted();
		assert.deepEqual(files, expectedPackFiles());
		for (const path of files) {
			assert.doesNotMatch(
				path,
				/^(PLAN\.md|AGENTS\.md|\.audit\/|test\/|\.pi\/|node_modules\/|\.github\/|scripts\/|\.npmrc$|package-lock\.json$|biome\.json$|\.oxlintrc\.json$|pi-extension\/tsconfig\.json$)/,
				path,
			);
			assert.doesNotMatch(path, /fixtures|evidence|settings\.json|\.jsonl$|\.tgz$/, path);
		}
	});

	it("keeps local links in packaged documentation inside the package", () => {
		const packed = new Set(expectedPackFiles());
		for (const doc of PACKAGED_DOCS.filter((path) => path.endsWith(".md"))) {
			const base = doc.includes("/") ? doc.slice(0, doc.lastIndexOf("/") + 1) : "";
			for (const target of localLinkTargets(readFileSync(join(PACKAGE_ROOT, doc), "utf8"))) {
				const resolved = new URL(target, `file:///pkg/${base}`).pathname.slice("/pkg/".length);
				assert.ok(packed.has(resolved), `${doc} links to ${target}, which is not packaged`);
			}
		}
	});
});

describe("packed skill links", () => {
	it("resolve to the same owned references and sibling skills in the extracted tarball", async (t) => {
		const packageRoot = await extractPack(await npmPack(t, { dryRun: false }));
		for (const skill of SKILLS) {
			const { problems, references, siblings } = checkSkill(join(packageRoot, dirname(skill.path)));
			assert.deepEqual({ problems, references, siblings }, { problems: [], references: skill.references.toSorted(), siblings: skill.siblings.toSorted() }, skill.name);
		}
	});

	it("report a linked sibling skill that the allowlist leaves out of the tarball", async (t) => {
		const candidate = join(makeTempRoot(t, "sibling-candidate"), "candidate");
		writeCandidate(candidate, {
			"package.json": `${JSON.stringify({ name: "sibling-candidate", version: "0.0.0", private: true, files: ["skills/hub/SKILL.md"] })}\n`,
			"skills/hub/SKILL.md": generatedSkill("hub", "Continue with [peer](../peer/SKILL.md)."),
			"skills/peer/SKILL.md": generatedSkill("peer", "Peer."),
		});
		const source = checkSkill(join(candidate, "skills", "hub"));
		assert.deepEqual({ problems: source.problems, siblings: source.siblings }, { problems: [], siblings: ["peer"] });
		const packageRoot = await extractPack(await npmPack(t, { dryRun: false, candidateRoot: candidate }));
		assert.deepEqual(listFiles(packageRoot), ["package.json", "skills/hub/SKILL.md"]);
		assert.deepEqual(checkSkill(join(packageRoot, "skills", "hub")).problems, ["SKILL.md links to a missing sibling skill: ../peer/SKILL.md"]);
	});
});

describe("npm pack isolation", () => {
	it("ignores a candidate's project .npmrc and packs its files unchanged", async (t) => {
		const { candidate, redirectedLogs } = writeAmbientCandidate(t);
		const pack = await npmPack(t, { dryRun: false, candidateRoot: candidate });
		assert.equal(existsSync(redirectedLogs), false, "npm followed the candidate's .npmrc outside its isolation root");
		assert.notDeepEqual(readdirSync(join(pack.root, "npm-cache", "_logs")), []);
		const packageRoot = await extractPack(pack);
		assert.deepEqual(listFiles(packageRoot), AMBIENT_PACKED);
		for (const path of AMBIENT_PACKED) {
			assert.equal(readFileSync(join(packageRoot, path), "utf8"), AMBIENT_CANDIDATE[path], path);
		}
	});

	it("stages a candidate that contains its own temporary root without copying that root", async (t) => {
		const { candidate } = writeAmbientCandidate(t);
		const tempParent = join(candidate, "tmp");
		mkdirSync(tempParent);
		const pack = await npmPack(t, { dryRun: true, candidateRoot: candidate, tempParent });
		assert.deepEqual(listFiles(pack.stage), Object.keys(AMBIENT_CANDIDATE).toSorted());
		assert.deepEqual(pack.entry.files.map((file) => file.path).toSorted(), AMBIENT_PACKED);
	});
});
