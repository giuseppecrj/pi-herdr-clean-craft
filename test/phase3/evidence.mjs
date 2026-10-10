import { dirname, join } from "node:path";
import {
	conversation,
	inheritedLength,
	inputTexts,
	newInput,
	parseFileAttachment,
	parseSkillInvocation,
	skillBody,
	systemText,
	toolCallArguments,
} from "./wire.mjs";

export const DISTINCTIONS = Object.freeze([
	"discovery",
	"standalone-role",
	"fork-control",
	"fresh-resources",
	"completion",
	"handoff",
	"skills-argument",
	"resource-controls",
	"pstack-report",
	"pstack-mode",
	"writer-refusal",
	"isolation",
	"teardown",
]);

const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);
const WRITER = "subagents_write_task_models";
const WRITER_REFUSAL = `pi-herdr-pstack blocked ${WRITER}`;
const MODE_SECTION = /<pstack_poteto_mode>\n([\s\S]*?)\n<\/pstack_poteto_mode>/;
const RESULT_HEADER = /^Sub-agent "[^"]+" completed/;

function pass(distinction, reason, evidence = []) {
	return Object.freeze({ distinction, kind: "pass", reason, evidence: Object.freeze(evidence) });
}

function fail(distinction, reason, evidence = []) {
	return Object.freeze({ distinction, kind: "fail", reason, evidence: Object.freeze(evidence) });
}

function blocked(distinction, reason, evidence = []) {
	return Object.freeze({ distinction, kind: "blocked", reason, evidence: Object.freeze(evidence) });
}

function occurrences(text, needle) {
	return needle === "" ? 0 : text.split(needle).length - 1;
}

export function expectedSkill({ name, location, fileText }) {
	return Object.freeze({ name, location, baseDir: dirname(location), body: skillBody(fileText) });
}

function invocationProblem(invocation, expected) {
	if (invocation.name !== expected.name) return `skill name ${invocation.name}, expected ${expected.name}`;
	if (invocation.location !== expected.location) return `skill location ${invocation.location}, expected ${expected.location}`;
	if (invocation.baseDir !== expected.baseDir) return `reference base ${invocation.baseDir}, expected ${expected.baseDir}`;
	if (invocation.body !== expected.body) return "delivered body differs from the canonical instructions";
	return null;
}

function deliveredSkill(entry) {
	if (entry.refused || !entry.parsed) return { problem: `request refused: ${entry.refused}` };
	const fresh = newInput(entry.parsed.turns);
	if (fresh.length !== 1 || fresh[0].role !== "user") return { problem: `new input has ${fresh.length} turns, expected one user turn` };
	const invocation = parseSkillInvocation(fresh[0].text);
	if (!invocation) return { problem: "new input is not an expanded skill block", text: fresh[0].text };
	return { invocation, text: fresh[0].text };
}

export function skillDeliveryProblem(entry, expected, task) {
	const delivered = deliveredSkill(entry);
	if (delivered.problem) return delivered.problem;
	const { invocation, text } = delivered;
	const problem = invocationProblem(invocation, expected);
	if (problem) return problem;
	if (expected.body.includes(task)) return "task marker is not distinct from the skill body";
	if (invocation.args !== task) return `task argument ${JSON.stringify(invocation.args)}, expected ${JSON.stringify(task)}`;
	if (occurrences(text, task) !== 1) return "task marker appears more than once in the new input";
	if (entry.reply.text.includes(task) || entry.reply.text.includes(expected.body)) return "reply echoes the task or the instructions";
	return null;
}

export function hostPreflight(entry) {
	if (!entry?.parsed) return { kind: "blocked", reason: "no received parent request" };
	return entry.parsed.tools.includes("subagent")
		? { kind: "ready" }
		: { kind: "blocked", reason: "the received request declares no subagent tool, so the host is not active" };
}

function messageText(message) {
	const { content } = message ?? {};
	if (typeof content === "string") return content;
	return Array.isArray(content) ? content.map((part) => (part?.type === "text" ? part.text : "")).join("") : "";
}

function parentEntries(ledger) {
	return ledger.filter((entry) => entry.origin.kind === "parent");
}

function childEntries(ledger, name) {
	return ledger.filter((entry) => entry.origin.kind === "host-child" && entry.origin.subagentName === name);
}

function emittedCall(ledger, id) {
	for (const entry of parentEntries(ledger)) {
		const call = entry.reply?.calls.find((candidate) => candidate.id === id);
		if (call) return { entry, call };
	}
	return null;
}

function toolEnd(log, id) {
	return log.find((entry) => entry.record?.type === "tool_execution_end" && entry.record.toolCallId === id) ?? null;
}

function subagentResult(log, name) {
	return (
		log.find(
			(entry) =>
				entry.record?.type === "message_end" &&
				entry.record.message?.role === "custom" &&
				entry.record.message.customType === "subagent_result" &&
				entry.record.message.details?.name === name,
		) ?? null
	);
}

function carries(entry, text) {
	return entry.parsed ? inputTexts(newInput(entry.parsed.turns)).some((value) => value.includes(text)) : false;
}

