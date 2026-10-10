import { spawn } from "node:child_process";
import { createEventLog, deadline, within } from "./event-log.mjs";
import { identify } from "./proc.mjs";

export const STREAM_LIMITS = Object.freeze({ lineBytes: 8 * 1024 * 1024, records: 20_000, captureBytes: 256 * 1024 });
const ESCALATION_MS = 5_000;
const DIALOGS = new Set(["select", "confirm", "input", "editor"]);

function splitLines(stream, maxBytes, { line: onLine, overflow: onOverflow, end: onEnd }) {
	let pending = Buffer.alloc(0);
	let overflowed = false;
	let ended = false;
	const finish = () => {
		if (ended) return;
		ended = true;
		if (!overflowed && pending.length > 0) onEnd(pending);
	};
	stream.once("end", finish);
	stream.once("close", finish);
	stream.on("data", (data) => {
		if (overflowed) return;
		pending = Buffer.concat([pending, data]);
		let newline = pending.indexOf(0x0a);
		while (newline !== -1) {
			const line = pending.subarray(0, newline);
			pending = pending.subarray(newline + 1);
			if (line.length > maxBytes) {
				overflowed = true;
				return onOverflow(line.length);
			}
			onLine(lineText(line));
			newline = pending.indexOf(0x0a);
		}
		if (pending.length > maxBytes) {
			overflowed = true;
			onOverflow(pending.length);
		}
	});
}

function lineText(bytes) {
	return bytes.toString("utf8").replace(/\r$/, "");
}

function completeRecord(line) {
	try {
		const value = JSON.parse(line);
		return value !== null && typeof value === "object" ? value : null;
	} catch {
		return null;
	}
}

function capture(limitBytes) {
	const chunks = [];
	let kept = 0;
	let dropped = 0;
	return {
		add(data) {
			const room = Math.max(0, limitBytes - kept);
			if (room > 0) chunks.push(data.subarray(0, room));
			kept += Math.min(room, data.length);
			dropped += Math.max(0, data.length - room);
		},
		text: () => Buffer.concat(chunks).toString("utf8"),
		get dropped() {
			return dropped;
		},
	};
}

async function closedWithin(closed, limit) {
	try {
		return await within(closed, limit);
	} catch {
		return null;
	}
}

function spawnOwned({ command, args, cwd, env, kind, stdin = "pipe", input }) {
	const child = spawn(command, args, { cwd, env, stdio: [input === undefined ? stdin : "pipe", "pipe", "pipe"] });
	const started = child.pid !== undefined;
	const captured = started ? identify(child.pid, kind) : null;
	const identity = captured?.state === "present" ? captured.identity : null;
	const identityProblem = identity ? null : (captured?.reason ?? "the process never started");
	const errors = [];
	const signals = [];
	let exit = null;
	child.on("error", (error) => errors.push(error.code ?? error.message));
	child.once("exit", (code, signal) => {
		exit = Object.freeze({ code, signal });
	});
	const closed = new Promise((resolve) => child.once("close", (code, signal) => resolve(Object.freeze({ code, signal }))));
	if (input !== undefined) {
		child.stdin.on("error", (error) => errors.push(`stdin: ${error.code ?? error.message}`));
		child.stdin.end(input);
	}

	function signal(name) {
		const delivered = child.kill(name);
		signals.push(Object.freeze({ signal: name, delivered }));
		return delivered;
	}

	function release() {
		child.unref();
		for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.unref?.();
	}

	function settle(final, forced) {
		if (!final) release();
		return Object.freeze({
			closure: final ? "closed" : "unresolved",
			code: final?.code ?? null,
			signal: final?.signal ?? null,
			exit,
			forced,
			signals: Object.freeze(signals.slice()),
			errors: Object.freeze(errors.slice()),
		});
	}

	let stopping = null;
	function stop(requestClose, limit, { escalationMs = ESCALATION_MS } = {}) {
		stopping ??= (async () => {
			try {
				requestClose();
			} catch (error) {
				errors.push(`close request: ${error.message}`);
			}
			let final = await closedWithin(closed, limit);
			let forced = null;
			for (const name of ["SIGTERM", "SIGKILL"]) {
				if (final) break;
				if (signal(name)) forced = name;
				final = await closedWithin(closed, deadline(escalationMs, `${limit.step} after ${name}`));
			}
			return settle(final, forced);
		})();
		return stopping;
	}

	return { child, started, identity, identityProblem, closed, signal, settle, stop };
}

