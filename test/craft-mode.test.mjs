import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, it } from "node:test";
import { SKILLS } from "./inventory.mjs";
import { guidance, hubBlock, openLab, REMINDER_CEILING, REMINDER_TAG, withoutCarriers } from "./phase3/sticky.mjs";
import { extractPack, npmPack, PACKAGE_ROOT } from "./support.mjs";

const HUB_PATH = join(PACKAGE_ROOT, "skills/craft-mode/SKILL.md");
const EXTENSION_PATH = join(PACKAGE_ROOT, "pi-extension/clean-craft/index.ts");
const HUB = hubBlock(HUB_PATH);
const RECORD_TYPE = "clean-craft-mode";

function views(entries, hub = HUB) {
	return entries.map((entry) => guidance(entry, hub));
}

function taskViews(entries, hub = HUB) {
	return views(entries, hub).filter((view) => view.kind === "task");
}

function assertGuided(view, label, { carrier = 1, user = 0 } = {}) {
	assert.equal(view.kind, "task", `${label}: request kind`);
	assert.equal(view.carrierHub, carrier, `${label}: carrier hub copies`);
	assert.equal(view.userHub, user, `${label}: user-loaded hub copies`);
	assert.equal(view.reminders, 1, `${label}: reminders`);
	assert.ok(view.reminderLengths[0] <= REMINDER_CEILING, `${label}: reminder is ${view.reminderLengths[0]} characters`);
	assert.ok(view.carriersAtEnd, `${label}: carriers follow the conversation`);
	assert.ok(view.toolPairsAdjacent, `${label}: tool results stay with their calls`);
}

function assertUnguided(view, label, { user = 0 } = {}) {
	assert.equal(view.carrierHub, 0, `${label}: carrier hub copies`);
	assert.equal(view.userHub, user, `${label}: user-loaded hub copies`);
	assert.equal(view.reminders, 0, `${label}: reminders`);
	assert.ok(view.toolPairsAdjacent, `${label}: tool results stay with their calls`);
}

function occurrences(entry, text) {
	return entry.rawBody.split(text).length - 1;
}

// History sent in a later request starts with the history of the earlier one, so carriers never altered it.
function assertHistoryPreserved(entries) {
	for (let index = 1; index < entries.length; index += 1) {
		const before = withoutCarriers(entries[index - 1], HUB);
		const after = withoutCarriers(entries[index], HUB).slice(0, before.length);
		assert.deepEqual(after, before, `ledger#${entries[index].index} rewrote history from ledger#${entries[index - 1].index}`);
	}
}

function records(entries) {
	return entries.filter((entry) => entry.type === "custom" && entry.customType === RECORD_TYPE).map((entry) => entry.data);
}

function stagePackage(root, name, change = () => {}) {
	const target = join(root, name);
	for (const path of ["package.json", "pi-extension", "skills"]) cpSync(join(PACKAGE_ROOT, path), join(target, path), { recursive: true });
	change(target);
	return target;
}

function persistedText(lab) {
	return lab
		.sessionFiles()
		.map((path) => readFileSync(path, "utf8"))
		.join("\n");
}

function assertNothingPersisted(lab) {
	const text = persistedText(lab);
	for (const marker of [REMINDER_TAG, "clean-craft-mode-hub", "clean-craft-mode-reminder"]) assert.ok(!text.includes(marker), `a session file holds ${marker}`);
}

function sessionOf(notice) {
	const [, id, file] = /^session (\S+) (\S+)$/.exec(notice) ?? [];
	return { id, file };
}