function tasked(entry, marker) {
	return entry.parsed ? newInput(entry.parsed.turns).some((turn) => turn.role !== "assistant" && turn.text.includes(marker)) : false;
}

function unreached(evidence, distinction, what) {
	return evidence.interruption
		? blocked(distinction, `not reached: ${what} (run interrupted at ${evidence.interruption.step}: ${evidence.interruption.reason})`)
		: fail(distinction, what);
}

function launched(evidence, distinction, key) {
	const child = evidence.table.children[key];
	const emitted = emittedCall(evidence.ledger, `call_${key.replace("-", "_")}`);
	if (!emitted) return { outcome: unreached(evidence, distinction, `the parent never launched ${key}`) };
	const args = toolCallArguments({ arguments: JSON.stringify(emitted.call.arguments) });
	const end = toolEnd(evidence.parentLog, emitted.call.id);
	if (!end) return { outcome: unreached(evidence, distinction, `no host tool result for ${key}`) };
	if (end.record.isError) return { outcome: fail(distinction, `the host refused to launch ${key}: ${messageText(end.record.result)}`, [`ledger#${emitted.entry.index}`, `rpc#${end.index}`]) };
	const requests = childEntries(evidence.ledger, args.name);
	return { child, args, launch: emitted.entry, end, requests };
}

export function judgeStandalone(evidence) {
	const d = "standalone-role";
	const run = launched(evidence, d, "standalone");
	if (run.outcome) return run.outcome;
	if (run.args.fork !== false || typeof run.args.systemPrompt !== "string") return fail(d, "the launch was not a bare fork:false spawn");
	const [first] = run.requests;
	if (!first) return unreached(evidence, d, "no attributed host-child request for the standalone child");
	const refs = [`ledger#${run.launch.index}`, `rpc#${run.end.index}`, `ledger#${first.index}`];
	const fresh = newInput(first.parsed.turns);
	if (fresh.length !== 1 || fresh[0].role !== "user") return fail(d, `the first child request has ${fresh.length} new turns, expected one user task`, refs);
	const attachment = parseFileAttachment(fresh[0].text);
	if (!attachment) return fail(d, "the new task input is not a file attachment", refs);
	if (!attachment.path.startsWith(`${evidence.artifactsDir}/`)) return fail(d, `the task artifact ${attachment.path} is outside the parent's artifacts`, refs);
	const roleAt = attachment.content.indexOf(run.args.systemPrompt);
	const taskAt = attachment.content.indexOf(run.args.task);
	if (roleAt === -1) return fail(d, "the complete role text is missing from the new task input", refs);
	if (taskAt === -1) return fail(d, "the complete task text is missing from the new task input", refs);
	if (taskAt < roleAt) return fail(d, "the task precedes the role text", refs);
	const inSystem = systemText(first.parsed.turns).includes(run.child.roleMarker);
	return pass(d, `role and task constraints arrive together in the child's first task input${inSystem ? "; the role marker is also in the system prompt" : "; the system prompt does not carry the role"}`, refs);
}

export function judgeFork(evidence) {
	const d = "fork-control";
	const run = launched(evidence, d, "fork");
	if (run.outcome) return run.outcome;
	if (run.args.fork !== true || typeof run.args.systemPrompt !== "string") return fail(d, "the launch was not a fork:true spawn with role text");
	const [first] = run.requests;
	if (!first) return unreached(evidence, d, "no attributed host-child request for the forked child");
	const refs = [`ledger#${run.launch.index}`, `ledger#${first.index}`];
	const inherited = inheritedLength(first.parsed.turns, run.launch.parsed.turns);
	const own = conversation(first.parsed.turns);
	const segment = own.slice(inherited);
	if (inherited === 0) return fail(d, "the child inherited no parent history, so it is not a fork", refs);
	if (segment.some((turn) => turn.text.includes(run.args.systemPrompt) || turn.text.includes(run.child.roleMarker))) {
		return fail(d, "the supplied role reached the new forked task: host contract changed", refs);
	}
	if (segment.length !== 1 || segment[0].role !== "user" || segment[0].text !== run.args.task) {
		return fail(d, `the new task segment after ${inherited} inherited turns is not exactly the task`, refs);
	}
	const earlierRole = own.slice(0, inherited).some((turn) => turn.toolCalls.some((call) => typeof toolCallArguments(call)?.systemPrompt === "string"));
	if (!earlierRole) return fail(d, "inherited history holds no earlier launch role text, so the control cannot expose a whole-request search", refs);
	const anywhere = first.rawBody.includes(run.child.roleMarker);
	return pass(d, `the new task segment after ${inherited} inherited turns omits the supplied role; inherited history keeps earlier launch role text; own role marker ${anywhere ? "present" : "absent"} elsewhere in the request`, refs);
}

