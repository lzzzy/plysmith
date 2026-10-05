# Plysmith 0.1.0-alpha.7

## Deutsch

### Neu in alpha.7

- PGN-Import mit Vorschau, Zielordner, Namenspräfix und gemeinsamer
  Namenskonfliktlösung. Hauptpfad und verschachtelte Varianten bleiben erhalten.
- Varianten stehen direkt im Zugablauf und sind zunächst zugeklappt.
  Analysepfade lassen sich als Variante, Kommentar oder eigene Analyse speichern;
  Varianten und ihre letzten Züge lassen sich löschen.
- Importierte Autorentexte an derselben Stellung bilden eine normale Notiz.
  Brettmarkierungen, technische Bewertungen, Uhren und Bewertungszeichen werden
  gefiltert, ohne Texte künstlich zu interpretieren.
- Sammelaktionen für ausgewählte Einträge, Verlustschutz bei Kontextänderungen
  und stabile Erstellungsreihenfolge. Importierte Kapitel folgen der PGN-Reihenfolge.
- Stockfish-Detaillevel sind gemeinsam für Analyse und Ausspielen konfigurierbar:
  Schnell 500 ms, Gründlich 1.500 ms, Tief 5.000 ms; Vorgabe 2 Threads,
  Ausspielen Gründlich. Analyseauswahl und Sortierung bleiben nach Neustart erhalten.
- Ruhigere Notizen, verschiebbarer Platz zwischen Zugliste und Engineanzeige
  und konsistente Navigation. Eine laufende oder pausierte Partie zeigt stets
  den neuesten Zug; Betrachtungsnavigation steht nach Partieende zur Verfügung.
- Aktualisierte Abhängigkeiten mit Sicherheitskorrekturen für Fastify und
  dessen URI-Verarbeitung sowie IP-Adressverarbeitung und Buildwerkzeuge.
- Zusätzliche Start-, Konfigurations-, Import- und Speicherfehler aus dem
  Release-Review korrigiert und mit Regressionstests abgesichert.

### Vor dem Wechsel

**Datenformatbruch gegenüber alpha.6:** Alte Bestände lassen sich nicht in
alpha.7 öffnen. Es gibt keine Migration. Schließen Sie Plysmith und sichern Sie
vor der Aktualisierung den vollständigen Datenordner `%LOCALAPPDATA%\Plysmith`.
Für einen neuen Bestand verschieben Sie den bisherigen Ordner an einen sicheren
Ort. Plysmith legt beim nächsten Start einen neuen an. Inkompatible Daten werden
nicht automatisch gelöscht oder konvertiert.

Ist ein Teil der technischen Konfiguration ungültig oder nicht unterstützt,
wird beim Start der gesamte Konfigurationssatz wie bei einer Neuinstallation
neu erstellt. Engines müssen dann vollständig neu eingerichtet werden.
Die Datenbank wird dabei nicht gelöscht; passende Bestände am Standardpfad
bleiben verfügbar. Ein früher manuell abweichender Datenbankpfad wird nicht übernommen.

### Installation und Grenzen

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

### New in alpha.7

- PGN import with preview, destination folder, name prefix and grouped name
  conflict resolution. Main lines and nested variations are retained.
- Variations appear in the move sequence and start collapsed. Save analysis
  paths as a variation, comment or separate analysis; delete variations or their last moves.
- Imported author text at the same position becomes one ordinary note.
  Board markings, technical evaluations, clocks and annotation glyphs are
  filtered without inventing interpretations of the text.
- Bulk actions with context loss protection and stable creation order.
  Imported chapters follow their order in the PGN file.
- Shared configurable Stockfish detail levels for analysis and playout:
  Quick 500 ms, Thorough 1,500 ms, Deep 5,000 ms; default 2 threads and
  Thorough for playout. Analysis selections and sorting survive restarts.
- Quieter notes, adjustable space between moves and engine results, and
  consistent navigation. Running and paused games always show the latest
  move; review navigation is available after the game ends.
- Dependency security fixes for Fastify, URI parsing, IP address handling and build tools.
- Additional startup, configuration, import and save-flow fixes from the
  release review, covered by regression tests.

### Before Upgrading

**Data-format break from alpha.6:** alpha.7 cannot open older inventories.
There is no migration. Close Plysmith and back up the complete data folder
`%LOCALAPPDATA%\Plysmith` before upgrading. To start a new inventory, move the
previous folder to a safe location. Plysmith creates a new one on the next
startup. Incompatible data is never automatically deleted or converted.

If any technical configuration is invalid or unsupported, startup recreates
the entire configuration set from scratch, like a fresh installation. Set up
all required engines again. This does not delete the database; compatible
inventory at the default path remains available. Previously customized
database paths are not retained.

### Installation and Limitations

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
