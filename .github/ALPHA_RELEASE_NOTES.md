# Plysmith Windows Alpha

## Deutsch

Diese frühe, wenig getestete Open-Source-Alpha ist für Windows x64. Laden Sie
`Plysmith-*-win-x64-Setup.exe` herunter. Git und Entwicklungswerkzeuge sind
nicht erforderlich. Der Installer ist **nicht digital signiert**; Windows kann
deshalb warnen. Prüfen Sie die Downloadquelle und vergleichen Sie bei Bedarf
den SHA-256-Wert mit `SHA256SUMS.txt`.

Sie können direkt im gesamten Bestand Analysen und Partien anlegen.
Arbeitskontexte helfen, ausgewählte Bestandseinträge für mehrere Themen
parallel zusammenzustellen. Stockfish liefert objektive
Stellungsbewertungen; Maia mit Lc0 bietet menschenähnliche Zugvorschläge
und einen Gegner zum Ausspielen. Beide werden separat eingerichtet;
Engines und Maia-Gewichte sind nicht enthalten.

Bei einer normalen Deinstallation bleiben Ihre Daten erhalten. Spätere
Alpha-Versionen können möglicherweise nicht alle bisherigen Daten und
Einstellungen lesen. Es gibt noch keine integrierte Sicherung oder Migration:
Sichern Sie wichtige Arbeit selbst. Die
[deutsche Anleitung](https://github.com/lzzzy/plysmith/blob/main/README.md)
erklärt Installation, Engines und das Melden von Fehlern mit freiwilligen
Screenshots und lokalen Diagnoseberichten. Auch wenn Plysmith nicht startet,
können Sie einen Fehler über
[GitHub Issues](https://github.com/lzzzy/plysmith/issues/new/choose) melden.
SBOM, Lizenzinventar, Notices und Lizenzarchiv liegen den Release-Dateien bei.

## English

This early, lightly tested open-source alpha is for Windows x64. Download
`Plysmith-*-win-x64-Setup.exe`; no Git checkout or development tools are
needed. The installer is **unsigned**, so Windows may warn. Check the
download source and, if needed, compare its SHA-256 hash with `SHA256SUMS.txt`.

You can create analyses and games directly in your inventory. Working
contexts let you collect selected inventory items for several topics in
parallel. Stockfish provides objective position evaluations; Maia with Lc0
offers human-like move suggestions and an opponent for playout. Set them up
separately; engines and Maia weights are not included.

A normal uninstall leaves your data in place. Future alpha releases are not
guaranteed to read all previous data and settings. There is no built-in
backup or migration yet; back up important work yourself. The
[English guide](https://github.com/lzzzy/plysmith/blob/main/README.en.md)
explains installation, engines, and how to report bugs with optional
screenshots and local diagnostic reports. You can still use
[GitHub Issues](https://github.com/lzzzy/plysmith/issues/new/choose) if
Plysmith will not start. The SBOM, license inventory, notices, and license
archive accompany the release files.
