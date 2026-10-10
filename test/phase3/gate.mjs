import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expectedPackFiles, SKILLS } from "../inventory.mjs";
import { extractPack, listFiles, packInto, parseFrontmatter } from "../support.mjs";
import { MODEL_REF, writeAgentConfig } from "./agent-config.mjs";
import { deadline, StepFailure } from "./event-log.mjs";
import { expectedSkill, judgeGate } from "./evidence.mjs";
import { startProvider } from "./provider.mjs";
import { createRuntime } from "./runtime.mjs";
import { childReply, createScenarioTable, parentReply, soloReply, writerPayload } from "./scenarios.mjs";
import { sha256 } from "./wire.mjs";

const BUILTIN_EXTENSIONS_OFF = Object.freeze(["-builtin:mcp", "-builtin:llama.cpp", "-builtin:codemode", "-builtin:tool-search"]);
const PI_COMMON = ["--mode", "rpc", "--offline", "--no-context-files", "--no-prompt-templates", "--no-themes", "--no-approve", "--model", MODEL_REF, "--thinking", "off"];
const TASK_MODEL_CONFIG = `${JSON.stringify(
	{
		status: { enabled: true },
		models: { agents: {} },
		persistent: { maxAgents: 3 },
		supervision: { forcePolling: false, hangWarningMinutes: 15 },
		panes: { mode: "grouped", direction: "right", maxPerTab: 4 },
	},
	null,
	2,
)}\n`;
const SCENARIO_MS = 90_000;

function isSubagentResult(record, name) {
	return record?.type === "message_end" && record.message?.role === "custom" && record.message.customType === "subagent_result" && record.message.details?.name === name;
}

function marker(label) {
	return `${label}-${randomBytes(6).toString("hex")}`;
}

function skillDocument(name, description, body) {
	return `---\nname: ${name}\ndescription: ${description}\ndisable-model-invocation: true\n---\n\n${body}\n`;
}

function packageSkillNames(pkg) {
	return pkg.skills.flatMap((entry) => {
		const dir = join(pkg.root, entry);
		return readdirSync(dir, { withFileTypes: true })
			.filter((child) => child.isDirectory() && existsSync(join(dir, child.name, "SKILL.md")))
			.map((child) => parseFrontmatter(readFileSync(join(dir, child.name, "SKILL.md"), "utf8")).fields.name)
			.filter((name) => typeof name === "string");
	});
}

function canonicalEvidence({ candidate, host, pstack }) {
	const files = Object.fromEntries(listFiles(candidate).map((path) => [join(candidate, path), readFileSync(join(candidate, path), "utf8")]));
	const skills = Object.fromEntries(
		SKILLS.map((skill) => {
			const location = join(candidate, skill.path);
			return [skill.name, expectedSkill({ name: skill.name, location, fileText: files[location] })];
		}),
	);
	const hubLocation = join(pstack.root, "skills", "poteto-mode", "SKILL.md");
	return {
		candidateRoot: candidate,
		files,
		skills,
		craftSkills: SKILLS.map(({ name, path }) => ({ name, path })),
		hostRoot: host.root,
		pstackRoot: pstack.root,
		hostSkills: packageSkillNames(host),
		pstackSkills: packageSkillNames(pstack),
		pstackExtension: join(pstack.root, pstack.extensions[0]),
		pstackHub: expectedSkill({ name: "poteto-mode", location: hubLocation, fileText: readFileSync(hubLocation, "utf8") }),
	};
}

export function launchScripts(table, artifactsDir) {
	const errors = [];
	if (!existsSync(artifactsDir)) return { paths: [], prompts: {}, errors };
	let paths = [];
	try {
		paths = readdirSync(artifactsDir, { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.parentPath.endsWith("/subagent-scripts"))
			.map((entry) => join(entry.parentPath, entry.name));
	} catch (error) {
		errors.push(`list ${artifactsDir}: ${error.message}`);
	}
	const prompts = {};
	for (const child of Object.values(table.children)) {
		const path = paths.find((candidate) => candidate.split("/").at(-1).startsWith(`${child.args.name}-`));
		if (!path) continue;
		try {
			const match = /--thinking '[^']*' (.*?); echo /.exec(readFileSync(path, "utf8"));
			if (match) prompts[child.key] = match[1];
		} catch (error) {
			errors.push(`read ${path}: ${error.message}`);
		}
	}
	return { paths, prompts, errors };
}

