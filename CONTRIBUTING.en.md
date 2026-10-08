# Contributing to Plysmith

[Deutsch](CONTRIBUTING.md) | [English](CONTRIBUTING.en.md)

Thank you for your interest. Bug reports, ideas, documentation corrections,
translations, tests, and code are welcome. Plysmith is a Windows beta;
a proposal does not promise inclusion in a particular release.

## Discussing changes

Report bugs and suggest features through
[GitHub Issues](https://github.com/lzzzy/plysmith/issues/new/choose).
German and English are welcome. Discuss larger changes in an issue first so
their goal and scope are clear. Small, focused fixes can go directly into a
pull request. Do not publish credentials, private games, databases, or raw
logs.

## Developing locally

Prerequisites, cloning, installation, and both startup commands are described
under [Running from Source](README.en.md#running-from-source) in the README.

Script commands check dependencies but never install them automatically. After
changes to the package files, run `pnpm install --frozen-lockfile` again if needed.
If pnpm asks to recreate `node_modules` entirely, cancel first: a different pnpm
store may be the cause. Compare `pnpm config get storeDir` with `storeDir` in
`node_modules/.modules.yaml`. Add `--store-dir "<previous store root>"` to the
install command to keep using the previous store without changing global
configuration. Do not include the version subdirectory, such as `v11`.

Most code changes do not need an installer build.

## Checking changes

Application code lives in `app/domain`, `app/application`,
`app/infrastructure`, and `app/bootstrap`. Domain rules do not belong in UI
or persistence adapters. Keep changes focused on the use case and add tests
for the behavior and important failure cases. Do not hand-edit generated
contracts under `contracts/host`: change their source and run `pnpm generate`
when a contract changes.

Before opening a pull request, run:

```powershell
pnpm verify
```

If needed, `pnpm build:release` builds the Windows installer and release files
in `build/release/output`. An ordinary contribution does not need a
version tag or release build.

## Pull request

Describe the purpose and visible change, link any relevant issue, and list
the tests you ran. A screenshot helps with UI changes; check it for private
content first. CI checks pull requests but does not replace your own review.
Maintainers handle versions, tags, and releases.

Application code uses [Apache-2.0](LICENSE). The chess font and its sources
use the [SIL Open Font License 1.1](licenses/PlysmithChess-OFL.txt).
