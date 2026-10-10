import { decideRetry, failureFromCode, type Decision } from "../domain/retry.ts";

export type JobFailure = {
	readonly code: string;
	readonly attemptsMade: number;
	readonly maxAttempts: number;
};

export function onJobFailure({ code, attemptsMade, maxAttempts }: JobFailure): Decision {
	return decideRetry({ failure: failureFromCode(code), attemptsMade, maxAttempts });
}
