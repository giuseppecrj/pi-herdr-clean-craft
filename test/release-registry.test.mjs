import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isolatedEnv, makeTempRoot, PACKAGE_ROOT, run } from "./support.mjs";

const REGISTRY = join(PACKAGE_ROOT, "scripts", "release", "registry.mjs");
const NAME = "pi-herdr-clean-craft";
const VERSION = "1.2.3";
const SHA = "a".repeat(40);

async function startRegistry(t, handler) {
	const requests = [];
	const server = createServer((request, response) => {
		requests.push({ method: request.method, url: request.url, accept: request.headers.accept });
		handler(request, response);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => {
		server.closeAllConnections();
		return new Promise((resolve) => server.close(resolve));
	});
	return { url: `http://127.0.0.1:${server.address().port}/`, requests };
}

function reply(status, body, headers = { "content-type": "application/json" }) {
	return (_request, response) => {
		response.writeHead(status, headers);
		response.end(typeof body === "string" ? body : JSON.stringify(body));
	};
}

async function check(t, { handler, registryUrl, extraEnv = {} }) {
	const root = makeTempRoot(t, "release-registry");
	const server = handler ? await startRegistry(t, handler) : { url: registryUrl, requests: [] };
	const output = join(root, "github-output");
	const started = performance.now();
	const result = await run(process.execPath, [REGISTRY], {
		cwd: root,
		env: isolatedEnv(root, {
			PACKAGE_NAME: NAME,
			VERSION,
			GITHUB_SHA: SHA,
			REGISTRY_URL: server.url,
			GITHUB_OUTPUT: output,
			...extraEnv,
		}),
		timeoutMs: 30_000,
		root,
	});
	const outputs = existsSync(output) ? readFileSync(output, "utf8") : null;
	return { ...result, outputs, requests: server.requests, elapsedMs: performance.now() - started };
}

function assertState(result, state) {
	assert.equal(result.code, 0, result.stderr);
	assert.equal(result.outputs, `registry=${state}\n`);
}

function assertRefused(result, pattern) {
	assert.equal(result.code, 1, `expected a refusal\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
	assert.equal(result.outputs, null, "a refusal writes no registry state");
	assert.match(`${result.stdout}${result.stderr}`, /::error::/);
	if (pattern) assert.match(`${result.stdout}${result.stderr}`, pattern);
}

const metadata = (versions) => ({ name: NAME, versions });

describe("registry guard: recognized states", () => {
	it("reports absent only for npm's exact not-found body, and asks for the package document", async (t) => {
		const result = await check(t, { handler: reply(404, { error: "Not found" }) });
		assertState(result, "absent");
		assert.deepEqual(result.requests, [{ method: "GET", url: `/${NAME}`, accept: "application/json" }]);
	});

	it("reports absent for the not-found body with JSON whitespace around its tokens", async (t) => {
		assertState(await check(t, { handler: reply(404, ' {\n\t"error" : "Not found"\r\n}\n') }), "absent");
	});

	it("reports version-absent when the package exists without this version", async (t) => {
		assertState(await check(t, { handler: reply(200, metadata({ "1.2.2": { name: NAME, version: "1.2.2", gitHead: "b".repeat(40) } })) }), "version-absent");
		assertState(await check(t, { handler: reply(200, metadata({})) }), "version-absent");
	});

	it("reports same-commit-published only when gitHead is this commit", async (t) => {
		assertState(await check(t, { handler: reply(200, metadata({ [VERSION]: { name: NAME, version: VERSION, gitHead: SHA } })) }), "same-commit-published");
	});
});

describe("registry guard: refusals", () => {
	it("refuses an existing version from another commit or without a gitHead, before any tag or release", async (t) => {
		assertRefused(await check(t, { handler: reply(200, metadata({ [VERSION]: { name: NAME, version: VERSION, gitHead: "b".repeat(40) } })) }), /gitHead/);
		assertRefused(await check(t, { handler: reply(200, metadata({ [VERSION]: { name: NAME, version: VERSION } })) }), /gitHead/);
		assertRefused(await check(t, { handler: reply(200, metadata({ [VERSION]: { name: NAME, version: VERSION, gitHead: SHA.toUpperCase() } })) }), /gitHead/);
	});

	it("refuses ambiguous not-found replies", async (t) => {
		for (const body of [{ error: "E404" }, { error: "Not found", detail: "x" }, [], "Not found", "", { error: "not found" }]) {
			assertRefused(await check(t, { handler: reply(404, body) }), /404/);
		}
	});

	it("refuses a not-found body with a repeated key, which JSON.parse would collapse to its last value, or another spelling", async (t) => {
		for (const body of [
			'{"error":"Unauthorized","error":"Not found"}',
			'{"error":"Not found","error":"Not found"}',
			'{"error":"Not found","error":"Unauthorized"}',
			'{"error":"Not\\u0020found"}',
			'\u00a0{"error":"Not found"}',
		]) {
			assertRefused(await check(t, { handler: reply(404, body) }), /404/);
		}
	});

	it("refuses authentication, server, and other HTTP failures", async (t) => {
		for (const status of [401, 403, 429, 500, 503, 204]) {
			assertRefused(await check(t, { handler: reply(status, status === 204 ? "" : { error: "denied" }) }), new RegExp(`HTTP ${status}`));
		}
	});

	it("refuses a redirect instead of following it", async (t) => {
		const result = await check(t, {
			handler: (request, response) => {
				if (request.url === "/followed") return reply(404, { error: "Not found" })(request, response);
				response.writeHead(302, { location: "/followed" });
				response.end();
			},
		});
		assertRefused(result, /redirect|fetch/i);
		assert.deepEqual(
			result.requests.map((request) => request.url),
			[`/${NAME}`],
		);
	});

	it("refuses when the registry does not answer within the bound", async (t) => {
		const result = await check(t, { handler: () => {}, extraEnv: { REGISTRY_TIMEOUT_MS: "300" } });
		assertRefused(result, /time|abort/i);
		assert.ok(result.elapsedMs < 10_000, `took ${result.elapsedMs} ms`);
	});

	it("refuses a connection failure", async (t) => {
		const server = createServer();
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		const { port } = server.address();
		await new Promise((resolve) => server.close(resolve));
		assertRefused(await check(t, { registryUrl: `http://127.0.0.1:${port}/` }), /fetch|connect|ECONNREFUSED/i);
	});

	it("refuses an oversized document", async (t) => {
		const padding = "x".repeat(9 * 1024 * 1024);
		assertRefused(await check(t, { handler: reply(200, { name: NAME, versions: {}, padding }) }), /large|limit|bytes/i);
	});

	it("refuses malformed or mismatched package metadata", async (t) => {
		for (const body of [
			"{}\n{}",
			"null",
			{ name: "other-package", versions: {} },
			{ name: NAME },
			{ name: NAME, versions: [] },
			{ name: NAME, versions: null },
			metadata({ [VERSION]: null }),
			metadata({ [VERSION]: "1.2.3" }),
			metadata({ [VERSION]: { name: NAME, version: `${VERSION}\n`, gitHead: SHA } }),
			metadata({ [VERSION]: { name: "other-package", version: VERSION, gitHead: SHA } }),
		]) {
			assertRefused(await check(t, { handler: reply(200, body) }), /metadata|JSON|name|version/i);
		}
	});

	it("refuses invalid inputs without making a request", async (t) => {
		const server = await startRegistry(t, reply(404, { error: "Not found" }));
		for (const extraEnv of [
			{ PACKAGE_NAME: "other-package" },
			{ VERSION: "1.2" },
			{ VERSION: "1.2.3-rc.1" },
			{ GITHUB_SHA: "HEAD" },
			{ REGISTRY_URL: "http://registry.npmjs.org/" },
			{ REGISTRY_URL: "ftp://127.0.0.1/" },
			{ REGISTRY_TIMEOUT_MS: "0" },
			{ REGISTRY_TIMEOUT_MS: "120000" },
		]) {
			const result = await check(t, { registryUrl: server.url, extraEnv });
			assertRefused(result);
		}
		assert.deepEqual(server.requests, []);
	});
});
