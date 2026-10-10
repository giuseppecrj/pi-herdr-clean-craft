import { randomBytes } from "node:crypto";
import { constants, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unresolvedUnder } from "../support.mjs";
import { deadline } from "./event-log.mjs";
import { createHerdrInstance, socketsUnder, writeHerdrConfig } from "./herdr.mjs";
import { ancestry, describe, environOf, exited, identify, loopbackClientInodes, observe, ownedTree, socketInodes } from "./proc.mjs";
import { runBounded, startRpcPi } from "./processes.mjs";

const RISKY_NAME = /KEY|TOKEN|SECRET|PASS|CRED|AUTH|PROXY|SSH_|GPG|AWS|GITHUB|GH_|ANTHROPIC|OPENAI|NPM_/i;

const ORPHANED_INODE = "0";

function riskyNames(environment) {
	return [...environment.keys()].filter((name) => RISKY_NAME.test(name));
}

function failedChecks(checks) {
	return Object.entries(checks)
		.filter(([, passed]) => !passed)
		.map(([name]) => name);
}

function writeEvidence(dir, files, ownedArtifacts, errors) {
	for (const [name, content] of Object.entries(files)) {
		try {
			writeFileSync(join(dir, name), content, { flag: "wx" });
		} catch (failure) {
			errors.push(`write ${name}: ${failure.message}`);
		}
	}
	for (const source of ownedArtifacts) {
		try {
			copyFileSync(source.path, join(dir, source.name), constants.COPYFILE_EXCL);
		} catch (failure) {
			errors.push(`copy ${source.name}: ${failure.message}`);
		}
	}
}