async function settleAfter(rpc, index, step) {
	return rpc.log.waitFor((entry) => entry.record?.type === "agent_settled", { from: index, limit: deadline(30_000, step) });
}

async function prompt(rpc, message, step) {
	const from = rpc.log.size;
	const response = await rpc.request({ type: "prompt", message }, deadline(15_000, step));
	if (!response.record.success) throw new StepFailure(step, `prompt rejected: ${response.record.error}`);
	return { from, response };
}

function soloControls({ candidate, host, decoy, root }) {
	const shadowBody = marker("SHADOW-BODY");
	return {
		filtered: {
			packages: [{ source: candidate, skills: ["-skills/craft-tdd/SKILL.md"] }],
			message: `/skill:craft-tdd ${marker("FILTERED")} READ ${join(candidate, "skills/craft-tdd/SKILL.md")}`,
		},
		shadowed: { packages: [candidate], message: `/skill:craft-mode ${marker("SHADOWED")}`, shadowBody, shadowPath: join(root, "shadowed", "agent", "skills", "craft-mode", "SKILL.md") },
		decoy: { packages: [decoy], message: `/skill:craft-tdd ${marker("DECOY")}`, decoyRoot: decoy },
		unknown: { packages: [candidate], message: `/skill:craft-absent ${marker("UNKNOWN")}` },
		"host-disabled": { packages: [{ source: host, extensions: [] }, candidate], message: "scenario:standalone", extensions: [...BUILTIN_EXTENSIONS_OFF] },
	};
}

async function runSolo(runtime, provider, label, control) {
	const agent = join(runtime.paths.solo, label, "agent");
	writeAgentConfig(agent, { baseUrl: `http://127.0.0.1:${provider.port}/v1`, packages: control.packages, extensions: control.extensions ?? [] });
	if (control.shadowPath) {
		mkdirSync(join(agent, "skills", "craft-mode"), { recursive: true });
		writeFileSync(control.shadowPath, skillDocument("craft-mode", "Shadow skill used as a precedence control.", control.shadowBody));
	}
	const args = [...PI_COMMON, "--no-session", ...(control.extensions ? [] : ["--no-extensions"])];
	const rpc = runtime.startPi({ label: `solo-${label}`, kind: "solo", args, processEnv: { ...runtime.env, PI_CODING_AGENT_DIR: agent } });
	const result = { label, ...control, ledgerFrom: provider.ledger.size };
	try {
		result.commands = (await rpc.request({ type: "get_commands" }, deadline(20_000, `${label} commands`))).record;
		const { response } = await prompt(rpc, control.message, `${label} prompt`);
		result.prompt = response.record;
		if (response.record.data?.disposition === "started") await settleAfter(rpc, response.index, `${label} settle`);
	} finally {
		result.exit = await rpc.close(deadline(15_000, `${label} close`));
		Object.assign(result, { ledgerTo: provider.ledger.size, stderr: rpc.stderr(), log: rpc.log.entries, logLabel: rpc.log.label, faults: rpc.log.faults, sent: rpc.sent });
	}
	return result;
}

