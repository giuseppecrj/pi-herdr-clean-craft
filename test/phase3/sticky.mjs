import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isolatedEnv, PACKAGE_ROOT } from "../support.mjs";
import { MODEL_REF, writeAgentConfig } from "./agent-config.mjs";
import { deadline } from "./event-log.mjs";
import { expectedSkill } from "./evidence.mjs";
import { resolveExecutable } from "./prerequisites.mjs";
import { startRpcPi } from "./processes.mjs";
import { startProvider } from "./provider.mjs";
import { conversation, newInput, skillBlock, systemText, textReply, toolReply } from "./wire.mjs";

export const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "sticky-driver.mjs");
export const REMINDER_TAG = "<craft-mode-reminder>";
export const REMINDER_CEILING = 600;
const SUMMARY_PROMPT = "You are a context summarization assistant.";

export function requirePi() {
	const pi = resolveExecutable(process.env, { variable: "CLEAN_CRAFT_PI_BIN", name: "pi" });
	if (pi.kind === "blocked") throw new Error(`BLOCKED: ${pi.reason}. The sticky command gate needs the Pi CLI and has not passed.`);
	return pi.path;
}

// The exact envelope Pi produces for /skill:craft-mode from a given registered path.
export function hubBlock(skillPath) {
	return skillBlock(expectedSkill({ name: "craft-mode", location: skillPath, fileText: readFileSync(skillPath, "utf8") }));
}

// Scripted replies keyed on markers in the newest input. Summary requests get a fixed summary;
// [[say:file]] replies with a file's exact text, so an assistant turn can quote instructions.
function responder(cwd) {
	return ({ request }) => {
		if (systemText(request.turns).startsWith(SUMMARY_PROMPT)) return { reply: textReply("SCRIPTED-SUMMARY") };
		const fresh = newInput(request.turns);
		if (fresh.some((turn) => turn.role === "tool")) return { reply: textReply("DONE") };
		const text = fresh.map((turn) => turn.text).join("\n");
		const say = /\[\[say:([^\]]+)\]\]/.exec(text);
		if (say) return { reply: textReply(readFileSync(join(cwd, say[1]), "utf8")) };
		const read = /\[\[read:([^\]]+)\]\]/.exec(text);
		if (read && request.tools.includes("read")) return { reply: toolReply("", [{ id: `call_${randomBytes(4).toString("hex")}`, name: "read", arguments: { path: read[1] } }]) };
		return { reply: textReply("OK") };
	};
}

const BUILTIN_EXTENSIONS_OFF = Object.freeze(["-builtin:mcp", "-builtin:llama.cpp", "-builtin:codemode", "-builtin:tool-search"]);
const PI_FLAGS = ["--mode", "rpc", "--offline", "--no-context-files", "--tools", "read", "--no-prompt-templates", "--no-themes", "--no-approve", "--model", MODEL_REF, "--thinking", "off"];

