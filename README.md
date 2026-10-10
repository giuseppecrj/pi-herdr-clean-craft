# pi-herdr-clean-craft

An unofficial Pi methodology pack inspired by Robert C. Martin's engineering practices and public projects. It is not affiliated with or endorsed by him or those projects. The goal is a repeatable delivery process whose claims rest on observed evidence: failing then passing tests, real dependency edges, and qualified measurements.

The pack supplies instructions only. Child execution comes from [pi-herdr-agents](https://github.com/giuseppecrj/pi-herdr-agents), installed and activated separately.

## Status

Pre-release scaffold, version 0.0.0, not published. It ships one skill:

| Skill | Purpose |
| --- | --- |
| `craft-mode` | Hub that scopes a task, picks a workflow, and reports evidence. It routes to stage skills that are not yet included, and reports each missing stage as blocked rather than improvising it. |

The stage skills (craft-tdd, craft-refactor, craft-architecture, craft-quality, craft-mutation, craft-spec, and craft-qa) are planned and not part of this release. There is no sticky mode command.

## Use

Skills in this pack load only on explicit request:

```text
/skill:craft-mode Fix the parser's empty-input behavior
```

Loading the skill grants no permission to commit, install, publish, or change settings.

## Installation

There is no published release. The verified path is registering this checkout's absolute directory as a local package source in test-owned Pi settings. Registering it in your own settings, for example with `pi install /absolute/path/to/pi-herdr-clean-craft`, uses the same mechanism but writes to your Pi configuration, so do it only when you intend to.

`package.json` declares `pi-herdr-agents` 3.2.1 as a peer. That is the inspected candidate, not a validated pairing, and an npm peer declaration does not activate a Pi extension. Install the host through Pi if you want delegation. The hub's local route does not use it.

## Documentation

- [Compatibility](docs/compatibility.md): what has and has not been exercised.
- [Verification](docs/verification.md): how the tests isolate Pi and what they prove.
- [Provenance](docs/provenance.md): pinned sources and what was, and was not, reused.
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

[MIT](LICENSE), for original contributions.
