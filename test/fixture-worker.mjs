import { AssertionError } from "node:assert";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import { isAbsolute, join, relative, sep } from "node:path";
import { run } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspace = process.cwd();
const testFiles = process.argv.slice(2);

function workspacePath(url) {
	if (!url?.startsWith("file:")) return undefined;
	const path = relative(workspace, fileURLToPath(url));
	if (path === "" || path.startsWith("..") || isAbsolute(path)) return undefined;
	return path.split(sep).join("/");
}

const edges = new Map();
const loaded = {};
registerHooks({
	resolve(specifier, context, nextResolve) {
		const result = nextResolve(specifier, context);
		const from = workspacePath(context.parentURL);
		if (from !== undefined) {
			const to = workspacePath(result.url) ?? result.url;
			edges.set(`${from}\n${to}`, { from, to });
		}
		return result;
	},
	load(url, context, nextLoad) {
		const result = nextLoad(url, context);
		const path = workspacePath(url);
		if (path !== undefined && result.source != null) {
			loaded[path] = createHash("sha256").update(result.source).digest("hex");
		}
		return result;
	},
});

const sources = readdirSync(join(workspace, "src"), { recursive: true })
	.map((path) => `src/${String(path).split(sep).join("/")}`)
	.filter((path) => path.endsWith(".ts"))
	.toSorted();
const loadErrors = [];
for (const path of sources) {
	try {
		await import(pathToFileURL(join(workspace, path)).href);
	} catch (error) {
		loadErrors.push({ path, message: String(error?.message) });
	}
}

process.send({
	event: "ready",
	loaded,
	edges: [...edges.values()].toSorted((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
	loadErrors,
});

const [command] = await once(process, "message");
if (command !== "run") throw new Error(`controller requested ${command}`);

function failure({ name, file, details: { error } }) {
	if (error?.code === "ERR_TEST_FAILURE") {
		const { cause } = error;
		if (error.failureType === "testCodeFailure" && cause instanceof AssertionError) {
			return { kind: "assertion", actual: cause.actual, expected: cause.expected };
		}
		return { kind: "error", message: String(cause?.message ?? error.message) };
	}
	return { kind: name === file ? "load" : "error", message: String(error?.message) };
}

const results = [];
for await (const event of run({ files: testFiles.map((file) => join(workspace, file)), isolation: "none" })) {
	if (event.type !== "test:pass" && event.type !== "test:fail") continue;
	const file = workspacePath(pathToFileURL(event.data.file).href);
	const name = event.data.name === event.data.file ? file : event.data.name;
	results.push(event.type === "test:pass" ? { file, name, outcome: "pass" } : { file, name, outcome: "fail", ...failure(event.data) });
}
process.send({ event: "result", results }, () => process.disconnect());
