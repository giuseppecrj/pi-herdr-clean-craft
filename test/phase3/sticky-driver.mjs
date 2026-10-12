// Test-only Pi extension. It drives session operations that RPC does not expose and simulates
// other extensions' traffic. It never reads or writes the clean-craft activation itself except
// through /drv record, which plants a raw record to test parsing at the boundary.

const RECORD_TYPE = "clean-craft-mode";
const SWALLOW = "[[swallow]]";

export default function driver(pi) {
	let barrier = null;
	let armed = false;

	pi.on("input", (event) => (event.text.includes(SWALLOW) ? { action: "handled" } : { action: "continue" }));

	pi.on("tool_call", async (event, ctx) => {
		if (!armed || event.toolName !== "read") return;
		armed = false;
		const released = new Promise((resolve) => {
			barrier = resolve;
		});
		ctx.ui.setStatus("drv", "barrier");
		await released;
	});

	if (process.env.DRV_FOREIGN === "1") {
		pi.on("before_agent_start", (event) => ({
			systemPrompt: `${event.systemPrompt}\nFOREIGN-SYSTEM-GUIDANCE`,
			message: { customType: "foreign.note", content: "FOREIGN-PERSISTED-NOTE", display: false },
		}));
		pi.on("context", (event) => ({ messages: [...event.messages, { role: "custom", customType: "foreign.carrier", content: "FOREIGN-CONTEXT-CARRIER", display: false, timestamp: Date.now() }] }));
	}

	if (process.env.DRV_STRIP_HUB === "1") {
		// Removes the user's own /skill:craft-mode expansion before later context handlers run.
		pi.on("context", (event) => ({
			messages: event.messages.filter((message) => !(message.role === "user" && JSON.stringify(message.content).includes('<skill name=\\"craft-mode\\"'))),
		}));
	}

	if (process.env.DRV_OTHER_MODE === "1") {
		// A second methodology mode with its own state and reminder, owned entirely by this extension.
		pi.registerCommand("other-mode", {
			description: "test-only competing mode",
			handler: async (args) => pi.appendEntry("other.mode", { on: args.trim() === "on" }),
		});
		pi.on("context", (event, ctx) => {
			const last = ctx.sessionManager
				.getBranch()
				.filter((entry) => entry.type === "custom" && entry.customType === "other.mode")
				.at(-1);
			if (last?.data?.on !== true) return undefined;
			return { messages: [...event.messages, { role: "custom", customType: "other.reminder", content: "OTHER-MODE-REMINDER", display: false, timestamp: Date.now() }] };
		});
	}

	pi.registerCommand("drv", {
		description: "test driver",
		handler: async (args, ctx) => {
			const [verb, ...rest] = args.trim().split(/\s+/);
			const text = rest.join(" ");
			switch (verb) {
				case "arm":
					armed = true;
					return;
				case "release":
					barrier?.();
					barrier = null;
					return;
				case "wake":
					pi.sendMessage({ customType: "drv.wake", content: text, display: true }, { triggerTurn: true, deliverAs: "steer" });
					return;
				case "reload":
					await ctx.reload();
					return;
				case "tree": {
					const result = await ctx.navigateTree(text, { summarize: false });
					ctx.ui.notify(`tree ${result.cancelled ? "cancelled" : "moved"}`, "info");
					return;
				}
				case "record":
					pi.appendEntry(RECORD_TYPE, JSON.parse(text));
					return;
				case "session":
					ctx.ui.notify(`session ${ctx.sessionManager.getSessionId()} ${ctx.sessionManager.getSessionFile()}`, "info");
					return;
				default:
					throw new Error(`unknown driver verb ${verb}`);
			}
		},
	});
}
