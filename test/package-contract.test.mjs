import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { expectedPackFiles, PACKAGED_DOCS } from "./inventory.mjs";
import { extractPack, listFiles, localLinkTargets, makeTempRoot, npmPack, PACKAGE_ROOT } from "./support.mjs";

const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));

const AMBIENT_CANDIDATE = {
	"package.json": `${JSON.stringify(
		{ name: "ambient-candidate", version: "0.0.0", private: true, files: ["kept.md", "PLAN.md", "test/", ".audit/"] },
		null,
		"\t",
	)}\n`,
	"kept.md": "Allowlisted resource.\n",
	"PLAN.md": "Plan that an erroneous allowlist publishes.\n",
	"test/leak.test.mjs": "export {};\n",
	"test/node_modules/helper/index.js": "export {};\n",
	".audit/phase.md": "Evidence that an erroneous allowlist publishes.\n",
	"unlisted.md": "Not allowlisted.\n",
};
const AMBIENT_PACKED = [
	"package.json",
	"kept.md",
	"PLAN.md",
	"test/leak.test.mjs",
	"test/node_modules/helper/index.js",
	".audit/phase.md",
].toSorted();

function writeAmbientCandidate(t) {
	const owner = makeTempRoot(t, "ambient");
	const candidate = join(owner, "candidate");
	for (const [path, content] of Object.entries(AMBIENT_CANDIDATE)) {
		mkdirSync(dirname(join(candidate, path)), { recursive: true });
		writeFileSync(join(candidate, path), content);
	}
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
	it("identifies an unreleased private MIT Pi package", () => {
		assert.equal(manifest.name, "pi-herdr-clean-craft");
		assert.equal(manifest.version, "0.0.0");
		assert.equal(manifest.private, true);
		assert.equal(manifest.license, "MIT");
		assert.ok(manifest.keywords.includes("pi-package"));
	});

	it("exposes only the skills directory and no extension", () => {
		assert.deepEqual(manifest.pi, { skills: ["./skills"] });
	});

	it("declares only the inspected host candidate as a peer and no other dependencies", () => {
		assert.deepEqual(manifest.peerDependencies, { "pi-herdr-agents": "3.2.1" });
		for (const field of [
			"dependencies",
			"devDependencies",
			"optionalDependencies",
			"bundleDependencies",
			"bundledDependencies",
		]) {
			assert.equal(manifest[field], undefined, field);
		}
	});

	it("has no install or lifecycle hooks", () => {
		const scripts = Object.keys(manifest.scripts ?? {});
		assert.deepEqual(
			scripts.filter((name) => LIFECYCLE_SCRIPTS.includes(name)),
			[],
		);
		assert.equal(manifest.gypfile, undefined);
	});

	it("allowlists exactly the packaged files", () => {
		assert.deepEqual(manifest.files.toSorted(), expectedPackFiles().filter((path) => path !== "package.json"));
	});
});

describe("npm pack --dry-run", () => {
	it("lists exactly the inventory, its references, and packaged documentation", async (t) => {
		const { entry } = await npmPack(t, { dryRun: true });
		assert.equal(entry.name, "pi-herdr-clean-craft");
		const files = entry.files.map((file) => file.path).toSorted();
		assert.deepEqual(files, expectedPackFiles());
		for (const path of files) {
			assert.doesNotMatch(path, /^(PLAN\.md|AGENTS\.md|\.audit\/|test\/|\.pi\/|node_modules\/)/, path);
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
