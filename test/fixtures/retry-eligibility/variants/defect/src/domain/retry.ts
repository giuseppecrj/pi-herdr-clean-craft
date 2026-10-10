export type Failure = "transient" | "permanent";
export type Decision = "retry" | "stop";

export type RetryRequest = {
	readonly failure: Failure;
	readonly attemptsMade: number;
	readonly maxAttempts: number;
};

export function decideRetry(request: RetryRequest): Decision {
	if (request.attemptsMade >= request.maxAttempts) return "stop";
	return "retry";
}
