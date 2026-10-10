# pi-herdr-clean-craft — implementation plan

Status: Phases 0 and 1 completed on 2026-10-10 and were committed as `a66de72484f3368f7034048cfe8b20a32c256a12`. Phase 2 passed its local gate on 2026-10-10 after cross-family review and verified corrections. Its six-skill core is complete. Local evidence is in `.audit/phase-0.md`, `.audit/phase-1.md`, and `.audit/phase-2.md`; the decision trail is `.audit/decisions.tsv`. Phase 3 host/coexistence and later evaluation/release gates remain incomplete.

Research date: 2026-10-10.

Target repository: `/home/g/Projects/pi-herdr-clean-craft`.

## 1. Purpose and intended outcome

Build an independently installable Pi methodology pack inspired by Robert C. Martin's engineering practices and the concrete workflows in his public repositories. Follow the separation used by `pi-herdr-pstack`: the pack supplies methodology; `pi-herdr-agents` supplies child execution in Herdr.

The pack should help an agent deliver changes through explicit behavior, test-first implementation, behavior-preserving refactoring, architectural boundary checks, and meaningful verification. Its distinctive value is not another clean-code checklist. It is a repeatable process whose claims are supported by failing tests, passing tests, actual dependency edges, and qualified quality measurements.

The complete scope is eight skills, two workflow sizes, source/provenance documentation, a verification suite, and a later optional sticky command. The six-skill first release is a delivery milestone, not a reduction of the complete plan.

This plan authorizes no installation, publication, upstream contact, or implementation by itself. The original request was to record the plan. The subsequent request to start work authorizes in-scope local implementation. It does not authorize installation into the operator's environment, publication, upstream contact, or shared configuration changes.

## 2. Design decisions

1. **Separate package.** Create `pi-herdr-clean-craft`; do not add methodology to the pack-neutral host or modify pstack to implement this pack.
2. **Original instructions.** Write procedures in our own words, distinguish upstream ideas from our adaptations, and do not copy unlicensed prompts.
3. **Skills first.** Start with native `SKILL.md` resources. No TypeScript extension is necessary for the initial explicit skill entry point.
4. **Eight namespaced skills.** Use `craft-*` names so installation alongside pstack does not collide with `tdd`, `architect`, or other existing skills.
5. **No named roles initially.** Use bounded bare delegates with task-specific reference briefs. Do not require `pi-herdr-roles` or register a role directory.
6. **One workflow owner.** The root session coordinates the work. Children are leaves and return evidence; they do not recursively orchestrate.
7. **Stages are not permanent agents.** A task can run locally or use sequential specialists. Six stages do not require six concurrent processes or worktrees.
8. **Project conventions come first.** Use the project's language, test runner, architectural policy, and verification commands. Do not impose upstream language-specific preferences globally.
9. **Measurements support judgment.** Complexity, coverage, duplication, and mutation scores are qualified signals, not proof of correctness or universal refactoring mandates.
10. **No hidden setup.** Detect capabilities before invoking optional tools. Installing dependencies, changing configuration, or regenerating reports must not be disguised as read-only analysis.
11. **Explicit scope and authority.** Loading a skill grants no new permission to commit, push, merge, publish, delete, install, or alter shared settings.
12. **Progressive disclosure.** Keep the hub compact. Load only the relevant skill, language reference, and delegate brief.

## 3. Evidence and source map

The first investigation surveyed Uncle Bob's repository inventory and read selected repository documentation and agent prompts. This is not an audit of every repository, nor evidence that the tools run correctly in our environment. No upstream installer or quality tool was executed.

### Primary sources