export function judgeResources(evidence) {
	const d = "fresh-resources";
	const run = launched(evidence, d, "resources");
	if (run.outcome) return run.outcome;
	const first = run.requests[0];
	if (!first) return unreached(evidence, d, "no attributed host-child request for the resource reader");
	const reads = first.reply?.calls ?? [];
	const refs = [`ledger#${first.index}`];
	const expected = evidence.table.reads;
	if (reads.length !== expected.length || reads.some((call, index) => call.name !== "read" || call.arguments.path !== expected[index])) {
		return fail(d, "the child did not issue one read call per packaged resource", refs);
	}
	for (const path of expected) {
		if (first.parsed.turns.some((turn) => turn.text.includes(evidence.canonical.files[path]))) return fail(d, `${path} content reached the child before it read the file`, refs);
	}
	const receipt = run.requests.find((entry) => entry.index > first.index);
	if (!receipt) return unreached(evidence, d, "no child request carried the read results");
	refs.push(`ledger#${receipt.index}`);
	const results = newInput(receipt.parsed.turns);
	for (const [index, call] of reads.entries()) {
		const turn = results.find((candidate) => candidate.role === "tool" && candidate.toolCallId === call.id);
		if (!turn) return fail(d, `no tool result for ${call.arguments.path}`, refs);
		if (turn.text !== evidence.canonical.files[expected[index]]) return fail(d, `read result for ${call.arguments.path} differs from the packaged file`, refs);
	}
	return pass(d, "a fresh host child read the canonical craft-mode skill, its delegation reference, and the craft-tdd sibling from the candidate, and the next request carried each exact file", refs);
}

function completionOf(evidence, key) {
	const name = evidence.table.children[key].args.name;
	const minted = childEntries(evidence.ledger, name).find((entry) => entry.minted);
	if (!minted) return { problem: `${key} minted no result` };
	const nonce = minted.minted;
	const early = evidence.ledger.find((entry) => entry.index < minted.index && entry.rawBody?.includes(nonce));
	if (early) return { problem: `${key} result appears before it was minted (ledger#${early.index})` };
	if (minted.rawBody.includes(nonce)) return { problem: `${key} result was present in its own minting request` };
	if (evidence.parentSent.some((sent) => JSON.stringify(sent.command).includes(nonce))) return { problem: `the controller sent ${key}'s result` };
	const custom = subagentResult(evidence.parentLog, name);
	if (!custom) return { problem: `no subagent_result reached the parent for ${key}` };
	const text = messageText(custom.record.message);
	if (!text.includes(nonce)) return { problem: `the subagent_result for ${key} does not carry the child's result` };
	const carrier = parentEntries(evidence.ledger).find((entry) => entry.index > minted.index && carries(entry, nonce));
	if (!carrier) return { problem: `no later parent request carried ${key}'s result` };
	if (!inputTexts(newInput(carrier.parsed.turns)).includes(text)) return { problem: `the parent request carrying ${key}'s result does not hold the subagent_result text` };
	return { nonce, minted, custom, carrier };
}

export function judgeCompletion(evidence) {
	const d = "completion";
	const refs = [];
	for (const key of ["standalone", "fork", "resources", "handoff-a", "handoff-b"]) {
		if (!emittedCall(evidence.ledger, `call_${key.replace("-", "_")}`)) return unreached(evidence, d, `${key} was never launched`);
		const result = completionOf(evidence, key);
		if (result.problem) return evidence.interruption && !subagentResult(evidence.parentLog, evidence.table.children[key].args.name) ? unreached(evidence, d, result.problem) : fail(d, result.problem, refs);
		refs.push(`ledger#${result.minted.index}`, `rpc#${result.custom.index}`, `ledger#${result.carrier.index}`);
	}
	return pass(d, "each child result was minted only on its own request, reached the parent through a host subagent_result, and arrived in a later parent request without controller injection", refs);
}

export function judgeHandoff(evidence) {
	const d = "handoff";
	const a = completionOf(evidence, "handoff-a");
	if (a.problem) return emittedCall(evidence.ledger, "call_handoff_a") ? fail(d, a.problem) : unreached(evidence, d, "handoff-a was never launched");
	const refs = [`ledger#${a.minted.index}`, `rpc#${a.custom.index}`, `ledger#${a.carrier.index}`];
	if (parentEntries(evidence.ledger).some((entry) => entry.index < a.carrier.index && entry.rawBody.includes(a.nonce))) return fail(d, "A's result reached the parent before the host delivered it", refs);
	const accept = a.carrier.reply;
	const next = accept?.calls.find((call) => call.name === "subagent");
	if (!accept || accept.text !== `ACCEPTED ${a.nonce}` || !next) return fail(d, "the parent's response to A's result did not accept it and launch B", refs);
	const b = evidence.table.children["handoff-b"];
	if (next.arguments.name !== b.args.name || !next.arguments.task.includes(`Accepted state: ${a.nonce}`)) return fail(d, "the dependent launch does not carry A's accepted value", refs);
	const end = toolEnd(evidence.parentLog, next.id);
	if (!end || end.record.isError) return fail(d, "the host did not launch B from the parent's call", refs);
	const bFirst = childEntries(evidence.ledger, b.args.name)[0];
	if (!bFirst) return unreached(evidence, d, "no attributed request from B");
	refs.push(`rpc#${end.index}`, `ledger#${bFirst.index}`);
	if (bFirst.index < a.carrier.index) return fail(d, "B's request precedes the parent's acceptance", refs);
	if (!tasked(bFirst, `Accepted state: ${a.nonce}`)) return fail(d, "B's task input does not carry the accepted state", refs);
	const bDone = completionOf(evidence, "handoff-b");
	if (bDone.problem) return fail(d, bDone.problem, refs);
	refs.push(`rpc#${bDone.custom.index}`, `ledger#${bDone.carrier.index}`);
	return pass(d, "A's minted value reached the parent only through the host, the parent's own response accepted it and launched B with it, and B's task input carried it", refs);
}

