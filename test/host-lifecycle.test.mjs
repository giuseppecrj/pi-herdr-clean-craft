import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs, { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { connect } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { SKILLS } from "./inventory.mjs";
import { runSkillDelivery } from "./phase3/delivery.mjs";
import { deadline, within } from "./phase3/event-log.mjs";
import { judgeIsolation } from "./phase3/evidence.mjs";
import { launchScripts } from "./phase3/gate.mjs";
import * as kernel from "./phase3/proc.mjs";
import { runBounded, startLineProcess, startRpcPi } from "./phase3/processes.mjs";
import { DUMMY_KEY, startProvider } from "./phase3/provider.mjs";
import { createRuntime } from "./phase3/runtime.mjs";
import { textReply } from "./phase3/wire.mjs";
import { makeTempRoot, PACKAGE_ROOT } from "./support.mjs";

const NODE = realpathSync(process.execPath);
const FS_READS = ["readFileSync", "readdirSync", "readlinkSync"];
const WAIT_FOR_EOF = 'process.stdin.resume(); process.stdin.on("end", () => process.exit(0));';
const HOLD_STDOUT = 'require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 3000)"], { stdio: ["ignore", 1, 2] });';
const SENDER = `
const http = require("node:http");
const keep = new http.Agent({ keepAlive: true, maxSockets: 1 });
const lines = require("node:readline").createInterface({ input: process.stdin });
lines.on("line", (line) => {
	const agent = line === "fresh" ? new http.Agent({ keepAlive: false }) : keep;
	const req = http.request(process.env.CC_TARGET, { method: "POST", agent }, (res) => {
		res.resume();
		res.on("end", () => process.stdout.write("done\\n"));
	});
	req.on("error", () => {});
	req.end("{}");
});
lines.on("close", () => process.exit(0));
`;
const SERVER = `
const child = require("node:child_process").spawn(process.execPath, ["-e", process.env.CC_SENDER], { stdio: [3, 1, "ignore"], env: JSON.parse(process.env.CC_CHILD_ENV) });
child.on("exit", () => process.stdout.write("exited\\n"));
process.stdout.write("child " + child.pid + "\\n");
setInterval(() => {}, 1 << 30);
`;

function requireProc() {
	if (!kernel.procAvailable()) assert.fail("BLOCKED: Linux /proc is unavailable, so the harness lifecycle cannot be checked here");
}

function denied(path) {
	return Object.assign(new Error(`EACCES: permission denied, '${path}'`), { code: "EACCES" });
}

function missing(path) {
	return Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: "ENOENT" });
}

function vanished(path) {
	return Object.assign(new Error(`ESRCH: no such process, '${path}'`), { code: "ESRCH" });
}

async function underKernelFaults(fault, run) {
	const saved = Object.fromEntries(FS_READS.map((name) => [name, fs[name]]));
	for (const name of FS_READS) {
		fs[name] = (path, ...rest) => {
			const injected = fault(String(path), name);
			if (injected instanceof Error) throw injected;
			return injected === undefined ? saved[name](path, ...rest) : injected;
		};
	}
	syncBuiltinESMExports();
	try {
		return await run();
	} finally {
		Object.assign(fs, saved);
		syncBuiltinESMExports();
	}
}

function startTime(pid) {
	const text = readFileSync(`/proc/${pid}/stat`, "utf8");
	return text.slice(text.lastIndexOf(")") + 2).split(" ")[19];
}

function killIfSame({ pid, startTime: recorded }) {
	try {
		if (startTime(pid) === recorded) process.kill(pid, "SIGKILL");
	} catch {}
}

function environText(environment) {
	return `${Object.entries(environment)
		.map(([name, value]) => `${name}=${value}`)
		.join("\0")}\0`;
}

function queue() {
	const items = [];
	const waiters = [];
	return {
		push(item) {
			const waiter = waiters.shift();
			if (waiter) waiter(item);
			else items.push(item);
		},
		next(step) {
			const ready = items.length > 0 ? Promise.resolve(items.shift()) : new Promise((resolve) => waiters.push(resolve));
			return within(ready, deadline(10_000, step));
		},
	};
}

async function settledState(promise, ms = 150) {
	return Promise.race([promise.then(() => "settled"), delay(ms).then(() => "pending")]);
}

function stubHerdr(options, serverProcess, { stop = async () => ({ started: false }) } = {}) {
	const socket = join(options.root, "run", "herdr.sock");
	return {
		socket,
		commands: [],
		state: "verified",
		server: null,
		async start() {
			const { pid } = serverProcess();
			const identity = Object.freeze({ pid, startTime: startTime(pid), kind: "server", exe: NODE });
			options.adopt?.("herdr server", "server", { identity, identityProblem: null });
			options.record(identity);
			return { server: identity, socket };
		},
		async anchor() {
			return { pane: "anchor-pane" };
		},
		stop,
	};
}

function removeRoot(runtime) {
	rmSync(runtime.paths.root, { recursive: true, force: true });
}

