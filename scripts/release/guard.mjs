import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
	isEntryPoint,
	PACKAGE_NAME,
	readManifest,
	REPOSITORY,
	refuse,
	requireEvent,
	requireMainRef,
	requireSha,
	requireStableVersion,
	runMain,
	SERVER_URL,
} from "./lib.mjs";

export function guard(env, cwd = process.cwd()) {
	requireEvent(env);
	requireMainRef(env);
	const sha = requireSha(env.GITHUB_SHA, "GITHUB_SHA");
	if (env.CANDIDATE_SHA !== sha) refuse(`The detected SHA ${JSON.stringify(env.CANDIDATE_SHA ?? "")} is not this run's GITHUB_SHA ${sha}.`);
	const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", timeout: 30_000 }).trim();
	if (head !== sha) refuse(`The checked-out HEAD ${head} is not GITHUB_SHA ${sha}.`);

	if (env.GITHUB_REPOSITORY !== REPOSITORY) refuse(`GITHUB_REPOSITORY must be ${REPOSITORY}, not ${JSON.stringify(env.GITHUB_REPOSITORY ?? "")}.`);
	if (env.GITHUB_SERVER_URL !== SERVER_URL) refuse(`GITHUB_SERVER_URL must be ${SERVER_URL}.`);
	if (env.REPOSITORY_PRIVATE !== "false" || env.REPOSITORY_VISIBILITY !== "public") {
		refuse("The repository must be public: npm does not generate provenance from a private repository.");
	}
	if (env.RUNNER_ENVIRONMENT !== "github-hosted") refuse("Trusted publishing and provenance need a github-hosted runner.");

	const manifest = readManifest(readFileSync(`${cwd}/package.json`, "utf8"), "package.json");
	if (env.CANDIDATE_NAME !== PACKAGE_NAME) refuse(`The detected name ${JSON.stringify(env.CANDIDATE_NAME ?? "")} is not ${PACKAGE_NAME}.`);
	if (manifest.private) refuse("package.json is private.");
	requireStableVersion(manifest.version, "package.json version");
	if (env.CANDIDATE_VERSION !== manifest.version) refuse(`The detected version ${JSON.stringify(env.CANDIDATE_VERSION ?? "")} is not package.json version ${manifest.version}.`);
	if (env.CANDIDATE_TAG !== `v${manifest.version}`) refuse(`The detected tag ${JSON.stringify(env.CANDIDATE_TAG ?? "")} is not v${manifest.version}.`);

	const { raw } = manifest;
	if (raw.publishConfig?.access !== "public") refuse('package.json publishConfig.access must be "public".');
	const web = `${SERVER_URL}/${REPOSITORY}`;
	if (raw.repository?.type !== "git" || raw.repository?.url !== `git+${web}.git`) refuse(`package.json repository must be { "type": "git", "url": "git+${web}.git" }.`);
	if (raw.homepage !== `${web}#readme`) refuse(`package.json homepage must be ${web}#readme.`);
	if (raw.bugs?.url !== `${web}/issues`) refuse(`package.json bugs.url must be ${web}/issues.`);
}

if (isEntryPoint(import.meta)) {
	await runMain(() => {
		guard(process.env);
		console.log(`Release candidate ${process.env.CANDIDATE_NAME}@${process.env.CANDIDATE_VERSION} confirmed at ${process.env.GITHUB_SHA}.`);
	});
}
