import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	blockedGate,
	DISTINCTIONS,
	expectedSkill,
	hostPreflight,
	judgeCompletion,
	judgeDiscovery,
	judgeFork,
	judgeGate,
	judgeHandoff,
	judgeIsolation,
	judgeResources,
	judgeSkillsArgument,
	judgeStandalone,
	judgeTeardown,
} from "./phase3/evidence.mjs";
import { locatePrerequisites, resolveExecutable } from "./phase3/prerequisites.mjs";
import { EXTENSIONS, SKILLS } from "./inventory.mjs";
import { createScenarioTable } from "./phase3/scenarios.mjs";
import { parseRequestBody, skillBlock, textReply, toolReply } from "./phase3/wire.mjs";
import { makeTempRoot, PACKAGE_ROOT } from "./support.mjs";

const CANDIDATE = "/owned/candidate";
const ARTIFACTS = "/owned/sessions/artifacts/session";
const PARENT = Object.freeze({ kind: "parent", label: "parent" });
const NONCES = [
	"C3N-00000000000000000000000000000001",
	"C3N-00000000000000000000000000000002",
	"C3N-00000000000000000000000000000003",
	"C3N-00000000000000000000000000000004",
	"C3N-00000000000000000000000000000005",
];

function child(name, detached = false) {
	return { kind: "host-child", subagentName: name, herdrSession: "owned", detached };
}

function user(text) {
	return { role: "user", content: [{ type: "text", text }] };
}

function assistant(text, calls = []) {
	const toolCalls = calls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }));
	return { role: "assistant", content: text === "" ? null : text, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) };
}

function tool(id, text) {
	return { role: "tool", tool_call_id: id, content: text };
}

function request(origin, messages, { reply = textReply("ok"), minted = null, tools = ["read", "subagent"] } = {}) {
	const rawBody = JSON.stringify({
		model: "fixture",
		messages: [{ role: "system", content: "system prompt" }, ...messages],
		tools: tools.map((name) => ({ type: "function", function: { name } })),
	});
	return { origin, auth: "dummy", rawBody, parsed: parseRequestBody(rawBody), refused: null, reply, minted };
}

function artifact(args) {
	return `<file name="${ARTIFACTS}/context/${args.name}.md">\n\n\n${args.systemPrompt}\n\nComplete your task autonomously.\n\n${args.task}\n\nYour FINAL assistant message should summarize what you accomplished.\n</file>\n`;
}

function launchId(key) {
	return `call_${key.replace("-", "_")}`;
}

function resultText(name, value) {
	return `Sub-agent "${name}" completed (0s).\n\n${value}\n\nRequested model: craft-test/fixture`;
}

function recorder() {
	const ledger = [];
	const parentLog = [];
	return {
		ledger,
		parentLog,
		push(entry) {
			ledger.push({ index: ledger.length, ...entry });
			return ledger.at(-1);
		},
		launched(id, isError = false) {
			parentLog.push({ index: parentLog.length, record: { type: "tool_execution_end", toolCallId: id, isError, result: { content: [{ type: "text", text: isError ? "Error" : "launched" }] } } });
		},
		result(name, text) {
			parentLog.push({ index: parentLog.length, record: { type: "message_end", message: { role: "custom", customType: "subagent_result", content: text, details: { name } } } });
		},
	};
}

function baseEvidence(table, record, extra = {}) {
	return { table, ledger: record.ledger, parentLog: record.parentLog, parentSent: [], artifactsDir: ARTIFACTS, interruption: null, ...extra };
}

function launch(record, table, key, args = table.children[key].args) {
	record.push(request(PARENT, [user(`scenario:${key}`)], { reply: toolReply("", [{ id: launchId(key), name: "subagent", arguments: args }]) }));
	record.launched(launchId(key));
}

