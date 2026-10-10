# Interpreting mutation results

A mutation result says how a particular set of tests responded to a particular set of changes, on one revision, under one tool's counting rules. Each of those qualifiers matters when you report it.

## What counts as killed

The strongest evidence of a kill is a named test that reached its assertion and failed because the mutant changed the result. Other ways a run can fail are weaker:

- **Compile or load failure.** The mutant made the code invalid, so no test judged its behavior. Report it as invalid, not as killed.
- **Timeout.** The mutant may have created an infinite loop, which a real test might also catch, or the machine may simply have been slow. Report it separately.
- **Crash or infrastructure error.** Nothing about the tests can be concluded.
- **Unrelated failure.** The test failed for a reason the mutant did not cause, such as an intermittent test. Rerun the case or exclude it.

Some tools count invalid mutants or timeouts as killed. When yours does, keep that rule in the report next to the score, and do not present the result as stricter than it is. You cannot separate the categories after the fact if the tool did not record them.

## Scores

- A kill rate is a ratio, and its denominator matters. State whether uncovered, invalid, timed-out, and equivalent mutants are included.
- A high kill rate with code that no test executes is incomplete evidence, not strong tests.
- Scores from different tools, tool versions, mutation operators, or scopes are not comparable without qualification.
- A score is never a target. Raising it by weakening mutation operators, excluding files, or adding assertion-free tests that only execute code defeats its purpose.

## Survivors

A surviving mutant is a question, not a verdict. Typical answers, in rough order of likelihood:

1. The assertion is too loose. It checks a type, presence, or a value far from the boundary.
2. No test covers the behavior the mutant changed.
3. The mutant is equivalent. The change cannot affect any observable result, for example in an optimization or a redundant check. Explain why.
4. The code is unneeded.

Each of the first two leads to a new or stronger test that fails against the mutant and passes on the original.

## Cached and differential results

Tools that reuse earlier results skip mutants whose source has not changed. That reuse is only valid when the tests, test data, dependencies, and environment have not changed in ways that affect the outcome. After any such change, confirm that the cached kills still hold, or rerun the affected scope and say why.

## Restoration

Mutation rewrites source. Treat restoration as something to prove, not assume:

- Before writing a mutant, confirm that the file matches the recorded original. Otherwise you could overwrite someone's change.
- After each run, and especially after an interruption or crash, compare every affected file with the original, byte for byte, and check that no extra files remain.
- If restoration cannot be confirmed, stop, keep the temporary copy, and report the paths. Do not continue other work on top of an uncertain source tree.
- Confirming restoration covers what you checked on this machine. It does not cover a controller or machine that died partway, unless you checked again afterwards.

## Manual probes versus tools

A few hand-seeded mutants answer a narrow question, such as whether a particular boundary assertion catches an off-by-one mistake. They do not estimate overall test strength. Report them as a probe, list each mutant, and do not present the outcome as a tool's mutation score.
