import { readdirSync, readFileSync, readlinkSync } from "node:fs";

const GONE_CODES = new Set(["ENOENT", "ESRCH"]);
const LINUX = process.platform === "linux";

function failure(path, error) {
	const code = error.code ?? "EUNKNOWN";
	return Object.freeze({ state: GONE_CODES.has(code) ? "absent" : "unknown", reason: `${path}: ${code}` });
}

function unknown(reason) {
	return Object.freeze({ state: "unknown", reason });
}

function read(path, reader) {
	if (!LINUX) return unknown(`${path}: no /proc on ${process.platform}`);
	try {
		return Object.freeze({ state: "present", value: reader(path) });
	} catch (error) {
		return failure(path, error);
	}
}

const text = (path) => readFileSync(path, "utf8");

export function procAvailable() {
	return readStat(process.pid).state === "present" && read("/proc/net/tcp", text).state === "present";
}

function readStat(pid) {
	const path = `/proc/${pid}/stat`;
	const raw = read(path, text);
	if (raw.state !== "present") return raw;
	const open = raw.value.indexOf("(");
	const close = raw.value.lastIndexOf(")");
	const fields = raw.value.slice(close + 2).split(" ");
	const stat = { pid, state: fields[0], ppid: Number(fields[1]), startTime: fields[19] };
	if (open === -1 || close < open || !Number.isInteger(stat.ppid) || !/^\d+$/.test(stat.startTime ?? "")) return unknown(`${path}: malformed`);
	return Object.freeze({ state: "present", stat: Object.freeze(stat) });
}

function liveThreads(pid) {
	const tasks = read(`/proc/${pid}/task`, readdirSync);
	if (tasks.state !== "present") return tasks;
	const live = [];
	for (const tid of tasks.value) {
		const thread = read(`/proc/${pid}/task/${tid}/stat`, text);
		if (thread.state === "unknown") return thread;
		const state = thread.state === "present" ? thread.value.slice(thread.value.lastIndexOf(")") + 2).split(" ")[0] : "X";
		if (state !== "Z" && state !== "X") live.push(tid);
	}
	return Object.freeze({ state: "present", live });
}

export function observe(identity) {
	if (!identity) return unknown("no identity was recorded");
	const current = readStat(identity.pid);
	if (current.state !== "present") return current;
	if (current.stat.startTime !== identity.startTime) {
		return Object.freeze({ state: "absent", reason: `pid ${identity.pid} now belongs to start time ${current.stat.startTime}` });
	}
	if (current.stat.state !== "Z") return current;
	const threads = liveThreads(identity.pid);
	if (threads.state === "unknown") return threads;
	return Object.freeze({ ...current, liveThreads: Object.freeze(threads.state === "present" ? threads.live : []) });
}

export function exited(observation) {
	return observation.state === "absent" || (observation.stat?.state === "Z" && observation.liveThreads?.length === 0);
}

export function describe(observation) {
	if (observation.state !== "present") return `${observation.state} (${observation.reason})`;
	const threads = observation.liveThreads ? `, ${observation.liveThreads.length} live threads` : "";
	return `present, state ${observation.stat.state}${threads}`;
}

function viewOf(pid) {
	const leader = readStat(pid);
	if (leader.state !== "present") return leader;
	if (leader.stat.state !== "Z") return Object.freeze({ state: "present", base: `/proc/${pid}` });
	const threads = liveThreads(pid);
	if (threads.state !== "present") return threads;
	if (threads.live.length === 0) return Object.freeze({ state: "absent", reason: `pid ${pid} has exited` });
	return Object.freeze({ state: "present", base: `/proc/${pid}/task/${threads.live[0]}` });
}

export function identify(pid, kind) {
	const current = readStat(pid);
	if (current.state !== "present") return current;
	const view = viewOf(pid);
	const exe = view.state === "present" ? read(`${view.base}/exe`, readlinkSync) : view;
	const identity = Object.freeze({ pid, startTime: current.stat.startTime, kind, exe: exe.state === "present" ? exe.value : null });
	return Object.freeze({ state: "present", identity, stat: current.stat, exe: Object.freeze(exe) });
}

function childrenOf(pid) {
	const threads = read(`/proc/${pid}/task`, readdirSync);
	if (threads.state !== "present") return threads;
	const children = [];
	for (const tid of threads.value) {
		const listed = read(`/proc/${pid}/task/${tid}/children`, text);
		if (listed.state === "unknown") return listed;
		if (listed.state === "present" && listed.value.trim() !== "") children.push(...listed.value.trim().split(/\s+/).map(Number));
	}
	return Object.freeze({ state: "present", children });
}