async function senderFixture(t) {
	let server = null;
	const runtime = createRuntime({ pi: NODE, herdr: "/bin/true", boundaries: { createHerdr: (options) => stubHerdr(options, () => server) } });
	const requests = queue();
	const http = createServer((req, res) => {
		const ports = { remotePort: req.socket.remotePort, localPort: req.socket.localPort };
		res.on("error", () => {});
		req.resume();
		req.on("end", () => requests.push({ req, res, ports }));
	});
	http.listen(0, "127.0.0.1");
	await once(http, "listening");
	const env = {
		PATH: "/usr/bin:/bin",
		HOME: runtime.paths.home,
		CC_TARGET: `http://127.0.0.1:${http.address().port}/v1/chat/completions`,
		PI_SUBAGENT_ID: "sub-1",
		PI_SUBAGENT_NAME: "child-1",
		HERDR_SESSION: runtime.session,
		HERDR_SOCKET_PATH: join(runtime.paths.root, "run", "herdr.sock"),
		HERDR_PANE_ID: "child-pane",
		PI_CODING_AGENT_DIR: runtime.paths.agent,
		PI_OFFLINE: "1",
	};
	server = spawn(NODE, ["-e", SERVER], {
		cwd: runtime.paths.work,
		env: { PATH: "/usr/bin:/bin", CC_SENDER: SENDER, CC_CHILD_ENV: JSON.stringify(env) },
		stdio: ["ignore", "pipe", "ignore", "pipe"],
	});
	const serverIdentity = { pid: server.pid, startTime: startTime(server.pid) };
	const lines = queue();
	createInterface({ input: server.stdout }).on("line", (line) => lines.push(line));
	const childPid = Number((await lines.next("sender pid")).split(" ")[1]);
	const child = { pid: childPid, startTime: startTime(childPid) };
	t.after(async () => {
		killIfSame(child);
		killIfSame(serverIdentity);
		server.stdio[3].destroy();
		http.closeAllConnections();
		http.close();
		await runtime.close();
		removeRoot(runtime);
	});
	await runtime.startServer();
	await runtime.anchor();
	return {
		runtime,
		server,
		child,
		env,
		lines,
		async send(kind) {
			server.stdio[3].write(`${kind}\n`);
			return requests.next(`${kind} request`);
		},
		async answer({ res }) {
			res.end("ok");
			assert.equal(await lines.next("sender reply"), "done");
		},
		attribute({ req, ports }) {
			return runtime.attribute({ connection: req.socket, ...ports });
		},
	};
}

const PASSING_PARENT = Object.freeze({
	kind: "parent",
	label: "parent",
	basis: "owned-tree",
	riskyNames: [],
	checks: { identity: true, executable: true, rootSender: true, noSubagentId: true, noRiskyNames: true },
});

function isolationEvidence(fields) {
	return { ledger: [], faults: {}, parentLog: [], parentStderr: "", solos: {}, session: "owned", herdrState: "stopped", ...fields };
}

const TIME_WAIT_ROW = "  20: 0100007F:D872 0100007F:80A9 06 00000000:00000000 03:0000176F 00000000     0        0 0 3 00000000bc7508f4";

function socketTables(tables) {
	return (path) => tables[path];
}

function malformedTcpTables() {
	const real = readFileSync("/proc/net/tcp", "utf8");
	const [header] = real.split("\n");
	return {
		"truncated row": `  sl  local_address rem_address st\n  0: truncated\n`,
		"rows without an inode": real
			.split("\n")
			.map((row, index) => (index === 0 || row === "" ? row : row.trim().split(/\s+/).slice(0, 9).join(" ")))
			.join("\n"),
		"table cut inside a row": `${header}\n${real.split("\n").slice(1).join("\n").trimEnd().slice(0, -3)}`,
	};
}

describe("kernel observations keep unknown apart from gone", () => {
	it("reports a denied stat read as unknown, and only a reaped process as absent", async () => {
		requireProc();
		const self = kernel.identify(process.pid, "controller");
		assert.equal(self.state, "present");
		assert.equal(kernel.observe(self.identity).state, "present");
		const denial = await underKernelFaults(
			(path) => (path === `/proc/${process.pid}/stat` ? denied(path) : undefined),
			() => kernel.observe(self.identity),
		);
		assert.equal(denial.state, "unknown");
		assert.match(denial.reason, /EACCES/);
		const child = spawn(NODE, ["-e", ""], { stdio: "ignore" });
		const captured = kernel.identify(child.pid, "fixture");
		await once(child, "close");
		assert.equal(kernel.observe(captured.identity).state, "absent");
		assert.equal(kernel.observe({ ...self.identity, startTime: "1" }).state, "absent", "a different start time is a different process");
	});

	it("reports unreadable descriptors, environments, socket tables and trees as unknown", async () => {
		requireProc();
		const self = kernel.identify(process.pid, "controller").identity;
		const fault = (path) =>
			path === `/proc/${process.pid}/fd` || path === `/proc/${process.pid}/environ` || path === "/proc/net/tcp" || path.startsWith(`/proc/${process.pid}/task`) ? denied(path) : undefined;
		const observed = await underKernelFaults(fault, () => ({
			sockets: kernel.socketInodes(process.pid),
			environment: kernel.environOf(process.pid),
			tcp: kernel.loopbackClientInodes(1, 2),
			tree: kernel.ownedTree([{ ...self, label: "controller" }]),
		}));
		assert.equal(observed.sockets.state, "unknown");
		assert.equal(observed.environment.state, "unknown");
		assert.equal(observed.tcp.state, "unknown");
		assert.ok(observed.tree.problems.length > 0, "an unreadable task list is not an empty tree");
	});

	it("reports malformed or truncated socket-table rows as unknown rather than as an empty table", async () => {
		requireProc();
		for (const [name, table] of Object.entries(malformedTcpTables())) {
			const tcp = await underKernelFaults(socketTables({ "/proc/net/tcp": table }), () => kernel.loopbackClientInodes(1234, 5678));
			assert.equal(tcp.state, "unknown", `${name}: ${JSON.stringify(tcp)}`);
		}
		const unixHeader = readFileSync("/proc/net/unix", "utf8").split("\n")[0];
		for (const table of ["Num RefCount Protocol Flags Type St Inode Path\n0000: truncated\n", `${unixHeader}\n0000000000000000: 00000002 00000000 00010000 0001 01\n`]) {
			const unix = await underKernelFaults(socketTables({ "/proc/net/unix": table }), () => kernel.unixListenerInodes("/tmp/test.sock"));
			assert.equal(unix.state, "unknown", JSON.stringify({ table, unix }));
		}
	});

	it("reads the kernel's shorter TIME_WAIT, unnamed and spaced-path rows as present", async () => {
		requireProc();
		const tcpHeader = readFileSync("/proc/net/tcp", "utf8").split("\n")[0];
		const unixHeader = readFileSync("/proc/net/unix", "utf8").split("\n")[0];
		const tables = {
			"/proc/net/tcp": `${tcpHeader}\n${TIME_WAIT_ROW}\n`,
			"/proc/net/unix": `${unixHeader}\n0000000017cf87ce: 00000002 00000000 00000000 0005 03 6454247\n00000000c96c5359: 00000002 00000000 00010000 0001 01 6883380 /tmp/with space.sock\n`,
		};
		const observed = await underKernelFaults(socketTables(tables), () => ({
			timeWait: kernel.loopbackClientInodes(0xd872, 0x80a9),
			listener: kernel.unixListenerInodes("/tmp/with space.sock"),
		}));
		assert.deepEqual(observed.timeWait, { state: "present", inodes: ["0"] });
		assert.deepEqual(observed.listener, { state: "present", inodes: ["6883380"] });
		const headerOnly = await underKernelFaults(socketTables({ "/proc/net/tcp": `${tcpHeader}\n` }), () => kernel.loopbackClientInodes(1, 2));
		assert.deepEqual(headerOnly, { state: "present", inodes: [] }, "a table with no rows is a readable empty table");
	});

	it("treats a descriptor that closes during enumeration as an ordinary race", async () => {
		requireProc();
		const [first] = readdirSync(`/proc/${process.pid}/fd`);
		const raced = await underKernelFaults(
			(path, method) => (method === "readlinkSync" && path === `/proc/${process.pid}/fd/${first}` ? missing(path) : undefined),
			() => kernel.socketInodes(process.pid),
		);
		assert.equal(raced.state, "present");
	});
});

