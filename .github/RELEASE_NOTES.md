# Plysmith 0.1.0-beta.2

## Deutsch

### Neu seit beta.1

- **PGN-Datensicherung und Wiederherstellung:** Unter **Einstellungen >
  Datensicherung** den gesamten gespeicherten Bestand mit Partien, Analysen,
  Ordnern, notwendigen Herkunftsbeziehungen und allgemeinen Notizen sichern.
  Die Sicherung lässt sich nach vollständiger Prüfung in einen frischen,
  leeren Bestand wiederherstellen. Die Datei enthält gewöhnliche PGN-Züge
  und zusätzliche Plysmith-Daten in Kommentaren; Kontexte, Entwürfe,
  kontextbezogene Notizen und Einstellungen sind nicht enthalten.
- **Lesbarere Pfadnotizen:** Bei der Übernahme eines Analysepfads in eine
  Notiz werden zusammengehörige Halbzüge in der üblichen Zugnotation
  zusammengefasst. Bereits gespeicherte Notizen bleiben unverändert.
- **Kompakte Zweigvorschau:** Zugeklappte Varianten zeigen neben dem
  Verzweigungssymbol genau ihren ersten Halbzug. Beim Aufklappen erscheint
  dieser wieder im Zugverlauf, ohne doppelte Anzeige in der Kopfzeile.
- **Robusterer Windows-Start:** Der private Laufzeithelfer erhält bei einem
  langsamen Kaltstart mehr Zeit. Ein tatsächlicher Timeout ist in der
  technischen Diagnose von anderen Prozessfehlern unterscheidbar;
  Zugriffsrechte und Instanzsperren bleiben unverändert.
- Die optionale technische Live-Protokollierung hilft, verzögerte oder
  ausgebliebene Aktualisierungen nachzuvollziehen, ohne Tokens, Spielernamen
  oder Partieinhalte zu protokollieren. Das Manual beschreibt jetzt auch
  Datensicherung und Wiederherstellung mit echten Screenshots.

### Bereits in beta.1 ergänzt

- **Live mit Lichess:** Im Browser eine normale Schachpartie starten, in
  Plysmith übernehmen und ohne Enginehilfe spielen. Zum Zuschauen eine
  Partie über ihre Lichess-URL öffnen und auf Wunsch Engines hinzunehmen.
  Abgeschlossene Aufzeichnungen lassen sich als Partie speichern oder verwerfen.
- Gemerkter Online-/Offline-Modus, laufende Uhren bei eigenen Partien,
  Spielerwertungen, Wiederverbindung und Nachladen des Endergebnisses.
  Enginehilfe bleibt während einer eigenen laufenden Onlinepartie gesperrt,
  auch bei einer unterbrochenen Verbindung.
- Verzögerte Aktualisierungen können einen bereits bestätigten Abschluss
  nicht mehr durch einen älteren laufenden Stand ersetzen. Beim bestätigten
  Partieende wird der bisherige Partiestream geschlossen.
- **Robusterer PGN-Import:** Größere kommentierte Studien, begrenzte
  Ressourcenbudgets, Abbruch einer laufenden Vorbereitung und eine klarere
  Vorschau. Unbrauchbare oder doppelte Namen werden vor dem Import sichtbar;
  Plysmith erfindet dafür keine Titel.
- Beim Speichern einer neuen Analyse ohne Quelle aus einem Arbeitskontext
  nur im Bestand oder in einem anderen Kontext wird der Arbeitsstand des
  Ausgangskontexts korrekt aktualisiert. Er behält auch nach einem Neustart
  keinen veralteten Verweis auf den bisherigen Analyseentwurf.
- Namensvorschläge für lange Titel beschädigen beim Kürzen für den
  Nummernzusatz keine Unicode-Zeichen mehr.
- Navigation und Kontextwahl zeigen ihre Sperre während laufender Vorgänge
  konsistent an. Bleibt die Speicherbestätigung einer ausgespielten Partie
  aus, sind Live und Einstellungen danach wieder erreichbar. Nach bestätigter
  Fair-Play-Freigabe lässt sich der Partieabschluss erneut öffnen.
- Gleichzeitige Änderungen an Diagnose- und Engineeinstellungen werden
  sauber als Konflikt abgewiesen, statt eine bereits bestätigte Einstellung
  unbemerkt zu überschreiben.
- Veraltete Konfliktvorschauen werden nach Bestandsänderungen neu geladen.
  Die Entscheidung, eine frühere Fassung als eigene Analyse zu behalten,
  verwendet dadurch auch nach einem Ansichtswechsel den aktuellen Stand.
- **Manual in Deutsch und Englisch:** Ein kleiner eigener PGN-Beispielbestand
  und echte App-Screenshots führen durch Bestand, Analyse, Notizen, Engines,
  Ausspielen, Live und schließlich Arbeitskontexte. Die README enthält
  Installation, Bezugsquellen und den Entwicklerstart statt doppelter Bedienhinweise.