export async function runHostGate({ prerequisites, evidenceDir }) {
	const runtime = createRuntime({ pi: prerequisites.pi.path, herdr: prerequisites.herdr.path });
	const steps = [];
	const evidence = { prerequisites, session: runtime.session, steps, solos: {}, windows: {}, markers: {}, versions: {}, interruption: null };
	let provider = null;
	let parent = null;
	let table = null;
	const step = (name, detail = {}) => steps.push({ name, ledger: provider?.ledger.size ?? 0, rpc: parent?.log.size ?? 0, ...detail });
	async function runScenarios() {
		step("stage candidate");
		const candidate = await extractPack(await packInto(join(runtime.paths.pack, "npm"), { dryRun: false }));
		const packed = listFiles(candidate);
		evidence.candidate = { root: candidate, files: packed, digests: Object.fromEntries(packed.map((path) => [path, sha256(readFileSync(join(candidate, path)))])) };
		if (JSON.stringify(packed) !== JSON.stringify(expectedPackFiles())) throw new StepFailure("stage candidate", "extracted tarball does not hold the expected inventory");
		evidence.canonical = canonicalEvidence({ candidate, host: prerequisites.host, pstack: prerequisites.pstack });

		const decoy = join(runtime.paths.root, "decoy");
		mkdirSync(join(decoy, "skills", "craft-tdd"), { recursive: true });
		writeFileSync(join(decoy, "package.json"), `${JSON.stringify({ name: "decoy-craft", version: "0.0.0", private: true, pi: { skills: ["./skills"] } }, null, "\t")}\n`);
		writeFileSync(join(decoy, "skills", "craft-tdd", "SKILL.md"), skillDocument("craft-tdd", "Decoy package skill used as a wrong-identity control.", marker("DECOY-BODY")));
		table = createScenarioTable({ candidateRoot: candidate, cwd: runtime.paths.work });
		evidence.table = table;
		const configPath = join(runtime.paths.agent, "herdr-agents", "config.json");
		mkdirSync(join(runtime.paths.agent, "herdr-agents"), { recursive: true });
		writeFileSync(configPath, TASK_MODEL_CONFIG);
		const revision = `sha256:${sha256(TASK_MODEL_CONFIG)}`;
		const writer = writerPayload(revision);
		evidence.taskModelConfig = { path: configPath, before: revision, after: null, writer };
		const context = { table, writer };
		provider = await startProvider({
			model: MODEL_REF,
			attribute: runtime.attribute,
			respond: ({ origin, request, mint }) => {
				if (origin.kind === "parent") return parentReply(request, context);
				if (origin.kind === "solo") return soloReply(origin.label.replace(/^solo-/, ""), request, context);
				const entry = table.byName(origin.subagentName);
				return entry ? childReply(entry, request, mint) : { refusal: `no actor for child ${origin.subagentName}` };
			},
		});
		runtime.useProvider(provider);
		writeAgentConfig(runtime.paths.agent, {
			baseUrl: `http://127.0.0.1:${provider.port}/v1`,
			packages: [prerequisites.host.root, prerequisites.pstack.root, candidate],
			extensions: [...BUILTIN_EXTENSIONS_OFF],
		});

		step("versions");
		for (const name of ["pi", "herdr"]) {
			const result = await runtime.run(join(runtime.paths.bin, name), ["--version"], `${name} version`);
			evidence.versions[name] = { code: result.code, closure: result.closure, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
		}
		evidence.versions.node = process.version;

		for (const [label, control] of Object.entries(soloControls({ candidate, host: prerequisites.host.root, decoy, root: runtime.paths.solo }))) {
			step(`solo ${label}`);
			evidence.solos[label] = await runSolo(runtime, provider, label, control);
		}

		step("start herdr");
		evidence.server = await runtime.startServer();
		evidence.anchor = await runtime.anchor();
		step("start parent");
		parent = runtime.startPi({ label: "parent", kind: "parent", args: [...PI_COMMON, "--session-dir", runtime.paths.sessions], processEnv: evidence.anchor.callerEnv });
		evidence.commands = (await parent.request({ type: "get_commands" }, deadline(30_000, "parent commands"))).record;
		evidence.state = (await parent.request({ type: "get_state" }, deadline(15_000, "parent state"))).record;
		const sessionFile = evidence.state.data?.sessionFile;
		if (typeof sessionFile !== "string" || !sessionFile.startsWith(`${runtime.paths.sessions}/`)) throw new StepFailure("parent state", "the parent has no owned session file");
		evidence.artifactsDir = join(runtime.paths.sessions, "artifacts", evidence.state.data.sessionId);

		const command = async (name, message) => {
			step(name);
			const { from, response } = await prompt(parent, message, name);
			evidence.windows[name] = { from, response: response.index, disposition: response.record.data?.disposition };
			return response;
		};
		const settledCommand = async (name, message) => {
			const response = await command(name, message);
			evidence.windows[name].settled = (await settleAfter(parent, response.index, `${name} settle`)).index;
		};
		const scenario = async (key, finalKey = key) => {
			const response = await command(`scenario ${key}`, `scenario:${key}`);
			const name = table.children[finalKey].args.name;
			const result = await parent.log.waitFor((entry) => isSubagentResult(entry.record, name), { from: response.index, limit: deadline(SCENARIO_MS, `${key} completion`) });
			evidence.windows[`scenario ${key}`].settled = (await settleAfter(parent, result.index, `${key} settle`)).index;
		};

		await command("setup report", "/setup-pstack report");
		await scenario("standalone");
		await scenario("fork");
		await scenario("resources");
		await settledCommand("scenario writer", "scenario:writer");
		await command("mode on", "/poteto-mode on");
		await command("mode status on", "/poteto-mode status");
		evidence.markers.modeSkill = marker("MODE-TASK");
		await settledCommand("mode skill", `/skill:craft-tdd ${evidence.markers.modeSkill}`);
		await scenario("handoff", "handoff-b");
		await command("mode off", "/poteto-mode off");
		await command("mode status off", "/poteto-mode status");
		await settledCommand("scenario final", "scenario:final");
		evidence.taskModelConfig.after = existsSync(configPath) ? `sha256:${sha256(readFileSync(configPath))}` : "missing";
		await scenario("skills");
		step("scenarios complete");
	}

	let scripts = { paths: [], prompts: {}, errors: [] };
	try {
		try {
			await runScenarios();
		} catch (error) {
			evidence.interruption = { step: error.step ?? "unexpected", reason: error.reason ?? error.message };
			step("interrupted", evidence.interruption);
		}
		if (table && evidence.artifactsDir) scripts = launchScripts(table, evidence.artifactsDir);
	} finally {
		evidence.teardown = await runtime.close();
	}
	evidence.launchScripts = scripts.prompts;
	evidence.launchScriptErrors = scripts.errors;
	evidence.herdrState = evidence.teardown.herdrState;
	evidence.ledger = provider?.ledger.entries ?? [];
	evidence.parentLog = parent?.log.entries ?? [];
	evidence.parentSent = parent?.sent ?? [];
	evidence.parentStderr = parent?.stderr() ?? "";
	evidence.herdrCommands = runtime.herdr.commands;
	evidence.serverOutput = runtime.herdr.server?.lines.entries ?? [];
	evidence.faults = Object.fromEntries(
		[
			...[provider?.ledger, parent?.log, runtime.herdr.server?.lines].filter(Boolean).map((log) => [log.label, log.faults]),
			...Object.values(evidence.solos).map((solo) => [solo.logLabel, solo.faults]),
		].filter(([label, faults]) => label && faults),
	);
	const report = judgeGate(evidence);
	const archived = runtime.archive(evidenceFiles(evidence, report), {
		passed: report.passed,
		evidenceDir,
		ownedArtifacts: scripts.paths.map((path) => ({ path, name: `launch-${path.split("/").at(-1)}` })),
	});
	return { ...report, archived, teardown: evidence.teardown, interruption: evidence.interruption, versions: evidence.versions };
}

function jsonl(entries) {
	return entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length > 0 ? "\n" : "");
}