describe("request attribution with real sender processes", () => {
	it("attributes a live reparented child only while every recorded invariant still holds", async (t) => {
		requireProc();
		const f = await senderFixture(t);
		const first = await f.send("same");
		const proven = f.attribute(first);
		assert.equal(proven.kind, "host-child", proven.reason);
		assert.equal(proven.detached, false);
		await f.answer(first);
		f.server.kill("SIGKILL");
		await once(f.server, "exit");
		const second = await f.send("same");
		const reparented = f.attribute(second);
		assert.equal(reparented.kind, "host-child", reparented.reason);
		assert.equal(reparented.subagentId, "sub-1");
		assert.equal(reparented.detached, true);
		assert.equal(judgeIsolation(isolationEvidence({ session: f.runtime.session, ledger: [{ index: 0, origin: reparented, auth: "dummy", refused: null }] })).kind, "pass");
		await f.answer(second);
		const third = await f.send("same");
		const changed = await underKernelFaults(
			(path, method) => {
				if (method === "readlinkSync" && path === `/proc/${f.child.pid}/exe`) return "/not-pi";
				if (method === "readFileSync" && path === `/proc/${f.child.pid}/environ`) return environText({ ...f.env, PI_OFFLINE: "0", OPENAI_API_KEY: "x" });
				return undefined;
			},
			() => f.attribute(third),
		);
		assert.equal(changed.kind, "unknown", "a changed executable and environment must not reuse the earlier proof");
		const environmentOnly = await underKernelFaults(
			(path, method) => (method === "readFileSync" && path === `/proc/${f.child.pid}/environ` ? environText({ ...f.env, PI_SUBAGENT_NAME: "someone-else" }) : undefined),
			() => f.attribute(third),
		);
		assert.equal(environmentOnly.kind, "unknown", "a changed subagent name contradicts the recorded child");
		assert.equal(f.attribute(third).kind, "host-child", "the unchanged child still attributes");
	});

	it("revalidates a sender whose main thread exited through a thread that still runs", async (t) => {
		requireProc();
		const f = await senderFixture(t);
		const first = await f.send("same");
		assert.equal(f.attribute(first).kind, "host-child");
		await f.answer(first);
		const second = await f.send("same");
		const leader = `/proc/${f.child.pid}`;
		const zombieStat = readFileSync(`${leader}/stat`, "utf8").replace(/\) \S /, ") Z ");
		const exitedLeader = (path, method) => {
			if (method === "readFileSync" && (path === `${leader}/stat` || path === `${leader}/task/${f.child.pid}/stat`)) return zombieStat;
			if (method === "readdirSync" && path === `${leader}/fd`) return [];
			if (method === "readlinkSync" && path === `${leader}/exe`) return missing(path);
			if (method === "readFileSync" && path === `${leader}/environ`) return vanished(path);
			return undefined;
		};
		const live = await underKernelFaults(exitedLeader, () => f.attribute(second));
		assert.equal(live.kind, "host-child", live.reason);
		assert.equal(live.subagentId, "sub-1");
		const threadEnvironment = new RegExp(`^${leader}/task/\\d+/environ$`);
		const changed = await underKernelFaults(
			(path, method) => exitedLeader(path, method) ?? (method === "readFileSync" && threadEnvironment.test(path) ? environText({ ...f.env, GITHUB_TOKEN: "x" }) : undefined),
			() => f.attribute(second),
		);
		assert.equal(changed.kind, "unknown", "a contradiction seen through the live thread still rejects");
	});

	it("blocks attribution when the kernel denies descriptor, environment or socket-table reads", async (t) => {
		requireProc();
		const f = await senderFixture(t);
		const first = await f.send("same");
		assert.equal(f.attribute(first).kind, "host-child");
		await f.answer(first);
		const second = await f.send("same");
		const deniedChild = await underKernelFaults(
			(path) => (path === `/proc/${f.child.pid}/fd` || path === `/proc/${f.child.pid}/environ` ? denied(path) : undefined),
			() => f.attribute(second),
		);
		assert.equal(deniedChild.kind, "unknown", "denied reads are not proof that the sender left");
		const deniedTable = await underKernelFaults(
			(path) => (path === "/proc/net/tcp" ? denied(path) : undefined),
			() => f.attribute(second),
		);
		assert.equal(deniedTable.kind, "unknown", "an unreadable socket table is not an empty one");
	});

	it("keeps historical attribution only on the same proven connection after the sender is confirmed gone", async (t) => {
		requireProc();
		const f = await senderFixture(t);
		const first = await f.send("same");
		assert.equal(f.attribute(first).kind, "host-child");
		await f.answer(first);
		const kept = await f.send("same");
		const fresh = await f.send("fresh");
		assert.equal(kept.req.socket, first.req.socket, "the sender reused its proven connection");
		assert.notEqual(fresh.req.socket, first.req.socket);
		assert.equal(startTime(f.child.pid), f.child.startTime);
		process.kill(f.child.pid, "SIGKILL");
		assert.equal(await f.lines.next("sender exit"), "exited");
		const deniedTable = await underKernelFaults(
			(path) => (path === "/proc/net/tcp" ? denied(path) : undefined),
			() => f.attribute(kept),
		);
		assert.equal(deniedTable.kind, "unknown");
		const deniedSender = await underKernelFaults(
			(path) => (path === `/proc/${f.child.pid}/stat` ? denied(path) : undefined),
			() => f.attribute(kept),
		);
		assert.equal(deniedSender.kind, "unknown", "an unreadable sender is not a departed sender");
		const historical = f.attribute(kept);
		assert.equal(historical.kind, "host-child", historical.reason);
		assert.equal(historical.basis, "connection");
		assert.equal(historical.disappearance.sender, "absent");
		assert.match(historical.disappearance.socket, /^(gone|orphaned)$/);
		assert.equal(judgeIsolation(isolationEvidence({ session: f.runtime.session, ledger: [{ index: 0, origin: historical, auth: "dummy", refused: null }] })).kind, "pass");
		assert.equal(f.attribute(fresh).kind, "unknown", "a different connection never inherits an earlier proof");
	});

	it("does not read a malformed socket table as the departure of a proven connection's sender", async (t) => {
		requireProc();
		const f = await senderFixture(t);
		const first = await f.send("same");
		assert.equal(f.attribute(first).kind, "host-child");
		await f.answer(first);
		const kept = await f.send("same");
		process.kill(f.child.pid, "SIGKILL");
		assert.equal(await f.lines.next("sender exit"), "exited");
		for (const [name, table] of Object.entries(malformedTcpTables())) {
			const observed = await underKernelFaults(socketTables({ "/proc/net/tcp": table }), () => f.attribute(kept));
			assert.equal(observed.kind, "unknown", `${name}: ${observed.basis ?? observed.reason}`);
			assert.equal(observed.provenConnection?.subagentName, "child-1", "the proven connection is still described");
		}
		assert.equal(f.attribute(kept).basis, "connection", "the readable table still establishes departure");
	});
});