describe("/craft-mode registration and controls", () => {
	it("registers one owned command beside the six skills, and its controls never call the provider", async (t) => {
		const lab = await openLab(t, "controls");
		const pi = await lab.start({ label: "controls" });
		const commands = (await pi.raw({ type: "get_commands" })).data.commands;
		const owned = commands.filter((command) => command.sourceInfo?.source === PACKAGE_ROOT);
		assert.deepEqual(owned.map((command) => command.name).toSorted(), ["craft-mode", ...SKILLS.map((skill) => `skill:${skill.name}`)].toSorted());
		const command = owned.find((entry) => entry.name === "craft-mode");
		assert.equal(command.source, "extension");
		assert.equal(command.sourceInfo.path, EXTENSION_PATH);

		const bare = await pi.command("/craft-mode");
		assert.match(bare.text, /^Craft mode: off \(never enabled on this branch\)\./);
		assert.ok(bare.text.includes(`Hub: ${HUB_PATH}\n`), bare.text);
		assert.match(bare.text, /Ownership: session \S+; every record on this branch applies/);
		assert.match(bare.text, /does not show what a provider received/);
		assert.equal((await pi.command("/craft-mode status")).text, bare.text, "bare form is status");
		assert.match((await pi.command("/craft-mode off")).text, /already off/);
		assert.match((await pi.command("/craft-mode on")).text, /^Craft mode is on for this branch from the next request\. No task was started\.$/);
		assert.match((await pi.command("/craft-mode ON")).text, /already on/);
		assert.match((await pi.command("/craft-mode status")).text, /^Craft mode: on \(recorded by session/);
		for (const text of ["/craft-mode on now", "/craft-mode off please", "/craft-mode status x", "/craft-mode --"]) {
			assert.match((await pi.command(text)).text, /Usage: \/craft-mode/, text);
		}
		assert.match((await pi.command("/craft-mode status")).text, /^Craft mode: on/, "invalid forms changed nothing");
		assert.match((await pi.command("/craft-mode off")).text, /^Craft mode is off from the next request\. Instructions already in the conversation stay there\.$/);
		assert.match((await pi.command("/craft-mode off")).text, /already off/);

		assert.deepEqual(
			records(await pi.entries()).map((record) => record.desired),
			["on", "off"],
			"repeated intents add no records",
		);
		const ledger = await lab.finish();
		assert.equal(ledger.length, 0, "no control reached the provider");
		lab.markPassed();
	});
});

describe("/craft-mode delivery through the context hook", () => {
	it("delivers from the extracted npm tarball, which has no development dependencies", async (t) => {
		const packageRoot = await extractPack(await npmPack(t, { dryRun: false }));
		const hub = hubBlock(join(packageRoot, "skills/craft-mode/SKILL.md"));
		const lab = await openLab(t, "tarball");
		const pi = await lab.start({ label: "tarball", packages: [packageRoot] });
		assert.match((await pi.command("/craft-mode on")).text, /^Craft mode is on/);
		assertGuided(views(await pi.prompt("T1 packed"), hub)[0], "packed extension");
		await lab.finish();
		lab.markPassed();
	});

	it("adds the hub when absent and one reminder to every request, including tool continuations, and never doubles user-loaded copies", async (t) => {
		const lab = await openLab(t, "delivery");
		writeFileSync(join(lab.root, "cwd", "fixture.txt"), "FIXTURE-CONTENT\n");
		const pi = await lab.start({ label: "delivery" });
		const [p0] = taskViews(await pi.prompt("P0 while off"));
		assertUnguided(p0, "off");
		const offShot = taskViews(await pi.prompt("/skill:craft-mode ONESHOT-OFF"));
		assertUnguided(offShot[0], "one-shot while off", { user: 1 });
		assert.match((await pi.command("/craft-mode status")).text, /^Craft mode: off \(never enabled/, "a one-shot does not enable the mode");

		await pi.raw({ type: "new_session" });
		await pi.command("/craft-mode on");
		const p1 = await pi.prompt("P1 plain");
		assert.equal(p1.length, 1);
		assertGuided(views(p1)[0], "P1");
		assert.equal(occurrences(p1[0], "P1 plain"), 1, "the prompt appears once");
		const p2 = await pi.prompt("P2 [[read:fixture.txt]]");
		assert.equal(p2.length, 2, "a tool call and its continuation");
		for (const [index, view] of views(p2).entries()) assertGuided(view, `P2 request ${index}`);
		assert.equal(views(p2)[1].turns.at(-3).role, "tool", "carriers come after the tool result");
		const s1 = await pi.prompt("/skill:craft-mode ONESHOT-1");
		assertGuided(views(s1)[0], "first one-shot", { carrier: 0, user: 1 });
		const p3 = await pi.prompt("P3 plain");
		assertGuided(views(p3)[0], "after one-shot", { carrier: 0, user: 1 });
		const s2 = await pi.prompt("/skill:craft-mode ONESHOT-2");
		assertGuided(views(s2)[0], "second one-shot", { carrier: 0, user: 2 });
		const p4 = await pi.prompt("P4 plain");
		assertGuided(views(p4)[0], "two user copies", { carrier: 0, user: 2 });
		assertHistoryPreserved([...p1, ...p2, ...s1, ...p3, ...s2, ...p4]);

		const ledger = await lab.finish();
		assert.equal(ledger.length, 9, "exactly the requests the prompts started");
		assertNothingPersisted(lab);
		lab.markPassed();
	});

	it("does not treat an assistant quotation or a tool result holding the hub text as delivery", async (t) => {
		const lab = await openLab(t, "quotes");
		writeFileSync(join(lab.root, "cwd", "quote.txt"), HUB);
		const pi = await lab.start({ label: "quotes" });
		await pi.command("/craft-mode on");
		const said = await pi.prompt("Q1 [[say:quote.txt]]");
		assertGuided(views(said)[0], "before the quote");
		const afterSay = views(await pi.prompt("Q2 plain"))[0];
		assertGuided(afterSay, "after an assistant quote");
		assert.equal(afterSay.hubTotal, 2, "the quote and one carrier");
		const read = views(await pi.prompt("Q3 [[read:quote.txt]]"));
		assert.equal(read[1].turns.filter((turn) => turn.role === "tool" && turn.text === HUB).length, 1, "the tool result holds the exact hub text");
		assertGuided(read[1], "after a tool result quote");
		assert.equal(read[1].hubTotal, 3, "two quotes and one carrier");
		await lab.finish();
		lab.markPassed();
	});
});

describe("/craft-mode while busy, and task submission", () => {
	it("applies on and off from the next request, refuses a task while busy, and submits an idle literal task once", async (t) => {
		const lab = await openLab(t, "busy");
		writeFileSync(join(lab.root, "cwd", "fixture.txt"), "FIXTURE-CONTENT\n");
		const pi = await lab.start({ label: "busy" });

		await pi.command("/craft-mode on");
		await pi.command("/drv arm");
		const run1 = await pi.begin("B1 [[read:fixture.txt]]");
		await pi.waitForStatus("barrier", run1.at);
		assert.match((await pi.command("/craft-mode off")).text, /^Craft mode is off from the next request/);
		assert.match((await pi.command("/craft-mode BUSY-TASK-1")).text, /^Task not submitted: a run is active/);
		assert.match((await pi.command("/craft-mode status")).text, /^Craft mode: off \(recorded\)/, "the refused task did not enable the mode");
		await pi.command("/drv release");
		const b1 = views(await pi.settled(run1.at, run1.ledgerBefore, "settle B1"));
		assert.equal(b1.length, 2);
		assertGuided(b1[0], "B1 before off");
		assertUnguided(b1[1], "B1 after off");

		await pi.command("/drv arm");
		const run2 = await pi.begin("B2 [[read:fixture.txt]]");
		await pi.waitForStatus("barrier", run2.at);
		await pi.command("/craft-mode on");
		await pi.command("/drv release");
		const b2 = views(await pi.settled(run2.at, run2.ledgerBefore, "settle B2"));
		assertUnguided(b2[0], "B2 before on");
		assertGuided(b2[1], "B2 after on");

		await pi.command("/craft-mode off");
		const literal = await pi.commandRun("/craft-mode -- /skill:craft-tdd LITERAL-TASK-1");
		assert.match(literal.text, /^Craft mode is on and the task was submitted once\. Submission does not confirm that a model run started\.$/);
		assert.equal(literal.requests.length, 1);
		const [submitted] = literal.requests;
		assertGuided(views(literal.requests)[0], "literal task");
		const fresh = submitted.parsed.turns.filter((turn) => turn.role === "user" && !turn.text.startsWith(REMINDER_TAG) && turn.text !== HUB).at(-1);
		assert.equal(fresh.text, "/skill:craft-tdd LITERAL-TASK-1", "the task text is literal");
		assert.equal(occurrences(submitted, "LITERAL-TASK-1"), 1);
		assert.ok(!submitted.rawBody.includes('<skill name=\\"craft-tdd\\"'), "the literal task was not expanded");

		const swallowed = await pi.command("/craft-mode [[swallow]] SWALLOWED-TASK");
		assert.match(swallowed.text, /submitted once/, "submission is reported even though input handling swallows it");
		await pi.command("/craft-mode off");
		const accepted = await pi.command("/craft-mode [[swallow]] SWALLOWED-AGAIN");
		assert.match(accepted.text, /submitted once/);
		assert.match((await pi.command("/craft-mode status")).text, /^Craft mode: on/, "a swallowed submission leaves the mode on");
		const after = await pi.prompt("B3 plain");
		assertGuided(views(after)[0], "after swallowed submissions");

		const entries = await pi.entries();
		assert.deepEqual(
			records(entries).map((record) => record.desired),
			["on", "off", "on", "off", "on", "off", "on"],
		);
		const ledger = await lab.finish();
		assert.equal(ledger.length, 6, "two busy runs, the literal task, and B3");
		for (const entry of ledger) {
			for (const text of ["BUSY-TASK-1", "SWALLOWED-TASK", "SWALLOWED-AGAIN"]) assert.equal(occurrences(entry, text), 0, `${text} reached ledger#${entry.index}`);
		}
		lab.markPassed();
	});

	it("guides a simulated completion wake that bypasses before_agent_start, and its tool continuation", async (t) => {
		const lab = await openLab(t, "wake");
		writeFileSync(join(lab.root, "cwd", "fixture.txt"), "FIXTURE-CONTENT\n");
		const pi = await lab.start({ label: "wake", env: { DRV_FOREIGN: "1" } });
		await pi.prompt("W0 seeds the system prompt");
		await pi.command("/craft-mode on");
		const on = views((await pi.commandRun("/drv wake SIMULATED-WAKE-1 [[read:fixture.txt]]")).requests);
		assert.equal(on.length, 2);
		for (const [index, view] of on.entries()) assertGuided(view, `wake request ${index}`);
		assert.ok(!on[0].system.includes("FOREIGN-SYSTEM-GUIDANCE"), "the wake bypassed before_agent_start, as on the host completion path");
		await pi.command("/craft-mode off");
		const off = views((await pi.commandRun("/drv wake SIMULATED-WAKE-2 [[read:fixture.txt]]")).requests);
		for (const [index, view] of off.entries()) assertUnguided(view, `wake after off ${index}`);
		const ledger = await lab.finish();
		assert.equal(ledger.length, 5);
		lab.markPassed();
	});
});

describe("/craft-mode across compaction and preparation failure", () => {
	it("keeps a retained user hub, resupplies an evicted one after manual compaction, and counts summary requests apart", async (t) => {
		const lab = await openLab(t, "manual-compaction");
		// Pi keeps the message that crosses keepRecentTokens, so R1 crosses it and the filler before it is summarized.
		const keep = Math.ceil(HUB.length / 4) + 300;
		const filler = `OLD-FILLER ${"lorem ipsum dolor sit amet ".repeat(1600)}`;

		const retain = await lab.start({ label: "retain", settings: { compaction: { enabled: false, keepRecentTokens: keep, reserveTokens: 1000 } } });
		await retain.command("/craft-mode on");
		await retain.prompt(filler);
		await retain.prompt(`R1 ${"crossing ".repeat(300)}`);
		assertGuided(views(await retain.prompt("/skill:craft-mode RETAIN-SHOT"))[0], "retain one-shot", { carrier: 0, user: 1 });
		const before = lab.ledger.length;
		const compacted = await retain.raw({ type: "compact" }, 30_000);
		assert.equal(compacted.success, true, JSON.stringify(compacted));
		const summaries = views(lab.ledger.slice(before));
		assert.ok(summaries.length >= 1 && summaries.every((view) => view.kind === "summary" && view.reminders === 0 && view.carrierHub === 0), "summary requests carry no guidance");
		assertGuided(views(await retain.prompt("R2 after compaction"))[0], "hub retained by compaction", { carrier: 0, user: 1 });
		await retain.close();

		const evict = await lab.start({ label: "evict", settings: { compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 1000 } } });
		await evict.command("/craft-mode on");
		assertGuided(views(await evict.prompt("/skill:craft-mode EVICT-SHOT"))[0], "evict one-shot", { carrier: 0, user: 1 });
		await evict.prompt("E1 plain");
		assert.equal((await evict.raw({ type: "compact" }, 30_000)).success, true);
		const evicted = views(await evict.prompt("E2 after compaction"))[0];
		assertGuided(evicted, "hub evicted by compaction");
		assert.ok(
			evicted.turns.some((turn) => turn.text.includes("SCRIPTED-SUMMARY")),
			"the request follows the compaction summary",
		);
		await evict.command("/craft-mode off");
		assertUnguided(views(await evict.prompt("E3 off"))[0], "off after compaction");
		await lab.finish();
		lab.markPassed();
	});

	it("resupplies the hub after automatic compaction between tool turns of one run", async (t) => {
		const lab = await openLab(t, "auto-compaction");
		writeFileSync(join(lab.root, "cwd", "big.txt"), `${"BIG-TOOL-OUTPUT line of padding text\n".repeat(800)}`);
		const pi = await lab.start({ label: "auto", settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 126_000 } } });
		await pi.command("/craft-mode on");
		const { at, ledgerBefore } = await pi.begin("/skill:craft-mode AUTO-SHOT [[read:big.txt]]");
		const run = views(await pi.settled(at, ledgerBefore, "settle auto compaction"));
		const log = pi.rpc.log.entries.slice(at);
		const start = log.find((entry) => entry.record?.type === "compaction_start");
		const settled = log.find((entry) => entry.record?.type === "agent_settled");
		assert.ok(start && start.index < settled.index, "compaction happened inside the run");
		assert.equal(start.record.reason, "threshold");
		const tasks = run.filter((view) => view.kind === "task");
		assert.ok(
			run.some((view) => view.kind === "summary"),
			"a summary request was made",
		);
		assert.equal(tasks.length, 2);
		assertGuided(tasks[0], "before compaction", { carrier: 0, user: 1 });
		assertGuided(tasks[1], "after mid-run compaction");
		assert.ok(
			tasks[1].turns.some((turn) => turn.role === "tool" && turn.text.includes("BIG-TOOL-OUTPUT")),
			"the kept tool result is still paired",
		);
		await lab.finish();
		lab.markPassed();
	});

	it("resupplies the hub when an earlier context handler removes the user's copy", async (t) => {
		const lab = await openLab(t, "context-removal");
		const pi = await lab.start({ label: "strip", env: { DRV_STRIP_HUB: "1" } });
		await pi.command("/craft-mode on");
		assertGuided(views(await pi.prompt("/skill:craft-mode STRIPPED-SHOT"))[0], "user copy removed before this extension");
		await lab.finish();
		lab.markPassed();
	});

	it("keeps no state from a prompt that fails during preparation", async (t) => {
		const lab = await openLab(t, "preparation");
		const pi = await lab.start({ label: "preparation" });
		await pi.command("/craft-mode on");
		const failed = await pi.raw({ type: "prompt", message: "IMAGE-FAIL", images: [{ type: "image", mimeType: "image/png" }] });
		assert.equal(failed.success, false, "the malformed image fails before agent_start");
		assert.ok(!pi.rpc.log.entries.some((entry) => entry.record?.type === "agent_start"), "no run started");
		await pi.command("/craft-mode off");
		assertUnguided(views((await pi.commandRun("/drv wake WAKE-AFTER-FAILURE")).requests)[0], "off after failure");
		await pi.command("/craft-mode on");
		assertGuided(views((await pi.commandRun("/drv wake WAKE-ON")).requests)[0], "on after failure");
		await pi.raw({ type: "new_session" });
		assert.match((await pi.command("/craft-mode status")).text, /^Craft mode: off \(never enabled/);
		assertUnguided(views((await pi.commandRun("/drv wake WAKE-NEW-SESSION")).requests)[0], "new session");
		const ledger = await lab.finish();
		assert.equal(ledger.length, 3);
		assert.ok(ledger.every((entry) => occurrences(entry, "IMAGE-FAIL") === 0));
		lab.markPassed();
	});
});

