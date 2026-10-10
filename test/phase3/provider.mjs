import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createEventLog, deadline, within } from "./event-log.mjs";
import { parseRequestBody, sseFrames } from "./wire.mjs";

export const DUMMY_KEY = "craft-test-dummy-key";
const PROVIDER_LIMITS = Object.freeze({ bodyBytes: 4 * 1024 * 1024, requests: 200, requestMs: 30_000 });

function authorization(header) {
	if (header === undefined) return "absent";
	return header === `Bearer ${DUMMY_KEY}` ? "dummy" : "unexpected";
}

function mintNonce() {
	return `C3N-${randomBytes(16).toString("hex")}`;
}

const IDLE_RESETS = new Set(["ECONNRESET", "EPIPE"]);

function summary(fields) {
	return { origin: fields.origin?.kind ?? null, reason: fields.origin?.reason ?? null, method: fields.method ?? null, path: fields.path ?? null, refused: fields.refused ?? null };
}

export async function startProvider({ model, attribute, respond, limits = PROVIDER_LIMITS }) {
	const ledger = createEventLog("provider ledger", limits.requests, summary);

	function refuse(res, status, message) {
		res.writeHead(status, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: { message } }));
	}

	function originOf(req) {
		try {
			return attribute({ connection: req.socket, remotePort: req.socket.remotePort, localPort: req.socket.localPort, url: req.url });
		} catch (error) {
			return Object.freeze({ kind: "unknown", reason: `attribution failed: ${error.message}` });
		}
	}

	function handle(req, res, origin, raw, overflow) {
		const base = { origin, method: req.method, path: req.url, auth: authorization(req.headers.authorization) };
		if (overflow) {
			ledger.append({ ...base, rawBody: null, parsed: null, refused: `body exceeded ${limits.bodyBytes} bytes`, reply: null, emitted: null, minted: null });
			return refuse(res, 413, "craft-test: request body too large");
		}
		const parsed = parseRequestBody(raw);
		let refused = null;
		if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) refused = `unexpected ${req.method} ${req.url}`;
		else if (parsed.kind !== "parsed") refused = parsed.reason;
		else if (origin.kind === "unknown") refused = `unattributed request: ${origin.reason}`;
		let reply = null;
		let minted = null;
		if (!refused) {
			try {
				const outcome = respond({
					origin,
					request: parsed,
					mint: () => {
						minted ??= mintNonce();
						return minted;
					},
				});
				if (outcome.refusal) refused = outcome.refusal;
				else reply = outcome.reply;
			} catch (error) {
				refused = `responder error: ${error.message}`;
			}
		}
		const emitted = refused ? null : sseFrames(reply, parsed.model ?? model);
		const entry = ledger.append({
			...base,
			rawBody: raw,
			parsed: parsed.kind === "parsed" ? parsed : null,
			refused,
			reply,
			emitted,
			minted: refused ? null : minted,
		});
		if (!entry) return refuse(res, 429, "craft-test: request ledger is full");
		if (refused) return refuse(res, origin.kind === "unknown" ? 503 : 400, `craft-test: ${refused}`);
		res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
		res.end(emitted);
	}

	const server = createServer((req, res) => {
		const origin = originOf(req);
		const chunks = [];
		let size = 0;
		let handled = false;
		req.on("data", (data) => {
			size += data.length;
			if (size <= limits.bodyBytes) chunks.push(data);
		});
		req.on("error", () => {});
		req.on("close", () => {
			if (!req.complete) ledger.fault("request-stream", summary({ origin, method: req.method, path: req.url }));
		});
		res.on("close", () => {
			if (handled && !res.writableFinished) ledger.fault("response-stream", summary({ origin, method: req.method, path: req.url }));
		});
		req.on("end", () => {
			handled = true;
			handle(req, res, origin, Buffer.concat(chunks).toString("utf8"), size > limits.bodyBytes);
		});
	});
	server.requestTimeout = limits.requestMs;
	server.headersTimeout = limits.requestMs;
	server.on("clientError", (error, socket) => {
		if (!IDLE_RESETS.has(error.code)) ledger.fault("client-error", { code: error.code ?? null });
		socket.destroy();
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});

	let closing = null;
	function close() {
		closing ??= (async () => {
			server.closeAllConnections();
			try {
				await within(new Promise((resolve) => server.close(resolve)), deadline(5_000, "provider close"));
				return true;
			} catch {
				return false;
			} finally {
				ledger.close("provider closed");
			}
		})();
		return closing;
	}

	return { port: server.address().port, ledger, close };
}