describe("standalone role evidence", () => {
	function evidence(content) {
		const table = createScenarioTable({ candidateRoot: CANDIDATE, cwd: "/owned/work" });
		const record = recorder();
		launch(record, table, "standalone");
		const args = table.children.standalone.args;
		record.push(request(child(args.name), [user(content(args))]));
		return baseEvidence(table, record);
	}

	it("passes the measured artifact carrying role and task", () => {
		assert.equal(judgeStandalone(evidence(artifact)).kind, "pass");
	});

	it("fails a new task input that lacks the role text", () => {
		const outcome = judgeStandalone(evidence((args) => artifact({ ...args, systemPrompt: "" })));
		assert.deepEqual([outcome.kind, outcome.reason], ["fail", "the complete role text is missing from the new task input"]);
	});

	it("fails a task artifact outside the parent's artifacts", () => {
		const outcome = judgeStandalone(evidence((args) => artifact(args).replace(ARTIFACTS, "/elsewhere")));
		assert.match(outcome.reason, /outside the parent's artifacts/);
	});

	it("fails a new task input that is not the host's task artifact", () => {
		const outcome = judgeStandalone(evidence((args) => `${args.task}`));
		assert.equal(outcome.reason, "the new task input is not a file attachment");
	});

	it("reports a missing child request as blocked only when the run was interrupted", () => {
		const table = createScenarioTable({ candidateRoot: CANDIDATE, cwd: "/owned/work" });
		const record = recorder();
		launch(record, table, "standalone");
		assert.equal(judgeStandalone(baseEvidence(table, record)).kind, "fail");
		assert.equal(judgeStandalone(baseEvidence(table, record, { interruption: { step: "standalone completion", reason: "deadline" } })).kind, "blocked");
	});
});

describe("fork control evidence", () => {
	function evidence({ inherit = true, extra = () => [], segment }) {
		const table = createScenarioTable({ candidateRoot: CANDIDATE, cwd: "/owned/work" });
		const standalone = table.children.standalone.args;
		const fork = table.children.fork;
		const history = [
			user("scenario:standalone"),
			assistant("", [{ id: "call_standalone", name: "subagent", arguments: standalone }]),
			tool("call_standalone", "launched"),
			assistant("ACK standalone"),
			...extra(fork.args),
		];
		const record = recorder();
		record.push(request(PARENT, [...history, user("scenario:fork")], { reply: toolReply("", [{ id: "call_fork", name: "subagent", arguments: fork.args }]) }));
		record.launched("call_fork");
		record.push(request(child(fork.args.name), [...(inherit ? history : []), ...segment(fork.args)]));
		return baseEvidence(table, record);
	}

	it("passes a forked task segment without the supplied role", () => {
		assert.equal(judgeFork(evidence({ segment: (args) => [user(args.task)] })).kind, "pass");
	});

	it("fails when the supplied role reaches the new forked task", () => {
		const outcome = judgeFork(evidence({ segment: (args) => [user(`${args.systemPrompt}\n\n${args.task}`)] }));
		assert.equal(outcome.reason, "the supplied role reached the new forked task: host contract changed");
	});

	it("judges the new task segment, not a whole request whose history holds the fork's own role", () => {
		const built = evidence({
			extra: (args) => [assistant("", [{ id: "call_prior", name: "subagent", arguments: { name: "prior", task: "t", systemPrompt: args.systemPrompt } }]), tool("call_prior", "launched")],
			segment: (args) => [user(args.task)],
		});
		assert.ok(built.ledger.at(-1).rawBody.includes(built.table.children.fork.roleMarker), "a whole-request search would find the role");
		assert.equal(judgeFork(built).kind, "pass");
	});

	it("fails a child that inherited no history", () => {
		assert.equal(judgeFork(evidence({ inherit: false, segment: (args) => [user(args.task)] })).reason, "the child inherited no parent history, so it is not a fork");
	});
});

describe("fresh resource evidence", () => {
	function evidence({ result = (text) => text, paths = (reads) => reads, leak = false } = {}) {
		const table = createScenarioTable({ candidateRoot: CANDIDATE, cwd: "/owned/work" });
		const files = Object.fromEntries(table.reads.map((path, index) => [path, `canonical file ${index}\n`]));
		const record = recorder();
		launch(record, table, "resources");
		const args = table.children.resources.args;
		const calls = paths(table.reads).map((path, index) => ({ id: `call_read_${index}`, name: "read", arguments: { path } }));
		const first = [user(`${artifact(args)}${leak ? files[table.reads[0]] : ""}`)];
		record.push(request(child(args.name), first, { reply: toolReply("", calls) }));
		record.push(
			request(child(args.name), [...first, assistant("", calls), ...calls.map((call, index) => tool(call.id, result(files[table.reads[index]])))], {
				minted: NONCES[0],
				reply: textReply(`RESULT ${NONCES[0]}`),
			}),
		);
		return baseEvidence(table, record, { canonical: { files } });
	}

	it("passes exact read results received in the next request", () => {
		assert.equal(judgeResources(evidence()).kind, "pass");
	});

	it("fails a read result that differs from the packaged file", () => {
		assert.match(judgeResources(evidence({ result: (text) => text.slice(0, -1) })).reason, /differs from the packaged file/);
	});

	it("fails reads of paths other than the packaged resources", () => {
		assert.equal(judgeResources(evidence({ paths: (reads) => reads.map((path) => path.replace(CANDIDATE, "/decoy")) })).reason, "the child did not issue one read call per packaged resource");
	});

	it("fails when file content reached the child before it read the file", () => {
		assert.match(judgeResources(evidence({ leak: true })).reason, /reached the child before it read the file/);
	});
});

describe("completion and handoff evidence", () => {
	function evidence({ sendNonce = false, dropResult = false, earlyB = false, accept = true, carryState = true } = {}) {
		const table = createScenarioTable({ candidateRoot: CANDIDATE, cwd: "/owned/work" });
		const record = recorder();
		["standalone", "fork", "resources"].forEach((key, index) => {
			const args = table.children[key].args;
			launch(record, table, key);
			record.push(request(child(args.name), [user(artifact(args))], { minted: NONCES[index], reply: textReply(`RESULT ${NONCES[index]}`) }));
			const text = resultText(args.name, `RESULT ${NONCES[index]}`);
			if (!(dropResult && key === "standalone")) record.result(args.name, text);
			record.push(request(PARENT, [user(text)], { reply: textReply(`ACK ${key}`) }));
		});
		const a = table.children["handoff-a"].args;
		const b = table.children["handoff-b"].args;
		launch(record, table, "handoff-a");
		record.push(request(child(a.name), [user(artifact(a))], { minted: NONCES[3], reply: textReply(`RESULT ${NONCES[3]}`) }));
		const aText = resultText(a.name, `RESULT ${NONCES[3]}`);
		record.result(a.name, aText);
		const bArgs = { ...b, task: `${b.task}\nAccepted state: ${NONCES[3]}` };
		const bRequest = request(child(b.name), [user(artifact(carryState ? bArgs : b))], { minted: NONCES[4], reply: textReply(`RESULT ${NONCES[4]}`) });
		if (earlyB) record.push(bRequest);
		const reply = accept ? toolReply(`ACCEPTED ${NONCES[3]}`, [{ id: "call_handoff_b", name: "subagent", arguments: bArgs }]) : textReply("ACK handoff-a");
		record.push(request(PARENT, [user(aText)], { reply }));
		record.launched("call_handoff_b");
		if (!earlyB) record.push(bRequest);
		const bText = resultText(b.name, `RESULT ${NONCES[4]}`);
		record.result(b.name, bText);
		record.push(request(PARENT, [user(bText)], { reply: textReply("ACK handoff-b") }));
		const parentSent = sendNonce ? [{ at: 0, command: { type: "prompt", message: `Accepted state: ${NONCES[3]}` } }] : [];
		return baseEvidence(table, record, { parentSent });
	}

	it("passes host-delivered results and an accepted dependent launch", () => {
		const built = evidence();
		assert.equal(judgeCompletion(built).kind, "pass");
		assert.equal(judgeHandoff(built).kind, "pass");
	});

	it("fails a result the controller sent itself", () => {
		const built = evidence({ sendNonce: true });
		assert.equal(judgeCompletion(built).reason, "the controller sent handoff-a's result");
		assert.equal(judgeHandoff(built).reason, "the controller sent handoff-a's result");
	});

	it("fails a result that never arrived as a host subagent_result", () => {
		assert.equal(judgeCompletion(evidence({ dropResult: true })).reason, "no subagent_result reached the parent for standalone");
	});

	it("fails a dependent request that precedes the parent's acceptance", () => {
		assert.equal(judgeHandoff(evidence({ earlyB: true })).reason, "B's request precedes the parent's acceptance");
	});

	it("fails a parent response that does not accept the value", () => {
		assert.equal(judgeHandoff(evidence({ accept: false })).reason, "the parent's response to A's result did not accept it and launch B");
	});

	it("fails a dependent task input without the accepted state", () => {
		assert.equal(judgeHandoff(evidence({ carryState: false })).reason, "B's task input does not carry the accepted state");
	});
});

describe("host skills argument evidence", () => {
	const craftMode = readFileSync(join(PACKAGE_ROOT, "skills/craft-mode/SKILL.md"), "utf8");
	const location = `${CANDIDATE}/skills/craft-mode/SKILL.md`;
	const expected = expectedSkill({ name: "craft-mode", location, fileText: craftMode });
	const block = skillBlock(expected);

	function evidence(build) {
		const table = createScenarioTable({ candidateRoot: CANDIDATE, cwd: "/owned/work" });
		const record = recorder();
		launch(record, table, "skills");
		build(record, table.children.skills.args);
		return baseEvidence(table, record, { canonical: { skills: { "craft-mode": expected } } });
	}

	it("passes a task request that retains the canonical skill and a task-derived completion", () => {
		const outcome = judgeSkillsArgument(
			evidence((record, args) => {
				record.push(request(child(args.name), [user(block)], { reply: textReply("STARTUP-ACK") }));
				record.push(request(child(args.name), [user(block), assistant("STARTUP-ACK"), user(artifact(args))], { minted: NONCES[0], reply: textReply(`RESULT ${NONCES[0]}`) }));
				record.result(args.name, resultText(args.name, `RESULT ${NONCES[0]}`));
			}),
		);
		assert.equal(outcome.kind, "pass");
	});

	it("fails the measured shape where the task request lacks the skill and a later request carries it", () => {
		const outcome = judgeSkillsArgument(
			evidence((record, args) => {
				record.push(request(child(args.name), [user(artifact(args))], { minted: NONCES[0], reply: textReply(`RESULT ${NONCES[0]}`) }));
				record.result(args.name, resultText(args.name, `RESULT ${NONCES[0]}`));
				record.push(request(child(args.name, true), [user(artifact(args)), assistant(`RESULT ${NONCES[0]}`), user(block)], { reply: textReply("STARTUP-ACK") }));
			}),
		);
		assert.equal(outcome.kind, "fail");
		assert.match(
			outcome.reason,
			/^upstream: the actual task request ledger#1 lacks the canonical craft-mode instructions; a later request ledger#2 from the same attributed child carries the craft-mode block; the host's subagent_result rpc#\d+ carries the result minted for the task request/,
		);
		assert.doesNotMatch(outcome.reason, /left its pane|after completion|after the host/);
	});

	it("names a later skill request that was unattributed at receipt without attributing it", () => {
		const outcome = judgeSkillsArgument(
			evidence((record, args) => {
				record.push(request(child(args.name), [user(artifact(args))], { minted: NONCES[0], reply: textReply(`RESULT ${NONCES[0]}`) }));
				record.result(args.name, resultText(args.name, `RESULT ${NONCES[0]}`));
				const late = request({ kind: "unknown", reason: "sender exiting", provenConnection: { kind: "host-child", subagentName: args.name } }, [
					user(artifact(args)),
					assistant(`RESULT ${NONCES[0]}`),
					user(block),
				]);
				record.push({ ...late, refused: "unattributed request: sender exiting" });
			}),
		);
		assert.equal(outcome.kind, "fail");
		assert.match(outcome.reason, /a later request ledger#2 unattributed at receipt but on the connection proven for this child carries the craft-mode block/);
	});

	it("fails a completion delivered after a startup turn and before any task request", () => {
		const outcome = judgeSkillsArgument(
			evidence((record, args) => {
				record.push(request(child(args.name), [user(block)], { reply: textReply("STARTUP-ACK") }));
				record.result(args.name, resultText(args.name, "STARTUP-ACK"));
			}),
		);
		assert.match(outcome.reason, /^upstream: the host delivered completion \(rpc#\d+\), and no child request carried the task$/);
	});
});

describe("isolation and teardown evidence", () => {
	const parentChecks = { identity: true, executable: true, rootSender: true, noSubagentId: true, noRiskyNames: true };
	const childChecks = {
		identity: true,
		executable: true,
		serverDescendant: true,
		subagentId: true,
		subagentName: true,
		herdrSession: true,
		herdrSocket: true,
		pane: true,
		agentDir: true,
		offline: true,
		noRiskyNames: true,
	};
	const attributedParent = { kind: "parent", label: "parent", basis: "owned-tree", riskyNames: [], checks: parentChecks };
	const attributedChild = (fields = {}) => ({ kind: "host-child", subagentName: "child", herdrSession: "owned", basis: "owned-tree", detached: false, riskyNames: [], checks: childChecks, ...fields });
	const received = (index, origin) => ({ index, origin, auth: "dummy", refused: null });
	const clean = { ledger: [received(0, attributedParent)], faults: {}, parentLog: [], parentStderr: "", solos: {}, session: "owned", herdrState: "stopped" };

	it("fails an unattributed request, a dialog, or diagnostic output", () => {
		assert.equal(judgeIsolation(clean).kind, "pass");
		const unknown = { index: 0, origin: { kind: "unknown", reason: "0 owned holders" }, auth: "dummy", refused: "unattributed request" };
		assert.match(judgeIsolation({ ...clean, ledger: [unknown] }).reason, /ledger#0 unattributed/);
		assert.match(judgeIsolation({ ...clean, parentLog: [{ index: 3, record: { type: "extension_ui_request", method: "confirm" } }] }).reason, /dialog confirm/);
		assert.match(judgeIsolation({ ...clean, parentStderr: "warning" }).reason, /parent wrote to stderr/);
	});

	it("never claims attribution for an empty ledger or one that lost observations", () => {
		assert.equal(judgeIsolation({ ...clean, ledger: [] }).kind, "blocked");
		assert.match(judgeIsolation({ ...clean, faults: undefined }).reason, /no record of lost observations/);
		const lost = { count: 2, samples: [{ kind: "capacity", detail: { origin: "unknown", reason: "late sender" } }] };
		const outcome = judgeIsolation({ ...clean, faults: { "provider ledger": lost } });
		assert.equal(outcome.kind, "fail");
		assert.match(outcome.reason, /provider ledger lost 2 observations: capacity .*late sender/);
	});

	it("rejects risky, contradicted or unproven origins instead of trusting their kind", () => {
		const judged = (origin) => judgeIsolation({ ...clean, ledger: [received(0, origin)] });
		assert.match(judged({ ...attributedParent, riskyNames: ["OPENAI_API_KEY"] }).reason, /OPENAI_API_KEY/);
		assert.match(judged(attributedChild({ checks: { ...childChecks, offline: false } })).reason, /offline/);
		assert.match(judged(attributedChild({ checks: undefined })).reason, /lacks passing checks/);
		assert.match(judged(attributedChild({ checks: { ...childChecks, serverDescendant: false } })).reason, /serverDescendant/);
		assert.match(judged(attributedChild({ herdrSession: "other" })).reason, /another Herdr session/);
		assert.match(judged(attributedChild({ basis: "connection", detached: true })).reason, /without confirmed disappearance/);
		assert.match(judged(attributedChild({ basis: "connection", detached: true, disappearance: { sender: "unknown", socket: "orphaned" } })).reason, /without confirmed disappearance/);
		const { serverDescendant, ...reparentedChecks } = childChecks;
		assert.equal(serverDescendant, true);
		assert.equal(judged(attributedChild({ basis: "reparented", detached: true, checks: reparentedChecks })).kind, "pass");
		const historical = judged(attributedChild({ basis: "connection", detached: true, disappearance: { sender: "absent", socket: "orphaned" } }));
		assert.equal(historical.kind, "pass");
		assert.doesNotMatch(historical.reason, /pane/);
	});

	const closed = {
		kind: "closed",
		root: "/tmp/cc3-x",
		exits: { parent: { closure: "closed", code: 0, signal: null, forced: null, errors: [] } },
		server: { started: true, exit: { closure: "closed", code: 0, signal: null, forced: null, errors: [] }, stopCommand: { stopped: true, closure: "closed" } },
		providerClosed: true,
		identities: [{ pid: 1, startTime: "1", kind: "parent" }],
		survivors: [],
		uncertain: [],
		sockets: [],
		forced: [],
		errors: [],
	};

	it("fails retained, uncertain, unresolved or forced teardown even when behavior passed", () => {
		assert.equal(judgeTeardown({ teardown: closed }).kind, "pass");
		const survivor = { pid: 42, startTime: "99", kind: "host-child" };
		assert.match(judgeTeardown({ teardown: { ...closed, kind: "retained", survivors: [survivor] } }).reason, /survivor host-child pid 42 start 99/);
		assert.match(judgeTeardown({ teardown: { ...closed, forced: ["parent: SIGTERM"] } }).reason, /forced parent: SIGTERM/);
		const uncertain = { pid: 7, startTime: "70", kind: "descendant", reason: "/proc/7/stat: EACCES" };
		assert.match(judgeTeardown({ teardown: { ...closed, uncertain: [uncertain] } }).reason, /uncertain descendant pid 7: \/proc\/7\/stat: EACCES/);
		const unresolved = { ...closed.exits.parent, closure: "unresolved", code: null };
		assert.match(judgeTeardown({ teardown: { ...closed, exits: { parent: unresolved } } }).reason, /parent closure unresolved/);
		assert.match(judgeTeardown({ teardown: { ...closed, errors: [{ phase: "parent close", message: "boom" }] } }).reason, /parent close: boom/);
	});

	it("turns unevaluable evidence into failures and missing prerequisites into blocked outcomes", () => {
		const gate = judgeGate({});
		assert.equal(gate.passed, false);
		assert.equal(gate.outcomes.length, DISTINCTIONS.length);
		const missing = blockedGate(["host: CLEAN_CRAFT_HOST_ROOT is not set"]);
		assert.equal(missing.passed, false);
		assert.ok(missing.outcomes.every((outcome) => outcome.kind === "blocked"));
	});

	it("reports a request without the subagent tool as a blocked host", () => {
		const entry = request(PARENT, [user("scenario:standalone")], { tools: ["read"] });
		assert.equal(hostPreflight(entry).kind, "blocked");
		assert.equal(hostPreflight(request(PARENT, [user("scenario:standalone")])).kind, "ready");
	});
});

describe("discovery evidence", () => {
	const HOST = "/owned/host";
	const PSTACK = "/owned/pstack";
	const canonical = {
		candidateRoot: CANDIDATE,
		candidateExtension: join(CANDIDATE, EXTENSIONS[0]),
		craftSkills: SKILLS.map(({ name, path }) => ({ name, path })),
		hostRoot: HOST,
		pstackRoot: PSTACK,
		hostSkills: ["pi-herdr-agents"],
		pstackSkills: ["poteto-mode"],
		pstackExtension: join(PSTACK, "pi-extension/pstack/index.ts"),
	};
	const info = (path, source) => ({ path, source, scope: "user", origin: "package", baseDir: source });
	const listed = (extra = []) => ({
		data: {
			commands: [
				...SKILLS.map((skill) => ({ name: `skill:${skill.name}`, source: "skill", sourceInfo: info(join(CANDIDATE, skill.path), CANDIDATE) })),
				{ name: "craft-mode", source: "extension", sourceInfo: info(canonical.candidateExtension, CANDIDATE) },
				{ name: "skill:pi-herdr-agents", source: "skill", sourceInfo: info(join(HOST, "skills/pi-herdr-agents/SKILL.md"), HOST) },
				{ name: "skill:poteto-mode", source: "skill", sourceInfo: info(join(PSTACK, "skills/poteto-mode/SKILL.md"), PSTACK) },
				{ name: "subagent", source: "extension", sourceInfo: info(join(HOST, "index.ts"), HOST) },
				{ name: "poteto-mode", source: "extension", sourceInfo: info(canonical.pstackExtension, PSTACK) },
				{ name: "setup-pstack", source: "extension", sourceInfo: info(canonical.pstackExtension, PSTACK) },
				...extra,
			],
		},
	});
	const judge = (commands) => judgeDiscovery({ commands, canonical });

	it("accepts exactly the candidate's /craft-mode extension command beside its skills", () => {
		assert.equal(judge(listed()).kind, "pass", judge(listed()).reason);
	});

	it("fails any other candidate command or a /craft-mode from another file", () => {
		const extra = judge(listed([{ name: "craft-extra", source: "extension", sourceInfo: info(canonical.candidateExtension, CANDIDATE) }]));
		assert.equal(extra.kind, "fail");
		assert.match(extra.reason, /not exactly its \/craft-mode extension command: extension:craft-mode, extension:craft-extra/);
		const moved = listed();
		moved.data.commands.find((command) => command.name === "craft-mode").sourceInfo.path = join(CANDIDATE, "elsewhere.ts");
		assert.equal(judge(moved).kind, "fail");
		const missing = listed();
		missing.data.commands = missing.data.commands.filter((command) => command.name !== "craft-mode");
		assert.match(judge(missing).reason, /: none$/);
	});
});

describe("integration prerequisites", () => {
	it("skips a package-local node_modules/.bin that npm run puts first on PATH", (t) => {
		const root = makeTempRoot(t, "path-order");
		const local = join(root, "node_modules", ".bin");
		const installed = join(root, "bin");
		for (const dir of [local, installed]) {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "pi"), "#!/bin/sh\n");
			chmodSync(join(dir, "pi"), 0o755);
		}
		assert.deepEqual(resolveExecutable({ PATH: `${local}:${installed}` }, { variable: "CLEAN_CRAFT_PI_BIN", name: "pi" }), { kind: "found", path: join(installed, "pi"), source: "PATH" });
		assert.equal(resolveExecutable({ PATH: local }, { variable: "CLEAN_CRAFT_PI_BIN", name: "pi" }).kind, "blocked");
		assert.equal(
			resolveExecutable({ PATH: installed, CLEAN_CRAFT_PI_BIN: join(local, "pi") }, { variable: "CLEAN_CRAFT_PI_BIN", name: "pi" }).path,
			join(local, "pi"),
			"an explicit override still wins",
		);
	});

	function fixture(t) {
		const root = makeTempRoot(t, "prereq");
		const bin = join(root, "bin");
		mkdirSync(bin);
		for (const name of ["pi", "herdr"]) {
			writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n");
			chmodSync(join(bin, name), 0o755);
		}
		const pkg = (dir, manifest, files) => {
			mkdirSync(join(root, dir), { recursive: true });
			writeFileSync(join(root, dir, "package.json"), JSON.stringify(manifest));
			for (const file of files) {
				mkdirSync(join(root, dir, file, ".."), { recursive: true });
				writeFileSync(join(root, dir, file), "export {};\n");
			}
			return join(root, dir);
		};
		const host = pkg("host", { name: "pi-herdr-agents", version: "3.2.1", pi: { extensions: ["./ext/index.ts"] } }, ["ext/index.ts"]);
		const pstack = pkg("pstack", { name: "pi-herdr-pstack", version: "9.9.9", pi: { extensions: ["./ext/index.ts"] } }, ["ext/index.ts"]);
		const env = { PATH: bin, CLEAN_CRAFT_HOST_ROOT: host, CLEAN_CRAFT_PSTACK_ROOT: pstack };
		return { root, env, pkg };
	}

	it("is ready only with explicit, valid inputs and records the unpinned pstack version", (t) => {
		const { env } = fixture(t);
		const located = locatePrerequisites(env, { hostVersion: "3.2.1", platform: () => true });
		assert.equal(located.kind, "ready", JSON.stringify(located.reasons));
		assert.equal(located.pstack.version, "9.9.9");
		assert.match(located.host.digest.sha256, /^[0-9a-f]{64}$/);
	});

	it("blocks missing, misidentified, or unusable inputs instead of skipping", (t) => {
		const { env, pkg } = fixture(t);
		const reasons = (overrides, platform = true) => locatePrerequisites({ ...env, ...overrides }, { hostVersion: "3.2.1", platform: () => platform }).reasons ?? [];
		assert.deepEqual(reasons({ CLEAN_CRAFT_HOST_ROOT: undefined }), ["host: CLEAN_CRAFT_HOST_ROOT is not set"]);
		assert.match(reasons({ CLEAN_CRAFT_PSTACK_ROOT: "relative/path" })[0], /must be an absolute path/);
		assert.match(reasons({ CLEAN_CRAFT_HOST_ROOT: env.CLEAN_CRAFT_PSTACK_ROOT })[0], /is package "pi-herdr-pstack", expected pi-herdr-agents/);
		const old = pkg("old-host", { name: "pi-herdr-agents", version: "3.1.0", pi: { extensions: ["./ext/index.ts"] } }, ["ext/index.ts"]);
		assert.match(reasons({ CLEAN_CRAFT_HOST_ROOT: old })[0], /expected exactly 3\.2\.1/);
		const hollow = pkg("hollow", { name: "pi-herdr-agents", version: "3.2.1", pi: { extensions: ["./missing.ts"] } }, []);
		assert.match(reasons({ CLEAN_CRAFT_HOST_ROOT: hollow })[0], /declares missing resources: \.\/missing\.ts/);
		assert.match(reasons({ CLEAN_CRAFT_PI_BIN: "pi" })[0], /CLEAN_CRAFT_PI_BIN must be an absolute path/);
		assert.match(reasons({ PATH: "/nonexistent" }).join("\n"), /no executable pi on PATH/);
		assert.match(reasons({}, false)[0], /Linux \/proc process and socket attribution is unavailable/);
	});
});
