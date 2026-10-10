import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isolatedEnv } from "../support.mjs";
import { MODEL_REF, writeAgentConfig } from "./agent-config.mjs";
import { deadline } from "./event-log.mjs";
import { startRpcPi } from "./processes.mjs";
import { startProvider } from "./provider.mjs";
import { textReply } from "./wire.mjs";

export const FIXED_REPLY = "CRAFT-FIXED-ACK";

const PI_FLAGS = [
	"--mode",
	"rpc",
	"--no-session",
	"--offline",
	"--no-extensions",
	"--no-context-files",
	"--no-tools",
	"--no-prompt-templates",
	"--no-themes",
	"--no-approve",
	"--model",
	MODEL_REF,
	"--thinking",
	"off",
];

async function attempt(errors, phase, action) {
	try {
		return await action();
	} catch (error) {
		errors.push(Object.freeze({ phase, message: error.message }));
		return null;
	}
}

export async function runSkillDelivery({ pi, packageRoot, root, skills, boundaries = {} }) {
	const { startRpc = startRpcPi, startEndpoint = startProvider } = boundaries;
	const token = randomBytes(8).toString("hex");
	const provider = await startEndpoint({
		model: MODEL_REF,
		attribute: ({ url }) => (url.startsWith(`/${token}/`) ? { kind: "case", token } : { kind: "unknown", reason: `route ${url}` }),
		respond: () => ({ reply: textReply(FIXED_REPLY) }),
	});
	const cases = [];
	let failure = null;
	let rpc = null;
	let exit = null;
	let providerClosed = false;
	const errors = [];
	try {
		const agentDir = join(root, "agent");
		const cwd = join(root, "cwd");
		for (const dir of ["home", "cwd", "xdg/config", "xdg/cache", "xdg/data", "xdg/state"]) mkdirSync(join(root, dir), { recursive: true });
		writeAgentConfig(agentDir, { baseUrl: `http://127.0.0.1:${provider.port}/${token}/v1`, packages: [packageRoot] });
		const env = isolatedEnv(root, { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0" });
		rpc = startRpc({ pi, args: PI_FLAGS, cwd, env, kind: "solo", label: "delivery" });
		for (const skill of skills) {
			const task = `TASK-${skill.name}-${randomBytes(6).toString("hex")}`;
			const from = provider.ledger.size;
			const response = await rpc.request({ type: "prompt", message: `/skill:${skill.name} ${task}` }, deadline(15_000, `prompt ${skill.name}`));
			if (!response.record.success || response.record.data?.disposition !== "started") {
				throw new Error(`prompt ${skill.name}: ${JSON.stringify(response.record)}`);
			}
			const settled = await rpc.log.waitFor((entry) => entry.record?.type === "agent_settled", {
				from: response.index,
				limit: deadline(20_000, `settle ${skill.name}`),
			});
			cases.push({ skill, task, requests: provider.ledger.entries.filter((entry) => entry.index >= from), settled: settled.record });
		}
	} catch (error) {
		failure = error.message;
	} finally {
		if (rpc) exit = await attempt(errors, "delivery pi close", () => rpc.close(deadline(10_000, "delivery pi close")));
		providerClosed = (await attempt(errors, "provider close", () => provider.close())) === true;
	}
	const closed = (rpc === null || exit?.closure === "closed") && providerClosed && errors.length === 0;
	const cleanup = Object.freeze({
		kind: closed ? "closed" : "retained",
		errors: Object.freeze(errors),
		pi: rpc && Object.freeze({ identity: rpc.identity, identityProblem: rpc.identityProblem }),
	});
	const faults = Object.fromEntries([provider.ledger, rpc?.log].filter(Boolean).map((log) => [log.label, log.faults]));
	return { cases, failure, exit, providerClosed, cleanup, faults, stderr: rpc?.stderr() ?? "", ledger: provider.ledger.entries };
}