export function judgeSkillsArgument(evidence) {
	const d = "skills-argument";
	const run = launched(evidence, d, "skills");
	if (run.outcome) return run.outcome;
	if (run.args.skills !== "craft-mode" || run.args.fork !== false) return fail(d, "the launch did not use skills:craft-mode with fork:false");
	const expected = evidence.canonical.skills["craft-mode"];
	const task = run.requests.find((entry) => tasked(entry, run.child.taskMarker));
	const custom = subagentResult(evidence.parentLog, run.args.name);
	if (!task) {
		return custom
			? fail(d, `upstream: the host delivered completion (rpc#${custom.index}), and no child request carried the task`)
			: unreached(evidence, d, "no child request carried the task");
	}
	const refs = [`ledger#${run.launch.index}`, `ledger#${task.index}`];
	const retained = task.parsed.turns.some((turn) => {
		const invocation = turn.role === "user" && parseSkillInvocation(turn.text);
		return invocation && !invocationProblem(invocation, expected);
	});
	const carriesSkill = (entry) => entry.index > task.index && entry.parsed && newInput(entry.parsed.turns).some((turn) => parseSkillInvocation(turn.text)?.name === "craft-mode");
	const later =
		run.requests.find(carriesSkill) ??
		evidence.ledger.find((entry) => entry.origin.kind === "unknown" && entry.origin.provenConnection?.subagentName === run.args.name && carriesSkill(entry));
	const derived = custom && task.minted && messageText(custom.record.message).includes(task.minted);
	if (custom) refs.push(`rpc#${custom.index}`);
	if (later) refs.push(`ledger#${later.index}`);
	if (!retained) {
		const sender = later?.origin.kind === "unknown" ? "unattributed at receipt but on the connection proven for this child" : "from the same attributed child";
		const where = later ? `; a later request ledger#${later.index} ${sender} carries the craft-mode block` : "";
		const result = derived ? `; the host's subagent_result rpc#${custom.index} carries the result minted for the task request` : "";
		const streams = later && custom ? "; ledger and RPC indices are separate streams, so this does not order the later request against host completion" : "";
		const order = evidence.launchScripts?.skills ? `; launch prompt arguments ${evidence.launchScripts.skills}` : "";
		return fail(d, `upstream: the actual task request ledger#${task.index} lacks the canonical craft-mode instructions${where}${result}${streams}${order}`, refs);
	}
	if (!custom) return unreached(evidence, d, "no subagent_result for the skills child");
	if (!derived) return fail(d, "upstream: completion does not carry the result derived from the task request", refs);
	return pass(d, "the actual task request retains the canonical craft-mode instructions and completion carries the task-derived result", refs);
}

function soloRequests(evidence, label) {
	return evidence.ledger.filter((entry) => entry.origin.kind === "solo" && entry.origin.label === `solo-${label}`);
}

function soloCommand(solo, name) {
	return solo.commands?.data?.commands?.find((command) => command.name === name) ?? null;
}

