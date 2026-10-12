export class StepFailure extends Error {
	constructor(step, reason) {
		super(`${step}: ${reason}`);
		this.step = step;
		this.reason = reason;
	}
}

export function deadline(ms, step) {
	return Object.freeze({ at: performance.now() + ms, step });
}

export function remaining(limit) {
	return Math.max(0, limit.at - performance.now());
}

export async function within(promise, limit) {
	let timer;
	const expiry = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new StepFailure(limit.step, "deadline expired")), remaining(limit));
	});
	try {
		return await Promise.race([promise, expiry]);
	} finally {
		clearTimeout(timer);
	}
}

const FAULT_SAMPLES = 20;

export function createEventLog(label, capacity, describe = () => null) {
	const entries = [];
	const waiters = new Set();
	const samples = [];
	let faultCount = 0;
	let closure = null;

	function fault(kind, detail = null) {
		faultCount += 1;
		if (samples.length < FAULT_SAMPLES) samples.push(Object.freeze({ kind, detail }));
	}

	function settle(waiter, outcome) {
		waiters.delete(waiter);
		clearTimeout(waiter.timer);
		if (outcome.entry) waiter.resolve(outcome.entry);
		else waiter.reject(outcome.error);
	}

	function close(reason) {
		if (closure) return;
		closure = reason;
		for (const waiter of Array.from(waiters)) settle(waiter, { error: new StepFailure(waiter.step, `${label} closed: ${reason}`) });
	}

	function append(fields) {
		if (entries.length >= capacity) {
			fault("capacity", describe(fields));
			close(`capacity of ${capacity} entries reached`);
			return null;
		}
		if (closure) {
			fault("after-close", describe(fields));
			return null;
		}
		const entry = Object.freeze({ index: entries.length, ...fields });
		entries.push(entry);
		for (const waiter of Array.from(waiters)) {
			if (entry.index >= waiter.from && waiter.predicate(entry)) settle(waiter, { entry });
		}
		return entry;
	}

	function waitFor(predicate, { from = 0, limit }) {
		const found = entries.find((entry) => entry.index >= from && predicate(entry));
		if (found) return Promise.resolve(found);
		if (closure) return Promise.reject(new StepFailure(limit.step, `${label} closed: ${closure}`));
		return new Promise((resolve, reject) => {
			const waiter = { predicate, from, step: limit.step, resolve, reject };
			waiter.timer = setTimeout(() => settle(waiter, { error: new StepFailure(limit.step, `deadline expired waiting on ${label}`) }), remaining(limit));
			waiters.add(waiter);
		});
	}

	return {
		label,
		append,
		close,
		fault,
		waitFor,
		get closure() {
			return closure;
		},
		get faults() {
			return Object.freeze({ count: faultCount, samples: Object.freeze(samples.slice()) });
		},
		get size() {
			return entries.length;
		},
		get entries() {
			return entries.slice();
		},
	};
}
