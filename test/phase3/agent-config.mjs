import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DUMMY_KEY } from "./provider.mjs";

const MODEL_PROVIDER = "craft-test";
const MODEL_ID = "fixture";
export const MODEL_REF = `${MODEL_PROVIDER}/${MODEL_ID}`;

export function writeAgentConfig(agentDir, { baseUrl, packages, extensions = [] }) {
	mkdirSync(agentDir, { recursive: true });
	const models = {
		providers: {
			[MODEL_PROVIDER]: {
				baseUrl,
				api: "openai-completions",
				apiKey: DUMMY_KEY,
				models: [
					{
						id: MODEL_ID,
						name: "Clean-craft scripted fixture",
						reasoning: false,
						input: ["text"],
						contextWindow: 128_000,
						maxTokens: 1024,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					},
				],
			},
		},
	};
	const settings = {
		packages,
		extensions,
		defaultProvider: MODEL_PROVIDER,
		defaultModel: MODEL_ID,
		defaultThinkingLevel: "off",
		enableInstallTelemetry: false,
		enableAnalytics: false,
		cacheWarming: "off",
		compaction: { enabled: false },
		retry: { enabled: false, provider: { maxRetries: 0 } },
		quietStartup: true,
		defaultProjectTrust: "never",
	};
	writeFileSync(join(agentDir, "models.json"), `${JSON.stringify(models, null, "\t")}\n`);
	writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify(settings, null, "\t")}\n`);
	return { models, settings };
}
