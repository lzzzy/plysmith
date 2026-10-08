# Plysmith

[Deutsch](README.md) | [English](README.en.md)

Plysmith ist eine lokale Open-Source-Schachwerkstatt für eigene Analysen und
Partien. Sie können zum Beispiel eine Eröffnungsbibliothek aufbauen, ein
Endspiel untersuchen und aus einer Stellung gegen eine Engine spielen.

Das [deutsche Manual](docs/manual/README.md) führt mit einem kleinen,
importierbaren Beispielbestand durch die Grundlagen und alle Bereiche der App.

Dies ist eine Windows-Beta zur Erprobung der Anwendung. Weitere Rückmeldungen
helfen, Plysmith zu verbessern. Spätere Versionen können möglicherweise nicht
alle bisherigen Daten und Einstellungen lesen. Eine integrierte Sicherung
oder Wiederherstellung gibt es noch nicht.

## Installieren

Plysmith ist derzeit für **Windows x64** verfügbar. Laden Sie den
`Plysmith-*-win-x64-Setup.exe` aus einem
[GitHub Release](https://github.com/lzzzy/plysmith/releases) herunter,
installieren Sie ihn und öffnen Sie Plysmith über das Startmenü. Sie brauchen
weder Git noch Node.js oder pnpm. Schließen Sie Plysmith vor einer Installation,
Aktualisierung oder Deinstallation. Auf dem Ziellaufwerk sollten mindestens
700 MiB frei sein.

Der Installer ist derzeit **nicht digital signiert**. Windows kann deshalb
eine Warnung anzeigen. Führen Sie nur einen Download aus einer von Ihnen
geprüften Quelle aus. Zum Vergleich mit `SHA256SUMS.txt` können Sie in
PowerShell `Get-FileHash -Path "Pfad zur Installerdatei" -Algorithm SHA256`
verwenden. Ersetzen Sie den Pfad durch den Speicherort Ihrer Datei.

Programm und Daten liegen getrennt. Eine frische Standardinstallation legt
das Programm unter `%LOCALAPPDATA%\Programs\Plysmith` ab. Der Datenordner
`%LOCALAPPDATA%\Plysmith` bleibt bei einer normalen Deinstallation erhalten.
Wie Sie Ihre Arbeit sichern, beschreibt das Manual unter
[Sprache und Daten](docs/manual/04-settings.md#sprache-und-daten).

**Wechsel auf beta.1:** Das Datenformat wurde geändert. Bestände aus alpha.7 oder älter
lassen sich nicht in dieser Version öffnen; eine Migration gibt es nicht.
Schließen Sie Plysmith und sichern Sie vor der Aktualisierung den vollständigen
Datenordner. Für einen neuen Bestand können Sie den bisherigen Datenordner
an einen sicheren Ort verschieben. Beim nächsten Start wird ein neuer angelegt.
Alte Daten werden weder automatisch gelöscht noch konvertiert.

## Aus Quellcode starten

Für Entwickler ist kein Installer nötig. Sie benötigen **Windows x64**, Git,
**Node.js 24.x** und **pnpm 11.19.0**. Maßgeblich sind `engines.node` und
`packageManager` in [package.json](package.json). Falls pnpm noch nicht
installiert ist, richten Sie es nach der Installation von Node.js ein:

```powershell
npm install --global pnpm@11.19.0
```

Klonen Sie das Repository und installieren Sie die Abhängigkeiten:

```powershell
git clone https://github.com/lzzzy/plysmith.git
cd plysmith
pnpm install --frozen-lockfile
pnpm exec install-electron
```

`install-electron` lädt die Desktop-Runtime herunter. SQLite verwendet
mitgelieferte native Module; ein eigener Compiler ist unter Windows x64
nicht nötig.

Starten Sie zuerst den Host im Repositoryverzeichnis und lassen Sie das
Terminal geöffnet:

```powershell
pnpm dev:host
```

Sobald der Host bereit ist, öffnen Sie ein zweites Terminal im selben
Repositoryverzeichnis und starten den Desktop:

```powershell
pnpm dev:desktop
```

Der Desktop wird dabei gebaut und anschließend geöffnet. Beide Prozesse
müssen während der Nutzung laufen. Schließen Sie zum Beenden den Desktop
und stoppen Sie den Host mit `Ctrl+C`. Entwicklungsdaten liegen im Repository
und sind vom Datenprofil einer installierten App getrennt.

**Aktuell unterstützen wir nur Windows.** Bei Interesse aus der Community
könnten wir mittelfristig auch weitere Plattformen wie Linux und macOS
unterstützen. Dafür benötigen wir Mitwirkende, die Tests auf dem jeweiligen
Zielbetriebssystem, die Reproduktion von Fehlern und die regelmäßige Prüfung
neuer Versionen übernehmen. Uns stehen derzeit keine Geräte mit diesen
Betriebssystemen zur Verfügung. Wer dabei mithelfen möchte, kann sich über
[GitHub Issues](https://github.com/lzzzy/plysmith/issues/new/choose) melden.

Hinweise zu Abhängigkeitsproblemen, Tests und Beiträgen finden Sie in
[CONTRIBUTING.md](CONTRIBUTING.md).

## Erste Schritte

Beginnen Sie mit den [Grundlagen im Manual](docs/manual/README.md) und dem
[Import des Beispielbestands](docs/manual/01-import.md). Der Übungsweg führt
zunächst durch **Gesamter Bestand**; Arbeitskontexte kommen erst später hinzu.
Zum Sichten und für eigene Untersuchungen benötigen Sie noch keine Engine.

Für einzelne Aufgaben können Sie direkt weiterlesen:

- [Bestand sichten und ordnen](docs/manual/02-inventory.md).
- [Stellungen untersuchen, Notizen und Analysepfade speichern](docs/manual/03-analysis.md).
- [Engines einrichten und ihre Bewertungen lesen](docs/manual/04-settings.md).
- [Stellungen ausspielen](docs/manual/05-playout.md) oder [Live auf Lichess spielen und zuschauen](docs/manual/06-live.md).
- [Eine Eröffnungsbibliothek aufbauen](docs/manual/07-opening-library.md) und [mit Arbeitskontexten parallel arbeiten](docs/manual/08-contexts.md).

## Schachengines einrichten

Stockfish, Lc0 und Maia-Gewichte stammen von externen Projekten. Prüfen Sie
Quelle, Lizenz und Systemanforderungen vor der Installation.

Der Installer enthält weder Engines noch Modellgewichte. Bezugsquellen:

- **Stockfish:** [Offizielle Windows-Versionen](https://stockfishchess.org/download/).
- **Lc0 für Maia:** [Stabile Windows-Versionen](https://github.com/LeelaChessZero/lc0/releases), auch mit CPU-Paketen für Rechner ohne geeignete GPU.
- **Maia-Modelle:** [Klassische Maia-Gewichte](https://github.com/CSSLab/maia-chess/tree/master/maia_weights) im Format `maia-*.pb.gz`. Neuere Modellgenerationen mit anderem Format sind dafür nicht geeignet.

Die Einrichtung in Plysmith, die drei Stockfish-Detaillevel und das Lesen der
Bewertungen erklärt [Einstellungen und Engines](docs/manual/04-settings.md).
Was bei ungültiger Konfiguration geschieht, steht unter
[Diagnose und Neueinrichtung](docs/manual/04-settings.md#diagnose-und-neueinrichtung).

## Fehler und Ideen melden

Über [GitHub Issues](https://github.com/lzzzy/plysmith/issues/new/choose)
können Sie einen Fehler melden oder eine Verbesserung vorschlagen. Auch ein
unvollständiger, aber nachvollziehbarer Bericht hilft. Bei einem Fehler sind
diese Angaben besonders nützlich:

- Plysmith-Version aus **Einstellungen > Lokales System > Technische Details**;
  wenn die App nicht startet, genügt der Name der heruntergeladenen
  Installerdatei.
- Windows-Version sowie die Schritte, mit denen der Fehler auftritt.
- Was Sie erwartet haben und was stattdessen passiert ist.
- Falls hilfreich, ein Screenshot und ein Diagnosebericht. Beides ist
  freiwillig; ein Startfehler lässt sich auch ohne Diagnosebericht melden.

Das Erstellen eines lokalen Diagnoseberichts beschreibt das Manual unter
[Diagnose und Neueinrichtung](docs/manual/04-settings.md#diagnose-und-neueinrichtung).
Prüfen Sie vor dem Anhängen Screenshots und Bericht auf persönliche Inhalte
und machen Sie private Angaben bei Bedarf unkenntlich. Veröffentlichen Sie
in öffentlichen Issues keine Datenbank,
aktive Konfiguration, `.env`-Datei, private Partien, Notizen oder
unbearbeiteten Logs. Ein Diagnosebericht ist kein Backup.

## Mitwirken

Fehlerberichte, Ideen, Dokumentation, Übersetzungen, Tests und Codebeiträge
sind willkommen. Der Ablauf für lokale Entwicklung und Pull Requests steht
in [CONTRIBUTING.md](CONTRIBUTING.md).

## Weitere Angaben

Plysmith installiert keinen Systemdienst, Autostart oder automatischen
Updater und lädt weder Telemetrie noch Crashberichte automatisch hoch.
Die Release-Beigaben `sbom.cdx.json`, `release-license-inventory.json`,
`THIRD_PARTY_NOTICES.txt` und `licenses.tar.gz` dokumentieren gelieferte
Komponenten und Lizenznachweise; das Inventar benennt seine Grenzen und ist
keine rechtliche Freigabe. Der Plysmith-Anwendungscode steht unter
[Apache-2.0](LICENSE); der [Schachfont](assets/fonts/plysmith-chess/README.md)
steht unter der [SIL Open Font License 1.1](licenses/PlysmithChess-OFL.txt).