function controlOutcomes(evidence) {
	const { solos, canonical } = evidence;
	const craftMode = canonical.skills["craft-mode"];
	const craftTdd = canonical.skills["craft-tdd"];
	const results = {};
	const firstOf = (label) => soloRequests(evidence, label)[0];

	const filtered = solos.filtered;
	const filteredRequests = soloRequests(evidence, "filtered");
	const filteredRead = filteredRequests[1] && newInput(filteredRequests[1].parsed.turns).find((turn) => turn.role === "tool");
	results.filtered =
		!filtered
			? "not run"
			: soloCommand(filtered, "skill:craft-tdd")
				? "craft-tdd is still registered"
				: !filteredRequests[0] || inputTexts(newInput(filteredRequests[0].parsed.turns))[0] !== filtered.message
					? "the filtered command did not reach the provider as raw text"
					: skillDeliveryProblem(filteredRequests[0], craftTdd, filtered.message) !== "new input is not an expanded skill block"
						? "raw text was accepted as canonical delivery"
						: filteredRead?.text !== canonical.files[craftTdd.location]
							? "the filtered file was not readable through the read tool"
							: null;

	const shadowed = solos.shadowed;
	const shadowCommand = shadowed && soloCommand(shadowed, "skill:craft-mode");
	const shadowEntry = firstOf("shadowed");
	const shadowDelivered = shadowEntry && deliveredSkill(shadowEntry);
	results.shadowed =
		!shadowed
			? "not run"
			: shadowCommand?.sourceInfo?.path !== shadowed.shadowPath
				? `the effective craft-mode is ${shadowCommand?.sourceInfo?.path}, not the shadow`
				: shadowDelivered?.invocation?.location !== shadowed.shadowPath || !shadowDelivered.invocation.body.includes(shadowed.shadowBody)
					? "the received block is not the shadow's identity and body"
					: !/^skill location /.test(skillDeliveryProblem(shadowEntry, craftMode, shadowDelivered.invocation.args) ?? "")
						? "the shadow delivery was not rejected by identity"
						: null;

	const decoy = solos.decoy;
	const decoyCommand = decoy && soloCommand(decoy, "skill:craft-tdd");
	const decoyEntry = firstOf("decoy");
	const decoyDelivered = decoyEntry && deliveredSkill(decoyEntry);
	results.decoy =
		!decoy
			? "not run"
			: decoyCommand?.sourceInfo?.source !== decoy.decoyRoot
				? "the decoy package did not register craft-tdd"
				: !/^skill location /.test(skillDeliveryProblem(decoyEntry, craftTdd, decoyDelivered?.invocation?.args ?? "") ?? "")
					? "the same-named decoy skill was not rejected by package identity"
					: null;

	const unknown = solos.unknown;
	const unknownEntry = firstOf("unknown");
	results.unknown =
		!unknown
			? "not run"
			: !unknownEntry || inputTexts(newInput(unknownEntry.parsed.turns))[0] !== unknown.message
				? "the unknown command did not reach the provider as raw text"
				: deliveredSkill(unknownEntry).problem !== "new input is not an expanded skill block"
					? "raw unknown text was treated as a skill block"
					: null;

	const disabled = solos["host-disabled"];
	const disabledEntry = firstOf("host-disabled");
	results["host-disabled"] =
		!disabled
			? "not run"
			: soloCommand(disabled, "subagent")
				? "the subagent command is registered despite the disabled extension"
				: hostPreflight(disabledEntry).kind !== "blocked"
					? "the host preflight did not report blocked"
					: disabledEntry.reply?.calls.length
						? "a launch was attempted without the host"
						: null;
	return results;
}

export function judgeResourceControls(evidence) {
	const d = "resource-controls";
	if (Object.keys(evidence.solos ?? {}).length === 0) return unreached(evidence, d, "no resource control ran");
	const results = controlOutcomes(evidence);
	const problems = Object.entries(results).filter(([, problem]) => problem !== null);
	if (problems.length > 0) {
		const notRun = problems.every(([, problem]) => problem === "not run");
		const text = problems.map(([label, problem]) => `${label}: ${problem}`).join("; ");
		return notRun ? unreached(evidence, d, text) : fail(d, text);
	}
	return pass(
		d,
		"filtered craft-tdd is unregistered and forwarded as raw text yet still readable; the agent-directory shadow and a same-named decoy package win registration and are rejected by identity; unknown slash text is forwarded raw; a host with extensions disabled is reported blocked",
	);
}

function skillNames(entries) {
	return new Set(entries.map((entry) => `skill:${entry}`));
}

export function judgeDiscovery(evidence) {
	const d = "discovery";
	const commands = evidence.commands?.data?.commands;
	if (!commands) return unreached(evidence, d, "the parent never listed its commands");
	const { candidateRoot, hostRoot, pstackRoot, hostSkills, pstackSkills, craftSkills, pstackExtension } = evidence.canonical;
	const names = commands.map((command) => command.name);
	const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
	if (duplicates.length > 0) return fail(d, `duplicate command names: ${duplicates.join(", ")}`);
	const craft = commands.filter((command) => command.name.startsWith("skill:craft-"));
	const craftExpected = [...skillNames(craftSkills.map((skill) => skill.name))].toSorted();
	if (JSON.stringify(craft.map((command) => command.name).toSorted()) !== JSON.stringify(craftExpected)) return fail(d, "the craft-* skill set differs from the inventory");
	for (const skill of craftSkills) {
		const info = commands.find((command) => command.name === `skill:${skill.name}`).sourceInfo;
		if (info.path !== join(candidateRoot, skill.path) || info.source !== candidateRoot || info.origin !== "package" || info.baseDir !== candidateRoot) {
			return fail(d, `skill:${skill.name} is not owned by the candidate: ${info.path}`);
		}
	}
	if (commands.some((command) => command.sourceInfo?.source === candidateRoot && command.source !== "skill")) return fail(d, "the candidate registers a non-skill command");
	for (const [label, root, expected] of [["host", hostRoot, hostSkills], ["pstack", pstackRoot, pstackSkills]]) {
		for (const name of skillNames(expected)) {
			const command = commands.find((entry) => entry.name === name);
			if (!command || command.sourceInfo.source !== root) return fail(d, `${label} skill ${name} is missing or owned elsewhere`);
		}
	}
	const subagent = commands.find((command) => command.name === "subagent");
	if (subagent?.source !== "extension" || subagent.sourceInfo.source !== hostRoot) return fail(d, "the subagent command is not the host's");
	for (const name of ["poteto-mode", "setup-pstack"]) {
		const command = commands.find((entry) => entry.name === name);
		if (command?.source !== "extension" || command.sourceInfo.path !== pstackExtension) return fail(d, `/${name} is not owned by the pstack extension`);
	}
	return pass(
		d,
		`six craft-* skills come only from the candidate; ${hostSkills.length} host and ${pstackSkills.length} pstack skills keep their owners; subagent belongs to the host and poteto-mode/setup-pstack to pstack; no duplicate names among ${names.length} commands`,
	);
}

