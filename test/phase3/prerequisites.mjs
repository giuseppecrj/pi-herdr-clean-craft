import { accessSync, constants, existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, relative } from "node:path";
import { procAvailable } from "./proc.mjs";
import { sha256 } from "./wire.mjs";

const DIGEST_FILE_LIMIT = 5_000;

function executableFile(path) {
	try {
		if (!statSync(path).isFile()) return false;
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export function resolveExecutable(env, { variable, name }) {
	const override = env[variable];
	if (override !== undefined) {
		if (!isAbsolute(override)) return { kind: "blocked", reason: `${variable} must be an absolute path, got ${JSON.stringify(override)}` };
		if (!executableFile(override)) return { kind: "blocked", reason: `${variable} does not name an executable file: ${override}` };
		return { kind: "found", path: realpathSync(override), source: variable };
	}
	for (const dir of (env.PATH ?? "").split(delimiter)) {
		// npm run puts package-local bins first; a development dependency's bundled CLI is not the installed tool under test.
		if (!isAbsolute(dir) || (basename(dir) === ".bin" && basename(dirname(dir)) === "node_modules")) continue;
		const candidate = join(dir, name);
		if (executableFile(candidate)) return { kind: "found", path: realpathSync(candidate), source: "PATH" };
	}
	return { kind: "blocked", reason: `no executable ${name} on PATH or in ${variable}` };
}

function contentDigest(root) {
	const files = readdirSync(root, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && !relative(root, entry.parentPath).split("/").includes("node_modules"))
		.map((entry) => relative(root, join(entry.parentPath, entry.name)))
		.toSorted();
	if (files.length > DIGEST_FILE_LIMIT) return { problem: `holds more than ${DIGEST_FILE_LIMIT} files` };
	const listing = files.map((path) => `${sha256(readFileSync(join(root, path)))}  ${path}`).join("\n");
	return { files: files.length, sha256: sha256(listing) };
}

function readManifest(root) {
	try {
		return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	} catch {
		return null;
	}
}

function locatePackage(env, { variable, name, version }) {
	const value = env[variable];
	if (value === undefined || value === "") return { kind: "blocked", reason: `${variable} is not set` };
	if (!isAbsolute(value)) return { kind: "blocked", reason: `${variable} must be an absolute path, got ${JSON.stringify(value)}` };
	if (!existsSync(value) || !statSync(value).isDirectory()) return { kind: "blocked", reason: `${variable} is not a directory: ${value}` };
	const root = realpathSync(value);
	const manifest = readManifest(root);
	if (!manifest) return { kind: "blocked", reason: `${variable} has no readable package.json` };
	if (manifest.name !== name) return { kind: "blocked", reason: `${variable} is package ${JSON.stringify(manifest.name)}, expected ${name}` };
	if (version !== undefined && manifest.version !== version) {
		return { kind: "blocked", reason: `${variable} is ${name}@${manifest.version}, expected exactly ${version}` };
	}
	const extensions = Array.isArray(manifest.pi?.extensions) ? manifest.pi.extensions : [];
	const skills = Array.isArray(manifest.pi?.skills) ? manifest.pi.skills : [];
	if (extensions.length === 0) return { kind: "blocked", reason: `${variable} declares no Pi extension` };
	const missing = [...extensions, ...skills].filter((entry) => typeof entry !== "string" || !existsSync(join(root, entry)));
	if (missing.length > 0) return { kind: "blocked", reason: `${variable} declares missing resources: ${missing.join(", ")}` };
	const digest = contentDigest(root);
	if (digest.problem) return { kind: "blocked", reason: `${variable} ${digest.problem}` };
	return { kind: "found", root, name, version: manifest.version, extensions, skills, digest };
}

export function locatePrerequisites(env, { hostVersion, platform = procAvailable }) {
	const located = {
		platform: platform() ? { kind: "found" } : { kind: "blocked", reason: "Linux /proc process and socket attribution is unavailable" },
		pi: resolveExecutable(env, { variable: "CLEAN_CRAFT_PI_BIN", name: "pi" }),
		herdr: resolveExecutable(env, { variable: "CLEAN_CRAFT_HERDR_BIN", name: "herdr" }),
		host: locatePackage(env, { variable: "CLEAN_CRAFT_HOST_ROOT", name: "pi-herdr-agents", version: hostVersion }),
		pstack: locatePackage(env, { variable: "CLEAN_CRAFT_PSTACK_ROOT", name: "pi-herdr-pstack" }),
	};
	const reasons = Object.entries(located)
		.filter(([, value]) => value.kind === "blocked")
		.map(([key, value]) => `${key}: ${value.reason}`);
	return reasons.length > 0 ? { kind: "blocked", reasons, located } : { kind: "ready", ...located };
}
