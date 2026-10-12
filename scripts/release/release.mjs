import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { assertReady, RELEASE_BLOCKERS } from "./readiness.mjs";
import {
	compareVersions,
	isEntryPoint,
	PACKAGE_NAME,
	parseVersion,
	REPOSITORY,
	refuse,
	requireMainRef,
	requireSha,
	requireStableVersion,
	runMain,
} from "./lib.mjs";

const SECRET_NAMES = new Set(["NODE_AUTH_TOKEN", "BOOTSTRAP_NPM_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"]);
const REGISTRY_STATES = new Set(["absent", "version-absent", "same-commit-published"]);
const TRUSTED_PUBLISHING = { npm: "11.5.1", node: "22.14.0" };
const BOT_IDENTITY = ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com"];
const SHA_LINE = /^([0-9a-f]{40})\t(\S+)$/;

function commandRunner({ cwd, env, stdio, say }) {
	const base = Object.fromEntries(Object.entries(env).filter(([name]) => !SECRET_NAMES.has(name)));
	return (command, args, { credentials = {}, capture = false } = {}) => {
		const piped = capture || stdio === "pipe";
		const result = spawnSync(command, args, {
			cwd,
			env: { ...base, ...credentials },
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
			stdio: piped ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
		});
		if (result.error) refuse(`Could not run ${command} ${args[0]}: ${result.error.message}.`);
		if (piped && !capture) for (const text of [result.stdout, result.stderr]) if (text?.trim()) say(text.trimEnd());
		return { code: result.status, signal: result.signal, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
	};
}

const describeExit = (result) => (result.signal ? `signal ${result.signal}` : `exit ${result.code}`);
const firstLine = (text) => text.trim().split("\n")[0] ?? "";

function validateTuple(env, run) {
	requireMainRef(env);
	if (env.PACKAGE_NAME !== PACKAGE_NAME) refuse(`PACKAGE_NAME must be exactly ${PACKAGE_NAME}.`);
	requireStableVersion(env.VERSION, "VERSION");
	if (env.TAG !== `v${env.VERSION}`) refuse(`TAG must be v${env.VERSION}, not ${JSON.stringify(env.TAG ?? "")}.`);
	const sha = requireSha(env.GITHUB_SHA, "GITHUB_SHA");
	if (env.GITHUB_REPOSITORY !== REPOSITORY) refuse(`GITHUB_REPOSITORY must be ${REPOSITORY}.`);
	if (!REGISTRY_STATES.has(env.REGISTRY_STATE)) refuse(`REGISTRY_STATE must be one of ${[...REGISTRY_STATES].join(", ")}, not ${JSON.stringify(env.REGISTRY_STATE ?? "")}.`);
	const head = run("git", ["rev-parse", "HEAD"], { capture: true });
	if (head.code !== 0 || head.stdout.trim() !== sha) refuse(`The checked-out HEAD is not GITHUB_SHA ${sha}.`);
	return { name: PACKAGE_NAME, version: env.VERSION, tag: env.TAG, sha, registry: env.REGISTRY_STATE };
}

function publicationPlan(registry, token) {
	const hasToken = typeof token === "string" && token !== "";
	if (registry === "absent") {
		if (!hasToken) refuse(`${PACKAGE_NAME} does not exist on npm. Its first publication needs the temporary NPM_TOKEN bootstrap described in RELEASING.md.`);
		return { kind: "bootstrap-token", token };
	}
	if (hasToken) refuse("NPM_TOKEN is bootstrap-only and the package already exists. Remove the secret; existing packages publish through trusted publishing.");
	return registry === "version-absent" ? { kind: "oidc" } : { kind: "already-published" };
}

function requireTrustedPublishing(run) {
	const npm = run("npm", ["--version"], { capture: true });
	const npmVersion = parseVersion(npm.stdout.trim());
	if (npm.code !== 0 || !npmVersion) refuse("Could not read the npm version for trusted publishing.");
	if (compareVersions(npmVersion, parseVersion(TRUSTED_PUBLISHING.npm)) < 0) {
		refuse(`npm ${npm.stdout.trim()} is older than ${TRUSTED_PUBLISHING.npm}, the minimum for trusted publishing.`);
	}
	if (compareVersions(parseVersion(process.versions.node), parseVersion(TRUSTED_PUBLISHING.node)) < 0) {
		refuse(`Node ${process.versions.node} is older than ${TRUSTED_PUBLISHING.node}, the minimum for trusted publishing.`);
	}
}

function localTag(run, tag) {
	const result = run("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`], { capture: true });
	if (result.code === 0) return requireSha(result.stdout.trim(), `local tag ${tag}`);
	if (result.code === 1 && result.stdout.trim() === "") return null;
	refuse(`Could not read local tag ${tag} (${describeExit(result)}).`);
}

function remoteTag(run, tag, credentials) {
	const result = run("git", ["ls-remote", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`], { capture: true, credentials });
	if (result.code !== 0) refuse(`git ls-remote for ${tag} failed (${describeExit(result)}): ${firstLine(result.stderr)}`);
	const refs = new Map();
	for (const line of result.stdout.split("\n").filter(Boolean)) {
		const match = SHA_LINE.exec(line);
		if (!match) refuse(`git ls-remote returned an unexpected line for ${tag}.`);
		refs.set(match[2], match[1]);
	}
	return refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`) ?? null;
}

function requireRemoteTagAt({ tag, sha }, current) {
	if (current === sha) return;
	if (current === null) refuse(`Tag ${tag} disappeared from the remote after it was checked. It was not pushed again, and no GitHub Release was created or reused. Inspect the remote before rerunning.`);
	refuse(`Remote tag ${tag} now points to ${current}, not ${sha}, after it was checked. Tags are never moved, and no GitHub Release was created or reused. Resolve the tag by hand before rerunning.`);
}

function releaseState(run, tag, credentials) {
	const result = run("gh", ["release", "view", tag, "--repo", REPOSITORY, "--json", "tagName,isDraft"], { capture: true, credentials });
	if (result.code === 1 && /release not found/.test(result.stderr)) return "absent";
	if (result.code !== 0) refuse(`gh release view ${tag} failed ambiguously (${describeExit(result)}): ${firstLine(result.stderr)}`);
	let release;
	try {
		release = JSON.parse(result.stdout);
	} catch {
		refuse(`gh release view ${tag} returned malformed JSON.`);
	}
	if (release?.tagName !== tag) refuse(`gh release view ${tag} described another release.`);
	if (release.isDraft !== false) refuse(`GitHub Release ${tag} is a draft. Publish or delete it by hand before releasing.`);
	return "present";
}

export function runRelease({ cwd, env, blockers, stdio = "inherit", say = console.log }) {
	assertReady(blockers);
	const run = commandRunner({ cwd, env, stdio, say });
	const tuple = validateTuple(env, run);
	const plan = publicationPlan(tuple.registry, env.BOOTSTRAP_NPM_TOKEN);
	if (plan.kind === "oidc") requireTrustedPublishing(run);
	const github = { GH_TOKEN: env.GH_TOKEN ?? "" };

	const setup = run("gh", ["auth", "setup-git"], { credentials: github });
	if (setup.code !== 0) refuse(`gh auth setup-git failed (${describeExit(setup)}).`);
	const local = localTag(run, tuple.tag);
	if (local !== null && local !== tuple.sha) refuse(`Local tag ${tuple.tag} points to another commit ${local}, not ${tuple.sha}. Tags are never moved; increase the version.`);
	const remote = remoteTag(run, tuple.tag, github);
	if (remote !== null && remote !== tuple.sha) refuse(`Remote tag ${tuple.tag} points to ${remote}, not ${tuple.sha}. Tags are never moved; increase the version.`);
	const release = releaseState(run, tuple.tag, github);
	if (release === "present" && remote === null) refuse(`GitHub Release ${tuple.tag} exists but there is no tag ${tuple.tag} on the remote. Resolve it by hand.`);

	if (plan.kind === "already-published") {
		say(`${tuple.name}@${tuple.version} is already published from ${tuple.sha}; skipping npm publish for this exact retry.`);
	} else {
		const credentials = plan.kind === "bootstrap-token" ? { NODE_AUTH_TOKEN: plan.token } : {};
		say(
			plan.kind === "bootstrap-token"
				? "Publishing the first version with the temporary NPM_TOKEN bootstrap. Revoke the token and delete the secret after this run."
				: "Publishing through OIDC trusted publishing with no NPM_TOKEN.",
		);
		const publish = run("npm", ["publish", "--access", "public", "--provenance", "--ignore-scripts"], { credentials });
		if (publish.code !== 0) {
			refuse(`npm publish failed (${describeExit(publish)}) and was not retried. Check npm before rerunning: a rerun continues only if npm has this version from ${tuple.sha}.`);
		}
	}

	let current = remoteTag(run, tuple.tag, github);
	if (current === null && remote === null) {
		if (local === null) {
			const created = run("git", [...BOT_IDENTITY, "tag", "-a", tuple.tag, "-m", `Release ${tuple.tag}`, tuple.sha]);
			if (created.code !== 0) refuse(`git tag ${tuple.tag} failed (${describeExit(created)}).`);
		}
		const pushed = run("git", ["push", "origin", `refs/tags/${tuple.tag}`], { credentials: github });
		if (pushed.code !== 0) refuse(`git push of ${tuple.tag} failed (${describeExit(pushed)}) and was not retried or forced.`);
		current = remoteTag(run, tuple.tag, github);
	} else if (current === tuple.sha) {
		say(`Tag ${tuple.tag} is already on ${tuple.sha}; not pushing it again.`);
	}
	// gh release create --verify-tag checks only that the tag exists, not its commit, and nothing
	// can lock the remote tag. A change after this last read is not detected.
	requireRemoteTagAt(tuple, current);

	if (release === "present") {
		say(`GitHub Release ${tuple.tag} already exists; reusing it unchanged.`);
	} else {
		const npmUrl = `https://www.npmjs.com/package/${tuple.name}/v/${tuple.version}`;
		const created = run(
			"gh",
			["release", "create", tuple.tag, "--repo", REPOSITORY, "--verify-tag", "--title", tuple.tag, "--generate-notes", "--notes", `Published package: [${tuple.name}@${tuple.version}](${npmUrl})`],
			{ credentials: github },
		);
		if (created.code !== 0) refuse(`gh release create ${tuple.tag} failed (${describeExit(created)}) and was not retried.`);
	}

	if (env.GITHUB_STEP_SUMMARY) {
		appendFileSync(
			env.GITHUB_STEP_SUMMARY,
			`Released [${tuple.tag}](https://github.com/${REPOSITORY}/releases/tag/${tuple.tag}) and [${tuple.name}@${tuple.version}](https://www.npmjs.com/package/${tuple.name}/v/${tuple.version}).\n`,
		);
	}
}

if (isEntryPoint(import.meta)) {
	await runMain(() => runRelease({ cwd: process.cwd(), env: process.env, blockers: RELEASE_BLOCKERS }));
}
