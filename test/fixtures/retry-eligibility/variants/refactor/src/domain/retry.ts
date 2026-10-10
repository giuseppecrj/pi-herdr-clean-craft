export type Failure = "transient" | "permanent";
export type Decision = "retry" | "stop";

export type RetryRequest = {
	readonly failure: Failure;
	readonly attemptsMade: number;
	readonly maxAttempts: number;
};

const RETRYABLE: Readonly<Record<Failure, boolean>> = { transient: true, permanent: false };

export function decideRetry({ failure, attemptsMade, maxAttempts }: RetryRequest): Decision {
	const exhausted = attemptsMade >= maxAttempts;
	return RETRYABLE[failure] && !exhausted ? "retry" : "stop";
}