describe("runtime teardown keeps uncertainty and finishes every phase", () => {
	it("retains the runtime when a recorded identity cannot be observed", async (t) => {
		requireProc();
		let server = null;
		const runtime = createRuntime({ pi: NODE, herdr: "/bin/true", boundaries: { createHerdr: (options) => stubHerdr(options, () => server) } });
		server = spawn(NODE, ["-e", "setInterval(() => {}, 1 << 30)"], { stdio: "ignore" });
		t.after(() => {
			server.kill("SIGKILL");
			removeRoot(runtime);
		});
		await runtime.startServer();
		const teardown = await underKernelFaults(
			(path) => (path === `/proc/${server.pid}/stat` ? denied(path) : undefined),
			() => runtime.close(),
		);
		assert.equal(teardown.kind, "retained");
		assert.ok(
			teardown.uncertain.some((entry) => entry.pid === server.pid),
			JSON.stringify(teardown.uncertain),
		);
		const archived = runtime.archive({ "report.json": "{}\n" }, { passed: true, ownedArtifacts: [] });
		t.after(() => archived.evidence && rmSync(archived.evidence, { recursive: true, force: true }));
		assert.equal(archived.retainedRoot, runtime.paths.root);
		assert.ok(existsSync(runtime.paths.root));
		assert.ok(archived.evidence && existsSync(join(archived.evidence, "report.json")), "an uncertain run keeps its evidence");
	});

	it("attempts every teardown phase and keeps every failure", async (t) => {
		const calls = [];
		const gone = Object.freeze({ pid: process.pid, startTime: "0", kind: "parent", exe: null });
		const runtime = createRuntime({
			pi: NODE,
			herdr: "/bin/true",
			boundaries: {
				startRpc: () => ({
					identity: gone,
					identityProblem: null,
					async close() {
						calls.push("parent close");
						throw new Error("injected parent close failure");
					},
				}),
				createHerdr: (options) =>
					stubHerdr(options, () => ({ pid: process.pid }), {
						async stop() {
							calls.push("server stop");
							throw new Error("injected server stop failure");
						},
					}),
			},
		});
		t.after(() => removeRoot(runtime));
		runtime.startPi({ label: "parent", kind: "parent", args: [], processEnv: {} });
		runtime.useProvider({
			async close() {
				calls.push("provider close");
				return true;
			},
		});
		const teardown = await runtime.close();
		assert.deepEqual(calls, ["parent close", "server stop", "provider close"]);
		assert.equal(teardown.kind, "retained");
		assert.deepEqual(
			teardown.errors.map((entry) => entry.message),
			["injected parent close failure", "injected server stop failure"],
		);
		assert.equal(await runtime.close(), teardown, "closing is idempotent");
	});

	it("keeps and closes a direct process whose identity could not be captured", async (t) => {
		requireProc();
		const runtime = createRuntime({ pi: NODE, herdr: "/bin/true" });
		const fault = (path) => (/^\/proc\/\d+\/stat$/.test(path) && path !== `/proc/${process.pid}/stat` ? denied(path) : undefined);
		const rpc = await underKernelFaults(fault, () =>
			runtime.startPi({ label: "solo-unidentified", kind: "solo", args: ["-e", WAIT_FOR_EOF], processEnv: { PATH: "/usr/bin:/bin", HOME: runtime.paths.home } }),
		);
		t.after(() => {
			rpc.child.kill("SIGKILL");
			removeRoot(runtime);
		});
		assert.equal(rpc.identity, null);
		const teardown = await runtime.close();
		assert.equal(await settledState(rpc.closed), "settled", "the owner closed the process through its handle");
		assert.equal(teardown.exits["solo-unidentified"].closure, "closed");
		assert.equal(teardown.kind, "retained");
		assert.ok(
			teardown.uncertain.some((entry) => entry.label === "solo-unidentified"),
			JSON.stringify(teardown.uncertain),
		);
	});
});