function windowEntries(evidence, name) {
	const window = evidence.windows[name];
	const start = evidence.steps.find((step) => step.name === name);
	const end = evidence.steps[evidence.steps.indexOf(start) + 1];
	return { window, start, end };
}

export function judgePstackReport(evidence) {
	const d = "pstack-report";
	const { window, start, end } = windowEntries(evidence, "setup report");
	if (!window) return unreached(evidence, d, "/setup-pstack report was not sent");
	if (window.disposition !== "handled") return fail(d, `/setup-pstack report disposition ${window.disposition}, expected handled`);
	const slice = evidence.parentLog.filter((entry) => entry.index >= window.from && (!end || entry.index < end.rpc));
	const report = slice.find((entry) => entry.record?.type === "message_end" && entry.record.message?.customType === "pi-herdr-pstack:setup-report");
	if (!report) return fail(d, "no setup report message reached the parent");
	const text = messageText(report.record.message);
	if (slice.some((entry) => entry.record?.type === "agent_start")) return fail(d, "the report command started a model turn");
	if (end && parentEntries(evidence.ledger).some((entry) => entry.index >= start.ledger && entry.index < end.ledger)) return fail(d, "the report command produced a provider request");
	if (!text.includes(evidence.taskModelConfig.path)) return fail(d, "the report did not read the owned task-model configuration");
	if (!text.trimEnd().endsWith("No changes were made.")) return fail(d, "the report does not state that it made no change");
	if (evidence.taskModelConfig.after !== evidence.taskModelConfig.before) return fail(d, "the owned task-model configuration changed");
	return pass(d, "/setup-pstack report was handled without a model turn or provider request, read only the owned configuration, and left its bytes unchanged", [`rpc#${report.index}`]);
}

export function judgeWriter(evidence) {
	const d = "writer-refusal";
	const emitted = emittedCall(evidence.ledger, "call_writer");
	if (!emitted) {
		const asked = parentEntries(evidence.ledger).find((entry) => entry.reply?.text === "WRITER-NOT-DECLARED");
		return asked ? blocked(d, `${WRITER} was not declared to the parent model`, [`ledger#${asked.index}`]) : unreached(evidence, d, "the writer control never ran");
	}
	const refs = [`ledger#${emitted.entry.index}`];
	const end = toolEnd(evidence.parentLog, "call_writer");
	if (!end) return unreached(evidence, d, "no tool result for the writer call");
	refs.push(`rpc#${end.index}`);
	const text = messageText(end.record.result);
	if (!end.record.isError || !text.startsWith(WRITER_REFUSAL)) return fail(d, `the writer call was not refused by pstack policy: ${text.slice(0, 200)}`, refs);
	const receipt = parentEntries(evidence.ledger).find((entry) => entry.index > emitted.entry.index && newInput(entry.parsed.turns).some((turn) => turn.toolCallId === "call_writer" && turn.text === text));
	if (!receipt) return fail(d, "the refusal did not reach the parent's next request", refs);
	const { window } = windowEntries(evidence, "scenario writer");
	const dialogs = evidence.parentLog.filter((entry) => entry.index >= window.from && entry.index <= window.settled && DIALOG_METHODS.has(entry.record?.method));
	if (dialogs.length > 0) return fail(d, "a dialog opened during the writer attempt", refs);
	if (evidence.taskModelConfig.after !== evidence.taskModelConfig.before) return fail(d, "the owned task-model configuration changed", refs);
	return pass(d, `a well-formed ${WRITER} call outside the setup flow was refused by pstack's writer gate, without a dialog, and the owned configuration bytes are unchanged`, refs);
}

function notifyAfter(evidence, name) {
	const { window, end } = windowEntries(evidence, name);
	if (!window) return null;
	return evidence.parentLog.find((entry) => entry.index >= window.from && (!end || entry.index < end.rpc) && entry.record?.method === "notify") ?? null;
}