- Erneute gründliche Prüfung der zentralen Abläufe, zusätzliche
  Regressionstests und aktualisierte Sicherheitskorrekturen in Abhängigkeiten.

### Weiterhin enthalten

Analysen mit bearbeitbarer Hauptlinie und gespeicherten Varianten, unveränderliche
Partien, eigene Analysepfade und Notizen, nachvollziehbare Herkunft, Ordner und
Sammelaktionen. Stockfish bietet konfigurierbare Detaillevel für Analyse und
Ausspielen; Maia mit Lc0 liefert menschenähnliche Zugvorschläge und einen Gegner.
Arbeitskontexte unterstützen die parallele Arbeit an Ihrem kuratierten Bestand.

### Vor dem Wechsel

**Gegenüber beta.1 ist das Datenformat unverändert.** Bestehende beta.1-Bestände
können weiterverwendet werden. Schließen Sie Plysmith vor der Aktualisierung
und sichern Sie wichtige Arbeit. In beta.1 ohne integrierte Datensicherung
kopieren Sie dazu den vollständigen Datenordner bei geschlossener App.

**Datenformatbruch gegenüber alpha.7 und älter:** Frühere Bestände lassen sich
weiterhin nicht öffnen. Es gibt keine Migration. Schließen Sie Plysmith und
sichern Sie vor der Aktualisierung den vollständigen Datenordner
`%LOCALAPPDATA%\Plysmith`. Für einen neuen Bestand verschieben Sie den
bisherigen Ordner an einen sicheren Ort. Plysmith legt beim nächsten Start
einen neuen an. Inkompatible Daten werden nicht automatisch gelöscht oder konvertiert.

Ist ein Teil der technischen Konfiguration ungültig oder nicht unterstützt,
wird beim Start der gesamte Konfigurationssatz wie bei einer Neuinstallation
neu erstellt. Engines müssen dann neu eingerichtet werden. Die Datenbank
wird dabei nicht gelöscht; passende Bestände am Standardpfad bleiben verfügbar.
Ein früher manuell abweichender Datenbankpfad wird nicht übernommen.

### Installation und Grenzen

Diese Beta ist eine Vorabversion für **Windows x64**, keine zugesicherte
fehlerfreie oder stabile Version. Laden Sie `Plysmith-*-win-x64-Setup.exe`
herunter. Git und Entwicklungswerkzeuge sind nicht erforderlich.
Der Installer ist **nicht digital signiert**; Windows kann deshalb warnen.
Prüfen Sie die Downloadquelle und vergleichen Sie bei Bedarf den SHA-256-Wert
mit `SHA256SUMS.txt`. Eine normale Deinstallation erhält Ihre Daten.

Engines, Maia-Gewichte und ein Lichess-Konto sind nicht enthalten.
Live benötigt einen eigenen Lichess-Token mit `board:play`; nur normales
Schach wird unterstützt. Zuschauen erfolgt über den offiziellen API-Stream,
der gegenüber dem Browser verzögert sein kann. Plysmith weiß nicht, welche
Partie Sie gerade im Browser anschauen.

Lokale Live-Aufnahmen werden nach einem Neustart von Plysmith nicht
wiederhergestellt. Speichern Sie abgeschlossene Partien vor dem Schließen.
Der gemerkte Online-/Offline-Modus stellt keine Aufnahme wieder her.

Die integrierte Datensicherung überträgt den gespeicherten Bestand, nicht
die vollständige Arbeitsumgebung. Sie ist kein Backup von Arbeitskontexten,
laufenden Entwürfen, kontextbezogenen Notizen, Engines oder Einstellungen.
Wiederherstellung ist nur in einen frischen, leeren Bestand möglich;
vorhandene Inhalte werden weder zusammengeführt noch überschrieben.
Eine Datenbankmigration gibt es nicht. Spätere Vorabversionen können erneut
ein anderes Datenformat benötigen.