describe("evidence archive", () => {
	async function closedRuntime() {
		const runtime = createRuntime({ pi: NODE, herdr: "/bin/true" });
		assert.equal((await runtime.close()).kind, "closed");
		return runtime;
	}

	it("keeps a failed run's evidence when no destination was requested", async (t) => {
		const runtime = await closedRuntime();
		const archived = runtime.archive({ "report.json": '{"passed":false}\n' }, { passed: false, ownedArtifacts: [] });
		t.after(() => {
			if (archived.evidence) rmSync(archived.evidence, { recursive: true, force: true });
			removeRoot(runtime);
		});
		assert.ok(archived.evidence, "a failed run kept no evidence");
		assert.ok(!archived.evidence.startsWith(`${runtime.paths.root}/`), "evidence is kept apart from the runtime root");
		assert.equal(readFileSync(join(archived.evidence, "report.json"), "utf8"), '{"passed":false}\n');
		assert.equal(archived.retainedRoot, null);
		assert.ok(!existsSync(runtime.paths.root));
	});

	it("discards a passing run's evidence only when no destination was requested", async (t) => {
		const runtime = await closedRuntime();
		const archived = runtime.archive({ "report.json": "{}\n" }, { passed: true, ownedArtifacts: [] });
		t.after(() => removeRoot(runtime));
		assert.equal(archived.evidence, null);
		assert.equal(archived.retainedRoot, null);
		assert.ok(!existsSync(runtime.paths.root));
	});

	it("writes each requested archive to a new run directory", async (t) => {
		const destination = makeTempRoot(t, "evidence");
		const runs = [];
		for (const passed of [true, false]) {
			const runtime = await closedRuntime();
			t.after(() => removeRoot(runtime));
			runs.push(runtime.archive({ "report.json": `${passed}\n` }, { passed, evidenceDir: destination, ownedArtifacts: [] }).evidence);
		}
		assert.notEqual(runs[0], runs[1]);
		assert.deepEqual(
			runs.map((dir) => readFileSync(join(dir, "report.json"), "utf8")),
			["true\n", "false\n"],
		);
	});

	it("reports archive failures and keeps the runtime root instead of throwing", async (t) => {
		const runtime = await closedRuntime();
		rmSync(runtime.paths.evidence, { recursive: true });
		writeFileSync(runtime.paths.evidence, "not a directory");
		const unreadable = join(runtime.paths.root, "launch.sh");
		writeFileSync(unreadable, "#!/bin/sh\n");
		chmodSync(unreadable, 0o000);
		const blocker = join(makeTempRoot(t, "evidence-blocker"), "file");
		writeFileSync(blocker, "");
		t.after(() => removeRoot(runtime));
		const archived = runtime.archive({ "report.json": "{}\n" }, { passed: false, evidenceDir: blocker, ownedArtifacts: [{ path: unreadable, name: "launch.sh" }] });
		assert.ok(archived.errors.length > 0);
		assert.equal(archived.retainedRoot, runtime.paths.root);
		assert.ok(existsSync(runtime.paths.root));
	});
});

