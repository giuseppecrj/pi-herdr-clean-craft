import { TRANSIENT_ERROR_CODES } from "../infra/error-codes.ts";

export type Failure = "transient" | "permanent";
export type Decision = "retry" | "stop";

export type RetryRequest = {
	readonly failure: Failure;
	readonly attemptsMade: number;
	readonly maxAttempts: number;
};

export function failureFromCode(code: string): Failure {
	return TRANSIENT_ERROR_CODES.includes(code) ? "transient" : "permanent";
}

export function decideRetry(request: RetryRequest): Decision {
	if (request.failure === "permanent") return "stop";
	if (request.attemptsMade >= request.maxAttempts) return "stop";
	return "retry";
}