export function judgePstackMode(evidence) {
	const d = "pstack-mode";
	const transitions = [
		["mode on", /^poteto-mode on /],
		["mode status on", /^poteto-mode: on /],
		["mode off", /^poteto-mode off\. /],
		["mode status off", /^poteto-mode: off /],
	];
	for (const [name, pattern] of transitions) {
		const { window } = windowEntries(evidence, name);
		if (!window) return unreached(evidence, d, `${name} was not sent`);
		if (window.disposition !== "handled") return fail(d, `${name} disposition ${window.disposition}, expected handled`);
		const notice = notifyAfter(evidence, name);
		if (!notice || !pattern.test(notice.record.message)) return fail(d, `${name} did not report the expected transition`);
	}
	const { start: skillStart, end: skillEnd } = windowEntries(evidence, "mode skill");
	const request = parentEntries(evidence.ledger).find((entry) => entry.index >= skillStart.ledger && entry.index < skillEnd.ledger);
	if (!request) return fail(d, "no parent request for the craft-tdd prompt while the mode was on");
	const refs = [`ledger#${request.index}`];
	const section = MODE_SECTION.exec(systemText(request.parsed.turns))?.[1];
	if (!section) return fail(d, "the pstack mode section is missing from the system prompt", refs);
	const fresh = newInput(request.parsed.turns);
	const craft = fresh.map((turn) => parseSkillInvocation(turn.text)).find((invocation) => invocation?.name === "craft-tdd");
	if (!craft || invocationProblem(craft, evidence.canonical.skills["craft-tdd"]) || craft.args !== evidence.markers.modeSkill) return fail(d, "craft-tdd instructions were not intact beside the mode", refs);
	const hub = request.parsed.turns.map((turn) => parseSkillInvocation(turn.text)).find((invocation) => invocation?.name === "poteto-mode");
	if (!hub || hub.body !== evidence.canonical.pstackHub.body || hub.location !== evidence.canonical.pstackHub.location) return fail(d, "the canonical poteto-mode hub was not supplied", refs);
	const { start: handoffStart, end: handoffEnd } = windowEntries(evidence, "scenario handoff");
	const wakes = parentEntries(evidence.ledger).filter(
		(entry) => entry.index >= handoffStart.ledger && entry.index < handoffEnd.ledger && newInput(entry.parsed.turns).some((turn) => turn.role === "user" && RESULT_HEADER.test(turn.text)),
	);
	if (wakes.length === 0) return fail(d, "no wake request ran while the mode was on", refs);
	const reminded = wakes.filter((entry) => inputTexts(newInput(entry.parsed.turns)).includes(section));
	if (reminded.length !== wakes.length) return fail(d, "a subagent-result wake request lacked the mode reminder", refs);
	refs.push(...reminded.map((entry) => `ledger#${entry.index}`));
	const { start: finalStart, end: finalEnd } = windowEntries(evidence, "scenario final");
	const final = parentEntries(evidence.ledger).find((entry) => entry.index >= finalStart.ledger && (!finalEnd || entry.index < finalEnd.ledger));
	if (!final) return fail(d, "no parent request after the mode was turned off", refs);
	refs.push(`ledger#${final.index}`);
	if (MODE_SECTION.test(systemText(final.parsed.turns)) || inputTexts(newInput(final.parsed.turns)).includes(section)) return fail(d, "mode guidance continued after /poteto-mode off", refs);
	return pass(d, "on, status and off were handled as commands; while on, the prompt carried the mode section, the canonical hub, and intact craft-tdd instructions, and each wake request carried the reminder; after off no guidance was added", refs);
}

const REQUIRED_CHECKS = Object.freeze({
	parent: ["identity", "executable", "rootSender", "noSubagentId", "noRiskyNames"],
	solo: ["identity", "executable", "rootSender", "noSubagentId", "noRiskyNames"],
	"host-child": ["identity", "executable", "subagentId", "subagentName", "herdrSession", "herdrSocket", "pane", "agentDir", "offline", "noRiskyNames"],
});
const DEPARTED_SENDER = new Set(["absent", "exited"]);
const DEPARTED_SOCKET = new Set(["gone", "orphaned"]);

function originProblem(origin, session) {
	if (origin.kind === "unknown") return `unattributed: ${origin.reason}`;
	const required = REQUIRED_CHECKS[origin.kind];
	if (!required) return `unexpected origin kind ${origin.kind}`;
	if (!Array.isArray(origin.riskyNames) || origin.riskyNames.length > 0) return `carries risky variable names ${origin.riskyNames ?? "unrecorded"}`;
	const missing = [...required, ...(origin.basis === "owned-tree" && origin.kind === "host-child" ? ["serverDescendant"] : [])].filter((name) => origin.checks?.[name] !== true);
	if (missing.length > 0) return `${origin.kind} origin lacks passing checks: ${missing.join(", ")}`;
	if (origin.kind === "host-child" && origin.herdrSession !== session) return "from another Herdr session";
	if (origin.basis === "connection") {
		if (!DEPARTED_SENDER.has(origin.disappearance?.sender) || !DEPARTED_SOCKET.has(origin.disappearance?.socket)) return "attributed by connection without confirmed disappearance";
		return null;
	}
	if (origin.basis === "reparented") return origin.kind === "host-child" ? null : `${origin.kind} origin cannot be reparented`;
	return origin.basis === "owned-tree" ? null : `unknown attribution basis ${origin.basis}`;
}

function faultText({ count, samples }) {
	const shown = samples.map((sample) => `${sample.kind} ${JSON.stringify(sample.detail)}`).join(", ");
	return `${count} observations: ${shown}${count > samples.length ? ", …" : ""}`;
}

function outsideTree(entry) {
	const { basis, disappearance } = entry.origin;
	if (basis === "reparented") return `ledger#${entry.index} from a reparented child whose recorded invariants were revalidated`;
	return `ledger#${entry.index} on a connection proven earlier, sender ${disappearance.sender} and client socket ${disappearance.socket}`;
}

