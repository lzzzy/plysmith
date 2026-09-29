# Plysmith

[Deutsch](README.md) | [English](README.en.md)

Plysmith is a local, open-source chess workbench for your own analyses and
games. You can build an opening library, study an endgame, or play from a
position against an engine.

You can start with **All inventory**. Working contexts are optional: they
let you work on several topics in parallel and collect relevant analyses
and games from your inventory, for example for a training session. Items
remain in the inventory; a working context does not create another copy.

This is an early, lightly tested Windows alpha. Your feedback helps improve
Plysmith. Later alpha versions may not read all previous data and settings.
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
work yourself: close Plysmith and copy this folder to a safe location. Later
alpha versions are not guaranteed to read older data or configuration.

## Getting Started

In **Manage**, you can create a new analysis from the starting position or
a position you set up yourself, without creating a working context first.
Analyses and games remain visible in **All inventory**. When you want to work
on several topics separately, create working contexts and select the
relevant inventory items for each one. You do not need a working context
to get started.

You can create your own analyses and manage your inventory without a chess
engine. Stockfish provides objective position evaluations. Maia Chess adds
human-like move suggestions and can be an opponent when you play out a
position. You can also play against Stockfish. The installer contains
neither engines nor model weights.

## Setting Up Chess Engines

Stockfish, Lc0, and Maia weights come from separate projects. Check their
sources, licenses, and system requirements before installing them.

1. **Stockfish:** Download an
   [official Windows build](https://stockfishchess.org/download/) and extract
   it to a permanent folder. Under **Settings > Chess engine > Add Stockfish**,
   select the extracted `stockfish*.exe` as the **Executable**. Review the
   configuration and choose **Save changed configuration**.
2. **Maia Chess:** Download and extract a stable
   [Lc0 Windows build](https://github.com/LeelaChessZero/lc0/releases).
   CPU packages are available if your computer lacks a suitable GPU. Download
   a classic `maia-*.pb.gz` file from the
   [Maia weights folder](https://github.com/CSSLab/maia-chess/tree/master/maia_weights),
   but do not extract it. Newer Maia model generations use a different file
   format. Under **Settings > Chess engine > Add Maia Chess**, select
   `lc0.exe` as the **Executable** and the `.pb.gz` file as the
   **Maia weights file**. Then choose **Save changed configuration**.
   You need both Lc0 and the weights file; the weights file is not an
   executable engine.

Keep engine files in a permanent location outside the Plysmith installation
folder. Do not move them while Plysmith uses them. If Plysmith asks for a
restart, close and reopen it. Stockfish and Maia are independent and optional.
You can create separate configurations for different Maia strengths using
their corresponding weights files.

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

You can create a local diagnostic report under **Settings > Diagnostics >
Review contents and create report** and save it yourself with
**Choose destination**. Plysmith does not upload it automatically. For a
reproducible bug, you can first select **Errors** or **Info** under
**Settings > Diagnostics**, choose **Apply**, restart Plysmith, and repeat
the problem. Only then will the report include the related technical events.
A report without these steps can still help. Before attaching screenshots or
the report, check for personal information and redact it if needed. Please
do not post your database, active configuration, `.env`, private games, notes,
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