export function ownedTree(roots) {
	const tree = new Map();
	const problems = [];
	const queue = [];
	for (const root of roots) {
		const current = observe(root);
		if (current.state === "unknown") problems.push(`root ${root.label ?? root.kind} pid ${root.pid}: ${current.reason}`);
		if (current.state !== "present") continue;
		tree.set(root.pid, { ...current.stat, root });
		queue.push(root.pid);
	}
	while (queue.length > 0) {
		const pid = queue.shift();
		const listed = childrenOf(pid);
		if (listed.state === "unknown") problems.push(`children of ${pid}: ${listed.reason}`);
		if (listed.state !== "present") continue;
		for (const child of listed.children) {
			if (tree.has(child)) continue;
			const current = readStat(child);
			if (current.state === "unknown") problems.push(`child ${child} of ${pid}: ${current.reason}`);
			if (current.state !== "present" || current.stat.ppid !== pid) continue;
			tree.set(child, { ...current.stat, root: tree.get(pid).root });
			queue.push(child);
		}
	}
	return Object.freeze({ tree, problems: Object.freeze(problems) });
}

export function ancestry(tree, pid) {
	const chain = [];
	for (let current = pid; tree.has(current); current = tree.get(current).ppid) chain.push(tree.get(current));
	return chain;
}

export function socketInodes(pid) {
	const view = viewOf(pid);
	if (view.state !== "present") return view;
	const fds = read(`${view.base}/fd`, readdirSync);
	if (fds.state !== "present") return fds;
	const inodes = new Set();
	for (const fd of fds.value) {
		const target = read(`${view.base}/fd/${fd}`, readlinkSync);
		if (target.state === "unknown") return target;
		const match = target.state === "present" && /^socket:\[(\d+)\]$/.exec(target.value);
		if (match) inodes.add(match[1]);
	}
	return Object.freeze({ state: "present", inodes });
}

export function environOf(pid) {
	const view = viewOf(pid);
	if (view.state !== "present") return view;
	const raw = read(`${view.base}/environ`, text);
	if (raw.state !== "present") return raw;
	if (raw.value === "") return unknown(`${view.base}/environ: empty`);
	const environment = new Map(
		raw.value
			.split("\0")
			.filter(Boolean)
			.map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]),
	);
	return Object.freeze({ state: "present", environment });
}

const TCP_ADDRESS = /^[0-9A-F]{8}:[0-9A-F]{4}$/i;
const UNIX_ROW = /^\s*[0-9A-F]+:\s+[0-9A-F]+\s+[0-9A-F]+\s+([0-9A-F]+)\s+[0-9A-F]+\s+[0-9A-F]+\s+(\d+)(?: (.*))?$/i;

function tcpRow(line) {
	const cols = line.trim().split(/\s+/);
	if (cols.length < 10 || !/^\d+:$/.test(cols[0]) || !TCP_ADDRESS.test(cols[1]) || !TCP_ADDRESS.test(cols[2]) || !/^\d+$/.test(cols[9])) return null;
	return { local: cols[1].toUpperCase(), remote: cols[2].toUpperCase(), inode: cols[9] };
}

function unixRow(line) {
	const match = UNIX_ROW.exec(line);
	return match && { flags: Number.parseInt(match[1], 16), inode: match[2], path: match[3] ?? null };
}

function table(path, header, parseRow) {
	const raw = read(path, text);
	if (raw.state !== "present") return unknown(raw.reason);
	const lines = raw.value.split("\n");
	if (!lines[0].includes(header)) return unknown(`${path}: malformed header`);
	if (lines.at(-1) !== "") return unknown(`${path}: ends inside a row`);
	const rows = [];
	for (const [index, line] of lines.slice(1, -1).entries()) {
		const row = parseRow(line);
		if (!row) return unknown(`${path}: malformed row ${index + 1}`);
		rows.push(row);
	}
	return Object.freeze({ state: "present", rows });
}

function hexPort(port) {
	return port.toString(16).toUpperCase().padStart(4, "0");
}

export function loopbackClientInodes(clientPort, serverPort) {
	const tcp = table("/proc/net/tcp", "local_address", tcpRow);
	if (tcp.state !== "present") return tcp;
	const [local, remote] = [`0100007F:${hexPort(clientPort)}`, `0100007F:${hexPort(serverPort)}`];
	const inodes = tcp.rows.filter((row) => row.local === local && row.remote === remote).map((row) => row.inode);
	return Object.freeze({ state: "present", inodes });
}

export function unixListenerInodes(path) {
	const unix = table("/proc/net/unix", "Inode", unixRow);
	if (unix.state !== "present") return unix;
	const inodes = unix.rows.filter((row) => row.path === path && (row.flags & 0x10000) !== 0).map((row) => row.inode);
	return Object.freeze({ state: "present", inodes });
}