export function judgeIsolation(evidence) {
	const d = "isolation";
	const problems = [];
	if (!evidence.faults) problems.push("the evidence has no record of lost observations");
	for (const [label, faults] of Object.entries(evidence.faults ?? {})) {
		if (faults.count > 0) problems.push(`${label} lost ${faultText(faults)}`);
	}
	for (const entry of evidence.ledger) {
		const problem = originProblem(entry.origin, evidence.session);
		if (problem) problems.push(`ledger#${entry.index} ${problem}`);
		else if (entry.refused) problems.push(`ledger#${entry.index} refused: ${entry.refused}`);
		if (entry.auth !== "dummy") problems.push(`ledger#${entry.index} authorization ${entry.auth}`);
	}
	const logs = [["parent", evidence.parentLog, evidence.parentStderr], ...Object.entries(evidence.solos).map(([label, solo]) => [`solo ${label}`, solo.log, solo.stderr])];
	for (const [label, log, stderr] of logs) {
		for (const entry of log) {
			if (entry.malformed !== undefined || entry.overflow || entry.stdinError) problems.push(`${label} rpc#${entry.index} protocol fault`);
			if (entry.record?.type === "extension_error") problems.push(`${label} rpc#${entry.index} extension error: ${entry.record.error}`);
			if (DIALOG_METHODS.has(entry.record?.method)) problems.push(`${label} rpc#${entry.index} dialog ${entry.record.method}`);
		}
		if (stderr) problems.push(`${label} wrote to stderr`);
	}
	if (evidence.herdrState === "tainted") problems.push("a mutating Herdr command timed out or did not close");
	if (problems.length > 0) return fail(d, problems.join("; "));
	if (evidence.ledger.length === 0) return blocked(d, "no request was received, so attribution was not exercised");
	const outside = evidence.ledger.filter((entry) => entry.origin.basis !== "owned-tree").map(outsideTree);
	return pass(
		d,
		`all ${evidence.ledger.length} received requests were attributed to owned processes with the test key and no observation was lost; no dialog, extension error, or protocol fault${outside.length ? `; attributed without owned-tree ancestry: ${outside.join(", ")}` : ""}`,
	);
}

export function judgeTeardown(evidence) {
	const d = "teardown";
	const t = evidence.teardown;
	if (!t) return fail(d, "teardown did not run");
	const exitProblems = Object.entries(t.exits).flatMap(([label, exit]) => {
		if (!exit) return [`${label} close failed`];
		if (exit.closure !== "closed") return [`${label} closure ${exit.closure}`];
		return exit.code === 0 ? [] : [`${label} exited ${exit.code ?? exit.signal}`];
	});
	const problems = [
		...t.survivors.map((identity) => `survivor ${identity.kind} pid ${identity.pid} start ${identity.startTime}`),
		...t.uncertain.map((entry) => `uncertain ${entry.kind ?? entry.label}${entry.pid ? ` pid ${entry.pid}` : ""}: ${entry.reason}`),
		...t.sockets.map((path) => `socket ${path}`),
		...t.forced.map((entry) => `forced ${entry}`),
		...t.errors.map((entry) => `${entry.phase}: ${entry.message}`),
		...(t.providerClosed ? [] : ["provider did not close"]),
		...exitProblems,
		...(t.server?.started && (t.server.exit.closure !== "closed" || t.server.exit.code !== 0 || !t.server.stopCommand?.stopped) ? ["the owned server did not stop cleanly"] : []),
	];
	if (t.kind !== "closed" || problems.length > 0) return fail(d, `teardown ${t.kind} for ${t.root}: ${problems.join("; ") || t.kind}`);
	return pass(d, `${t.identities.length} recorded process identities are confirmed gone, none is uncertain, no owned sockets remain, every direct process closed with exit 0 without escalation, and the provider closed`);
}

const JUDGES = Object.freeze({
	discovery: judgeDiscovery,
	"standalone-role": judgeStandalone,
	"fork-control": judgeFork,
	"fresh-resources": judgeResources,
	completion: judgeCompletion,
	handoff: judgeHandoff,
	"skills-argument": judgeSkillsArgument,
	"resource-controls": judgeResourceControls,
	"pstack-report": judgePstackReport,
	"pstack-mode": judgePstackMode,
	"writer-refusal": judgeWriter,
	isolation: judgeIsolation,
	teardown: judgeTeardown,
});

export function judgeGate(evidence) {
	const outcomes = DISTINCTIONS.map((distinction) => {
		try {
			return JUDGES[distinction](evidence);
		} catch (error) {
			return fail(distinction, `judge could not evaluate the evidence: ${error.message}`);
		}
	});
	return { outcomes, passed: outcomes.every((outcome) => outcome.kind === "pass") };
}

export function blockedGate(reasons) {
	const outcomes = DISTINCTIONS.map((distinction) => blocked(distinction, `prerequisites missing: ${reasons.join("; ")}`));
	return { outcomes, passed: false };
}