// One provider and one owned root per test; Pi processes start and close sequentially inside it.
export async function openLab(t, label) {
	const pi = requirePi();
	const root = realpathSync(mkdtempSync(join(tmpdir(), `clean-craft-sticky-${label}-`)));
	const token = randomBytes(8).toString("hex");
	const provider = await startProvider({
		model: MODEL_REF,
		attribute: ({ url }) => (url.startsWith(`/${token}/`) ? { kind: "case", token } : { kind: "unknown", reason: `route ${url}` }),
		respond: responder(join(root, "cwd")),
	});
	for (const dir of ["home", "cwd", "sessions", "xdg/config", "xdg/cache", "xdg/data", "xdg/state"]) mkdirSync(join(root, dir), { recursive: true });
	const processes = [];
	const errors = [];
	let passed = false;
	let providerClosed = false;

	t.after(async () => {
		for (const proc of processes) await proc.close();
		if (!providerClosed) providerClosed = (await provider.close()) === true;
		writeEvidence();
		const closed = providerClosed && processes.every((proc) => proc.exit?.closure === "closed");
		if (passed && closed) rmSync(root, { recursive: true, force: true });
		else t.diagnostic(`retained sticky evidence at ${root}`);
	});

	function writeEvidence() {
		const dir = join(root, "evidence");
		mkdirSync(dir, { recursive: true });
		const ledger = provider.ledger.entries.map((entry) => ({ index: entry.index, origin: entry.origin, refused: entry.refused, reply: entry.reply, rawBody: entry.rawBody }));
		writeFileSync(join(dir, "ledger.json"), `${JSON.stringify(ledger, null, 1)}\n`);
		processes.forEach((proc, index) => {
			writeFileSync(join(dir, `rpc-${index}-${proc.label}.jsonl`), proc.rpc.log.entries.map((entry) => JSON.stringify(entry.record ?? entry)).join("\n"));
			writeFileSync(join(dir, `stderr-${index}-${proc.label}.txt`), proc.rpc.stderr());
			writeFileSync(
				join(dir, `exit-${index}-${proc.label}.json`),
				`${JSON.stringify({ exit: proc.exit, identity: proc.rpc.identity, identityProblem: proc.rpc.identityProblem, faults: proc.rpc.log.faults }, null, 1)}\n`,
			);
		});
		writeFileSync(join(dir, "summary.json"), `${JSON.stringify({ label, passed, providerClosed, providerFaults: provider.ledger.faults, errors }, null, 1)}\n`);
		if (existsSync(join(root, "sessions"))) cpSync(join(root, "sessions"), join(dir, "sessions"), { recursive: true });
		const target = process.env.CLEAN_CRAFT_STICKY_EVIDENCE_DIR;
		if (target) {
			rmSync(join(target, label), { recursive: true, force: true });
			cpSync(dir, join(target, label), { recursive: true });
		}
	}

	async function start({ label: procLabel, packages = [PACKAGE_ROOT], settings = {}, env = {}, args = [], extensions = [DRIVER], agentDir = join(root, "agent") }) {
		const config = writeAgentConfig(agentDir, { baseUrl: `http://127.0.0.1:${provider.port}/${token}/v1`, packages, extensions: [...BUILTIN_EXTENSIONS_OFF] });
		writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify({ ...config.settings, ...settings }, null, "\t")}\n`);
		const piEnv = isolatedEnv(root, { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", ...env });
		const argv = [...PI_FLAGS, "--session-dir", join(root, "sessions"), ...args, ...extensions.flatMap((path) => ["-e", path])];
		const rpc = startRpcPi({ pi, args: argv, cwd: join(root, "cwd"), env: piEnv, kind: "solo", label: procLabel });
		const proc = { label: procLabel, rpc, exit: null, close: null };
		proc.close = async () => {
			if (proc.exit) return proc.exit;
			try {
				proc.exit = await rpc.close(deadline(10_000, `${procLabel} close`));
			} catch (error) {
				errors.push(`${procLabel} close: ${error.message}`);
				proc.exit = { closure: "unresolved" };
			}
			return proc.exit;
		};
		processes.push(proc);
		return session(proc);
	}

	function session(proc) {
		const { rpc } = proc;
		const notices = (from, to) =>
			rpc.log.entries
				.slice(from, to)
				.filter((entry) => entry.record?.type === "extension_ui_request" && entry.record.method === "notify")
				.map((entry) => entry.record.message);

		async function request(fields, step, ms = 20_000) {
			const from = rpc.log.size;
			const reply = await rpc.request(fields, deadline(ms, step));
			return { reply, from };
		}

		return {
			proc,
			rpc,
			// A slash command that Pi handles without starting a run. `at` is the log position before it was sent.
			async command(text) {
				const ledgerBefore = provider.ledger.size;
				const { reply, from } = await request({ type: "prompt", message: text }, text);
				if (!reply.record.success || reply.record.data?.disposition !== "handled") throw new Error(`${text}: ${JSON.stringify(reply.record)}`);
				return { notices: notices(from, reply.index + 1), text: notices(from, reply.index + 1).join("\n"), at: from, ledgerBefore };
			},
			// Wait for the run a command or prompt started after `at`, and return its provider requests.
			async settled(at, ledgerBefore, step) {
				await rpc.log.waitFor((entry) => entry.record?.type === "agent_settled", { from: at, limit: deadline(30_000, step) });
				return provider.ledger.entries.slice(ledgerBefore);
			},
			// Start a prompt and return without waiting for it to settle.
			async begin(message, extra = {}) {
				const ledgerBefore = provider.ledger.size;
				const { reply, from } = await request({ type: "prompt", message, ...extra }, message.slice(0, 60));
				if (!reply.record.success || reply.record.data?.disposition !== "started") throw new Error(`${message}: ${JSON.stringify(reply.record)}`);
				return { at: from, ledgerBefore };
			},
			async prompt(message, extra = {}) {
				const { at, ledgerBefore } = await this.begin(message, extra);
				return this.settled(at, ledgerBefore, `settle ${message.slice(0, 60)}`);
			},
			// Run a handled command that starts a run of its own, such as a wake or a submitted task.
			async commandRun(text) {
				const handled = await this.command(text);
				return { ...handled, requests: await this.settled(handled.at, handled.ledgerBefore, `settle ${text.slice(0, 60)}`) };
			},
			async raw(fields, ms) {
				return (await request(fields, fields.type, ms)).reply.record;
			},
			async waitForStatus(text, from) {
				return rpc.log.waitFor((entry) => entry.record?.type === "extension_ui_request" && entry.record.method === "setStatus" && entry.record.statusText === text, {
					from,
					limit: deadline(15_000, `status ${text}`),
				});
			},
			async entries() {
				const reply = await this.raw({ type: "get_entries" });
				return reply.data.entries;
			},
			close: proc.close,
		};
	}

	async function finish() {
		for (const proc of processes) await proc.close();
		providerClosed = (await provider.close()) === true;
		const problems = [...errors];
		if (!providerClosed) problems.push("provider did not close");
		if (provider.ledger.faults.count > 0) problems.push(`provider faults ${JSON.stringify(provider.ledger.faults)}`);
		for (const proc of processes) {
			if (proc.exit?.closure !== "closed" || proc.exit.forced || proc.exit.code !== 0) problems.push(`${proc.label} exit ${JSON.stringify(proc.exit)}\n${proc.rpc.stderr()}`);
			if (proc.rpc.log.faults.count > 0) problems.push(`${proc.label} rpc faults ${JSON.stringify(proc.rpc.log.faults)}`);
		}
		for (const entry of provider.ledger.entries) if (entry.refused || entry.auth !== "dummy") problems.push(`ledger#${entry.index} refused ${entry.refused} auth ${entry.auth}`);
		if (problems.length > 0) throw new Error(problems.join("\n"));
		return provider.ledger.entries;
	}

	return {
		root,
		start,
		finish,
		get ledger() {
			return provider.ledger.entries;
		},
		markPassed() {
			passed = true;
		},
		sessionFiles() {
			const out = [];
			const walk = (dir) => {
				for (const entry of readdirSync(dir, { withFileTypes: true })) {
					if (entry.isDirectory()) walk(join(dir, entry.name));
					else if (entry.name.endsWith(".jsonl")) out.push(join(dir, entry.name));
				}
			};
			walk(join(root, "sessions"));
			return out.toSorted();
		},
	};
}

