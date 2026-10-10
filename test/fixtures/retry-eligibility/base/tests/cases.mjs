export const DOMAIN_CASES = [
	{ name: "a transient failure is retried below the limit", failure: "transient", attemptsMade: 1, maxAttempts: 3, expected: "retry" },
	{ name: "the last allowed retry is still taken", failure: "transient", attemptsMade: 2, maxAttempts: 3, expected: "retry" },
	{ name: "stops once attempts reach the maximum", failure: "transient", attemptsMade: 3, maxAttempts: 3, expected: "stop" },
	{ name: "a permanent failure stops on the first attempt", failure: "permanent", attemptsMade: 1, maxAttempts: 3, expected: "stop" },
	{ name: "a NaN attempt count never reaches the maximum", failure: "transient", attemptsMade: NaN, maxAttempts: 3, expected: "retry" },
	{ name: "a NaN maximum is never reached", failure: "transient", attemptsMade: 1, maxAttempts: NaN, expected: "retry" },
];

export const ADAPTER_CASES = [
	{ name: "a reset connection is retried", code: "ECONNRESET", attemptsMade: 1, maxAttempts: 3, expected: "retry" },
	{ name: "an unrecognized error code stops", code: "EACCES", attemptsMade: 1, maxAttempts: 3, expected: "stop" },
];
