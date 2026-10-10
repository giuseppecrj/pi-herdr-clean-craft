import assert from "node:assert/strict";
import { test } from "node:test";
import { decideRetry } from "../src/domain/retry.ts";

test("stops after too many attempts", () => {
	assert.equal(decideRetry({ failure: "transient", attemptsMade: 4, maxAttempts: 3 }), "stop");
});

test("returns a decision at the limit", () => {
	assert.ok(["retry", "stop"].includes(decideRetry({ failure: "transient", attemptsMade: 3, maxAttempts: 3 })));
});