describe("/craft-mode across session lifecycle", () => {
	it("follows the active branch through restart, reload, tree navigation, fork, clone, and a fresh session", async (t) => {
		const lab = await openLab(t, "lifecycle");
		const first = await lab.start({ label: "first" });
		await first.prompt("Z before any record");
		await first.command("/craft-mode on");
		assertGuided(views(await first.prompt("A on"))[0], "A");
		await first.command("/craft-mode off");
		assertUnguided(views(await first.prompt("B off"))[0], "B");
		await first.command("/drv reload");
		assert.match((await first.command("/craft-mode status")).text, /^Craft mode: off \(recorded\)/, "reload rebuilt state from the branch");
		await first.command("/craft-mode on");
		await first.close();

		const second = await lab.start({ label: "resumed", args: ["--continue"] });
		assert.match((await second.command("/craft-mode status")).text, /^Craft mode: on/, "restart restored the branch state");
		assertGuided(views(await second.prompt("C resumed"))[0], "C");
		const entries = await second.entries();
		const [on1, off1] = entries.filter((entry) => entry.type === "custom" && entry.customType === RECORD_TYPE);
		assert.match((await second.command(`/drv tree ${off1.parentId}`)).text, /tree moved/);
		assert.match((await second.command("/craft-mode status")).text, /^Craft mode: on/, "the branch before off is on");
		assertGuided(views(await second.prompt("D on branch"))[0], "D");
		assert.match((await second.command(`/drv tree ${on1.parentId}`)).text, /tree moved/);
		assert.match((await second.command("/craft-mode status")).text, /^Craft mode: off \(never enabled/, "the branch before on is off");
		assertUnguided(views(await second.prompt("E before records"))[0], "E");

		const original = sessionOf((await second.command("/drv session")).text);
		const forkPoint = (await second.raw({ type: "get_entries" })).data.entries.find(
			(entry) => entry.type === "message" && entry.message.role === "user" && JSON.stringify(entry.message.content).includes("D on branch"),
		);
		assert.equal((await second.raw({ type: "fork", entryId: forkPoint.id })).data.cancelled, false);
		const forked = sessionOf((await second.command("/drv session")).text);
		assert.notEqual(forked.id, original.id);
		const forkStatus = (await second.command("/craft-mode status")).text;
		assert.ok(forkStatus.startsWith(`Craft mode: on (recorded by session ${original.id})`), forkStatus);
		assertGuided(views(await second.prompt("F forked"))[0], "F, a human fork inherits intent");
		assert.equal((await second.raw({ type: "clone" })).data.cancelled, false);
		assert.notEqual(sessionOf((await second.command("/drv session")).text).id, forked.id);
		assertGuided(views(await second.prompt("G cloned"))[0], "G, a clone inherits intent");
		await second.raw({ type: "new_session" });
		assertUnguided(views(await second.prompt("H fresh"))[0], "H, a new session starts off");

		const ledger = await lab.finish();
		assert.equal(ledger.length, 9);
		assertNothingPersisted(lab);
		lab.markPassed();
	});

	it("ignores activation copied into a delegated child, while the child's own decisions work and survive resume", async (t) => {
		const lab = await openLab(t, "child");
		const parent = await lab.start({ label: "parent" });
		await parent.command("/craft-mode on");
		assertGuided(views(await parent.prompt("PARENT-1"))[0], "parent");
		const parentSession = sessionOf((await parent.command("/drv session")).text);
		await parent.close();

		// Seed child sessions the way pi-herdr-agents 3.2.1 does for fork mode: a new header, copied entries.
		const seed = (id) => {
			const lines = readFileSync(parentSession.file, "utf8").split("\n").filter(Boolean);
			const header = { ...JSON.parse(lines[0]), id, parentSession: parentSession.file, timestamp: new Date().toISOString() };
			const file = join(dirname(parentSession.file), `${basename(parentSession.file, ".jsonl")}-child-${id}.jsonl`);
			writeFileSync(file, `${[JSON.stringify(header), ...lines.slice(1)].join("\n")}\n`);
			return file;
		};
		const childFile = seed("01a20000-0000-7000-8000-00000000c001");
		const copied = readFileSync(childFile, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line))
			.filter((entry) => entry.type === "custom" && entry.customType === RECORD_TYPE);
		assert.deepEqual(
			copied.map((entry) => entry.data),
			[{ version: 1, desired: "on", issuedBy: parentSession.id }],
			"the parent's activation is present in the child file",
		);

		const delegated = { PI_SUBAGENT_ID: "craft-child-1" };
		const child = await lab.start({ label: "child", env: delegated, args: ["--session", childFile] });
		const status = (await child.command("/craft-mode status")).text;
		assert.ok(status.startsWith(`Craft mode: off here: only records copied from session ${parentSession.id} exist`), status);
		assert.match(status, /Ownership: delegated child \(PI_SUBAGENT_ID set\)/);
		assertUnguided(views(await child.prompt("CHILD-1"))[0], "inherited activation ignored");
		assert.match((await child.command("/craft-mode on")).text, /^Craft mode is on for this branch/, "the child's first decision records its own state");
		assertGuided(views(await child.prompt("CHILD-2"))[0], "child on");
		await child.command('/drv record {"version":1,"desired":"on","issuedBy":7}');
		assert.match((await child.command("/craft-mode status")).text, /no owning session/, "malformed ownership fails closed");
		assertUnguided(views(await child.prompt("CHILD-3"))[0], "malformed ownership");
		await child.command("/craft-mode on");
		await child.close();

		const resumed = await lab.start({ label: "child-resumed", env: delegated, args: ["--session", childFile] });
		assert.match((await resumed.command("/craft-mode status")).text, /^Craft mode: on \(recorded by session 01a20000/);
		assertGuided(views(await resumed.prompt("CHILD-4"))[0], "child resumed with the hint");
		await resumed.command("/craft-mode off");
		assertUnguided(views(await resumed.prompt("CHILD-5"))[0], "child off");
		await resumed.close();

		// Without the hint a copied record is indistinguishable from a human fork: documented, not a boundary.
		const hintless = await lab.start({ label: "hintless", args: ["--session", seed("01a20000-0000-7000-8000-00000000c002")] });
		assertGuided(views(await hintless.prompt("HINTLESS-1"))[0], "hintless resume applies copied intent");
		const ledger = await lab.finish();
		assert.equal(ledger.length, 7);
		lab.markPassed();
	});
});

describe("/craft-mode resource fidelity", () => {
	it("refuses to enable or deliver a missing, filtered, shadowed, linked, or non-explicit hub", async (t) => {
		const lab = await openLab(t, "resources");
		const missing = stagePackage(lab.root, "missing", (root) => {
			const skill = join(root, "skills/craft-mode/SKILL.md");
			writeFileSync(skill, readFileSync(skill, "utf8").replace("name: craft-mode", "name: craft-mode-renamed"));
		});
		const permissive = stagePackage(lab.root, "permissive", (root) => {
			const skill = join(root, "skills/craft-mode/SKILL.md");
			writeFileSync(skill, readFileSync(skill, "utf8").replace("disable-model-invocation: true\n", ""));
		});
		const shadowDir = join(lab.root, "agent-shadow");
		mkdirSync(join(shadowDir, "skills/craft-mode"), { recursive: true });
		writeFileSync(join(shadowDir, "skills/craft-mode/SKILL.md"), "---\nname: craft-mode\ndescription: Shadow copy.\ndisable-model-invocation: true\n---\n\nSHADOW BODY\n");
		const linkDir = join(lab.root, "agent-link");
		mkdirSync(join(linkDir, "skills/craft-mode"), { recursive: true });
		symlinkSync(HUB_PATH, join(linkDir, "skills/craft-mode/SKILL.md"));

		const cases = [
			{ label: "missing", options: { packages: [missing] }, reason: /skill:craft-mode is not registered/ },
			{ label: "filtered", options: { packages: [{ source: PACKAGE_ROOT, skills: [] }] }, reason: /skill:craft-mode is not registered/ },
			{ label: "shadowed", options: { agentDir: shadowDir }, reason: /another skill shadows it/ },
			{ label: "linked", options: { agentDir: linkDir }, reason: /a link outside this package's skill directory/ },
			{ label: "permissive", options: { packages: [permissive] }, reason: /is not explicit-only/ },
		];
		for (const { label, options, reason } of cases) {
			const pi = await lab.start({ label, ...options });
			assert.match((await pi.command("/craft-mode status")).text, new RegExp(`Hub blocked: .*${reason.source}`), label);
			assert.match((await pi.command("/craft-mode on")).text, new RegExp(`^cannot enable craft mode: .*${reason.source}`), label);
			assert.match((await pi.command("/craft-mode TASK-WHILE-BLOCKED")).text, /^Task not submitted: cannot enable craft mode/, label);
			assert.deepEqual(records(await pi.entries()), [], `${label}: refusal recorded nothing`);
			await pi.command(`/drv record ${JSON.stringify({ version: 1, desired: "on", issuedBy: "planted" })}`);
			const [view] = views(await pi.prompt(`${label} saved on`));
			assert.equal(view.carrierHub, 0, `${label}: no hub delivered`);
			assert.equal(view.reminders, 1, `${label}: one honest notice`);
			assert.ok(view.turns.at(-1).text.includes("its canonical hub is unavailable"), `${label}: the notice says why`);
			assert.match((await pi.command("/craft-mode off")).text, /^Craft mode is off/, `${label}: off works without the hub`);
			assertUnguided(views(await pi.prompt(`${label} off`))[0], `${label} off`);
			await pi.close();
		}
		const ledger = await lab.finish();
		assert.equal(ledger.length, cases.length * 2);
		assert.ok(ledger.every((entry) => occurrences(entry, "TASK-WHILE-BLOCKED") === 0 && occurrences(entry, "SHADOW BODY") === 0));
		lab.markPassed();
	});

	it("revalidates the hub on every request, accepts a linked package root, and ignores enableSkillCommands", async (t) => {
		const lab = await openLab(t, "revalidate");
		const staged = stagePackage(lab.root, "staged");
		const stagedHub = join(staged, "skills/craft-mode/SKILL.md");
		const pi = await lab.start({ label: "unreadable", packages: [staged] });
		const hub = hubBlock(stagedHub);
		await pi.command("/craft-mode on");
		assertGuided(views(await pi.prompt("U1 readable"), hub)[0], "readable");
		chmodSync(stagedHub, 0o000);
		try {
			assert.match((await pi.command("/craft-mode status")).text, /Hub blocked: the registered hub at \S+ is unreadable/);
			const [view] = views(await pi.prompt("U2 unreadable"), hub);
			assert.equal(view.carrierHub, 0);
			assert.ok(view.turns.at(-1).text.includes("its canonical hub is unavailable"));
		} finally {
			chmodSync(stagedHub, 0o644);
		}
		assertGuided(views(await pi.prompt("U3 readable again"), hub)[0], "readable again");
		await pi.close();

		const link = join(lab.root, "linked-package");
		symlinkSync(PACKAGE_ROOT, link);
		const linked = await lab.start({ label: "linked-root", packages: [link], settings: { enableSkillCommands: false } });
		const registered = (await linked.raw({ type: "get_commands" })).data.commands.find((command) => command.name === "skill:craft-mode").sourceInfo.path;
		const linkedHub = hubBlock(registered);
		await linked.command("/craft-mode on");
		assertGuided(views(await linked.prompt("L1 linked root"), linkedHub)[0], "linked package root");
		assertGuided(views(await linked.prompt("/skill:craft-mode LINKED-SHOT"), linkedHub)[0], "one-shot under a linked root", { carrier: 0, user: 1 });
		await lab.finish();
		lab.markPassed();
	});

	it("blocks at an unreadable or future activation record instead of reviving an earlier one", async (t) => {
		const lab = await openLab(t, "records");
		const pi = await lab.start({ label: "records" });
		await pi.command("/craft-mode on");
		await pi.command(`/drv record ${JSON.stringify({ version: 2, desired: "on", issuedBy: "future" })}`);
		assert.match((await pi.command("/craft-mode status")).text, /^Craft mode: blocked: an activation record has version 2, newer than this extension understands; earlier records are not revived\./);
		assertUnguided(views(await pi.prompt("F1 future"))[0], "future record");
		await pi.command("/craft-mode on");
		assertGuided(views(await pi.prompt("F2 explicit on"))[0], "explicit on after a future record");
		await pi.command(`/drv record ${JSON.stringify({ desired: "maybe" })}`);
		assert.match((await pi.command("/craft-mode status")).text, /^Craft mode: blocked: an activation record is malformed/);
		assertUnguided(views(await pi.prompt("F3 malformed"))[0], "malformed record");
		assert.match((await pi.command("/craft-mode off")).text, /^Craft mode is off/);
		assertUnguided(views(await pi.prompt("F4 off"))[0], "off after malformed");
		await lab.finish();
		lab.markPassed();
	});

	it("refuses safely when two copies of the extension register the command", async (t) => {
		const lab = await openLab(t, "duplicate");
		const copy = stagePackage(lab.root, "copy");
		const pi = await lab.start({ label: "duplicate", packages: [PACKAGE_ROOT, copy] });
		const names = (await pi.raw({ type: "get_commands" })).data.commands.filter((command) => command.source === "extension" && command.name.startsWith("craft-mode"));
		assert.deepEqual(names.map((command) => command.name).toSorted(), ["craft-mode:1", "craft-mode:2"]);
		const bare = await pi.command("/craft-mode on");
		assert.match(bare.text, /^\/craft-mode is ambiguous \(craft-mode:1, craft-mode:2\); the input was not sent to the model/);
		assert.match((await pi.command("/craft-mode:1 on")).text, /^\/craft-mode is loaded more than once/);
		assert.match((await pi.command("/craft-mode:2 some task")).text, /^Task not submitted: \/craft-mode is loaded more than once/);
		assert.match((await pi.command("/craft-mode:2 status")).text, /Command: ambiguous, loaded as craft-mode:1, craft-mode:2/);
		assert.deepEqual(records(await pi.entries()), []);
		await pi.command(`/drv record ${JSON.stringify({ version: 1, desired: "on", issuedBy: "planted" })}`);
		assertUnguided(views(await pi.prompt("D1 ambiguous"))[0], "ambiguous copies add nothing");
		const ledger = await lab.finish();
		assert.equal(ledger.length, 1, "the bare ambiguous command never reached the model");
		lab.markPassed();
	});
});

describe("/craft-mode coexistence", () => {
	it("preserves foreign system, message, and context content and runs beside another mode, each switched off independently", async (t) => {
		const lab = await openLab(t, "coexistence");
		const pi = await lab.start({ label: "coexistence", env: { DRV_FOREIGN: "1", DRV_OTHER_MODE: "1" } });
		assert.match((await pi.command("/craft-mode status")).text, /Other modes: \/other-mode also loaded\. Their state is not read or changed here/);
		const count = (view, text) => view.turns.filter((turn) => turn.text === text).length;
		let prompts = 0;
		const check = async (label, { ours, theirs }) => {
			prompts += 1;
			const requests = await pi.prompt(label);
			const [view] = views(requests);
			assert.ok(view.system.includes("FOREIGN-SYSTEM-GUIDANCE"), `${label}: foreign system guidance kept`);
			assert.equal(count(view, "FOREIGN-PERSISTED-NOTE"), prompts, `${label}: every persisted foreign message kept`);
			assert.equal(count(view, "FOREIGN-CONTEXT-CARRIER"), 1, `${label}: foreign context addition kept`);
			assert.equal(count(view, "OTHER-MODE-REMINDER"), theirs ? 1 : 0, `${label}: other mode`);
			assert.equal(view.carrierHub, ours ? 1 : 0, `${label}: our hub`);
			assert.equal(view.reminders, ours ? 1 : 0, `${label}: our reminder`);
			if (ours)
				assert.match(
					view.turns.find((turn) => turn.text.startsWith(REMINDER_TAG)).text,
					/If another methodology mode is also active, keep the current coordinator and ask the user which one should coordinate/,
				);
			return requests;
		};
		await pi.command("/craft-mode on");
		await pi.command("/other-mode on");
		const both = await check("K1 both on", { ours: true, theirs: true });
		await pi.command("/craft-mode off");
		const theirs = await check("K2 ours off", { ours: false, theirs: true });
		await pi.command("/other-mode off");
		await check("K3 both off", { ours: false, theirs: false });
		await pi.command("/craft-mode on");
		await check("K4 ours on, theirs off", { ours: true, theirs: false });
		assert.deepEqual(
			(await pi.entries()).filter((entry) => entry.type === "custom" && entry.customType === "other.mode").map((entry) => entry.data.on),
			[true, false],
			"the other mode's state is untouched",
		);
		assert.ok(withoutCarriers(both[0], HUB).length > 0 && withoutCarriers(theirs[0], HUB).length > 0);
		await lab.finish();
		lab.markPassed();
	});
});
