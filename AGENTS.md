# Contributor guidance

This file is for people and agents changing the pack. It is not packaged.

## Content

- Write instructions in original prose. Do not copy upstream prompts, articles, skills, or code, including from pi-herdr-pstack. Record any source you draw on in `docs/provenance.md` before relying on it.
- Describe only what ships. Name planned skills in plain text and never link them until they exist.
- Keep skills explicit-only with `disable-model-invocation: true`, and keep the skill name equal to its directory name.
- Keep host parameters in prose. Skill files contain no fenced code blocks, so there are no executable host-call examples to go stale.
- Make claims match evidence. Compatibility statements belong in `docs/compatibility.md` with the level of evidence behind them.

## Package

- `package.json` lists every packaged file exactly. When you add a skill or reference, update `files` and the inventory in `test/inventory.mjs` together.
- A skill may link another shipped skill only at `../<name>/SKILL.md`. List each such link in that skill's `siblings` in the inventory. Sibling links never add packaged files.
- Do not add dependencies, an extension, or install and lifecycle scripts without a phase that needs them.
- Planning documents, the `.audit` directory, this file, tests, fixtures, local settings, and evidence stay out of the tarball.

## Checks

Run `npm test`. It needs the Pi CLI and fails as blocked without it. Tests run Pi and npm only inside their own temporary directories with no credentials, and must keep doing so. Never point a test at real Pi settings.

Committing, publishing, and installing into real Pi settings each need explicit authorization.