| Source | Material examined | Intended use |
| --- | --- | --- |
| [SwarmForge main](https://github.com/unclebob/swarm-forge) | Main README and shared engineering article | Separate common engineering rules from stage ownership; understand what belongs to the upstream runtime rather than this pack. |
| [SwarmForge two-pack](https://github.com/unclebob/swarm-forge/tree/two-pack) | Product README | Lightweight implementation followed by cleanup and hardening. |
| [SwarmForge six-pack](https://github.com/unclebob/swarm-forge/tree/six-pack) | Product README and all six role prompts | Specification, implementation, cleanup, architecture, hardening, and QA responsibilities. |
| [Acceptance Pipeline Specification](https://github.com/unclebob/Acceptance-Pipeline-Specification) | README and component map | Optional Gherkin-to-IR acceptance pipeline and mutation of example values. Read detailed specifications before implementing an adapter. |
| [crapper](https://github.com/unclebob/crapper) | README and LICENSE | Complexity plus coverage risk assessment across Clojure, Java, Go, TypeScript, Rust, and Python. |
| [mutator](https://github.com/unclebob/mutator) | README and LICENSE | Differential source mutation, survivor investigation, and metric limitations. |
| [dryer](https://github.com/unclebob/dryer) | README and LICENSE | Structural duplication candidates that require semantic review. |
| [dependency-checker](https://github.com/unclebob/dependency-checker) | README | Allowed dependency edges, cycles, and architectural metrics; implementation is Clojure-specific. |
| [SCRAP](https://github.com/unclebob/scrap) | README | Test-structure review, assertion weaknesses, harmful versus intentional repetition, and helper-hidden complexity. Implementation is Speclj-specific. |
| [crap4clj](https://github.com/unclebob/crap4clj/blob/master/SKILL.md) | Native skill | Example of packaging a concrete quality-analysis procedure as a skill, not permission to copy its text. |

Classic examples such as `PPP`, `javaargs`, `videostore`, `FunctionalDesign`, and `BinarySearch` appeared in the inventory but were not examined deeply. They are optional later research for examples or teaching material, not validated sources for the first implementation. Do not imply all these ideas originated with one author; attribute each source accurately.

### Local reference packages

- `/home/g/Projects/pi-herdr-pstack/README.md`
- `/home/g/Projects/pi-herdr-pstack/package.json`
- `/home/g/Projects/pi-herdr-pstack/skills/poteto-mode/SKILL.md`
- `/home/g/Projects/pi-herdr-agents/docs/roles.md`
- Pi 1.1.0 `docs/skills.md` and `docs/packages.md`.

Local baselines recorded when writing this plan:

| Repository | HEAD | Working tree at capture |
| --- | --- | --- |
| pi-herdr-pstack | `135c0fc7514afc1af7560c17f53bf25cf05b18db` | Clean |
| pi-herdr-agents | `e18fb59b8ba98b8ecf7c011c684f4ce833adf321` | Clean |

These identify comparison sources, not a tested compatibility matrix. The inspected pstack manifest was version `0.3.0` and targeted Pi `^1.0.3`; the locally consulted Pi docs were 1.1.0. Select and test the actual package versions before declaring compatibility.

### Upstream snapshot evidence

The six-pack directory response resolved to commit `066a62ffa6cbc8c859262536dc579fecf8535ebb`. Other fetched files reported Git blob hashes, not commit hashes:

| Source file | Observed blob SHA |
| --- | --- |
| SwarmForge main README | `2a5bf1652a2e5837f8bbd3f6300c0718a8f8de8f` |
| SwarmForge shared engineering article | `d07dd19f783d70e4865baa75e76908ef7819ea9f` |
| SwarmForge six-pack README | `403f8171dff55c1e663b8df325ecd07864616ba9` |
| SwarmForge two-pack README | `a3edf5f36d8d6c00d2d53fa93002ea0a4564d547` |
| Acceptance Pipeline README | `176d10932367160b67cff5931e63b3eba0ead3d1` |
| crapper README | `f5690415b719a010d23cfbed76fb5add957f1988` |
| mutator README | `1152ce6da20cb132905f50ecd6304fabe313d03b` |
| dryer README | `fae6e640c1d77ab94c599d96d987c63df5452da3` |
| dependency-checker README | `4a5fd7b32459d1b7f7fab86cb7d0d01ddd0084ef` |
| SCRAP README | `e1a15c8b81ba1ee024074282d6ab3bf67804f836` |
| crap4clj SKILL.md | `ba67247bcb8b12e31f19f6544cf6bf7c84d820f7` |

The six role files read from the `six-pack` branch were:

| Path | Observed blob SHA |
| --- | --- |
| `swarmforge/roles/specifier.prompt` | `2a4155abaa9bffe7a59b00c904b8ce0401a201af` |
| `swarmforge/roles/coder.prompt` | `d33d29826609842211240134c2cd6ee6109a3977` |
| `swarmforge/roles/cleaner.prompt` | `cab560e10e08851234b8250aad05553c33b130e7` |
| `swarmforge/roles/architect.prompt` | `8811cfdac5390a6f056cf4936f3cd81f0f2a9182` |
| `swarmforge/roles/hardender.prompt` | `13d992cf3ef578395111deccd673a77289182284` |
| `swarmforge/roles/QA.prompt` | `d1420c7e86ab0bb4f40f194a86fd5258bbf8dbfc` |

Before adapting a source, resolve its branch to a commit, inspect the complete relevant files at that commit, and record the license and source paths. Reconcile these observed blobs against the pinned commit; the original separate branch reads do not prove an atomic snapshot. Do not treat a blob hash as a runnable repository revision.

## 4. Licensing and attribution gate

Verified during research:

- `crapper`, `mutator`, and `dryer` contain BSD Zero Clause licenses attributed to Robert C. Martin.
- Pstack's README declares MIT licensing; inspect its actual LICENSE and notices before copying implementation material.
- No explicit license was found in the examined SwarmForge main/six-pack roots or Acceptance Pipeline root. This is a scoped observation, not proof that no permission exists elsewhere.
- License rights for other potential source material remain to be checked.

Implementation rules:

1. Do not assume public GitHub visibility grants permission to redistribute prompt text or code.
2. Write original procedures around general engineering concepts; cite their inspiration.
3. Do not reproduce book chapters, paid course material, or repository prompts without appropriate permission.
4. For any copied or adapted licensed artifact, record repository, commit, path, license, modifications, and required notices.
5. If rights are unclear, omit the artifact, implement an original alternative, or obtain permission before redistribution. Contacting upstream requires separate authorization.
6. Use descriptive branding: an unofficial pack inspired by Robert C. Martin's practices. Do not imply endorsement or affiliation.
7. Proposed license for our original code and documentation: MIT, subject to final source audit.

Deliver `docs/provenance.md`, `LICENSE`, and `THIRD_PARTY_NOTICES.md` before release. Distinguish inspiration from redistributed material in the provenance table.

## 5. Product boundaries and non-goals

### The pack owns

- Skill instructions, workflow routing, bounded delegate briefs, and report contracts.
- A small set of practical references for design, tests, metrics, and tool use.
- Explicit capability checks and documented verification recipes.
- Optional project-local acceptance adapters when separately requested.
- A later optional sticky methodology command.
- Tests proving resource discovery, host compatibility, and bounded workflow behavior.

### The host owns

- Launching Pi children in Herdr.
- Pane placement, lifecycle, completion delivery, cancellation, and supervision.
- Managed worktrees, ownership manifests, handoffs, and explicit cleanup controls.
- Shared task-model preferences and routing.

### Do not build or copy

- SwarmForge's tmux launcher, dashboard, handoff daemon, queue, or automatic merge propagation.
- A replacement scheduler, persistent workflow engine, or model preference store.
- Background tool installers, automatic upgrades, or global configuration mutations.
- A bundled fork of every quality analyzer.
- A generic architecture framework imposed on every target project.
- Separate skills for every SOLID acronym merely to expand the inventory.
- An autonomous publishing, merging, or worktree-deletion workflow.

## 6. Complete skill inventory

All skill names and parent directory names match. Initial skills are explicit-only using `disable-model-invocation: true`; the hub reads relevant sibling skills when needed. Examples below are proposed interfaces, not currently installed commands.

### 6.1 `craft-mode` — workflow hub

Entry point: `/skill:craft-mode <task>`.

Responsibilities:

- Determine whether the task changes behavior, preserves behavior, diagnoses quality, or verifies an artifact.
- Establish scope, baseline, project commands, available tools, and authorization limits.
- Choose the smallest adequate workflow, not the maximum number of agents.
- Load only the relevant skills and references.
- Decide when a fresh independent reviewer is useful.
- Keep a concise visible stage checklist with evidence and explicit skipped/blocked steps.
- Report changes, verification, unresolved risks, and handoff state.

Routing:

| Request | Route |
| --- | --- |
| Small feature or bug fix | TDD, focused cleanup, relevant verification |
| Existing behavior needs restructuring | Refactor; architecture if boundaries change |
| Architectural review | Architecture, initially read-only |
| Quality audit | Quality, initially report-only |
| Weak tests or suspicious coverage | Mutation, after baseline and capability checks |
| Substantial new behavior | Specification approval followed by the full feature workflow |
| Final verification | QA, using the agreed public surface |

No sticky state in the first release. Reading this skill once must not silently enable a mode.

### 6.2 `craft-tdd` — observable behavior before implementation

Inputs: approved behavior slice or reproducible bug, scope, existing test conventions.

Procedure:

1. Run or inspect the relevant baseline and reproduce the bug where applicable.
2. Write one focused test for an observable behavior or invariant.
3. Run it and verify the expected failure. Distinguish a meaningful red test from an import, syntax, environment, or fixture failure.
4. Implement the smallest production change that satisfies the behavior.
5. Run the focused test and relevant regression suite.
6. Refactor under green tests, without expanding scope.

Output: behavioral intent, test command, observed red reason, production change, green result, and limitations.

Rules: acceptance tests do not replace unit tests where units provide useful behavioral checks; avoid tests pinned solely to private implementation structure. If red cannot be demonstrated, disclose it rather than claiming a completed TDD cycle.

### 6.3 `craft-refactor` — improve structure without changing behavior

Inputs: target code, baseline tests, intended improvement, permitted scope.

Review names, cohesion, mixed responsibilities, local coupling, duplication, mutable state, error paths, dead code, and test readability. Use characterization tests when existing behavior is poorly protected.

Make small edits with verification between meaningful steps. Extract only when the resulting abstraction clarifies responsibility and owns coherent inputs. Do not split a single-purpose function merely to lower a score, or turn coincidentally similar code into a shared abstraction.

Output: before/after rationale, preserved behavior, checks run, and any suspected behavior changes requiring a separate task.

Test cleanup uses SCRAP-inspired reasoning without pretending a Speclj analyzer supports other languages. Count complexity moved into helpers; shorter visible tests are not automatically clearer tests.

### 6.4 `craft-architecture` — policy and dependency boundaries

Default posture: read-only findings and a scoped proposal. Structural edits require an implementation brief that permits them.

Review:

- High-level policy versus UI, database, filesystem, network, and framework details.
- Actual import/call edges and dependency cycles.
- Framework and persistence types leaking across boundaries.
- Information hiding, invariant ownership, and accidental public APIs.
- Adapters that duplicate domain decisions instead of calling the domain.
- Domain modules used only by tests while production code reimplements their rules.
- Existing boundary checks that preserve accidental structure rather than intended architecture.

Add lightweight enforceable checks when warranted: forbidden imports, dependency direction, cycles, or a small focused architectural test. Keep legitimate exceptions explicit. An observed dependency graph is a baseline, not automatically the desired policy.

Use SOLID as questions about responsibility, substitutability, coupling, and change pressure. Do not demand one interface per class, a fixed layer count, or object-oriented patterns in languages where simpler structures fit.

Output: evidence-backed findings with paths/edges, smallest useful correction, tradeoffs, and proposed or executed boundary checks.

### 6.5 `craft-quality` — evidence-backed risk assessment

Default posture: report-only; running tools may still have side effects and requires preflight.

Procedure:

1. Identify language, target revision, changed scope, test commands, and available analyzers.
2. Establish a passing test baseline and inspect coverage freshness and scope.
3. Collect supported measurements, beginning with bounded changed-code analysis where practical.
4. Rank hotspots using complexity, coverage, duplication, change context, and behavioral importance.
5. Inspect actual code before recommending extraction, tests, or deletion.
6. When remediation is authorized, change a bounded hotspot and compare like-for-like evidence.

CRAP reference formula: `CC² × (1 − coverage)³ + CC`, with coverage as a fraction. Never compare scores across incompatible tool versions or coverage definitions without qualification.

Output includes tool version, commands, revision/scope, coverage source/freshness, exclusions, unavailable measurements, and prioritized recommendations. Do not invent numeric proxies and label them as upstream tool results.

### 6.6 `craft-mutation` — test strength, not coverage theater

Inputs: green baseline, scoped source, approved runner, time/worker budget, and available coverage.

Procedure:

1. Verify baseline tests pass before mutation.
2. Start with a small relevant file or behavior slice.
3. Prefer differential runs after an established baseline, preserving tool-owned manifests.
4. Classify survivors, uncovered sites, invalid mutants, timeouts, and infrastructure failures as far as the tool evidence permits.
5. Inspect whether a survivor exposes missing behavior, weak assertions, or an equivalent mutation.
6. Add meaningful tests or fix a genuine defect; never change assertions only to inflate a score.
7. Rerun the bounded analysis, then unmutated tests, and verify source restoration.

Output: executed scope, baseline result, tool-reported counts, qualified behavioral conclusions, unresolved/equivalent cases, budget limits, and final working-tree state.

If the tool combines invalid mutants or timeouts with killed mutants, retain that caveat. Do not invent a cleaner score from unavailable data. A high kill rate with uncovered code is incomplete evidence.

### 6.7 `craft-spec` — behavior and acceptance criteria

Inputs: user intent, constraints, known public interfaces, and unresolved product questions.

Produce concise deterministic examples, acceptance criteria, edge cases, and independent end-to-end QA procedures. Separate requested behavior from suggested implementation.

Gherkin is optional. Existing project-native acceptance tests remain valid. The APS integration is an explicit project capability, not a dependency automatically imposed on every feature.

When APS is selected:

- Read its parser, IR, generator, and mutation specifications at the pinned revision.
- Use its supplied parser rather than inventing an incompatible substitute.
- Define the project-specific generator, runtime, step handlers, and runner adapter.
- Keep generated acceptance artifacts separate from source examples and unit tests.
- Confirm that step parameters drive real application behavior and assertions.
- Distinguish source mutation from acceptance example-value mutation.

Output: reviewable behavior specification, unresolved questions, acceptance plan, and QA procedure. Obtain approval at the parent/user boundary before implementing substantial newly specified behavior; do not rely on SwarmForge's dashboard approval mechanism.

### 6.8 `craft-qa` — independent public-surface verification

Inputs: approved behavior, final candidate revision, user-facing surface, and verification scope.

Run accepted scenarios through the actual supported public interface: browser/UI for a GUI product, CLI for a CLI product, public API for an API product. Do not substitute a private internal hook and label it end-to-end verification.

Reproduce failures and report contradictions between specification, tests, and actual behavior before changing expectations. Mark inaccessible environments and missing tooling as blocked, not passing.

Default reviewer is read-only. Return fixes to the implementation owner. If a separate brief permits narrow QA fixes, disclose that the verifier became an author and use a fresh final verification pass where independence matters.

Output: scenario-to-evidence matrix, commands/artifacts, revision tested, failures, skipped checks, and a scoped verdict. No claim of universal correctness.

## 7. Workflows and delegation

### Lightweight change

`scope → baseline → TDD → focused cleanup → relevant verification → report`

Use for bounded features and bug fixes. Architecture and mutation stages are invoked when justified by the change, not mechanically. One local writer or sequential delegate is the default.

This is inspired by the two-pack, not a literal reproduction. Upstream's two-pack excludes acceptance and property testing; this pack should not ban useful existing project checks.

### Full feature

`specification → user approval → TDD implementation → cleanup → architecture → mutation hardening → independent QA → parent review`

- Specification and implementation remain separate where the feature contains genuine ambiguity.
- Existing behavior-preserving stages must not introduce unapproved requirements.
- Property tests are a useful separate verification capability for invariants, round trips, ordering, or broad input domains, not a mandatory homegrown framework.
- Bound correction rounds by a stated budget. Escalate unresolved requirements or repeated failed gates instead of silently looping.
- Rerun affected downstream checks after fixes. If code changes after QA, the old verdict no longer covers the new revision.

### Bare delegate contract

Every delegated task names:

- One bounded outcome and allowed files.
- Relevant skill/reference paths and input revision.
- Explicit model and supported thinking level.
- Whether the session is standalone or forked.
- Verification commands and expected evidence.
- Commit policy.
- No child orchestration, publication, merging, or cleanup unless separately authorized.

Use `task:<category>` for ordinary routing through host preferences. Use exact authenticated model IDs for independence-sensitive review. Prefer a different model family from the author. If unavailable, disclose a context-isolated same-family review; do not describe it as cross-family independent.

For bare delegates receiving reference text as `systemPrompt`, explicitly use `fork: false` (standalone). The inspected host contract drops that role text for `fork: true`; a forked session is therefore not an interchangeable way to deliver this brief. Keep any essential task-specific constraints in the task too. Verify actual prompt delivery, not only that a skill is discoverable.

### Worktree and integration discipline

- Read-only reviewers use ordinary panes.
- A single or sequential writer may use the current checkout.
- Parallel independent writers use unique managed worktrees based on exact committed revisions.
- Dependent writers must see the predecessor's accepted work: use sequential ownership of the same checkout after confirmed completion, or a committed exact base for the next worktree.
- Uncommitted parent files are not copied into new worktrees.
- The parent inspects diffs, tests the integrated candidate, and owns integration.
- Completion is delivered automatically. Never poll agent lists, tail sessions, or sleep waiting for children.
- Worktree cleanup requires its own explicit authorization. Branches and retained work are not deleted by the workflow.

## 8. Tool integration and measurement safety

### Common adapter contract

Prefer documentation and small version-qualified command recipes over an abstract plugin framework. Each supported tool recipe records:

- Supported languages and tested versions.
- Detection/help commands and prerequisites.
- Installation requirements, with no automatic installation.
- Read/write paths, generated artifacts, report deletion, and cache behavior.
- Baseline/test command, scope controls, timeout, and concurrency budget.
- Output format, exit-code meaning, and failure classification.
- How report freshness and revision association are established.
- Cleanup/restoration requirements and unsupported cases.

Do not silently substitute one analyzer for another. Report the tool actually used. Existing project tooling is preferred when it answers the same question reliably.

### Known upstream caveats to verify

| Tool | Observed documentation caveat | Pack response |
| --- | --- | --- |
| crapper | Launcher installs into a virtual environment; coverage paths can install missing language tooling and regenerate reports. Missing tools or failed tests can become 0% coverage in a written snapshot. | Preflight side effects; preserve a separate failed/unknown measurement state. Never conclude that a tooling failure proves untested code. |
| mutator | Requires a sibling crapper checkout; uses worker overlays; timeouts and uncompilable mutants count as killed. | Verify layout/version compatibility and source restoration; report score semantics explicitly. |
| mutator | Differential reuse tracks source changes; test/environment changes may affect whether cached kills remain trustworthy. | Validate invalidation behavior before claiming fresh evidence. Request a scoped rerun when needed and explain why. |
| dryer | Reports structural similarity, including normalization that removes incidental details. | Inspect semantic responsibility before deduplication; similar syntax is not sufficient. |
| dependency-checker | Language- and namespace-layout-specific; starter policy derives from observed edges. | Do not label generated policy as approved architecture without review. |
| SCRAP | Speclj-specific heuristics and recommendations. | Use its implementation only on supported projects; generalize the review questions, not fabricated scores. |
| APS | Requires project-specific executable acceptance plumbing. | Budget and test the adapter separately; do not claim installing the parser provides end-to-end verification. |

The inspected SwarmForge shared and role-local prompts contain different worker limits and mutation-level instructions. Resolve such differences in one documented pack policy rather than concatenating upstream prompts. Use conservative project-appropriate budgets; do not inherit contradictory constants.

### First supported environment

Start verification with a small TypeScript/Node fixture, matching the ecosystem of these Pi packages. Core prose remains language-neutral. Quality-tool support is version-specific and must be earned with executable tests; upstream claims of six-language support do not establish six-language pack compatibility.

Add other language recipes incrementally after fixture-based verification. Do not install all language toolchains as a pack prerequisite.

## 9. Package layout and public interfaces

Proposed complete layout:

```text
pi-herdr-clean-craft/
├── package.json
├── README.md
├── LICENSE
├── THIRD_PARTY_NOTICES.md
├── CHANGELOG.md
├── RELEASING.md
├── AGENTS.md
├── PLAN.md
├── docs/
│   ├── methodology.md
│   ├── compatibility.md
│   ├── provenance.md
│   ├── tooling.md
│   ├── verification.md
│   └── troubleshooting.md
├── skills/
│   ├── craft-mode/
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── workflows.md
│   │       ├── delegation.md
│   │       ├── authorization.md
│   │       └── reporting.md
│   ├── craft-tdd/SKILL.md
│   ├── craft-refactor/
│   │   ├── SKILL.md
│   │   └── references/test-quality.md
│   ├── craft-architecture/
│   │   ├── SKILL.md
│   │   └── references/design-principles.md
│   ├── craft-quality/
│   │   ├── SKILL.md
│   │   └── references/tool-recipes.md
│   ├── craft-mutation/
│   │   ├── SKILL.md
│   │   └── references/interpretation.md
│   ├── craft-spec/
│   │   ├── SKILL.md
│   │   └── references/acceptance-pipeline.md
│   └── craft-qa/SKILL.md
├── test/
│   ├── fixtures/
│   ├── package-contract.test.*
│   ├── skill-contract.test.*
│   └── integration/
└── pi-extension/                 # only if the later sticky command is built
    └── clean-craft/index.ts
```

File names under tests are illustrative; choose the smallest compatible test setup during scaffolding. Do not create empty future directories or placeholder runtime code solely to match this tree.

Initial manifest exposes `pi.skills: ["./skills"]` and the `pi-package` keyword. Declare `pi-herdr-agents` as a peer for host-backed workflows and document installation through Pi; an npm peer declaration does not activate the host. Do not add SDK dependencies until code actually requires them. Follow the active Pi packaging guidance for host-provided dependencies and test exact supported versions.

Expected usage after implementation and installation:

```text
/skill:craft-mode Fix the parser's empty-input behavior
/skill:craft-tdd Add retry-limit behavior
/skill:craft-refactor Simplify the billing calculation without changing results
/skill:craft-architecture Review domain-to-storage dependencies
/skill:craft-quality Assess the changed files; report only
/skill:craft-mutation Check assertions around the retry policy
/skill:craft-spec Specify CSV import behavior
/skill:craft-qa Verify the approved CSV import scenarios
```

The final package install instructions will name both the host and the pack. Install the pack wherever fresh child sessions resolve resources, not only in the parent session.

Define the package `files` allowlist during Phase 1. Explicitly exclude planning documents, test sessions, generated evidence, local configuration, and fixtures from the published tarball unless a specific runtime resource requires them. Every bundled reference linked from a skill must be included. From scaffolding onward, static tests inspect `npm pack --dry-run --json` against the allowlist; repeat this check at release and verify the actual tarball.

## 10. Coexistence with pstack

- Use `craft-*` names throughout. Do not shadow pstack skills or commands.
- Do not register a second shared task-model approval gate or setup writer.
- Do not modify pstack's sticky state or automatically enable either methodology.
- Support invoking a focused craft skill under another coordinator. In that case, return its bounded result rather than starting a competing top-level workflow.
- If both sticky modes are explicitly enabled in a future release, disclose competing workflow owners and ask which should coordinate; do not silently disable another package or claim enforcement that does not exist.
- Verify discovery in a combined host + pstack + clean-craft installation.
- No dependency on pstack itself; it is a packaging/reference example, not a runtime prerequisite.

## 11. Optional sticky `/craft-mode` command

Implement only after the explicit skills are useful and validated. It is a separate milestone, not required for the initial pack.

Proposed behavior:

- `/craft-mode on`: enable for the active session branch; starts no task.
- `/craft-mode status`: report state and resource resolution.
- `/craft-mode off`: stop future reminders; do not claim to erase prior context or stop children.
- `/craft-mode <task>`: enable and start the requested task when the session can accept it.
- `/skill:craft-mode`: remain a one-shot skill load, never a sticky-state toggle.

Use a small versioned session entry and public Pi APIs. Restore the correct branch state across reload, resume, forks, compaction, and navigation. Do not propagate parent sticky ownership accidentally into delegated children.

Load the canonical hub when missing from retained context, including after compaction, without blindly duplicating it. Handle automatic child-result turns as well as direct user prompts. Refuse activation when the intended skill is missing, filtered, or shadowed.

Do not copy pstack's implementation wholesale. Read the relevant SDK extension/event/session documentation, audit the source license, and reuse only what is justified. Test observable transitions and prompt delivery. Add LSP checks for every changed TypeScript file.

No `/setup-clean-craft` command is planned initially. README guidance and explicit diagnostics are enough until a real setup need is demonstrated.

## 12. Verification strategy

### A. Static package checks

- Validate frontmatter, unique names, matching directories, descriptions, and explicit-only settings.
- Verify all relative references resolve from the skill directory and exist in the package tarball.
- Validate the manifest, dependency placement, file allowlist, notices, and provenance records.
- Scan executable examples for obsolete host parameters, SwarmForge helper commands, external CLI backends, polling instructions, or automatic destructive actions.
- Ensure source attribution does not imply endorsement.
- Avoid brittle tests that snapshot entire prompt prose. Test contracts, references, and behavior instead.

### B. Deterministic Pi/Herdr compatibility tests

Use isolated temporary homes, agent directories, settings, and fixtures. Never edit the operator's normal configuration.

Prove:

1. Pi discovers all intended skills from the installed package.
2. Explicit skill invocation delivers complete instructions on the actual task request.
3. Fresh children can resolve the required skills and reference files.
4. A bare delegate with `systemPrompt` and explicit `fork: false` receives a distinctive reference marker and the task constraints on the actual task request. A separate `fork: true` control characterizes the inspected host's omission of that role text, so the test cannot pass merely because the task was delivered. Adapt the control only if the pinned host's documented contract changes.
5. Completion is delivered through the host without polling or premature startup-turn completion.
6. Sequential dependent work receives the accepted prior state.
7. Parallel writers, when exercised, use distinct worktrees and exact committed bases.
8. Missing host/tool/resource conditions are reported, not silently replaced or called passing.
9. Combined installation with pstack has no name or setup-policy collision.
10. Cancellation and retained-worktree behavior remain host-owned; the pack invents no replacement lifecycle.

Run only one real Herdr integration suite per instance at a time. A skipped Herdr test is not passing evidence.

### C. Quality-tool fixtures

For each actually supported recipe, test:

- Clean baseline and a known behavior defect.
- A covered function with intentionally weak assertions.
- Uncovered source and missing/stale coverage.
- Failed baseline and unavailable tooling.
- For the upstream mutator recipe, both a compatible sibling crapper checkout and a missing sibling: preflight must report the missing prerequisite without silently installing it or claiming successful analysis.
- A survivor, an invalid mutant, and a timeout where the tool can produce them.
- Source restoration after normal completion and interrupted mutation work.
- A duplication candidate that should be extracted and coincidental similarity that should not.
- Report version/scope association and differential-cache invalidation.
- No unapproved dependency installation or writes outside test-owned directories.

APS fixtures additionally need a disconnected/no-op step, a genuinely connected example value, generator/runtime failure, and a working normal acceptance run.

### D. Live-model methodology evaluations

Deterministic providers prove plumbing, not that models follow the methodology. Before describing the pack as behaviorally validated, run bounded live scenarios and inspect actual tool traces and diffs.

Minimum scenarios:

| Scenario | Required evidence |
| --- | --- |
| Bug fix | A meaningful red test precedes the production fix; regression checks pass. |
| Refactor | Observable behavior remains stable; changes are scoped and justified. |
| Architecture | A real forbidden edge is found and addressed without unnecessary layers. |
| Quality audit | Missing/stale coverage is disclosed rather than converted into false confidence. |
| Mutation | A survivor leads to a meaningful assertion or a documented equivalent case. |
| Specification | Ambiguous behavior is surfaced; substantive specification is approved before implementation. |
| QA | Verification uses the actual public surface and catches a seeded mismatch. |
| Coexistence | A focused skill does not spawn a competing coordinator under pstack. |

Record model/provider, thinking level, Pi/host/pack revisions, fixture revision, commands, verdict, and failures. Keep generated transcripts/evidence outside published resources. Set budgets before running; do not evaluate only on one showcase success or require metric improvement at the expense of correctness.

### E. Release checks

- Run package tests and any configured lint/format/type checks.
- Run active LSP diagnostics on changed TypeScript when an extension or TS tests are introduced.
- Inspect `npm pack --dry-run` and validate the actual packed resources in an isolated installation.
- Run host integration and combined-package smoke checks for the exact release candidates.
- Review license/provenance and supported-tool/version claims.
- Inspect final diff/status for generated artifacts and secrets.
- Publish only under an explicit release request; green tests do not authorize publication.

## 13. Phased delivery plan

Each phase ends in a reviewable artifact and a gate. Keep dependent writes sequential. Phase 0 must close before Phase 1 implementation starts. Record gate outcomes and supporting evidence in a local progress record excluded from the tarball; a failed or blocked prerequisite stops dependent work. This is a coordinator-owned process gate, not a new runtime permission engine. If implementation is delegated, assign exclusive file ownership and a commit policy; do not let parallel workers independently rewrite the hub, manifest, or shared contracts.

### Phase 0 — confirm sources and compatibility

Deliver:

- Pin relevant upstream commits and inspect licensing at those revisions.
- Re-read current Pi package/skill APIs and host delegation/worktree contracts.
- Record tested candidate Pi and host versions.
- Establish provenance and a clear original-versus-reused-material policy.
- Write a Phase 0 report recording source commits/paths, license decisions, omitted or independently authored alternatives, candidate APIs/versions, and pass/fail/blocked outcomes. The coordinator reviews and records the gate decision before Phase 1.

Gate: no ambiguous redistribution in the proposed artifact inventory; runtime assumptions are documented rather than inferred from package names. Unresolved optional sources can be explicitly excluded rather than blocking original work indefinitely.

### Phase 1 — scaffold and shared contracts

Prerequisite: the Phase 0 report records a passing gate for the selected artifact scope.

Deliver:

- Minimal package manifest with an explicit `files` allowlist, README, contributor guidance, license/notices, provenance, and static tests including `npm pack --dry-run --json` inventory assertions.
- Hub skeleton with workflow selection, delegation, authorization, and reporting references.
- Test fixture and isolated discovery harness.

Gate: package installs into a test-owned Pi environment; resource paths and package contents are correct. Do not claim unavailable future skills are shipped.

### Phase 2 — six-skill core

Deliver:

- `craft-mode`, `craft-tdd`, `craft-refactor`, `craft-architecture`, `craft-quality`, and `craft-mutation`.
- Small-change workflow and bounded audit/refactor routes.
- TypeScript/Node test fixture and reviewed tool recipes where available.
- Test-quality and design-principle references.

Gate: static/discovery tests pass; deterministic fixture tests establish expected red/green outcomes, behavior-preserving transformations, dependency violations, and mutation results. This proves the fixture and tool contracts, not live-model adherence. For any supported upstream mutator recipe, verify sibling-crapper preflight and source restoration after normal and interrupted runs. Unsupported analyzers are clearly marked; no fabricated metrics or hidden installs.

Result on 2026-10-10: pass for this phase's selected original-content scope. The suite passed 65 tests with 3 later-gate TODOs. The 18 fixture tests passed twice; counterfactual controls showed both reviewed regressions are detected. Source and tarball Pi discovery passed, and the tarball contains exactly 21 allowlisted files. See `.audit/phase-2.md` for review, restoration, diagnostics, and remaining limits. No upstream analyzer is supported or claimed.

This is the first useful core milestone, not yet a publishable candidate by itself. A six-skill release must also pass Phase 3 and the applicable Phase 6 evaluations and release checks; it can defer Phases 4 and 5 while accurately declaring the smaller shipped scope. Releasing remains separately authorized.

### Phase 3 — host orchestration and coexistence

Deliver:

- Verified bare-delegate briefs and sequential stage handoffs.
- Fresh-child resource visibility checks.
- Combined host/pstack/clean-craft discovery and workflow checks.
- Worktree path for genuinely independent parallel writing and parent-owned integration.

Gate: a bounded bare delegated task using `systemPrompt` plus explicit `fork: false` completes and returns evidence through the real host. Its task-request prompt contains the expected brief marker, and the separate forked control demonstrates the prompt-delivery distinction described in §12.B. No polling, state loss, competing coordinator, or unauthorized integration.

### Phase 4 — specification and final QA

Deliver:

- `craft-spec` and `craft-qa`.
- Full feature workflow with explicit specification approval.
- Public-surface QA fixtures and scenario-to-evidence reporting.
- Optional APS recipe and a tested example adapter if licensing and capability gates permit it.

Gate: approved behavior is implemented and independently exercised through the real public surface. APS unavailability does not block project-native acceptance workflows; unsupported APS claims remain absent.

### Phase 5 — optional sticky command

Deliver:

- Minimal `/craft-mode` extension and versioned branch-scoped state.
- On/off/status/task semantics, compaction-safe hub loading, child isolation, and shadowing diagnostics.
- Reload/resume/fork/navigation/noninteractive tests.

Gate: state and prompt delivery match the documented contract; a one-shot skill invocation remains one-shot; coexistence is explicit.

### Phase 6 — evaluate, document, and prepare release

Deliver:

- Bounded live-model evaluations with recorded limitations.
- Final compatibility matrix and tested tool recipes.
- Troubleshooting and installation guidance for parent and child environments.
- Changelog, release procedure, and audited tarball.

Gate: release claims match evidence; source rights are resolved; no generated evidence or local settings are packaged. Ask for explicit authorization before any publication.

## 14. Reporting and acceptance contract

Every workflow's final report should contain only applicable fields:

- Goal and scope.
- Behavior/specification reference.
- Files or revisions changed.
- Verification commands and actual outcomes.
- Metric tool/version/scope and interpretation limits.
- Independent review status, including model-family limitations.
- Skipped/blocked checks and unresolved risks.
- Commit/worktree handoff when relevant.

Use three distinct outcomes for gates: **pass**, **fail**, and **blocked/not measured**. A skipped required gate is not a pass. A process exiting successfully is not enough if the tool's semantics permit incomplete analysis.

The complete pack is accepted when:

- [ ] All eight skills are present, discoverable, namespaced, and documented.
- [ ] Lightweight and full feature workflows have bounded, evidence-backed behavior.
- [ ] No host execution or model-store functionality is duplicated.
- [ ] Pstack coexistence is tested without resource collisions or competing implicit ownership.
- [ ] Meaningful red/green evidence, behavior-preserving changes, and architecture findings are demonstrated in fixtures.
- [ ] Quality and mutation results retain freshness, scope, and failure caveats.
- [ ] Specification approval and real-surface QA are exercised.
- [ ] Fresh child prompt/resource delivery is tested through the real host.
- [ ] Source licenses, provenance, and attribution are complete.
- [ ] Published contents exclude plans, local configuration, transcripts, and generated evidence.
- [ ] Compatibility statements distinguish deterministic runtime checks from live-model evaluations.
- [ ] The sticky command, if shipped, independently meets its lifecycle tests; otherwise it remains documented as unimplemented.

## 15. Risks and mitigation

| Risk | Mitigation |
| --- | --- |
| Unclear prompt/source licensing | Original prose, pinned provenance, no copying until rights are clear. |
| Generic principles cause overengineering | Tie every recommendation to a concrete change pressure or observed defect; prefer no change when appropriate. |
| Metric gaming | Review behavior and actual code; preserve exclusions and failed/unknown states; reject score-only refactors. |
| Analyzer setup has hidden side effects | Preflight installers, caches, report deletion, overlays, and restoration; use test-owned fixtures first. |
| Upstream branches drift or contradict each other | Pin commits, keep one pack policy, record deliberate departures. |
| Mutation becomes prohibitively expensive | Small scopes, explicit worker/time budgets, validated differential reuse, honest incomplete results. |
| Six-stage workflow is too expensive for small tasks | Default to the lightweight route and explain why heavier stages are warranted. |
| Sequential stages run on stale work | Exact revision handoffs and parent-owned integration; no assumption that a new worktree copies dirty state. |
| Prompt presence is mistaken for adherence | Separate deterministic integration tests from observed live-model behavior. |
| Pstack and craft both try to coordinate | Namespaced resources, explicit invocation, bounded leaf behavior under another coordinator. |
| QA fixes invalidate independent verification | Separate authoring from the final verification pass and identify the exact tested revision. |
| Framework-specific tools limit portability | Language-neutral procedures; incremental, tested language recipes with explicit unsupported cases. |

## 16. Open decisions and defaults

These do not block writing original skills; settle them before the relevant implementation phase.

| Decision | Proposed default |
| --- | --- |
| Package identity | `pi-herdr-clean-craft`; unofficial and explicitly attributed. |
| Initial activation | Explicit `/skill:craft-mode`, no sticky extension. |
| First milestone | Six core skills, followed by specification and QA. |
| Automatic skill invocation | Disabled initially to avoid ambient methodology conflicts. |
| Named roles | None; bounded bare delegates. |
| First verified language | TypeScript/Node; other languages added only with evidence. |
| Quality tooling | Existing project tools first; approved pinned upstream tools where verified. |
| Universal score thresholds | None; scoped project policy and justified exceptions. |
| APS dependency | Optional, project-specific integration; never mandatory for all tasks. |
| QA fixes | Read-only verification by default; return fixes to the implementation owner. |
| Model selection | Host task preferences; explicit family-aware selection for independent review. |
| Commits/releases | Governed by the implementation brief and explicit release authorization. |

## 17. Immediate next action

Phase 2 is verified. The next implementation unit is Phase 3, host orchestration and coexistence. Read `.audit/phase-2.md` and `.audit/phase2-implementation-review.md` for the evidence and limitations, and `docs/provenance.md` for source decisions. The current suite passes 65 tests with three later gates explicitly unmeasured. Phase 3 must exercise real host prompt delivery and fresh-child resource resolution rather than treating fixture results as integration evidence. Keep dependent writes sequential and preserve test-owned settings isolation. No operator installation, publication, or compatibility certification has occurred. Do not copy upstream runtime scripts or treat this plan as permission to install tools, initialize remote infrastructure, publish, or remove the retained design worktrees.
