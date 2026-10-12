import {
	isEntryPoint,
	PACKAGE_NAME,
	Refusal,
	refuse,
	requireSha,
	requireStableVersion,
	runMain,
	writeOutputs,
} from "./lib.mjs";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BYTES = 8 * 1024 * 1024;
const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"]);
// Matched on the raw text, not after JSON.parse, which keeps only the last of repeated keys.
const NOT_FOUND_BODY = /^[ \t\n\r]*\{[ \t\n\r]*"error"[ \t\n\r]*:[ \t\n\r]*"Not found"[ \t\n\r]*\}[ \t\n\r]*$/;

function registryUrl(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		refuse("REGISTRY_URL is not a URL.");
	}
	if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) refuse("REGISTRY_URL must use https.");
	return url;
}

function timeoutMs(value) {
	if (value === undefined || value === "") return DEFAULT_TIMEOUT_MS;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > DEFAULT_TIMEOUT_MS) refuse(`REGISTRY_TIMEOUT_MS must be an integer from 1 to ${DEFAULT_TIMEOUT_MS}.`);
	return parsed;
}

async function readBounded(response) {
	const chunks = [];
	let size = 0;
	for await (const chunk of response.body ?? []) {
		size += chunk.byteLength;
		if (size > MAX_BYTES) refuse(`npm returned more than ${MAX_BYTES} bytes for ${PACKAGE_NAME}; refusing an oversized document.`);
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export async function checkRegistry(env) {
	if (env.PACKAGE_NAME !== PACKAGE_NAME) refuse(`PACKAGE_NAME must be exactly ${PACKAGE_NAME}.`);
	const version = env.VERSION;
	requireStableVersion(version, "VERSION");
	const sha = requireSha(env.GITHUB_SHA, "GITHUB_SHA");
	const url = new URL(encodeURIComponent(PACKAGE_NAME), registryUrl(env.REGISTRY_URL));
	const limit = timeoutMs(env.REGISTRY_TIMEOUT_MS);

	let response;
	let body;
	try {
		response = await fetch(url, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(limit) });
		body = await readBounded(response);
	} catch (error) {
		if (error instanceof Refusal) throw error;
		const cause = error?.cause?.code ?? error?.cause?.message ?? "";
		refuse(`npm registry fetch for ${PACKAGE_NAME} failed (${error?.name}: ${error?.message}${cause ? `; ${cause}` : ""}); redirects, timeouts, and network errors are refused.`);
	}

	if (response.status === 404) {
		if (!NOT_FOUND_BODY.test(body)) refuse(`npm returned an ambiguous HTTP 404 body for ${PACKAGE_NAME}; only {"error":"Not found"} means absent.`);
		return "absent";
	}
	if (response.status !== 200) refuse(`npm registry lookup for ${PACKAGE_NAME} returned HTTP ${response.status}.`);

	let metadata;
	try {
		metadata = JSON.parse(body);
	} catch {
		refuse(`npm returned malformed JSON metadata for ${PACKAGE_NAME}.`);
	}
	if (!isRecord(metadata) || metadata.name !== PACKAGE_NAME || !isRecord(metadata.versions)) {
		refuse(`npm returned unexpected package metadata for ${PACKAGE_NAME}.`);
	}
	if (!Object.hasOwn(metadata.versions, version)) return "version-absent";
	const published = metadata.versions[version];
	if (!isRecord(published) || published.version !== version || published.name !== PACKAGE_NAME) {
		refuse(`npm returned unexpected version metadata for ${PACKAGE_NAME}@${version}.`);
	}
	if (published.gitHead !== sha) {
		const gitHead = typeof published.gitHead === "string" ? published.gitHead : "missing";
		refuse(
			`${PACKAGE_NAME}@${version} is already published from gitHead ${gitHead}, not ${sha}. Refusing to tag or create a GitHub Release for it. Increase the version instead.`,
		);
	}
	return "same-commit-published";
}

if (isEntryPoint(import.meta)) {
	await runMain(async () => {
		const state = await checkRegistry(process.env);
		console.log(`npm registry state for ${PACKAGE_NAME}@${process.env.VERSION}: ${state}.`);
		writeOutputs(process.env.GITHUB_OUTPUT, { registry: state });
	});
}
