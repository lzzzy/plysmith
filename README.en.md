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

**Upgrading to alpha.7:** The data format has changed. This version cannot open
inventory created by alpha.6, and there is no migration. Close Plysmith and
back up the complete data folder before upgrading. To start a new inventory,
move the previous data folder to a safe location. A new one will be created
on the next startup. Old data is never automatically deleted or converted.

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

## Variations and Comments

The analysis view initially shows the main line. Expand a variation using its
branch symbol. Nested variations appear within their parent variation.
Selecting a move shows its position without hiding other expanded alternatives.

Explore a continuation on the board, then choose how to save it at the end of
the analysis path. **Save as variation** extends the same analysis in the global inventory
without replacing its main line. Optionally save the move sequence as an editable
comment at the same time. The comment can be global or limited to the current
working context; the structural variation always belongs to the inventory.
Alternatively, save only the comment or create a separate named analysis linked
to its starting point. A game's played move sequence remains unchanged.

Delete a variation from its symbol row, or take back its last move. Before
saving, review the change and any affected notes.

## Folders and Working Contexts

In **Manage > Folders**, you can organize analyses and games in nested folders.
Drag folders and items to change their location. **Origins**
shows the actual derivations between analyses and games, independently of
their folder location.
Plysmith remembers the selected view separately for the full inventory and
each working context, including after a restart.

Folder and item actions are available at their rows: as icons or, when space
is limited, in the **…** menu. The right-hand panel shows details and a
position preview. Move checked items together using the selection action or by
dragging one of them to the destination folder. Selection actions can also add
multiple items to the current working context, remove them from that context,
or delete them from inventory after confirmation. If an operation fails, the
remaining items stay selected.
The plus adds content to a working context; the minus removes it only from
that context. The trash icon deletes from the inventory.

Items appear in ascending creation order. Imported chapters follow their order
in the PGN file; later edits or moves do not change this order.

A working context can include a folder and its subfolders as empty destinations
or together with their current items. Items added later are not included
automatically. The working context shows relevant folders with their full paths.
Folder locations are shared by all working contexts.

Deleting an inventory folder and its subfolders keeps the items; they appear
under **Unfiled**. Removing a folder from a working context instead removes
its associated items and work from that context only. Plysmith asks before
discarding context notes or drafts. The inventory items themselves remain.

## Importing PGN

In **Manage > Import**, choose a local `.pgn` file and prepare a preview.
Select the entries you want and choose whether to import them as **Analysis**
or **Game**. Analysis suits an opening repertoire; a PGN result does not
automatically determine the type. Imports always go into the global inventory.

Choose an existing or new destination folder and a common name prefix.
Plysmith suggests the file name, for example folder `italian-game.pgn` and
prefix `italian-game.pgn - `. Afterwards, review, rename, move or delete items,
or include them in working contexts. **Unfiled** imports without a folder.

The preview shows name conflicts, warnings and preserved content. Edit names
or apply the offered name suggestions together. **Import selection** creates
new items; it does not replace or merge existing items. Importing again with
different names creates additional items. The preview belongs to the current
import only; closing it or restarting discards it without changing inventory.

The main line and variations are preserved. Comment text and
useful details such as players, opening or result become ordinary notes that
you can edit or delete. Comments at the same position are combined into one
note. Expand side variations in the position preview or analysis view.
You can also play out an imported position.
Technical board markings, evaluations, clock annotations and evaluation symbols
are not imported. The author's explanations are preserved unchanged.

Standard-chess PGN is supported up to 16 MiB and 1,000 entries, with bounded
size per entry. UTF-8 is the default; for older files, Plysmith can offer an
explicit ISO-8859-1 retry. Unsupported content is identified in the preview.
Archives and URL downloads are not supported yet.

The [source catalogue (German)](docs/import-sources.md) lists openings,
tactics, endgames and master games to try, with direct download links and
material-specific notes.

## Lichess Live

In **Settings**, enter a personal Lichess API token with `board:play`, then
restart Plysmith. The token is stored locally and is never displayed again.
No Lichess password is needed.

In **Live**, switch to **Online**. The default is **Offline**; the choice is
remembered in the desktop profile. Online reconnects on the next start; Offline
closes connections without ending a game. Without a connection, Plysmith cannot
detect browser game starts. A known Fair Play restriction remains until
Lichess confirms it can be cleared.

Start your games in the Lichess browser as usual. Plysmith reports the start
in **Live**; Board API-compatible standard chess games can be played there
without engines. While your own game is ongoing, engine and analysis assistance
is blocked throughout Plysmith, including when you play in the browser.

To watch a foreign standard chess game, paste its Lichess URL. Plysmith records
the complete move history and offers local engines for the displayed position.
Lichess spectator updates are delayed by three moves. After the game ends,
save the complete game or discard it. Leaving Live only ends the local
recording, not a game on Lichess.

Setup and boundaries: [Lichess Live](docs/lichess-live.md) (German).

## Setting Up Chess Engines

Stockfish, Lc0, and Maia weights come from separate projects. Check their
sources, licenses, and system requirements before installing them.

1. **Stockfish:** Download an
   [official Windows build](https://stockfishchess.org/download/) and extract
   it to a permanent folder. Under **Settings > Chess engine > Add Stockfish**,
   select the extracted `stockfish*.exe` as the **Executable**. Review the
   configuration and choose **Save changed configuration**.
   New configurations suggest 2 threads and **Fast** (500 ms), **Thorough**
   (1,500 ms), and **Deep** (5,000 ms). These configurable detail levels apply
   to both analysis and playout; playout defaults to **Thorough**.
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

The entire technical configuration is checked at startup. If any part is
invalid or unsupported, the complete active set is discarded and recreated from
current defaults, just like a first installation. No old values or valid partial
configurations are retained. Set up the engines you need again from scratch.
There is no additional reset button or manual file-repair workflow.

The database itself is not deleted. The default setup opens `data/plysmith.db`
again. If its data format matches this version, the inventory, notes, contexts
and work in progress stored there become available again. An incompatible
inventory blocks startup and remains untouched. A manually customized previous database path is not retained;
its file remains untouched.

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
