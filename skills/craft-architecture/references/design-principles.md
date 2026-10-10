# Design principles as review questions

Principles are useful when they explain a specific difficulty in specific code. Use the questions below to find that difficulty, and recommend a change only when you can point to the code that needs it. None of them requires a particular paradigm, layer count, or pattern.

## Responsibility

- What would cause this module to change? If the answers involve different people or different reasons, such as a tax rule and a report layout, the module mixes responsibilities.
- Can you name the module's job in one short phrase without "and"?
- Not applicable when the pieces always change together. Splitting them would only scatter one decision.

## Extension and modification

- When a new variant arrives, such as another payment method or another file format, how many existing places must be edited? Several scattered edits suggest the variation needs one home.
- Not applicable when no new variants are expected. Speculative extension points cost more than the edit they would avoid.

## Substitutability

- Can every implementation of an interface be used wherever the interface is expected, without callers checking which one they have?
- Does any implementation throw "not supported" for part of the contract, or quietly weaken a guarantee?
- A caller that inspects concrete types to decide what to do shows that substitution has failed.

## Interface size

- Do clients depend on operations they never call? A client that needs two methods but compiles against twenty must be rebuilt, retested, or mocked whenever the other eighteen change.
- Not applicable to a cohesive interface whose clients all use most of it.

## Dependency direction

- Do high-level policies depend on low-level details, or do details depend on policies? Policy that imports a database driver cannot be tested or reused without it.
- Could the detail be passed in as a value, a function, or a narrow interface that the policy side owns?
- In languages and projects where a direct call is simpler and the detail is stable, a direct dependency can be the right choice. Say why.

## Information hiding

- Which design decisions does this module hide, and which does it leak through its exports, types, or errors?
- If the storage format or the third-party client changed, how far would the change spread?

## Invariants

- For each rule the system must never break, which single place enforces it? Rules enforced partly in several places drift apart.
- Can an invalid value be constructed and passed around before anything notices? Validating where data enters, and passing a type that cannot hold the invalid value, is often simpler than checking everywhere.

## Cycles and stability

- Are there cycles between modules? A cycle makes its members change, build, and test together, whatever the folder structure says.
- Do modules that many others depend on change often? Widely used code should be the most stable, or the most abstract, or both.

## Signals that a principle is being misapplied

- One interface per class, created before any second implementation exists.
- Layers that only pass calls through.
- Abstractions named for a pattern, such as a manager, factory, or strategy, rather than for what they do.
- A refactor justified only by a principle's name, with no difficulty in the current code.