export async function runBounded({ command, args, cwd, env, limit, grace = ESCALATION_MS, captureBytes = STREAM_LIMITS.captureBytes, input }) {
	const owned = spawnOwned({ command, args, cwd, env, kind: "command", stdin: "ignore", input });
	const stdout = capture(captureBytes);
	const stderr = capture(captureBytes);
	owned.child.stdout.on("data", stdout.add);
	owned.child.stderr.on("data", stderr.add);
	let final = await closedWithin(owned.closed, limit);
	const timedOut = final === null;
	let forced = null;
	if (timedOut) {
		if (owned.signal("SIGKILL")) forced = "SIGKILL";
		final = await closedWithin(owned.closed, deadline(grace, `${limit.step} after SIGKILL`));
	}
	return Object.freeze({
		...owned.settle(final, forced),
		timedOut,
		identity: owned.identity,
		identityProblem: owned.identityProblem,
		stdout: stdout.text(),
		stderr: stderr.text(),
		truncated: stdout.dropped + stderr.dropped > 0,
		closed: owned.closed,
	});
}

export function startLineProcess({ command, args, cwd, env, kind, label, limits = STREAM_LIMITS }) {
	const owned = spawnOwned({ command, args, cwd, env, kind, stdin: "ignore" });
	const lines = createEventLog(`${label} output`, limits.records, (fields) => ({ stream: fields.stream ?? null, exit: Boolean(fields.exit) }));
	const overflow = (bytes) => {
		lines.fault("line-size", { bytes });
		lines.close("output line exceeded limit");
		owned.signal("SIGTERM");
	};
	for (const stream of ["stdout", "stderr"]) {
		splitLines(owned.child[stream], limits.lineBytes, {
			line: (line) => lines.append({ stream, line }),
			overflow,
			end: (rest) => lines.append({ stream, line: lineText(rest), unterminated: true }),
		});
	}
	owned.closed.then((exit) => {
		lines.append({ exit });
		lines.close("process closed");
	});
	return { ...owned, lines };
}

function describeRecord(fields) {
	if (fields.record) return { type: fields.record.type ?? null };
	return { type: fields.malformed !== undefined ? "malformed" : fields.stdinError ? "stdin error" : fields.exit ? "exit" : null };
}

export function startRpcPi({ pi, args, cwd, env, kind, label, limits = STREAM_LIMITS }) {
	const owned = spawnOwned({ command: pi, args, cwd, env, kind });
	const log = createEventLog(`${label} rpc`, limits.records, describeRecord);
	const sent = [];
	const stderr = capture(STREAM_LIMITS.captureBytes);
	let commands = 0;

	function send(command) {
		sent.push(Object.freeze({ at: log.size, command }));
		if (!owned.child.stdin.writable) return false;
		owned.child.stdin.write(`${JSON.stringify(command)}\n`);
		return true;
	}

	function onLine(line) {
		if (line === "") return;
		let record;
		try {
			record = JSON.parse(line);
		} catch {
			log.append({ malformed: line.slice(0, 500) });
			return;
		}
		log.append({ record });
		if (record?.type === "extension_ui_request" && DIALOGS.has(record.method)) {
			send({ type: "extension_ui_response", id: record.id, cancelled: true });
		}
	}

	function onFinalFrame(rest) {
		const line = lineText(rest);
		if (line === "") return;
		const record = completeRecord(line);
		if (record) log.append({ record, unterminated: true });
		else log.fault("incomplete-frame", { bytes: rest.length });
	}

	splitLines(owned.child.stdout, limits.lineBytes, {
		line: onLine,
		overflow: (bytes) => {
			log.fault("line-size", { bytes });
			log.close("stdout record exceeded limit");
			owned.signal("SIGTERM");
		},
		end: onFinalFrame,
	});
	owned.child.stderr.on("data", stderr.add);
	owned.child.stdin.on("error", (error) => log.append({ stdinError: error.code ?? error.message }));
	owned.closed.then((exit) => {
		log.append({ exit });
		log.close("process closed");
	});

	async function request(fields, limit) {
		if (!owned.child.stdin.writable) throw new Error(`${label} stdin is closed`);
		commands += 1;
		const id = `${label}-${commands}`;
		const reply = log.waitFor((entry) => entry.record?.type === "response" && entry.record.id === id, { from: log.size, limit });
		send({ id, ...fields });
		return reply;
	}

	return {
		...owned,
		log,
		sent,
		request,
		stderr: () => stderr.text(),
		close: (limit, options) => owned.stop(() => owned.child.stdin.end(), limit, options),
	};
}
