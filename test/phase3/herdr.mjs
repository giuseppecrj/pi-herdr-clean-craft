import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deadline, StepFailure } from "./event-log.mjs";
import { environOf, identify, observe, ownedTree, socketInodes, unixListenerInodes } from "./proc.mjs";
import { runBounded, startLineProcess } from "./processes.mjs";

const HERDR_CONFIG = [
	"onboarding = false",
	"",
	"[terminal]",
	'default_shell = "/bin/sh"',
	'shell_mode = "non_login"',
	'new_cwd = "home"',
	"",
	"[update]",
	"version_check = false",
	"manifest_check = false",
	"",
	"[ui.toast]",
	'delivery = "off"',
	"",
	"[ui.sound]",
	"enabled = false",
	"",
	"[session]",
	"resume_agents_on_restore = false",
	"",
	"[experimental]",
	"pane_history = false",
	"",
].join("\n");

export function writeHerdrConfig(path) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, HERDR_CONFIG);
}

export function socketsUnder(dir) {
	const found = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) found.push(...socketsUnder(path));
		else if (entry.isSocket()) found.push(path);
	}
	return found;
}

function parseJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function socketPaths(value) {
	return [...JSON.stringify(value ?? {}).matchAll(/"(\/[^"]*\.sock)"/g)].map((match) => match[1]);
}

