import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ContextEvent, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext, parseFrontmatter, stripFrontmatter } from "@earendil-works/pi-coding-agent";

type Message = ContextEvent["messages"][number];
type BranchEntry = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>[number];

const COMMAND = "craft-mode";
const COMMAND_COPY = /^craft-mode(?::\d+)?$/;
const SKILL_COMMAND = "skill:craft-mode";
const SKILL_NAME = "craft-mode";
const RECORD_TYPE = "clean-craft-mode";
const RECORD_VERSION = 1;
const HUB_CARRIER = "clean-craft-mode-hub";
const REMINDER_CARRIER = "clean-craft-mode-reminder";
const REMINDER_LIMIT = 600;
const CANONICAL_HUB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills", "craft-mode", "SKILL.md");

type Desired = "on" | "off";

type ActivationRecord = { readonly version: typeof RECORD_VERSION; readonly desired: Desired; readonly issuedBy: string };

type ParsedRecord = { readonly kind: "valid"; readonly record: ActivationRecord } | { readonly kind: "invalid"; readonly reason: string };

type Activation =
	| { readonly kind: "on"; readonly issuedBy: string }
	| { readonly kind: "off"; readonly recorded: boolean }
	| { readonly kind: "inherited-only"; readonly issuedBy: string }
	| { readonly kind: "invalid"; readonly reason: string };

type Owner = { readonly sessionId: string; readonly delegated: boolean };

type Resource = { readonly kind: "ready"; readonly location: string; readonly envelope: string } | { readonly kind: "blocked"; readonly reason: string };

type Presence = { readonly kind: "missing" } | { readonly kind: "present"; readonly copies: number };

type CommandCopies = { readonly kind: "single" } | { readonly kind: "ambiguous"; readonly names: readonly string[] };

type Command =
	| { readonly kind: "status" }
	| { readonly kind: "set"; readonly desired: Desired }
	| { readonly kind: "task"; readonly text: string }
	| { readonly kind: "invalid"; readonly reason: string };

const USAGE = "Usage: /craft-mode [status] | /craft-mode on | /craft-mode off | /craft-mode <task> | /craft-mode -- <task starting with a reserved word>";

function parseCommand(args: string): Command {
	const text = args.trim();
	if (text === "") return { kind: "status" };
	const [head = "", ...rest] = text.split(/\s+/);
	const word = head.toLowerCase();
	if (word === "--") {
		const literal = text.slice(head.length).trim();
		return literal === "" ? { kind: "invalid", reason: "-- needs task text after it" } : { kind: "task", text: literal };
	}
	if (word !== "status" && word !== "on" && word !== "off") return { kind: "task", text };
	if (rest.length > 0) return { kind: "invalid", reason: `${word} takes no arguments; use /craft-mode -- ${text} to submit it as a task` };
	return word === "status" ? { kind: "status" } : { kind: "set", desired: word };
}

function parseRecord(data: unknown): ParsedRecord {
	if (typeof data !== "object" || data === null || Array.isArray(data) || !("version" in data)) return { kind: "invalid", reason: "an activation record is malformed" };
	const { version } = data;
	if (typeof version === "number" && Number.isInteger(version) && version > RECORD_VERSION) {
		return { kind: "invalid", reason: `an activation record has version ${version}, newer than this extension understands` };
	}
	if (version !== RECORD_VERSION || !("desired" in data) || !("issuedBy" in data)) return { kind: "invalid", reason: "an activation record is malformed" };
	const { desired, issuedBy } = data;
	if (desired !== "on" && desired !== "off") return { kind: "invalid", reason: "an activation record has no valid on/off intent" };
	if (typeof issuedBy !== "string" || issuedBy === "") return { kind: "invalid", reason: "an activation record has no owning session" };
	return { kind: "valid", record: { version: RECORD_VERSION, desired, issuedBy } };
}

function ownerOf(ctx: ExtensionContext): Owner {
	return { sessionId: ctx.sessionManager.getSessionId(), delegated: (process.env.PI_SUBAGENT_ID ?? "") !== "" };
}