const REPORT_FIELDS = [
	"prerequisites",
	"session",
	"versions",
	"candidate",
	"table",
	"markers",
	"taskModelConfig",
	"server",
	"anchor",
	"state",
	"windows",
	"steps",
	"launchScripts",
	"launchScriptErrors",
	"faults",
	"interruption",
	"teardown",
];

function evidenceFiles(evidence, report) {
	const summary = Object.fromEntries(REPORT_FIELDS.map((field) => [field, evidence[field]]));
	const files = {
		"report.json": `${JSON.stringify({ outcomes: report.outcomes, passed: report.passed, ...summary }, null, 2)}\n`,
		"commands.json": `${JSON.stringify(evidence.commands ?? null, null, 2)}\n`,
		"ledger.jsonl": jsonl(evidence.ledger),
		"parent-rpc.jsonl": jsonl(evidence.parentLog),
		"parent-sent.jsonl": jsonl(evidence.parentSent),
		"parent-stderr.txt": evidence.parentStderr,
		"herdr-commands.jsonl": jsonl(evidence.herdrCommands),
		"herdr-server-output.jsonl": jsonl(evidence.serverOutput),
	};
	for (const [label, solo] of Object.entries(evidence.solos)) {
		const { log, sent, ...rest } = solo;
		files[`solo-${label}.json`] = `${JSON.stringify(rest, null, 2)}\n`;
		files[`solo-${label}-rpc.jsonl`] = jsonl(log ?? []);
		files[`solo-${label}-sent.jsonl`] = jsonl(sent ?? []);
	}
	return files;
}