export function createHerdrInstance({ herdr, session, env, cwd, root, record, adopt }) {
	const commands = [];
	let state = "unstarted";
	let server = null;
	let socket = null;

	async function client(args, { mutates, limit, clientEnv = env, explicitSession = true }) {
		if (mutates && state !== "verified") throw new StepFailure(limit.step, `Herdr instance is ${state}; mutation refused`);
		const argv = explicitSession ? ["--session", session, ...args] : args;
		const { closed, ...result } = await runBounded({ command: herdr, args: argv, cwd, env: clientEnv, limit });
		commands.push(Object.freeze({ argv, mutates, explicitSession, ...result }));
		if (mutates && (result.timedOut || result.closure !== "closed")) state = "tainted";
		return { ...result, json: parseJson(result.stdout) };
	}

	async function start() {
		const before = await client(["status", "--json"], { mutates: false, limit: deadline(10_000, "herdr pre-status") });
		if (before.json?.server?.running !== false) throw new StepFailure("herdr pre-status", "owned session is already running or status is unreadable");
		if (socketsUnder(root).length > 0) throw new StepFailure("herdr pre-status", "sockets exist under the owned root before start");
		server = startLineProcess({ command: herdr, args: ["--session", session, "server"], cwd, env, kind: "server", label: "herdr server" });
		adopt("herdr server", "server", server);
		if (!server.identity) throw new StepFailure("herdr start", `server identity unknown: ${server.identityProblem}`);
		state = "starting";
		const announced = await server.lines.waitFor((entry) => entry.line?.startsWith("api socket: "), { limit: deadline(15_000, "herdr api socket announcement") });
		socket = announced.line.slice("api socket: ".length).trim();
		const listeners = unixListenerInodes(socket);
		const serverBefore = observe(server.identity);
		const held = socketInodes(server.identity.pid);
		const serverAfter = observe(server.identity);
		const status = await client(["status", "--json"], { mutates: false, limit: deadline(10_000, "herdr status") });
		const reported = socketPaths(status.json);
		const checks = {
			underRoot: socket.startsWith(`${root}/`),
			serverIdentity: serverBefore.state === "present" && serverAfter.state === "present",
			listenerHeldByServer: listeners.state === "present" && held.state === "present" && listeners.inodes.some((inode) => held.inodes.has(inode)),
			statusRunning: status.json?.server?.running === true,
			statusSocket: status.json?.server?.socket === socket,
			statusSession: status.json?.server?.session === session,
			reportedUnderRoot: reported.length > 0 && reported.every((path) => path.startsWith(`${root}/`)),
		};
		if (!Object.values(checks).every(Boolean)) throw new StepFailure("herdr identity", `owned server not proven: ${JSON.stringify(checks)}`);
		state = "verified";
		return Object.freeze({ socket, server: server.identity, ...checks });
	}

	async function anchor() {
		const created = await client(["workspace", "create", "--cwd", cwd, "--label", "craft-anchor", "--no-focus"], {
			mutates: true,
			limit: deadline(15_000, "herdr anchor workspace"),
		});
		const pane = created.json?.result?.root_pane?.pane_id;
		const workspace = created.json?.result?.workspace?.workspace_id;
		if (created.code !== 0 || typeof pane !== "string" || typeof workspace !== "string") {
			throw new StepFailure("herdr anchor workspace", `workspace create failed: ${created.stderr || created.stdout}`);
		}
		const info = await client(["pane", "process-info", "--pane", pane], { mutates: false, limit: deadline(10_000, "herdr anchor process") });
		const shellPid = info.json?.result?.process_info?.shell_pid;
		const { tree, problems } = ownedTree([{ ...server.identity, label: "herdr server" }]);
		if (problems.length > 0) throw new StepFailure("herdr anchor process", `owned server tree is uncertain: ${problems.join("; ")}`);
		if (!tree.has(server.identity.pid)) throw new StepFailure("herdr anchor process", "the recorded server identity is gone");
		if (!Number.isInteger(shellPid) || !tree.has(shellPid)) throw new StepFailure("herdr anchor process", `anchor shell ${shellPid} is not an owned server descendant`);
		const shell = identify(shellPid, "pane-shell");
		if (shell.state !== "present" || shell.identity.startTime !== tree.get(shellPid).startTime) throw new StepFailure("herdr anchor process", `anchor shell identity: ${shell.reason ?? "pid reused"}`);
		record(shell.identity);
		const environ = environOf(shellPid);
		if (environ.state !== "present" || observe(shell.identity).state !== "present") {
			throw new StepFailure("herdr anchor process", `anchor shell environment is unreadable: ${environ.reason ?? "the shell changed while it was read"}`);
		}
		const herdrEnv = Object.fromEntries([...environ.environment].filter(([name]) => name.startsWith("HERDR_")));
		const expected = {
			HERDR_ENV: "1",
			HERDR_SESSION: session,
			HERDR_SOCKET_PATH: socket,
			HERDR_PANE_ID: pane,
			HERDR_WORKSPACE_ID: workspace,
			HERDR_CONFIG_PATH: env.HERDR_CONFIG_PATH,
		};
		const mismatched = Object.entries(expected).filter(([name, value]) => herdrEnv[name] !== value);
		if (mismatched.length > 0) throw new StepFailure("herdr anchor environment", `anchor HERDR_* mismatch: ${mismatched.map(([name]) => name).join(", ")}`);
		const callerEnv = { ...env, ...herdrEnv };
		const current = await client(["pane", "current", "--current"], {
			mutates: false,
			clientEnv: callerEnv,
			explicitSession: false,
			limit: deadline(10_000, "herdr caller resolution"),
		});
		const resolved = current.json?.result?.pane;
		if (resolved?.pane_id !== pane || resolved?.workspace_id !== workspace) {
			throw new StepFailure("herdr caller resolution", `implicit caller resolution reached ${JSON.stringify(resolved)}`);
		}
		return Object.freeze({ pane, workspace, shell: shell.identity, herdrEnv: Object.freeze(herdrEnv), callerEnv: Object.freeze(callerEnv) });
	}

	let stopping = null;
	function stop() {
		stopping ??= (async () => {
			if (!server) return { started: false };
			state = "stopping";
			const stopCommand = client(["session", "stop", session, "--json"], { mutates: false, limit: deadline(15_000, "herdr session stop") });
			const exit = await server.stop(() => {}, deadline(20_000, "herdr server close"));
			const stopped = await stopCommand;
			state = "stopped";
			return { started: true, exit, stopCommand: { code: stopped.code, timedOut: stopped.timedOut, closure: stopped.closure, stopped: stopped.json?.stopped === true } };
		})();
		return stopping;
	}

	return {
		start,
		anchor,
		stop,
		get state() {
			return state;
		},
		get socket() {
			return socket;
		},
		get server() {
			return server;
		},
		commands,
	};
}
