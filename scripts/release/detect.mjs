import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { compareVersions, isEntryPoint, isStable, PACKAGE_NAME, parseVersion, readManifest, refuse, requireEvent, requireMainRef, requireSha, runMain, sameCore, writeOutputs } from "./lib.mjs";

const INITIAL_PUSH = /^0{40}$/;

function readPredecessor(beforeSha) {
	let text;
	try {
		text = execFileSync("git", ["show", `${beforeSha}:package.json`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 });
	} catch {
		return { kind: "unreadable" };
	}
	try {
		JSON.parse(text);
	} catch {
		return { kind: "unreadable" };
	}
	const manifest = readManifest(text, `package.json at predecessor ${beforeSha}`);
	const version = parseVersion(manifest.version);
	if (!version) refuse(`package.json at predecessor ${beforeSha} has malformed version ${JSON.stringify(manifest.version)}.`);
	return { kind: "read", version, private: manifest.private, text: manifest.version };
}

export function detect(env, cwd = process.cwd()) {
	const event = requireEvent(env);
	requireMainRef(env);
	const sha = requireSha(env.GITHUB_SHA, "GITHUB_SHA");
	const manifest = readManifest(readFileSync(`${cwd}/package.json`, "utf8"), "package.json");
	if (manifest.private) return { kind: "skip", reason: "private", note: `${PACKAGE_NAME} is private; nothing to release.` };
	const version = parseVersion(manifest.version);
	if (!version) refuse(`package.json version ${JSON.stringify(manifest.version)} is not a valid SemVer version.`);
	if (!isStable(version)) return { kind: "skip", reason: "prerelease", note: `${manifest.version} is a prerelease; only stable versions are released.` };
	const candidate = (basis) => ({ kind: "candidate", basis, name: PACKAGE_NAME, version: manifest.version, tag: `v${manifest.version}`, sha });
	if (event === "workflow_dispatch") return candidate("dispatch");

	const before = env.BEFORE_SHA ?? "";
	if (INITIAL_PUSH.test(before)) return { kind: "skip", reason: "initial-push", note: "Initial branch creation has no predecessor; not inferring a release." };
	requireSha(before, "BEFORE_SHA");
	const previous = readPredecessor(before);
	if (previous.kind === "unreadable") return { kind: "skip", reason: "unreadable-predecessor", note: `Could not read package.json at ${before}; not inferring a release.` };

	const comparison = compareVersions(previous.version, version);
	if (comparison > 0) refuse(`package.json version ${manifest.version} is lower than its predecessor ${previous.text}.`);
	if (comparison < 0) return candidate(!isStable(previous.version) && sameCore(previous.version, version) ? "prerelease-to-core" : "version-increase");
	if (previous.private) return candidate("private-removed");
	return { kind: "skip", reason: "unchanged", note: `${manifest.version} is unchanged; nothing to release.` };
}

if (isEntryPoint(import.meta)) {
	await runMain(() => {
		const decision = detect(process.env);
		if (decision.kind === "skip") {
			console.log(`::notice::${decision.note}`);
			writeOutputs(process.env.GITHUB_OUTPUT, { decision: "skip", reason: decision.reason });
			return;
		}
		console.log(`Release candidate ${decision.name}@${decision.version} (${decision.basis}) at ${decision.sha}.`);
		const { basis, name, version, tag, sha } = decision;
		writeOutputs(process.env.GITHUB_OUTPUT, { decision: "candidate", basis, name, version, tag, sha });
	});
}
