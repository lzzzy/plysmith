# Plysmith

[Deutsch](README.md) | [English](README.en.md)

Plysmith is a local, open-source chess workbench for your own analyses and
games. You can build an opening library, study an endgame, or play from a
position against an engine.

The [English user manual](docs/manual/README.en.md) introduces
the concepts and all areas of the app using a small, importable example inventory.

This is a Windows beta for trying the application. Your feedback helps improve
Plysmith. Later versions may not read all previous data and settings.
There is no built-in backup or restore feature yet.

## Installation

Plysmith is currently available for **Windows x64**. Download
`Plysmith-*-win-x64-Setup.exe` from a
[GitHub release](https://github.com/lzzzy/plysmith/releases), install it,
and open Plysmith from the Start menu. You do not need Git, Node.js, or pnpm.
Close Plysmith before installing, updating, or uninstalling it. Leave at
least 700 MiB free on the target drive.

The installer is currently **unsigned**, so Windows may display a warning.
Only run a download from a source you have checked. You can compare its hash
with `SHA256SUMS.txt` in PowerShell using
`Get-FileHash -Path "path to installer file" -Algorithm SHA256`. Replace the
path with the location of your downloaded file.

Program files and data are separate. A fresh default installation puts the
program in `%LOCALAPPDATA%\Programs\Plysmith`. The data folder
`%LOCALAPPDATA%\Plysmith` remains after a normal uninstall. Back up important
work as described in [Language and data](docs/manual/04-settings.en.md#language-and-data).

**Upgrading to beta.1:** The data format has changed. This version cannot open
inventory created by alpha.7 or earlier, and there is no migration. Close Plysmith and
back up the complete data folder before upgrading. To start a new inventory,
move the previous data folder to a safe location. A new one will be created
on the next startup. Old data is never automatically deleted or converted.

## Running from Source

Developers do not need the installer. You need **Windows x64**, Git,
**Node.js 24.x**, and **pnpm 11.19.0**. The authoritative versions are
`engines.node` and `packageManager` in [package.json](package.json).
If pnpm is not installed, set it up after installing Node.js:

```powershell
npm install --global pnpm@11.19.0
```

Clone the repository and install its dependencies:

```powershell
git clone https://github.com/lzzzy/plysmith.git
cd plysmith
pnpm install --frozen-lockfile
pnpm exec install-electron
```

`install-electron` downloads the desktop runtime. SQLite uses bundled native
modules, so Windows x64 does not require a separate compiler.

Start the Host in the repository directory first and keep its terminal open:

```powershell
pnpm dev:host
```

Once the Host is ready, open a second terminal in the same repository
directory and start the Desktop:

```powershell
pnpm dev:desktop
```

This builds and opens the Desktop. Both processes must remain running while
you use the app. To stop, close the Desktop and stop the Host with `Ctrl+C`.
Development data is stored in the repository, separately from an installed
app's data profile.

**We currently support Windows only.** If there is interest from the community,
we could add support for platforms such as Linux and macOS in the medium term.
This would require contributors to handle testing on each target operating
system, reproduce bugs, and regularly check new versions. We currently have
no devices running these operating systems. To help with this work, please
get in touch through [GitHub Issues](https://github.com/lzzzy/plysmith/issues/new/choose).

See [CONTRIBUTING.en.md](CONTRIBUTING.en.md) for dependency troubleshooting,
tests, and contribution guidelines.

## Getting Started

Start with the [manual's fundamentals](docs/manual/README.en.md) and
[importing the example inventory](docs/manual/01-import.en.md). The exercises
begin in **All inventory**; working contexts come later. You do not need
an engine to review material or explore your own continuations.

For individual tasks, go directly to these chapters:

- [Review and organize inventory](docs/manual/02-inventory.en.md).
- [Explore positions and save notes or analysis paths](docs/manual/03-analysis.en.md).
- [Configure engines and read their evaluations](docs/manual/04-settings.en.md).
- [Play out positions](docs/manual/05-playout.en.md) or [play and watch live games on Lichess](docs/manual/06-live.en.md).
- [Build an opening library](docs/manual/07-opening-library.en.md) and [work on topics in parallel with working contexts](docs/manual/08-contexts.en.md).

## Setting Up Chess Engines

Stockfish, Lc0, and Maia weights come from separate projects. Check their
sources, licenses, and system requirements before installing them.

The installer contains neither engines nor model weights. Download sources:

- **Stockfish:** [Official Windows builds](https://stockfishchess.org/download/).
- **Lc0 for Maia:** [Stable Windows builds](https://github.com/LeelaChessZero/lc0/releases), including CPU packages for computers without a suitable GPU.
- **Maia models:** [Classic Maia weights](https://github.com/CSSLab/maia-chess/tree/master/maia_weights) in `maia-*.pb.gz` format. Newer model generations with a different format are not suitable for this setup.

[Settings and engines](docs/manual/04-settings.en.md) explains
configuration in Plysmith, the three Stockfish detail levels, and how to
read evaluations. For invalid configurations, see
[Diagnostics and reconfiguration](docs/manual/04-settings.en.md#diagnostics-and-fresh-configuration).

## Reporting Bugs and Ideas

Use [GitHub Issues](https://github.com/lzzzy/plysmith/issues/new/choose) to
report a bug or suggest an improvement. An incomplete but understandable
report is still useful. For a bug, these details help most:

- Plysmith version from **Settings > Local system > Technical details**; if
  the app will not start, the downloaded installer filename is enough.
- Windows version and the steps that lead to the problem.
- What you expected and what actually happened.
- A screenshot and diagnostic report, if helpful. Both are optional; you
  can report a startup failure without a diagnostic report.

The manual explains how to create a local report under
[Diagnostics and reconfiguration](docs/manual/04-settings.en.md#diagnostics-and-fresh-configuration).
Before attaching screenshots or the report, check for personal information
and redact it if needed. Please do not post your database, active configuration,
`.env`, private games, notes,
or raw logs in a public issue. A diagnostic report is not a backup.

## Contributing

Bug reports, ideas, documentation, translations, tests, and code
contributions are welcome. See [CONTRIBUTING.en.md](CONTRIBUTING.en.md) for
local development and pull requests.

## More Information

Plysmith installs no system service, autostart, or automatic updater, and
does not automatically upload telemetry or crash reports. The release files
`sbom.cdx.json`, `release-license-inventory.json`,
`THIRD_PARTY_NOTICES.txt`, and `licenses.tar.gz` document shipped components
and license evidence. The inventory states its coverage limits and is not
legal clearance. Plysmith's application code is licensed under
[Apache-2.0](LICENSE); the [chess font](assets/fonts/plysmith-chess/README.md)
uses the [SIL Open Font License 1.1](licenses/PlysmithChess-OFL.txt).
