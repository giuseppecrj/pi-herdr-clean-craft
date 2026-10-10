import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SKILLS } from "./inventory.mjs";
import { FIXED_REPLY } from "./phase3/delivery.mjs";
import { expectedSkill, skillDeliveryProblem } from "./phase3/evidence.mjs";
import { parseRequestBody, skillBlock, textReply } from "./phase3/wire.mjs";
import { PACKAGE_ROOT } from "./support.mjs";

const SKILL = SKILLS.find((skill) => skill.name === "craft-mode");
const LOCATION = join(PACKAGE_ROOT, SKILL.path);
const EXPECTED = expectedSkill({ name: SKILL.name, location: LOCATION, fileText: readFileSync(LOCATION, "utf8") });
const TASK = "TASK-craft-mode-negative-control";

function user(text) {
	return { role: "user", content: [{ type: "text", text }] };
}

function assistant(text) {
	return { role: "assistant", content: text };
}

function entry(messages, reply = FIXED_REPLY) {
	const raw = JSON.stringify({ model: "fixture", messages: [{ role: "system", content: "system prompt" }, ...messages], stream: true });
	return { origin: { kind: "case", token: "t" }, refused: null, parsed: parseRequestBody(raw), reply: textReply(reply) };
}

function invocation({ body = EXPECTED.body, location = EXPECTED.location, baseDir = EXPECTED.baseDir, task = TASK } = {}) {
	return `${skillBlock({ name: SKILL.name, location, baseDir, body })}\n\n${task}`;
}

describe("skill delivery evidence boundary", () => {
	it("accepts the measured Pi 1.1.0 expansion of the canonical skill", () => {
		assert.equal(skillDeliveryProblem(entry([user(invocation())]), EXPECTED, TASK), null);
	});

	it("rejects a body truncated by one line", () => {
		const body = EXPECTED.body.slice(0, EXPECTED.body.lastIndexOf("\n"));
		assert.equal(skillDeliveryProblem(entry([user(invocation({ body }))]), EXPECTED, TASK), "delivered body differs from the canonical instructions");
	});

	it("rejects the same skill name delivered from another package path", () => {
		const location = "/tmp/decoy/skills/craft-mode/SKILL.md";
		assert.match(skillDeliveryProblem(entry([user(invocation({ location, baseDir: "/tmp/decoy/skills/craft-mode" }))]), EXPECTED, TASK), /^skill location /);
	});

	it("rejects a block whose reference base differs from its location", () => {
		assert.match(skillDeliveryProblem(entry([user(invocation({ baseDir: "/tmp/elsewhere" }))]), EXPECTED, TASK), /^reference base /);
	});

	it("rejects instructions and marker found only in an earlier user turn", () => {
		const messages = [user(invocation()), assistant(FIXED_REPLY), user(`/skill:craft-mode ${TASK}`)];
		assert.equal(skillDeliveryProblem(entry(messages), EXPECTED, TASK), "new input is not an expanded skill block");
	});

	it("rejects instructions and marker found only in assistant text", () => {
		const messages = [user("Start."), assistant(invocation()), user("Continue.")];
		assert.equal(skillDeliveryProblem(entry(messages), EXPECTED, TASK), "new input is not an expanded skill block");
	});

	it("rejects raw slash text forwarded without expansion", () => {
		assert.equal(skillDeliveryProblem(entry([user(`/skill:craft-mode ${TASK}`)]), EXPECTED, TASK), "new input is not an expanded skill block");
	});

	it("rejects a block with the wrong task argument", () => {
		assert.match(skillDeliveryProblem(entry([user(invocation({ task: "TASK-other" }))]), EXPECTED, TASK), /^task argument /);
	});

	it("rejects a reply that echoes the task", () => {
		assert.equal(skillDeliveryProblem(entry([user(invocation())], `Done ${TASK}`), EXPECTED, TASK), "reply echoes the task or the instructions");
	});

	it("rejects a refused or malformed request", () => {
		const malformed = { origin: { kind: "case" }, refused: "body is not JSON", parsed: null, reply: null };
		assert.match(skillDeliveryProblem(malformed, EXPECTED, TASK), /^request refused/);
		assert.equal(parseRequestBody("{").kind, "malformed");
		assert.equal(parseRequestBody(JSON.stringify({ messages: [{ content: "x" }] })).kind, "malformed");
	});
});
