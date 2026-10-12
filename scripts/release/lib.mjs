import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PACKAGE_NAME = "pi-herdr-clean-craft";
export const REPOSITORY = "giuseppecrj/pi-herdr-clean-craft";
export const SERVER_URL = "https://github.com";
export const MAIN_REF = "refs/heads/main";
export const EVENTS = new Set(["push", "workflow_dispatch"]);

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const OUTPUT_VALUE = /^[0-9A-Za-z._-]+$/;
const NUMERIC = /^(?:0|[1-9]\d*)$/;
const TEXT = /^[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

export class Refusal extends Error {}

export function refuse(message) {
	throw new Refusal(message);
}

export function parseVersion(text) {
	if (typeof text !== "string") return undefined;
	const match = VERSION_PATTERN.exec(text);
	if (!match) return undefined;
	const prerelease = [];
	if (match[4] !== undefined) {
		for (const part of match[4].split(".")) {
			if (NUMERIC.test(part)) prerelease.push({ kind: "numeric", value: BigInt(part) });
			else if (TEXT.test(part)) prerelease.push({ kind: "text", value: part });
			else return undefined;
		}
	}
	return { core: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])], prerelease };
}

export const isStable = (version) => version.prerelease.length === 0;

function order(a, b) {
	if (a < b) return -1;
	return a > b ? 1 : 0;
}

function compareIdentifiers(a, b) {
	if (a.kind !== b.kind) return a.kind === "numeric" ? -1 : 1;
	return order(a.value, b.value);
}

export function compareVersions(a, b) {
	for (let index = 0; index < 3; index += 1) {
		const core = order(a.core[index], b.core[index]);
		if (core !== 0) return core;
	}
	if (a.prerelease.length === 0 || b.prerelease.length === 0) return order(b.prerelease.length, a.prerelease.length);
	for (let index = 0; index < Math.min(a.prerelease.length, b.prerelease.length); index += 1) {
		const identifier = compareIdentifiers(a.prerelease[index], b.prerelease[index]);
		if (identifier !== 0) return identifier;
	}
	return order(a.prerelease.length, b.prerelease.length);
}

export function sameCore(a, b) {
	return a.core.every((part, index) => part === b.core[index]);
}

export function readManifest(text, label) {
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		refuse(`${label} is not valid JSON.`);
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) refuse(`${label} is not a JSON object.`);
	if (value.name !== PACKAGE_NAME) refuse(`${label} name must be exactly ${PACKAGE_NAME}.`);
	if (value.private !== undefined && typeof value.private !== "boolean") refuse(`${label} private must be a boolean when present.`);
	return { name: value.name, version: value.version, private: value.private === true, raw: value };
}

export function requireSha(value, label) {
	if (typeof value !== "string" || !SHA_PATTERN.test(value)) refuse(`${label} must be a 40-character lowercase hexadecimal commit SHA.`);
	return value;
}

export function requireStableVersion(value, label) {
	const version = parseVersion(value);
	if (!version || !isStable(version)) refuse(`${label} must be a stable major.minor.patch version, not ${JSON.stringify(value)}.`);
	return version;
}

export function requireMainRef(env) {
	if (env.GITHUB_REF !== MAIN_REF) refuse(`Releases run only from ${MAIN_REF}, not ${JSON.stringify(env.GITHUB_REF ?? "")}.`);
}

export function requireEvent(env) {
	if (!EVENTS.has(env.GITHUB_EVENT_NAME)) refuse(`Unsupported release event ${JSON.stringify(env.GITHUB_EVENT_NAME ?? "")}.`);
	return env.GITHUB_EVENT_NAME;
}

// GITHUB_OUTPUT is line-based, so a value with a newline or an unexpected character could add another output.
export function writeOutputs(path, entries) {
	if (!path) refuse("GITHUB_OUTPUT is not set.");
	const lines = Object.entries(entries).map(([key, value]) => {
		if (!OUTPUT_VALUE.test(key) || typeof value !== "string" || !OUTPUT_VALUE.test(value)) refuse(`Refusing to write unsafe output ${key}.`);
		return `${key}=${value}\n`;
	});
	appendFileSync(path, lines.join(""));
}

export function isEntryPoint(meta) {
	return process.argv[1] === fileURLToPath(meta.url);
}

export async function runMain(main) {
	try {
		await main();
	} catch (error) {
		const message = error instanceof Refusal ? error.message : `Unexpected failure: ${error?.stack ?? error}`;
		console.log(`::error::${message.replaceAll("\n", " ")}`);
		process.exitCode = 1;
	}
}