describe("bounded process closure", () => {
	const env = { PATH: "/usr/bin:/bin", HOME: "/nonexistent" };

	it("reports a command whose descendant keeps its output open as unresolved within its bound", async () => {
		const started = performance.now();
		const result = await runBounded({ command: NODE, args: ["-e", `${HOLD_STDOUT} setTimeout(() => {}, 10000);`], cwd: "/", env, limit: deadline(200, "holder"), grace: 300 });
		const elapsed = performance.now() - started;
		assert.ok(elapsed < 2000, `runBounded waited ${Math.round(elapsed)} ms`);
		assert.equal(result.timedOut, true);
		assert.equal(result.closure, "unresolved");
		assert.equal(result.exit?.signal, "SIGKILL");
		assert.ok(result.identity, "the handle's identity is kept for the owner");
		await within(result.closed, deadline(10_000, "eventual close"));
	});

	it("reports a command that cannot start without waiting", async () => {
		const result = await runBounded({ command: "/nonexistent/clean-craft-command", args: [], cwd: "/", env, limit: deadline(2000, "missing") });
		assert.equal(result.closure, "closed");
		assert.equal(result.timedOut, false);
		assert.match(result.errors.join(" "), /ENOENT/);
	});

	it("does not treat a child error event as closure", async (t) => {
		requireProc();
		const rpc = startRpcPi({ pi: NODE, args: ["-e", WAIT_FOR_EOF], cwd: "/", env, kind: "solo", label: "error-event" });
		t.after(() => rpc.child.kill("SIGKILL"));
		rpc.child.emit("error", Object.assign(new Error("kill EPERM"), { code: "EPERM" }));
		assert.equal(await settledState(rpc.closed), "pending");
		assert.equal(kernel.observe(rpc.identity).state, "present");
		const exit = await rpc.close(deadline(5000, "error-event close"));
		assert.equal(exit.closure, "closed");
		assert.equal(exit.code, 0);
		assert.deepEqual(exit.errors, ["EPERM"]);
	});

	it("bounds a close that never arrives and reports undelivered signals", async () => {
		const rpc = startRpcPi({ pi: NODE, args: ["-e", `${HOLD_STDOUT} ${WAIT_FOR_EOF}`], cwd: "/", env, kind: "solo", label: "held-close" });
		const started = performance.now();
		const exit = await rpc.close(deadline(200, "held close"), { escalationMs: 200 });
		const elapsed = performance.now() - started;
		assert.ok(elapsed < 2000, `close waited ${Math.round(elapsed)} ms`);
		assert.equal(exit.closure, "unresolved");
		assert.deepEqual(exit.exit, { code: 0, signal: null });
		assert.equal(exit.forced, null);
		assert.ok(exit.signals.every((attempt) => attempt.delivered === false));
		await within(rpc.closed, deadline(10_000, "eventual close"));
	});

	it("records a write to a closed stdin without an unhandled error", async () => {
		const rpc = startRpcPi({ pi: NODE, args: ["-e", "process.exit(0)"], cwd: "/", env, kind: "solo", label: "epipe" });
		const exit = await rpc.close(deadline(5000, "epipe close"));
		assert.equal(exit.closure, "closed");
		await assert.rejects(rpc.request({ type: "get_state" }, deadline(1000, "epipe request")), /closed/);
	});
});

