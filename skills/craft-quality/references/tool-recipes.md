# Tool recipes

## Status in this release

No external quality analyzer is supported. This pack has not executed, installed, or verified any analyzer against a project, so it offers no commands for one. The questions below apply to any tool, including tools the project already uses. Never install a tool on your own initiative. Installation is a separate, authorized action.

The pack's provenance document lists upstream analyzers that inspired this methodology: crapper, mutator, dryer, dependency-checker, and SCRAP. All of them are unsupported here. If a project already uses one, treat it like any other unfamiliar tool. Read its documentation at the version installed, run the preflight below, and report the tool's results in the tool's own terms. Do not describe its behavior from memory or from a summary.

## Preflight for any analyzer

Answer these before running a tool, and record the answers in the report.

1. **Identity.** What is the tool's exact name and version? Does it support this language and project layout, according to its own documentation for that version?
2. **Presence.** Is it already installed? Check without triggering an install. Some wrappers download or install on first use.
3. **Side effects.** What does it write? Look for caches, report directories, coverage files, temporary copies or overlays of source files, lock files, virtual environments, and toolchain downloads. Does it delete or replace existing reports?
4. **Network.** Does it contact any service?
5. **Inputs.** Which test command and coverage data does it use? Does it run the tests itself, and could it regenerate coverage that others rely on?
6. **Scope and budget.** How do you limit it to the files in scope? What time limit and concurrency will you allow?
7. **Results.** What do its exit codes mean? Can it exit successfully after partial or failed analysis? How does it report files it skipped?
8. **Association.** How will you tie its output to the revision and scope you analyzed?
9. **Restoration.** If it rewrites source, even temporarily, how will you confirm that every file is restored afterwards, including after an interruption?

If an answer is unknown and the risk matters, do not run the tool. Report the measurement as blocked/not measured and say what would be needed.

## Coverage states

Report coverage as exactly one of these states:

- **Measured and fresh.** Produced by a known command on the analyzed revision, from a passing run, with known exclusions.
- **Stale.** Produced before the latest relevant source or test change. Either refresh it with permission, or report it as stale and do not rank from it.
- **Failed.** The run that should have produced it failed or stopped early. This is not a measurement of untested code.
- **Absent.** No coverage data exists. This is not zero coverage.

A tool that turns missing or failed coverage into zero produces false hotspots. If a tool does that, report its numbers with the caveat or discard them.

## Project-native first

When the project already answers a question with its own tools, such as its coverage reporter, a complexity lint rule, or a duplication check in continuous integration, prefer those. They match the project's conventions, and their results are already trusted. Report which tool produced each number. Do not substitute one tool for another without saying so.
