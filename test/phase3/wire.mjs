import { createHash } from "node:crypto";

export function sha256(data) {
	return createHash("sha256").update(data).digest("hex");
}

function contentText(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : "")).join("");
}

function parseToolCall(call) {
	return Object.freeze({
		id: typeof call?.id === "string" ? call.id : null,
		name: typeof call?.function?.name === "string" ? call.function.name : null,
		arguments: typeof call?.function?.arguments === "string" ? call.function.arguments : null,
	});
}

export function parseRequestBody(raw) {
	let body;
	try {
		body = JSON.parse(raw);
	} catch {
		return { kind: "malformed", reason: "body is not JSON" };
	}
	if (body === null || typeof body !== "object" || !Array.isArray(body.messages)) {
		return { kind: "malformed", reason: "body has no messages array" };
	}
	const turns = [];
	for (const message of body.messages) {
		if (typeof message?.role !== "string") return { kind: "malformed", reason: "a message has no role" };
		turns.push(
			Object.freeze({
				role: message.role,
				text: contentText(message.content),
				toolCalls: Object.freeze((Array.isArray(message.tool_calls) ? message.tool_calls : []).map(parseToolCall)),
				toolCallId: typeof message.tool_call_id === "string" ? message.tool_call_id : null,
			}),
		);
	}
	const tools = (Array.isArray(body.tools) ? body.tools : [])
		.map((tool) => tool?.function?.name)
		.filter((name) => typeof name === "string");
	return Object.freeze({
		kind: "parsed",
		model: typeof body.model === "string" ? body.model : null,
		turns: Object.freeze(turns),
		tools: Object.freeze(tools),
	});
}

export function toolCallArguments(call) {
	try {
		const value = JSON.parse(call.arguments ?? "");
		return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
	} catch {
		return null;
	}
}

export function conversation(turns) {
	return turns.filter((turn) => turn.role !== "system");
}

export function systemText(turns) {
	return turns
		.filter((turn) => turn.role === "system")
		.map((turn) => turn.text)
		.join("\n");
}

export function newInput(turns) {
	const rest = conversation(turns);
	const lastAssistant = rest.findLastIndex((turn) => turn.role === "assistant");
	return rest.slice(lastAssistant + 1);
}

export function inputTexts(turns) {
	return turns.filter((turn) => turn.role !== "assistant").map((turn) => turn.text);
}

function sameTurn(a, b) {
	return (
		a.role === b.role &&
		a.text === b.text &&
		a.toolCallId === b.toolCallId &&
		a.toolCalls.length === b.toolCalls.length &&
		a.toolCalls.every(
			(call, index) =>
				call.id === b.toolCalls[index].id &&
				call.name === b.toolCalls[index].name &&
				call.arguments === b.toolCalls[index].arguments,
		)
	);
}

export function inheritedLength(child, ancestor) {
	const own = conversation(child);
	const inherited = conversation(ancestor);
	let length = 0;
	while (length < own.length && length < inherited.length && sameTurn(own[length], inherited[length])) length += 1;
	return length;
}

const SKILL_HEADER = /^<skill name="([^"\n]+)" location="([^"\n]+)">\nReferences are relative to ([^\n]+)\.\n\n/;
const SKILL_CLOSE = "\n</skill>";

export function parseSkillInvocation(text) {
	const header = SKILL_HEADER.exec(text);
	if (!header) return null;
	const start = header[0].length;
	const close = text.indexOf(SKILL_CLOSE, start);
	if (close === -1) return null;
	const after = text.slice(close + SKILL_CLOSE.length);
	if (after !== "" && !after.startsWith("\n\n")) return null;
	return Object.freeze({
		name: header[1],
		location: header[2],
		baseDir: header[3],
		body: text.slice(start, close),
		args: after.slice(2),
	});
}

export function skillBody(fileText) {
	const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(fileText);
	return (match ? fileText.slice(match[0].length) : fileText).trim();
}

export function skillBlock({ name, location, baseDir, body }) {
	return `<skill name="${name}" location="${location}">\nReferences are relative to ${baseDir}.\n\n${body}${SKILL_CLOSE}`;
}

const FILE_HEADER = /^<file name="([^"\n]+)">\n/;
const FILE_CLOSE = "\n</file>\n";

export function parseFileAttachment(text) {
	const header = FILE_HEADER.exec(text);
	if (!header || !text.endsWith(FILE_CLOSE)) return null;
	return Object.freeze({ path: header[1], content: text.slice(header[0].length, -FILE_CLOSE.length) });
}

function chunk(model, delta, finish) {
	return { id: "craft-test", object: "chat.completion.chunk", created: 0, model, choices: [{ index: 0, delta, finish_reason: finish }] };
}

export function sseFrames(reply, model) {
	const chunks = [];
	if (reply.text) chunks.push(chunk(model, { role: "assistant", content: reply.text }, null));
	reply.calls.forEach((call, index) => {
		chunks.push(
			chunk(model, { tool_calls: [{ index, id: call.id, type: "function", function: { name: call.name, arguments: "" } }] }, null),
			chunk(model, { tool_calls: [{ index, function: { arguments: JSON.stringify(call.arguments) } }] }, null),
		);
	});
	chunks.push(chunk(model, {}, reply.calls.length > 0 ? "tool_calls" : "stop"));
	chunks.push({ id: "craft-test", object: "chat.completion.chunk", created: 0, model, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
	return `${chunks.map((entry) => `data: ${JSON.stringify(entry)}\n\n`).join("")}data: [DONE]\n\n`;
}

export function textReply(text) {
	return Object.freeze({ text, calls: Object.freeze([]) });
}

export function toolReply(text, calls) {
	return Object.freeze({ text, calls: Object.freeze(calls.map((call) => Object.freeze(call))) });
}