describe("lost observations reach the verdict", () => {
	it("records a request lost to a full ledger, including an unattributed first loss", async () => {
		let count = 0;
		const provider = await startProvider({
			model: "fixture",
			attribute: () => (++count === 1 ? PASSING_PARENT : { kind: "unknown", reason: "deliberate unexpected request" }),
			respond: () => ({ reply: textReply("ok") }),
			limits: { bodyBytes: 1024, requests: 1, requestMs: 5000 },
		});
		const statuses = [];
		try {
			for (let i = 0; i < 2; i += 1) {
				const response = await fetch(`http://127.0.0.1:${provider.port}/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${DUMMY_KEY}` }, body: '{"messages":[]}' });
				await response.text();
				statuses.push(response.status);
			}
		} finally {
			await provider.close();
		}
		assert.deepEqual(statuses, [200, 429]);
		assert.equal(provider.ledger.entries.length, 1);
		assert.equal(provider.ledger.faults.count, 1);
		assert.equal(provider.ledger.faults.samples[0].kind, "capacity");
		const outcome = judgeIsolation(isolationEvidence({ ledger: provider.ledger.entries, faults: { [provider.ledger.label]: provider.ledger.faults } }));
		assert.equal(outcome.kind, "fail");
		assert.match(outcome.reason, /deliberate unexpected request/);
	});

	it("records an incomplete request body as a stream fault", async () => {
		const provider = await startProvider({ model: "fixture", attribute: () => PASSING_PARENT, respond: () => ({ reply: textReply("ok") }) });
		try {
			const socket = connect(provider.port, "127.0.0.1");
			await once(socket, "connect");
			socket.write(`POST /v1/chat/completions HTTP/1.1\r\nhost: 127.0.0.1\r\ncontent-length: 100\r\nauthorization: Bearer ${DUMMY_KEY}\r\n\r\n{"mess`);
			await delay(100);
			socket.destroy();
			await delay(100);
		} finally {
			await provider.close();
		}
		assert.equal(provider.ledger.entries.length, 0);
		assert.ok(
			provider.ledger.faults.samples.some((sample) => sample.kind === "request-stream"),
			JSON.stringify(provider.ledger.faults),
		);
		assert.equal(
			judgeIsolation(isolationEvidence({ ledger: [{ index: 0, origin: PASSING_PARENT, auth: "dummy", refused: null }], faults: { [provider.ledger.label]: provider.ledger.faults } })).kind,
			"fail",
		);
	});

	it("refuses an oversized body and fails isolation on it", async () => {
		const provider = await startProvider({ model: "fixture", attribute: () => PASSING_PARENT, respond: () => ({ reply: textReply("ok") }), limits: { bodyBytes: 64, requests: 5, requestMs: 5000 } });
		let status;
		try {
			const response = await fetch(`http://127.0.0.1:${provider.port}/v1/chat/completions`, {
				method: "POST",
				headers: { authorization: `Bearer ${DUMMY_KEY}` },
				body: JSON.stringify({ messages: [], padding: "x".repeat(512) }),
			});
			await response.text();
			status = response.status;
		} finally {
			await provider.close();
		}
		assert.equal(status, 413);
		assert.match(judgeIsolation(isolationEvidence({ ledger: provider.ledger.entries, faults: { [provider.ledger.label]: provider.ledger.faults } })).reason, /body exceeded 64 bytes/);
	});

	it("keeps a complete final RPC record written without a newline, so its extension error fails isolation", async () => {
		const env = { PATH: "/usr/bin:/bin", HOME: "/nonexistent" };
		const rpc = startRpcPi({ pi: NODE, args: ["-e", 'process.stdout.write(JSON.stringify({ type: "extension_error", error: "lost EOF error" }))'], cwd: "/", env, kind: "solo", label: "eof-record" });
		await within(rpc.closed, deadline(5000, "eof-record close"));
		assert.deepEqual(
			rpc.log.entries.map((entry) => entry.record?.type ?? (entry.exit ? "exit" : "other")),
			["extension_error", "exit"],
		);
		const ledger = [{ index: 0, origin: PASSING_PARENT, auth: "dummy", refused: null }];
		const outcome = judgeIsolation(isolationEvidence({ ledger, parentLog: rpc.log.entries, faults: { [rpc.log.label]: rpc.log.faults } }));
		assert.equal(outcome.kind, "fail");
		assert.match(outcome.reason, /extension error: lost EOF error/);
	});

	it("records a truncated final RPC frame as a fault that fails isolation", async () => {
		const env = { PATH: "/usr/bin:/bin", HOME: "/nonexistent" };
		const rpc = startRpcPi({ pi: NODE, args: ["-e", `process.stdout.write('{"type":"extension_error","error":"lo')`], cwd: "/", env, kind: "solo", label: "eof-truncated" });
		await within(rpc.closed, deadline(5000, "eof-truncated close"));
		assert.equal(rpc.log.faults.count, 1, JSON.stringify(rpc.log.entries));
		assert.deepEqual(rpc.log.faults.samples[0], { kind: "incomplete-frame", detail: { bytes: 37 } });
		const ledger = [{ index: 0, origin: PASSING_PARENT, auth: "dummy", refused: null }];
		const outcome = judgeIsolation(isolationEvidence({ ledger, parentLog: rpc.log.entries, faults: { [rpc.log.label]: rpc.log.faults } }));
		assert.equal(outcome.kind, "fail");
		assert.match(outcome.reason, /incomplete-frame/);
	});

	it("keeps newline-terminated RPC output free of faults", async () => {
		const env = { PATH: "/usr/bin:/bin", HOME: "/nonexistent" };
		const rpc = startRpcPi({ pi: NODE, args: ["-e", 'process.stdout.write("{\\"type\\":\\"a\\"}\\n{\\"type\\":\\"b\\"}\\n")'], cwd: "/", env, kind: "solo", label: "terminated" });
		await within(rpc.closed, deadline(5000, "terminated close"));
		assert.deepEqual(
			rpc.log.entries.map((entry) => entry.record?.type ?? (entry.exit ? "exit" : "other")),
			["a", "b", "exit"],
		);
		assert.equal(rpc.log.faults.count, 0);
	});

	it("keeps a process's final output line written without a newline", async () => {
		const env = { PATH: "/usr/bin:/bin", HOME: "/nonexistent" };
		const server = startLineProcess({ command: NODE, args: ["-e", 'process.stdout.write("first\\napi socket: /tmp/final.sock")'], cwd: "/", env, kind: "server", label: "eof-lines" });
		await within(server.closed, deadline(5000, "eof-lines close"));
		assert.deepEqual(
			server.lines.entries.map((entry) => entry.line ?? (entry.exit ? "exit" : "other")),
			["first", "api socket: /tmp/final.sock", "exit"],
		);
		assert.equal(server.lines.faults.count, 0);
	});

	it("records RPC records lost to capacity and oversized lines", async () => {
		const print = (count, size) => `for (let i = 0; i < ${count}; i += 1) process.stdout.write(JSON.stringify({ type: "noise", pad: "x".repeat(${size}) }) + "\\n");`;
		const env = { PATH: "/usr/bin:/bin", HOME: "/nonexistent" };
		const crowded = startRpcPi({ pi: NODE, args: ["-e", `${print(10, 1)} ${WAIT_FOR_EOF}`], cwd: "/", env, kind: "solo", label: "crowded", limits: { records: 3, lineBytes: 1024 } });
		const long = startRpcPi({ pi: NODE, args: ["-e", `${print(1, 4096)} ${WAIT_FOR_EOF}`], cwd: "/", env, kind: "solo", label: "long-line", limits: { records: 100, lineBytes: 1024 } });
		await crowded.close(deadline(5000, "crowded close"));
		await long.close(deadline(5000, "long-line close"));
		assert.ok(crowded.log.faults.count >= 1);
		assert.equal(crowded.log.faults.samples[0].kind, "capacity");
		assert.equal(long.log.faults.samples[0].kind, "line-size");
		const ledger = [{ index: 0, origin: PASSING_PARENT, auth: "dummy", refused: null }];
		const outcome = judgeIsolation(isolationEvidence({ ledger, parentLog: crowded.log.entries, faults: { [crowded.log.label]: crowded.log.faults } }));
		assert.equal(outcome.kind, "fail");
		assert.match(outcome.reason, /crowded rpc lost/);
	});
});

