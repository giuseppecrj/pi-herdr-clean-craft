import assert from "node:assert/strict";
import { test } from "node:test";
import { onJobFailure } from "../src/adapters/job-runner.ts";
import { decideRetry } from "../src/domain/retry.ts";
import { ADAPTER_CASES, DOMAIN_CASES } from "./cases.mjs";

for (const { name, expected, ...request } of DOMAIN_CASES) {
	test(name, () => assert.equal(decideRetry(request), expected));
}

for (const { name, expected, ...failure } of ADAPTER_CASES) {
	test(name, () => assert.equal(onJobFailure(failure), expected));
}
