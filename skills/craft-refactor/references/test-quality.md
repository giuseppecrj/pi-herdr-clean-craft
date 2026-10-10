# Test quality

Use these questions when reading, cleaning up, or adding tests. They are review prompts, not a scoring system. This pack has no analyzer that measures them.

## Is the behavior visible?

- Can a reader tell from the test alone what situation it sets up, what it does, and what result it expects? If they must open three helpers to find out, the test is harder to read than it looks.
- Does the name describe the behavior and its condition, such as "stops once attempts reach the maximum", rather than the function under test?
- Does each test check one behavior? Several assertions are fine when they describe one outcome. Several unrelated outcomes belong in separate tests.

## Are the assertions strong enough?

- Does the test compare against an exact expected value? Checks that only confirm a value exists, has a type, is truthy, or did not throw often pass for wrong answers.
- Does it exercise the edge the behavior turns on? A limit tested only far beyond the boundary misses off-by-one mistakes.
- Would the test fail if the line it is meant to protect were changed or deleted? If you cannot tell, a seeded change answers it. See [craft-mutation](../../craft-mutation/SKILL.md).
- Coverage shows that code ran during a test, not that any assertion checked its result. High coverage with weak assertions is common.

## Where did the complexity go?

- Shortening a test by moving setup and branching into a helper does not remove complexity. It hides it. Count the helper's logic as part of the test when judging readability.
- A helper that builds the expected value with the same logic as the code under test can agree with the code even when both are wrong. Prefer literal expected values.
- Conditionals and loops inside a test body make it harder to see which case failed. A table of literal cases, each reported under its own name, is usually clearer.

## Is the repetition harmful or intentional?

- Repetition that lets each test be read on its own is often worth keeping.
- Copied setup that must change in step across many tests, and has already drifted in places, is worth consolidating into a well-named builder whose defaults are visible.
- Two tests that look alike but check different behaviors should stay separate.

## Does the test depend on structure it should not?

- A test that mocks every collaborator of the unit fixes the unit's internal call pattern in place, so a refactor breaks it without any change in behavior. Prefer real collaborators where they are cheap and deterministic, and substitute only at real boundaries such as the network, the clock, or external services.
- Snapshot assertions of large outputs tend to be approved without being read. Prefer assertions on the parts that matter.

## Is it reliable?

- Does it pass and fail the same way on every run and in every order? Shared state, real time, randomness, and ordering assumptions cause intermittent failures that train people to ignore red.
- Does it clean up what it creates?

The pack's provenance document records the inspiration for this review style. No external test-structure analyzer is used or claimed here.
