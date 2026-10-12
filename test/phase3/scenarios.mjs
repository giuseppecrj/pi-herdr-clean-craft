import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { MODEL_REF } from "./agent-config.mjs";
import { newInput, textReply, toolReply } from "./wire.mjs";

const SCENARIO_PREFIX = "scenario:";
const NONCE_PATTERN = /RESULT (C3N-[0-9a-f]{32})/;
const RESULT_HEADER = /^Sub-agent "([^"]+)" completed/;

function marker(label) {
	return `${label}-${randomBytes(6).toString("hex")}`;
}

function role(roleMarker, purpose) {
	return [
		`Role marker ${roleMarker}.`,
		`You are a bounded leaf worker for a scripted clean-craft integration check: ${purpose}`,
		"Stay read-only. Create, edit, or delete nothing and run no state-changing command.",
		"Do not launch, resume, message, or cancel any other agent.",
		"Reply with one short line, then stop.",
	].join("\n");
}

export function createScenarioTable({ candidateRoot, cwd }) {
	const tag = randomBytes(3).toString("hex");
	const reads = [join(candidateRoot, "skills/craft-mode/SKILL.md"), join(candidateRoot, "skills/craft-mode/references/delegation.md"), join(candidateRoot, "skills/craft-tdd/SKILL.md")];
	const child = (key, { fork, purpose, task, skills }) => {
		const roleMarker = marker("ROLE");
		const taskMarker = marker("TASK");
		const args = {
			name: `craft3-${key}-${tag}`,
			task: `Task marker ${taskMarker}.\n${task}`,
			systemPrompt: role(roleMarker, purpose),
			fork,
			model: MODEL_REF,
			thinking: "off",
			cwd,
			...(skills ? { skills } : {}),
		};
		return Object.freeze({ key, roleMarker, taskMarker, args: Object.freeze(args) });
	};
	const children = [
		child("standalone", { fork: false, purpose: "confirm a standalone brief.", task: "Confirm receipt of this task in one line. Make no tool calls." }),
		child("fork", { fork: true, purpose: "confirm a forked task.", task: "Confirm receipt of this forked task in one line. Make no tool calls." }),
		child("resources", {
			fork: false,
			purpose: "read packaged skill files.",
			task: ["Read each of these files with the read tool, then reply with one line.", ...reads.map((path) => `READ ${path}`)].join("\n"),
		}),
		child("handoff-a", { fork: false, purpose: "produce a value for a dependent step.", task: "Produce one result value in one line. Make no tool calls." }),
		child("handoff-b", { fork: false, purpose: "continue from accepted state.", task: "Confirm the accepted state in one line. Make no tool calls." }),
		child("skills", {
			fork: false,
			skills: "craft-mode",
			purpose: "confirm a task that loads a skill at startup.",
			task: "Confirm receipt of this task in one line. Make no tool calls.",
		}),
	];
	return Object.freeze({
		tag,
		reads: Object.freeze(reads),
		children: Object.freeze(Object.fromEntries(children.map((entry) => [entry.key, entry]))),
		byName: (name) => children.find((entry) => entry.args.name === name) ?? null,
	});
}

export function writerPayload(revision) {
	return Object.freeze({
		tasks: { coding: [MODEL_REF] },
		tasksMeta: { generatedAt: "2026-10-10T00:00:00.000Z", method: "registry-only" },
		expectedConfigRevision: revision,
		basis: { kind: "registry-only" },
	});
}

function call(id, name, args) {
	return { id, name, arguments: args };
}

function launchedBy(request) {
	const conversation = request.turns.filter((turn) => turn.role !== "system");
	const assistant = conversation.findLast((turn) => turn.role === "assistant");
	return new Map((assistant?.toolCalls ?? []).map((entry) => [entry.id, entry.name]));
}

export function parentReply(request, { table, writer }) {
	const fresh = newInput(request.turns);
	const results = fresh.filter((turn) => turn.role === "tool");
	if (results.length > 0) {
		const names = launchedBy(request);
		return { reply: textReply(`TOOL-RESULTS ${results.map((turn) => names.get(turn.toolCallId) ?? "unknown").join(",")}`) };
	}
	const result = fresh.map((turn) => RESULT_HEADER.exec(turn.text)).find(Boolean);
	if (result) {
		const finished = table.byName(result[1]);
		if (!finished) return { refusal: `result from unknown child ${result[1]}` };
		if (finished.key !== "handoff-a") return { reply: textReply(`ACK ${finished.key}`) };
		const carrier = fresh.find((turn) => RESULT_HEADER.test(turn.text));
		const value = NONCE_PATTERN.exec(carrier.text)?.[1];
		if (!value) return { reply: textReply("REJECTED handoff-a: no result value") };
		const next = table.children["handoff-b"];
		const args = { ...next.args, task: `${next.args.task}\nAccepted state: ${value}` };
		return { reply: toolReply(`ACCEPTED ${value}`, [call("call_handoff_b", "subagent", args)]) };
	}
	const prompt = fresh.find((turn) => turn.role === "user" && turn.text.startsWith(SCENARIO_PREFIX));
	if (prompt) {
		const key = prompt.text.slice(SCENARIO_PREFIX.length);
		if (key === "final") return { reply: textReply("ACK final") };
		if (key === "writer") {
			if (!request.tools.includes("subagents_write_task_models")) return { reply: textReply("WRITER-NOT-DECLARED") };
			return { reply: toolReply("", [call("call_writer", "subagents_write_task_models", writer)]) };
		}
		const launch = key === "handoff" ? table.children["handoff-a"] : table.children[key];
		if (!launch) return { refusal: `unknown scenario ${key}` };
		if (!request.tools.includes("subagent")) return { reply: textReply("HOST-NOT-DECLARED") };
		return { reply: toolReply("", [call(`call_${launch.key.replace("-", "_")}`, "subagent", launch.args)]) };
	}
	if (fresh.some((turn) => turn.role === "user" && turn.text.startsWith("<skill name="))) return { reply: textReply("ACK skill") };
	return { refusal: "unscripted parent input" };
}

export function childReply(entry, request, mint) {
	const fresh = newInput(request.turns);
	if (entry.key === "resources" && fresh.length > 0 && fresh.every((turn) => turn.role === "tool")) {
		return { reply: textReply(`RESULT ${mint()}`) };
	}
	const tasked = fresh.some((turn) => turn.role !== "assistant" && turn.text.includes(entry.taskMarker));
	if (!tasked) return { reply: textReply("STARTUP-ACK") };
	if (entry.key !== "resources") return { reply: textReply(`RESULT ${mint()}`) };
	const paths = fresh.flatMap((turn) => [...turn.text.matchAll(/^READ (\/\S+)$/gm)].map((match) => match[1]));
	return {
		reply: toolReply(
			"",
			paths.map((path, index) => call(`call_read_${index}`, "read", { path })),
		),
	};
}

export function soloReply(label, request, context) {
	if (label === "host-disabled") return parentReply(request, context);
	const fresh = newInput(request.turns);
	if (fresh.length > 0 && fresh.every((turn) => turn.role === "tool")) return { reply: textReply("SOLO-ACK") };
	const path = fresh.flatMap((turn) => [...turn.text.matchAll(/ READ (\/\S+)$/gm)].map((match) => match[1]))[0];
	if (label === "filtered" && path) return { reply: toolReply("", [call("call_filtered_read", "read", { path })]) };
	return { reply: textReply("SOLO-ACK") };
}
