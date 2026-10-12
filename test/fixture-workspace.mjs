import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isolatedEnv, listFiles, PACKAGE_ROOT } from "./support.mjs";

export const FIXTURE_ROOT = join(PACKAGE_ROOT, "test", "fixtures", "retry-eligibility");
const WORKER = join(PACKAGE_ROOT, "test", "fixture-worker.mjs");

export function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function snapshot(name, files) {
	const owned = new Map([...files].map(([path, bytes]) => [path, Buffer.from(bytes)]));
	return Object.freeze({
		name,
		paths: Object.freeze([...owned.keys()].toSorted()),
		bytes(path) {
			const bytes = owned.get(path);
			if (bytes === undefined) throw new Error(`${name} has no file ${path}`);
			return Buffer.from(bytes);
		},
	});
}

export function readSnapshot(name, dir) {
	return snapshot(name, new Map(listFiles(dir).map((path) => [path, readFileSync(join(dir, path))])));
}

function subdirectories(dir) {
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.toSorted();
}

function replacedSources(label, base, overlay) {
	for (const path of overlay.paths) {
		if (!path.startsWith("src/") || !base.paths.includes(path)) {
			throw new Error(`${label} must replace existing base files under src/, not ${path}`);
		}
		if (overlay.bytes(path).equals(base.bytes(path))) throw new Error(`${label} leaves ${path} unchanged`);
	}
}

function variant(base, overlay, name) {
	replacedSources(`variant ${name}`, base, overlay);
	return snapshot(`variant ${name}`, new Map([...base.paths, ...overlay.paths].map((path) => [path, (overlay.paths.includes(path) ? overlay : base).bytes(path)])));
}

function mutant(base, overlay, name) {
	if (overlay.paths.length !== 1) throw new Error(`mutant ${name} must replace exactly one file, found ${overlay.paths.length}`);
	replacedSources(`mutant ${name}`, base, overlay);
	const [path] = overlay.paths;
	const before = base.bytes(path).toString("utf8").split("\n");
	const after = overlay.bytes(path).toString("utf8").split("\n");
	if (before.length !== after.length) throw new Error(`mutant ${name} changes the line count of ${path}`);
	const lines = after.flatMap((line, index) => (line === before[index] ? [] : [index + 1]));
	if (lines.length !== 1) throw new Error(`mutant ${name} changes ${lines.length} lines of ${path}`);
	return Object.freeze({ name, path, line: lines[0], bytes: () => overlay.bytes(path) });
}

export function loadFixture(root = FIXTURE_ROOT) {
	const base = readSnapshot("base", join(root, "base"));
	const load = (kind, build) => new Map(subdirectories(join(root, kind)).map((name) => [name, build(base, readSnapshot(name, join(root, kind, name)), name)]));
	const variants = load("variants", variant);
	const mutants = load("mutants", mutant);
	const pick = (kind, states, name) => {
		const state = states.get(name);
		if (state === undefined) throw new Error(`unknown ${kind} ${name}; known: ${[...states.keys()].join(", ")}`);
		return state;
	};
	return Object.freeze({
		base,
		variant: (name) => pick("variant", variants, name),
		mutant: (name) => pick("mutant", mutants, name),
	});
}

export function diffWorkspace(dir, expected) {
	const actual = listFiles(dir);
	return [
		...expected.paths.filter((path) => !actual.includes(path)).map((path) => `missing ${path}`),
		...actual.filter((path) => !expected.paths.includes(path)).map((path) => `extra ${path}`),
		...actual.filter((path) => expected.paths.includes(path) && !readFileSync(join(dir, path)).equals(expected.bytes(path))).map((path) => `changed ${path}`),
	];
}

export function release(workspace) {
	if (!existsSync(workspace.root)) return;
	const differences = diffWorkspace(workspace.dir, workspace.expected);
	if (differences.length > 0) {
		throw new Error(`workspace does not match ${workspace.expected.name} (${differences.join(", ")}); retained ${workspace.root}`);
	}
	rmSync(workspace.root, { recursive: true, force: true });
}

export function materialize(t, state, parent = tmpdir()) {
	const root = realpathSync(mkdtempSync(join(parent, "clean-craft-fixture-")));
	const dir = join(root, "workspace");
	for (const path of state.paths) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), state.bytes(path));
	}
	const workspace = Object.freeze({ root, dir, expected: state });
	t.after(() => release(workspace));
	return workspace;
}

export function runWorker(workspace, { tests, ending = "complete", timeoutMs = 30_000 }) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(process.execPath, [WORKER, ...tests], {
			cwd: workspace.dir,
			env: isolatedEnv(workspace.root),
			stdio: ["ignore", "pipe", "pipe", "ipc"],
		});
		let ready;
		let results;
		let stderr = "";
		let interrupted = false;
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, timeoutMs);
		child.stdout.resume();
		child.stderr.setEncoding("utf8").on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("message", (message) => {
			if (message.event === "ready" && ready === undefined) {
				ready = message;
				if (ending === "interrupted") interrupted = child.kill("SIGKILL");
				else child.send(ending === "complete" ? "run" : "fail");
			} else if (message.event === "result" && ready !== undefined) {
				results = message.results;
			}
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			if (timedOut) {
				reject(new Error(`fixture worker exceeded ${timeoutMs} ms\nstderr:\n${stderr}`));
				return;
			}
			const observed = results !== undefined && code === 0 ? "complete" : interrupted && signal === "SIGKILL" && results === undefined ? "interrupted" : "worker-error";
			resolvePromise({ ending: observed, ready, results, code, signal, stderr });
		});
	});
}

export function writeMutant(workspace, base, mutant) {
	const target = join(workspace.dir, mutant.path);
	if (!readFileSync(target).equals(base.bytes(mutant.path))) {
		throw new Error(`${mutant.path} does not match base; mutant ${mutant.name} was not written`);
	}
	writeFileSync(target, mutant.bytes());
}

export function passedEverything(run) {
	return run.ending === "complete" && run.results.length > 0 && run.results.every((result) => result.outcome === "pass");
}

export async function mutantTrial(t, fixture, { mutant: name, tests, ending = "complete" }) {
	const workspace = materialize(t, fixture.base);
	const baseline = await runWorker(workspace, { tests });
	if (!passedEverything(baseline)) throw new Error(`baseline is not green; mutant ${name} was not written`);
	const mutant = fixture.mutant(name);
	writeMutant(workspace, fixture.base, mutant);
	let mutated;
	try {
		mutated = await runWorker(workspace, { tests, ending });
	} finally {
		writeFileSync(join(workspace.dir, mutant.path), fixture.base.bytes(mutant.path));
	}
	const differences = diffWorkspace(workspace.dir, fixture.base);
	if (differences.length > 0) {
		throw new Error(`restoration not verified (${differences.join(", ")}); retained ${workspace.root}`);
	}
	const final = await runWorker(workspace, { tests });
	return { workspace, mutant, baseline, mutated, final };
}