[Installation und Projektüberblick](https://github.com/lzzzy/plysmith/blob/v0.1.0-beta.2/README.md),
[deutsches Manual](https://github.com/lzzzy/plysmith/blob/v0.1.0-beta.2/docs/manual/README.md)
und [Fehler melden](https://github.com/lzzzy/plysmith/issues/new/choose).
SBOM, Lizenzinventar, Notices und Lizenzarchiv liegen den Release-Dateien bei.

## English

### New Since beta.1

- **PGN backup and restore:** Under **Settings > Data backup**, save the
  entire stored inventory, including games, analyses, folders, necessary
  origin relationships and general notes. After full validation, restore
  the backup into a fresh, empty inventory. The file contains ordinary PGN
  moves with additional Plysmith data in comments; working contexts, drafts,
  context-specific notes and settings are not included.
- **More readable path notes:** When copying an analysis path into a note,
  matching half-moves are grouped using conventional move notation.
  Previously saved notes remain unchanged.
- **Compact branch preview:** Collapsed variations show exactly their
  first half-move next to the branch icon. Expanding a variation places
  that move back in the move list, without duplicating it in the heading.
- **More resilient Windows startup:** The private runtime helper allows
  more time for a slow cold start. Technical diagnostics distinguish an
  actual timeout from other process failures; access permissions and
  instance locks remain unchanged.
- Optional technical Live logging helps investigate delayed or missing
  updates without recording tokens, player names or game content. The
  manual now covers backup and restore with real screenshots.

### Previously Added in beta.1

- **Live with Lichess:** Start a standard chess game in your browser, open it
  in Plysmith and play without engine assistance. To watch, open a game using
  its Lichess URL and optionally use engines. Save completed recordings as
  games or discard them.
- Remembered online/offline mode, running clocks for your own games,
  player ratings, reconnection and retrieval of the final result. Engine
  assistance remains blocked during your own ongoing online game, including
  when the connection is interrupted.
- Delayed updates no longer replace an already confirmed terminal state
  with an older ongoing snapshot. The game stream is closed after the
  completed game is confirmed.
- **More robust PGN import:** Larger annotated studies, bounded resource
  budgets, cancellation during preparation and a clearer preview.
  Unusable or duplicate names are shown before importing; Plysmith does not
  invent titles for them.
- Saving a new analysis without a source from a working context to inventory
  only or to another context now updates the original context's working state
  correctly. It retains no stale reference to the previous analysis draft,
  including after a restart.
- Name suggestions for long titles no longer damage Unicode characters
  when shortening a name to make room for the numeric suffix.
- Navigation and context selection consistently show when an ongoing
  operation blocks them. If saving a playout receives no confirmation, Live
  and Settings become accessible again once the operation ends. The completion
  view can be reopened once Fair Play restrictions are confirmed as lifted.
- Concurrent changes to diagnostic and engine settings are rejected as
  conflicts rather than silently overwriting an already confirmed setting.
- Outdated conflict previews are reloaded after inventory changes. Keeping
  an earlier version as an independent analysis therefore uses the current
  state even after switching views.
- **German and English manuals:** A small original PGN example inventory
  and real app screenshots guide you through inventory, analysis, notes,
  engines, playout, Live and finally working contexts. The README covers
  installation, download sources and developer startup rather than duplicating
  operating instructions.
- Another thorough review of core workflows, additional regression tests
  and updated dependency security fixes.

### Still Included

Analyses with editable main lines and saved variations, immutable games,
your own analysis paths and notes, traceable origin, folders and bulk actions.
Stockfish provides configurable detail levels for analysis and playout;
Maia with Lc0 offers human-like move suggestions and an opponent.
Working contexts support parallel work on your curated inventory.

### Before Upgrading

**The data format is unchanged from beta.1.** Existing beta.1 inventories
can still be used. Close Plysmith before upgrading and back up important
work. In beta.1, which has no integrated backup, copy the complete data
folder while the app is closed.

**Data-format break from alpha.7 and earlier:** Earlier inventories still
cannot be opened. There is no migration. Close Plysmith and back up the complete
data folder `%LOCALAPPDATA%\Plysmith` before upgrading. To start a new
inventory, move the previous folder to a safe location. Plysmith creates a
new one on the next startup. Incompatible data is never automatically deleted
or converted.

If any technical configuration is invalid or unsupported, startup recreates
the entire configuration set from scratch, like a fresh installation.
Set up all required engines again. This does not delete the database;
compatible inventory at the default path remains available. Previously
customized database paths are not retained.

### Installation and Limitations

This beta is a prerelease for **Windows x64**, not a promise of a bug-free or
stable version. Download `Plysmith-*-win-x64-Setup.exe`; no Git checkout or
development tools are required. The installer is **unsigned**, so Windows
may warn. Check the download source and, if needed, compare its SHA-256 hash
with `SHA256SUMS.txt`. A normal uninstall leaves your data in place.

Engines, Maia weights and a Lichess account are not included. Live requires
your own Lichess token with `board:play`; only standard chess is supported.
Spectating uses the official API stream, which may lag behind the browser.
Plysmith does not know which game you are watching in your browser.

Local live recordings are not restored after restarting Plysmith. Save
completed games before closing the app. The remembered online/offline mode
does not restore a recording.

Integrated backup transfers the stored inventory, not the complete working
environment. It does not back up working contexts, active drafts,
context-specific notes, engines or settings. Restore requires a fresh,
empty inventory; existing contents are neither merged nor overwritten.
There is no database migration. Later prereleases may require another data format.

[Installation and project overview](https://github.com/lzzzy/plysmith/blob/v0.1.0-beta.2/README.en.md),
[English manual](https://github.com/lzzzy/plysmith/blob/v0.1.0-beta.2/docs/manual/README.en.md)
and [reporting bugs](https://github.com/lzzzy/plysmith/issues/new/choose).
The SBOM, license inventory, notices and license archive accompany the release files.