function deliveryBoundaries(t, { piClose, providerClose, holdOutput } = {}) {
	const calls = [];
	const rpcs = [];
	const providers = [];
	t.after(async () => {
		for (const rpc of rpcs) await within(rpc.closed, deadline(10_000, "delivery fixture close"));
		for (const provider of providers) await provider.close();
	});
	return {
		calls,
		rpcs,
		boundaries: {
			startRpc(options) {
				const rpc = startRpcPi({ ...options, pi: NODE, args: ["-e", holdOutput ? `${HOLD_STDOUT} ${WAIT_FOR_EOF}` : WAIT_FOR_EOF] });
				rpcs.push(rpc);
				return {
					...rpc,
					async close(limit, options) {
						calls.push("pi close");
						const exit = await rpc.close(holdOutput ? deadline(200, "held delivery close") : limit, holdOutput ? { escalationMs: 200 } : options);
						if (piClose) throw new Error(piClose);
						return exit;
					},
				};
			},
			async startEndpoint(options) {
				const provider = await startProvider(options);
				providers.push(provider);
				return {
					...provider,
					async close() {
						calls.push("provider close");
						const closed = await provider.close();
						if (providerClose) throw new Error(providerClose);
						return closed;
					},
				};
			},
		},
	};
}

describe("collection and setup failures do not bypass cleanup", () => {
	it("reports unreadable launch scripts instead of throwing", (t) => {
		const root = makeTempRoot(t, "scripts");
		const scripts = join(root, "artifacts", "subagent-scripts");
		mkdirSync(scripts, { recursive: true });
		const script = join(scripts, "craft3-skills-abc-1.sh");
		writeFileSync(script, "pi --thinking 'off' '' '/skill:craft-mode'; echo done\n");
		chmodSync(script, 0o000);
		const table = { children: { skills: { key: "skills", args: { name: "craft3-skills-abc" } } } };
		let collected;
		try {
			collected = launchScripts(table, join(root, "artifacts"));
			chmodSync(join(root, "artifacts"), 0o000);
			const unreadableDir = launchScripts(table, join(root, "artifacts"));
			assert.equal(unreadableDir.errors.length, 1);
		} finally {
			chmodSync(join(root, "artifacts"), 0o700);
			chmodSync(script, 0o600);
		}
		assert.deepEqual(collected.prompts, {});
		assert.match(collected.errors.join(" "), /EACCES/);
	});

	it("closes the delivery provider when setup fails before Pi starts", async (t) => {
		const blocker = join(makeTempRoot(t, "delivery-setup"), "file");
		writeFileSync(blocker, "");
		const run = await runSkillDelivery({ pi: NODE, packageRoot: PACKAGE_ROOT, root: join(blocker, "root"), skills: SKILLS });
		assert.match(run.failure, /ENOTDIR/);
		assert.equal(run.exit, null);
		assert.equal(run.providerClosed, true);
		assert.deepEqual(run.cleanup, { kind: "closed", errors: [], pi: null }, "a setup failure is a run failure, not a cleanup failure");
	});

	it("closes the delivery provider and keeps the run retained when Pi's close throws", async (t) => {
		const fixture = deliveryBoundaries(t, { piClose: "injected Pi close failure" });
		const run = await runSkillDelivery({ pi: NODE, packageRoot: PACKAGE_ROOT, root: makeTempRoot(t, "delivery-pi-close"), skills: [], boundaries: fixture.boundaries }).catch((error) => ({
			thrown: error.message,
		}));
		assert.deepEqual(fixture.calls, ["pi close", "provider close"], `cleanup stopped early: ${JSON.stringify(run)}`);
		assert.equal(run.thrown, undefined);
		assert.equal(run.providerClosed, true);
		assert.equal(run.exit, null, "a close that threw was never observed to close");
		assert.equal(run.cleanup.kind, "retained");
		assert.deepEqual(run.cleanup.errors, [{ phase: "delivery pi close", message: "injected Pi close failure" }]);
		assert.equal(run.cleanup.pi.identity?.pid, fixture.rpcs[0].identity.pid, "the uncertain Pi is identified");
	});

	it("closes Pi and keeps the run retained when the provider's close throws", async (t) => {
		const fixture = deliveryBoundaries(t, { providerClose: "injected provider close failure" });
		const run = await runSkillDelivery({ pi: NODE, packageRoot: PACKAGE_ROOT, root: makeTempRoot(t, "delivery-provider-close"), skills: [], boundaries: fixture.boundaries }).catch((error) => ({
			thrown: error.message,
		}));
		assert.deepEqual(fixture.calls, ["pi close", "provider close"]);
		assert.equal(run.thrown, undefined, "a provider close failure is reported, not thrown");
		assert.equal(run.exit.closure, "closed");
		assert.equal(run.providerClosed, false);
		assert.equal(run.cleanup.kind, "retained");
		assert.deepEqual(run.cleanup.errors, [{ phase: "provider close", message: "injected provider close failure" }]);
	});

	it("keeps a delivery run whose Pi closure stays unresolved fail-closed", async (t) => {
		const fixture = deliveryBoundaries(t, { holdOutput: true });
		const run = await runSkillDelivery({ pi: NODE, packageRoot: PACKAGE_ROOT, root: makeTempRoot(t, "delivery-unresolved"), skills: [], boundaries: fixture.boundaries });
		assert.equal(run.exit.closure, "unresolved");
		assert.equal(run.providerClosed, true);
		assert.notEqual(run.cleanup?.kind, "closed");
	});
});
