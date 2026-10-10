import { decideRetry, type Decision, type Failure } from "../domain/retry.ts";
import { TRANSIENT_ERROR_CODES } from "../infra/error-codes.ts";

export type JobFailure = {
	readonly code: string;
	readonly attemptsMade: number;
	readonly maxAttempts: number;
};

export function onJobFailure({ code, attemptsMade, maxAttempts }: JobFailure): Decision {
	const failure: Failure = TRANSIENT_ERROR_CODES.includes(code) ? "transient" : "permanent";
	return decideRetry({ failure, attemptsMade, maxAttempts });
}