export function createRuntime({ pi, herdr, boundaries = {} }) {
	const { createHerdr = createHerdrInstance, startRpc = startRpcPi } = boundaries;
	const root = realpathSync(mkdtempSync("/tmp/cc3-"));
	const home = join(root, "h");
	const paths = Object.freeze({
		root,
		home,
		config: join(home, ".config"),
		agent: join(root, "agent"),
		sessions: join(root, "sessions"),
		work: join(root, "work"),
		bin: join(root, "bin"),
		solo: join(root, "solo"),
		pack: join(root, "pack"),
		evidence: join(root, "evidence"),
	});
	const xdg = {
		XDG_CONFIG_HOME: paths.config,
		XDG_DATA_HOME: join(home, ".local/share"),
		XDG_STATE_HOME: join(home, ".local/state"),
		XDG_CACHE_HOME: join(home, ".cache"),
		XDG_RUNTIME_DIR: join(root, "run"),
		TMPDIR: join(root, "tmp"),
	};
	for (const dir of [...Object.values(paths), ...Object.values(xdg)]) mkdirSync(dir, { recursive: true, mode: 0o700 });
	symlinkSync(pi, join(paths.bin, "pi"));
	symlinkSync(herdr, join(paths.bin, "herdr"));
	symlinkSync(realpathSync(process.execPath), join(paths.bin, "node"));
	const herdrConfig = join(paths.config, "herdr", "config.toml");
	writeHerdrConfig(herdrConfig);
	const env = Object.freeze({
		HOME: home,
		...xdg,
		PATH: `${paths.bin}:/usr/bin:/bin`,
		SHELL: "/bin/sh",
		TERM: "xterm-256color",
		LANG: "C.UTF-8",
		LC_ALL: "C.UTF-8",
		HERDR_CONFIG_PATH: herdrConfig,
		PI_CODING_AGENT_DIR: paths.agent,
		PI_OFFLINE: "1",
		PI_SKIP_VERSION_CHECK: "1",
		PI_TELEMETRY: "0",
	});
	const session = `cc3-${randomBytes(4).toString("hex")}`;
	const roots = [];
	const recorded = new Map();
	const hostChildren = new Map();
	const connections = new WeakMap();
	const processes = new Map();
	const unverifiable = [];
	const commands = [];
	let state = "allocated";
	let anchorPane = null;
	let provider = null;

	function record(identity) {
		recorded.set(`${identity.pid}:${identity.startTime}`, identity);
	}

	function adopt(label, kind, owned) {
		if (owned.identity) {
			record(owned.identity);
			roots.push(Object.freeze({ pid: owned.identity.pid, startTime: owned.identity.startTime, kind, label }));
		} else if (owned.started !== false) {
			unverifiable.push(Object.freeze({ label, kind, reason: `identity not captured (${owned.identityProblem}), so its descendants cannot be verified` }));
		}
	}

	function snapshot() {
		const { tree, problems } = ownedTree(roots);
		for (const proc of tree.values()) {
			if (recorded.has(`${proc.pid}:${proc.startTime}`)) continue;
			const current = identify(proc.pid, "descendant");
			const exe = current.state === "present" && current.identity.startTime === proc.startTime ? current.identity.exe : null;
			record(Object.freeze({ pid: proc.pid, startTime: proc.startTime, kind: "descendant", exe }));
		}
		return { tree, problems };
	}

	const herdrInstance = createHerdr({ herdr: join(paths.bin, "herdr"), session, env, cwd: paths.work, root, record, adopt });

	function unknown(reason, detail = {}) {
		return Object.freeze({ kind: "unknown", reason, ...detail });
	}

	function holds(identity, inode) {
		const before = observe(identity);
		if (before.state !== "present") return before;
		const sockets = socketInodes(identity.pid);
		const after = observe(identity);
		if (after.state !== "present") return after;
		if (sockets.state !== "present") return sockets;
		return { state: "present", holds: sockets.inodes.has(inode) };
	}

	function inspect(identity) {
		const current = identify(identity.pid, "holder");
		if (current.state === "present" && current.identity.startTime !== identity.startTime) return { state: "absent", reason: `pid ${identity.pid} was reused` };
		if (current.state !== "present") return current;
		const environment = environOf(identity.pid);
		const after = observe(identity);
		if (after.state === "unknown") return after;
		if (exited(after)) return { state: "absent", reason: `pid ${identity.pid} exited during attribution` };
		if (current.exe.state !== "present") return { state: "unknown", reason: current.exe.reason };
		if (environment.state !== "present") return { state: "unknown", reason: environment.reason };
		return { state: "present", identity: current.identity, environment: environment.environment };
	}

	function hostChildChecks(environment, known) {
		const pane = environment.get("HERDR_PANE_ID");
		return {
			subagentId: known ? environment.get("PI_SUBAGENT_ID") === known.subagentId : Boolean(environment.get("PI_SUBAGENT_ID")),
			subagentName: known ? environment.get("PI_SUBAGENT_NAME") === known.subagentName : Boolean(environment.get("PI_SUBAGENT_NAME")),
			herdrSession: environment.get("HERDR_SESSION") === session,
			herdrSocket: herdrInstance.socket !== null && environment.get("HERDR_SOCKET_PATH") === herdrInstance.socket,
			pane: known ? pane === known.paneId : Boolean(pane) && pane !== anchorPane,
			agentDir: environment.get("PI_CODING_AGENT_DIR") === paths.agent,
			offline: environment.get("PI_OFFLINE") === "1",
		};
	}

	function classify(inode) {
		const { tree, problems } = snapshot();
		if (problems.length > 0) return unknown(`the owned process tree is uncertain: ${problems.join("; ")}`);
		const holders = [];
		for (const proc of tree.values()) {
			const held = holds(proc, inode);
			if (held.state === "unknown") return unknown(`owned pid ${proc.pid}: ${held.reason}`);
			if (held.state === "present" && held.holds) holders.push(proc);
		}
		if (holders.length > 1) return unknown(`${holders.length} owned holders of socket ${inode}`);
		if (holders.length === 0) return reparentedChild(inode);
		const [holder] = holders;
		const seen = inspect(holder);
		if (seen.state !== "present") return unknown(`holder ${holder.pid}: ${seen.reason}`);
		const chain = ancestry(tree, holder.pid).map((proc) => proc.pid);
		const risky = riskyNames(seen.environment);
		const base = { inode, chain, riskyNames: risky };
		const key = `${holder.pid}:${holder.startTime}`;
		if (holder.root.kind === "parent" || holder.root.kind === "solo") {
			const checks = Object.freeze({
				identity: true,
				executable: seen.identity.exe === pi,
				rootSender: holder.pid === holder.root.pid,
				noSubagentId: !seen.environment.has("PI_SUBAGENT_ID"),
				noRiskyNames: risky.length === 0,
			});
			const failed = failedChecks(checks);
			if (failed.length > 0) return unknown(`${holder.root.label} checks failed: ${failed.join(", ")}`, base);
			return Object.freeze({ kind: holder.root.kind, label: holder.root.label, process: recorded.get(key), basis: "owned-tree", detached: false, checks, ...base });
		}
		const known = hostChildren.get(key);
		const checks = Object.freeze({
			identity: true,
			executable: seen.identity.exe === pi,
			serverDescendant: holder.root.kind === "server" && chain.at(-1) === holder.root.pid,
			...hostChildChecks(seen.environment, known),
			noRiskyNames: risky.length === 0,
		});
		const failed = failedChecks(checks);
		if (failed.length > 0) return unknown(`host-child checks failed: ${failed.join(", ")}`, base);
		if (known) return Object.freeze({ ...known, basis: "owned-tree", detached: false, checks, ...base });
		const sender = Object.freeze({ ...seen.identity, kind: "host-child" });
		record(sender);
		const child = Object.freeze({
			kind: "host-child",
			process: sender,
			subagentId: seen.environment.get("PI_SUBAGENT_ID"),
			subagentName: seen.environment.get("PI_SUBAGENT_NAME"),
			paneId: seen.environment.get("HERDR_PANE_ID"),
			herdrSession: seen.environment.get("HERDR_SESSION"),
			basis: "owned-tree",
			detached: false,
			checks,
			...base,
		});
		hostChildren.set(key, child);
		return child;
	}

	function reparentedChild(inode) {
		const holders = [];
		for (const child of hostChildren.values()) {
			const held = holds(child.process, inode);
			if (held.state === "unknown") return unknown(`recorded host child ${child.process.pid}: ${held.reason}`);
			if (held.state === "present" && held.holds) holders.push(child);
		}
		if (holders.length === 0) return unknown(`no live owned holder of socket ${inode}`, { unheld: true });
		if (holders.length > 1) return unknown(`${holders.length} recorded host children hold socket ${inode}`);
		const [known] = holders;
		const seen = inspect(known.process);
		if (seen.state !== "present") return unknown(`recorded host child ${known.process.pid}: ${seen.reason}`);
		const risky = riskyNames(seen.environment);
		const checks = Object.freeze({ identity: true, executable: seen.identity.exe === pi, ...hostChildChecks(seen.environment, known), noRiskyNames: risky.length === 0 });
		const failed = failedChecks(checks);
		if (failed.length > 0) return unknown(`recorded host child ${known.process.pid} contradicts its earlier proof: ${failed.join(", ")}`, { inode, riskyNames: risky });
		return Object.freeze({ ...known, inode, chain: [], basis: "reparented", detached: true, checks, riskyNames: risky });
	}

	function historical(connection, remotePort, localPort) {
		const proven = connections.get(connection);
		if (!proven) return unknown(`no live owned process holds the client socket on port ${remotePort}, and this connection was never proven`);
		const sender = observe(proven.origin.process);
		if (sender.state === "unknown") return unknown(`proven sender ${proven.origin.process.pid} cannot be observed: ${sender.reason}`);
		if (!exited(sender)) return unknown(`proven sender ${proven.origin.process.pid} is ${describe(sender)} but no owned holder of its socket was found`);
		const socket = loopbackClientInodes(remotePort, localPort);
		if (socket.state !== "present") return unknown(`client socket table: ${socket.reason}`);
		const left = socket.inodes.length === 0 ? "gone" : socket.inodes.length === 1 && socket.inodes[0] === ORPHANED_INODE ? "orphaned" : null;
		if (!left) return unknown(`the client socket on port ${remotePort} is still held (inode ${socket.inodes.join(", ")}) after its proven sender became ${describe(sender)}`);
		const disappearance = Object.freeze({ sender: sender.state === "absent" ? "absent" : "exited", socket: left, provenInode: proven.inode });
		return Object.freeze({ ...proven.origin, chain: [], basis: "connection", detached: true, disappearance });
	}

	function attribute(request) {
		const origin = attributeNow(request);
		const proven = connections.get(request.connection);
		if (origin.kind !== "unknown" || !proven) return origin;
		const provenConnection = Object.freeze({ kind: proven.origin.kind, label: proven.origin.label ?? null, subagentName: proven.origin.subagentName ?? null, inode: proven.inode });
		return Object.freeze({ ...origin, provenConnection });
	}

	function attributeNow({ connection, remotePort, localPort }) {
		const socket = loopbackClientInodes(remotePort, localPort);
		if (socket.state !== "present") return unknown(`client socket table: ${socket.reason}`);
		if (socket.inodes.length > 1) return unknown(`${socket.inodes.length} loopback client sockets on port ${remotePort}`);
		const [inode] = socket.inodes;
		if (inode === undefined || inode === ORPHANED_INODE) return historical(connection, remotePort, localPort);
		const origin = classify(inode);
		if (origin.kind !== "unknown") {
			connections.set(connection, { inode, origin });
			return origin;
		}
		return origin.unheld ? historical(connection, remotePort, localPort) : origin;
	}

	function startPi({ label, kind, args, processEnv, cwd = paths.work }) {
		const rpc = startRpc({ pi: join(paths.bin, "pi"), args, cwd, env: processEnv, kind, label });
		processes.set(label, rpc);
		adopt(label, kind, rpc);
		return rpc;
	}

	async function run(command, args, step) {
		const { closed, ...result } = await runBounded({ command, args, cwd: paths.work, env, limit: deadline(15_000, step) });
		commands.push(Object.freeze({ argv: [command, ...args], ...result }));
		return result;
	}

	async function startServer() {
		const proof = await herdrInstance.start();
		state = "server-verified";
		return proof;
	}

	async function anchor() {
		const placed = await herdrInstance.anchor();
		anchorPane = placed.pane;
		state = "running";
		return placed;
	}

	async function attempt(errors, phase, action) {
		try {
			return await action();
		} catch (error) {
			errors.push(Object.freeze({ phase, message: error.message }));
			return null;
		}
	}

	function unresolvedCommands() {
		const bounded = [...commands, ...herdrInstance.commands]
			.filter((command) => command.closure !== "closed")
			.map((command) => Object.freeze({ ...(command.identity ?? {}), label: command.argv.join(" "), reason: `command closure ${command.closure}${command.identity ? "" : `; ${command.identityProblem}`}` }));
		const staged = unresolvedUnder(root).map((entry) =>
			Object.freeze({ ...(entry.identity ?? {}), label: entry.argv.join(" "), reason: `command closure unresolved: ${entry.reason}${entry.identity ? "" : `; ${entry.identityProblem}`}` }),
		);
		return [...bounded, ...staged];
	}

	let closing = null;
	function close() {
		closing ??= (async () => {
			state = "closing";
			const errors = [];
			const problems = [];
			const capture = (phase) => attempt(errors, phase, () => problems.push(...snapshot().problems));
			await capture("process tree before close");
			const exits = {};
			for (const [label, rpc] of processes) exits[label] = await attempt(errors, `${label} close`, () => rpc.close(deadline(15_000, `${label} close`)));
			await capture("process tree after Pi close");
			const server = await attempt(errors, "herdr server stop", () => herdrInstance.stop());
			const providerClosed = provider ? (await attempt(errors, "provider close", () => provider.close())) === true : true;
			const survivors = [];
			const uncertain = [...unverifiable, ...problems.map((reason) => Object.freeze({ label: "process tree", reason })), ...unresolvedCommands()];
			for (const identity of recorded.values()) {
				const now = observe(identity);
				if (now.state === "present") survivors.push(identity);
				else if (now.state === "unknown") uncertain.push(Object.freeze({ ...identity, reason: now.reason }));
			}
			for (const [label, exit] of Object.entries(exits)) {
				if (exit?.closure !== "closed") uncertain.push(Object.freeze({ label, reason: exit ? `closure ${exit.closure}` : "close failed, so closure was not observed" }));
			}
			if (server?.started && server.exit.closure !== "closed") uncertain.push(Object.freeze({ label: "herdr server", reason: `closure ${server.exit.closure}` }));
			const sockets = (await attempt(errors, "owned socket check", () => socketsUnder(root))) ?? [];
			const forced = [
				...Object.entries(exits)
					.filter(([, exit]) => exit?.forced)
					.map(([label, exit]) => `${label}: ${exit.forced}`),
				...(server?.started && server.exit.forced ? [`herdr server: ${server.exit.forced}`] : []),
			];
			const closed = survivors.length === 0 && uncertain.length === 0 && sockets.length === 0 && providerClosed && errors.length === 0;
			state = closed ? "closed" : "retained";
			return Object.freeze({
				kind: state,
				root,
				exits,
				server,
				providerClosed,
				identities: [...recorded.values()],
				survivors,
				uncertain,
				sockets,
				forced,
				errors,
				herdrState: herdrInstance.state,
			});
		})();
		return closing;
	}

	function archive(files, { passed, evidenceDir, ownedArtifacts }) {
		const errors = [];
		const source = evidenceDir ? "requested" : passed && state === "closed" ? null : "default";
		let evidence = null;
		if (source) {
			try {
				const parent = evidenceDir ?? tmpdir();
				mkdirSync(parent, { recursive: true });
				evidence = mkdtempSync(join(parent, evidenceDir ? `run-${new Date().toISOString().replace(/[:.]/g, "-")}-` : "clean-craft-evidence-"));
				writeEvidence(evidence, files, ownedArtifacts, errors);
			} catch (failure) {
				errors.push(`${source} evidence directory: ${failure.message}`);
			}
		}
		if (errors.length > 0) writeEvidence(paths.evidence, files, ownedArtifacts, errors);
		let retained = state !== "closed" || errors.length > 0;
		if (!retained) {
			try {
				rmSync(root, { recursive: true, force: true });
			} catch (failure) {
				errors.push(`remove ${root}: ${failure.message}`);
				retained = true;
			}
		}
		return Object.freeze({ evidence, source, retainedRoot: retained ? root : null, errors: Object.freeze(errors) });
	}

	return {
		paths,
		env,
		session,
		herdr: herdrInstance,
		attribute,
		startPi,
		run,
		startServer,
		anchor,
		close,
		archive,
		useProvider(owned) {
			provider = owned;
		},
	};
}
