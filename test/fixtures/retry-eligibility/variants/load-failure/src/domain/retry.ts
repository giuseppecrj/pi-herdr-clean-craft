export type Failure = "transient" | "permanent";
export type Decision = "retry" | "stop";

export type RetryRequest = {
	readonly failure: Failure;
	readonly attemptsMade: number;
	readonly maxAttempts: number;
};

export function decide(request: RetryRequest): Decision {
	if (request.failure === "permanent") return "stop";
	if (request.attemptsMade >= request.maxAttempts) return "stop";
	return "retry";
}