export function isSummaryRequest(entry) {
	return systemText(entry.parsed.turns).startsWith(SUMMARY_PROMPT);
}

// Observable guidance in one received request. A carrier is a turn that is exactly the hub; a user
// expansion is a turn that starts with the hub followed by its arguments.
export function guidance(entry, hub) {
	const turns = conversation(entry.parsed.turns);
	const all = entry.parsed.turns.map((turn) => turn.text).join("\n");
	const reminders = turns.filter((turn) => turn.role === "user" && turn.text.startsWith(REMINDER_TAG));
	const carriers = turns.filter((turn) => turn.role === "user" && turn.text === hub);
	const added = carriers.length + reminders.length;
	const tail = added === 0 ? [] : turns.slice(-added);
	const pairs = turns.flatMap((turn, index) => turn.toolCalls.map((call) => turns[index + 1 + turn.toolCalls.indexOf(call)]?.toolCallId === call.id));
	return {
		kind: isSummaryRequest(entry) ? "summary" : "task",
		hubTotal: all.split(hub).length - 1,
		carrierHub: carriers.length,
		userHub: turns.filter((turn) => turn.role === "user" && turn.text.startsWith(`${hub}\n\n`)).length,
		reminders: reminders.length,
		reminderLengths: reminders.map((turn) => turn.text.length),
		carriersAtEnd: tail.every((turn) => turn.role === "user" && (turn.text === hub || turn.text.startsWith(REMINDER_TAG))),
		toolPairsAdjacent: pairs.every(Boolean),
		system: systemText(entry.parsed.turns),
		turns,
	};
}

// Conversation without this pack's request-local carriers, to compare history across requests.
export function withoutCarriers(entry, hub) {
	return conversation(entry.parsed.turns).filter((turn) => !(turn.role === "user" && (turn.text === hub || turn.text.startsWith(REMINDER_TAG))));
}