function reduceActivation(branch: readonly BranchEntry[], owner: Owner): Activation {
	let foreign: string | null = null;
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry?.type !== "custom" || entry.customType !== RECORD_TYPE) continue;
		const parsed = parseRecord(entry.data);
		if (parsed.kind === "invalid") return { kind: "invalid", reason: parsed.reason };
		const { record } = parsed;
		if (owner.delegated && record.issuedBy !== owner.sessionId) {
			foreign ??= record.issuedBy;
			continue;
		}
		return record.desired === "on" ? { kind: "on", issuedBy: record.issuedBy } : { kind: "off", recorded: true };
	}
	return foreign === null ? { kind: "off", recorded: false } : { kind: "inherited-only", issuedBy: foreign };
}

function activationOf(ctx: ExtensionContext): Activation {
	return reduceActivation(ctx.sessionManager.getBranch(), ownerOf(ctx));
}

function commandCopies(pi: ExtensionAPI): CommandCopies {
	const names = pi
		.getCommands()
		.filter((command) => command.source === "extension" && COMMAND_COPY.test(command.name))
		.map((command) => command.name);
	return names.length === 1 ? { kind: "single" } : { kind: "ambiguous", names };
}

function canonicalPath(path: string): string | null {
	try {
		return realpathSync(path);
	} catch {
		return null;
	}
}

function readText(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

function hubEnvelope(location: string, text: string): Resource {
	let frontmatter: Record<string, unknown>;
	try {
		frontmatter = parseFrontmatter(text).frontmatter;
	} catch {
		return { kind: "blocked", reason: `the hub at ${location} has malformed frontmatter` };
	}
	if (frontmatter.name !== SKILL_NAME) return { kind: "blocked", reason: `the hub at ${location} is not named ${SKILL_NAME}` };
	if (frontmatter["disable-model-invocation"] !== true) return { kind: "blocked", reason: `the hub at ${location} is not explicit-only` };
	const body = stripFrontmatter(text).trim();
	return { kind: "ready", location, envelope: `<skill name="${SKILL_NAME}" location="${location}">\nReferences are relative to ${dirname(location)}.\n\n${body}\n</skill>` };
}

function resolveHub(pi: ExtensionAPI): Resource {
	const registered = pi.getCommands().filter((command) => command.source === "skill" && command.name === SKILL_COMMAND);
	if (registered.length === 0) return { kind: "blocked", reason: `${SKILL_COMMAND} is not registered; the skill is missing, malformed, or filtered out` };
	const [registration] = registered;
	if (registered.length > 1 || registration === undefined) return { kind: "blocked", reason: `${SKILL_COMMAND} is registered more than once` };
	const location = registration.sourceInfo.path;
	const canonical = canonicalPath(CANONICAL_HUB);
	if (canonical === null) return { kind: "blocked", reason: `this package's hub is missing at ${CANONICAL_HUB}` };
	const actual = canonicalPath(location);
	if (actual === null) return { kind: "blocked", reason: `the registered hub at ${location} is unreadable` };
	if (actual !== canonical) return { kind: "blocked", reason: `${SKILL_COMMAND} resolves to ${location}, not this package's hub; another skill shadows it` };
	// A link to the hub file from another directory changes where its references resolve.
	if (canonicalPath(dirname(location)) !== canonicalPath(dirname(CANONICAL_HUB))) {
		return { kind: "blocked", reason: `${SKILL_COMMAND} is registered from ${location}, a link outside this package's skill directory, so its references would not resolve` };
	}
	const text = readText(location);
	return text === null ? { kind: "blocked", reason: `the registered hub at ${location} is unreadable` } : hubEnvelope(location, text);
}

function firstText(message: Message): string | null {
	if (message.role !== "user") return null;
	const { content } = message;
	if (typeof content === "string") return content;
	const part = content[0];
	return part?.type === "text" ? part.text : null;
}

function hubPresence(messages: readonly Message[], envelope: string): Presence {
	const copies = messages.filter((message) => {
		const text = firstText(message);
		return text !== null && (text === envelope || text.startsWith(`${envelope}\n\n`));
	}).length;
	return copies === 0 ? { kind: "missing" } : { kind: "present", copies };
}

function isOwnCarrier(message: Message): boolean {
	return message.role === "custom" && (message.customType === HUB_CARRIER || message.customType === REMINDER_CARRIER);
}

function carrier(customType: string, text: string): Message {
	return { role: "custom", customType, content: [{ type: "text", text }], display: false, timestamp: Date.now() };
}

function bounded(text: string): string {
	return text.length <= REMINDER_LIMIT ? text : `${text.slice(0, REMINDER_LIMIT - 1)}…`;
}

const READY_REMINDER = [
	"<craft-mode-reminder>",
	"Craft mode is on for this session branch. Coordinate this request with the craft-mode hub instructions in this conversation.",
	"This reminder grants no permission beyond what the user and the hub's authorization rules allow.",
	"If another methodology mode is also active, keep the current coordinator and ask the user which one should coordinate; do not merge or switch silently.",
	"The user can stop this with /craft-mode off.",
	"</craft-mode-reminder>",
].join("\n");

function blockedReminder(reason: string): string {
	const frame = (detail: string) =>
		`<craft-mode-reminder>\nCraft mode is saved on for this session branch, but its canonical hub is unavailable: ${detail}\nDo not substitute another copy or claim to follow craft mode. Ask the user to run /craft-mode status.\n</craft-mode-reminder>`;
	const room = REMINDER_LIMIT - frame("").length;
	return frame(reason.length <= room ? reason : `${reason.slice(0, room - 1)}…`);
}

function guidance(pi: ExtensionAPI, ctx: ExtensionContext, messages: readonly Message[]): Message[] {
	if (activationOf(ctx).kind !== "on" || commandCopies(pi).kind === "ambiguous") return [];
	const resource = resolveHub(pi);
	if (resource.kind === "blocked") return [carrier(REMINDER_CARRIER, blockedReminder(resource.reason))];
	const reminder = carrier(REMINDER_CARRIER, bounded(READY_REMINDER));
	return hubPresence(messages, resource.envelope).kind === "missing" ? [carrier(HUB_CARRIER, resource.envelope), reminder] : [reminder];
}

function describeActivation(activation: Activation): string {
	switch (activation.kind) {
		case "on":
			return `on (recorded by session ${activation.issuedBy})`;
		case "off":
			return activation.recorded ? "off (recorded)" : "off (never enabled on this branch)";
		case "inherited-only":
			return `off here: only records copied from session ${activation.issuedBy} exist, and a delegated child ignores them`;
		case "invalid":
			return `blocked: ${activation.reason}; earlier records are not revived`;
		default: {
			const _exhaustive: never = activation;
			return _exhaustive;
		}
	}
}

function describeEffect(activation: Activation, copies: CommandCopies, resource: Resource): string {
	if (activation.kind !== "on") return "no guidance is added";
	if (copies.kind === "ambiguous") return "no guidance is added while the command is ambiguous";
	if (resource.kind === "blocked") return "only a blocked notice is added; the hub is not delivered";
	return "the next request gets the hub when absent and one reminder";
}

// Other extensions' mode commands are visible; their state is not, so status names them without judging them.
function otherModes(pi: ExtensionAPI): string {
	const names = pi
		.getCommands()
		.filter((command) => command.source === "extension" && command.name.endsWith("-mode") && !COMMAND_COPY.test(command.name))
		.map((command) => `/${command.name}`);
	return names.length === 0
		? "Other modes: none visible."
		: `Other modes: ${names.join(", ")} also loaded. Their state is not read or changed here; if one is on too, the reminder asks the model to have you choose which coordinates.`;
}

function statusReport(pi: ExtensionAPI, ctx: ExtensionContext): string {
	const activation = activationOf(ctx);
	const owner = ownerOf(ctx);
	const copies = commandCopies(pi);
	const resource = resolveHub(pi);
	return [
		`Craft mode: ${describeActivation(activation)}.`,
		`Effective: ${describeEffect(activation, copies, resource)}.`,
		resource.kind === "ready" ? `Hub: ${resource.location}` : `Hub blocked: ${resource.reason}`,
		owner.delegated
			? `Ownership: delegated child (PI_SUBAGENT_ID set); only records from this session ${owner.sessionId} apply.`
			: `Ownership: session ${owner.sessionId}; every record on this branch applies, including ones copied by a fork.`,
		copies.kind === "ambiguous" ? `Command: ambiguous, loaded as ${copies.names.join(", ")}; on and tasks are refused.` : "Command: one copy loaded.",
		otherModes(pi),
		"Status reads saved state; it does not show what a provider received.",
	].join("\n");
}

function onRefusal(pi: ExtensionAPI): string | null {
	const copies = commandCopies(pi);
	if (copies.kind === "ambiguous") return `/craft-mode is loaded more than once (${copies.names.join(", ")}); remove the duplicate package before enabling it`;
	const resource = resolveHub(pi);
	return resource.kind === "blocked" ? `cannot enable craft mode: ${resource.reason}` : null;
}

function taskRefusal(pi: ExtensionAPI, ctx: ExtensionCommandContext): string | null {
	if (!ctx.isIdle()) return "a run is active; wait for it to finish, then submit the task (use /craft-mode on to enable without a task)";
	if (ctx.hasPendingMessages()) return "queued messages are pending; submit the task after they are handled";
	if (ctx.model === undefined) return "no model is selected";
	return onRefusal(pi);
}

function record(pi: ExtensionAPI, ctx: ExtensionContext, desired: Desired): void {
	const data: ActivationRecord = { version: RECORD_VERSION, desired, issuedBy: ownerOf(ctx).sessionId };
	pi.appendEntry(RECORD_TYPE, data);
}

function setMode(pi: ExtensionAPI, ctx: ExtensionCommandContext, desired: Desired): void {
	const activation = activationOf(ctx);
	if (activation.kind === desired) {
		ctx.ui.notify(`Craft mode is already ${desired} for this branch.`, "info");
		return;
	}
	if (desired === "on") {
		const refusal = onRefusal(pi);
		if (refusal !== null) {
			ctx.ui.notify(refusal, "error");
			return;
		}
	}
	record(pi, ctx, desired);
	ctx.ui.notify(
		desired === "on" ? "Craft mode is on for this branch from the next request. No task was started." : "Craft mode is off from the next request. Instructions already in the conversation stay there.",
		"info",
	);
}

function submitTask(pi: ExtensionAPI, ctx: ExtensionCommandContext, text: string): void {
	const refusal = taskRefusal(pi, ctx);
	if (refusal !== null) {
		ctx.ui.notify(`Task not submitted: ${refusal}.`, "error");
		return;
	}
	if (activationOf(ctx).kind !== "on") record(pi, ctx, "on");
	pi.sendUserMessage(text, { expandPromptTemplates: false });
	ctx.ui.notify("Craft mode is on and the task was submitted once. Submission does not confirm that a model run started.", "info");
}

export default function cleanCraft(pi: ExtensionAPI): void {
	pi.registerCommand(COMMAND, {
		description: "Keep craft-mode guidance on for this session branch: status, on, off, or a task to start with it on",
		handler: async (args, ctx) => {
			const command = parseCommand(args);
			switch (command.kind) {
				case "status":
					ctx.ui.notify(statusReport(pi, ctx), "info");
					return;
				case "set":
					setMode(pi, ctx, command.desired);
					return;
				case "task":
					submitTask(pi, ctx, command.text);
					return;
				case "invalid":
					ctx.ui.notify(`${command.reason}. ${USAGE}`, "error");
					return;
				default: {
					const _exhaustive: never = command;
					return _exhaustive;
				}
			}
		},
	});

	pi.on("input", (event, ctx) => {
		if (event.source === "extension" || !/^\/craft-mode(?:\s|$)/.test(event.text)) return undefined;
		const copies = commandCopies(pi);
		if (copies.kind === "single") return undefined;
		ctx.ui.notify(`/craft-mode is ambiguous (${copies.names.join(", ")}); the input was not sent to the model. Remove the duplicate package.`, "error");
		return { action: "handled" };
	});

	pi.on("context", (event, ctx) => {
		const kept = event.messages.filter((message) => !isOwnCarrier(message));
		const additions = guidance(pi, ctx, kept);
		if (additions.length === 0 && kept.length === event.messages.length) return undefined;
		return { messages: [...kept, ...additions] };
	});
}
