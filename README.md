# Plysmith

[Deutsch](README.md) | [English](README.en.md)

Plysmith ist eine lokale Open-Source-Schachwerkstatt für eigene Analysen und
Partien. Sie können zum Beispiel eine Eröffnungsbibliothek aufbauen, ein
Endspiel untersuchen und aus einer Stellung gegen eine Engine spielen.

Für den Einstieg genügt **Gesamter Bestand**. Arbeitskontexte sind
optional: Sie können damit mehrere Themen parallel bearbeiten und für ein
Training passende Analysen und Partien aus dem gesamten Bestand
zusammenstellen. Die Einträge bleiben im Bestand; der Arbeitskontext ist
keine zweite Kopie.

Dies ist eine frühe, wenig getestete Windows-Alpha. Rückmeldungen helfen,
Plysmith zu verbessern. Spätere Alpha-Versionen können möglicherweise nicht
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
Sichern Sie wichtige Arbeit selbst: Schließen Sie Plysmith und kopieren Sie
diesen Ordner an einen sicheren Ort. Eine spätere Alpha-Version garantiert
noch keine Übernahme älterer Daten oder Konfigurationen.

## Erste Schritte

In **Verwalten** können Sie ohne Arbeitskontext eine neue Analyse aus der
Grundstellung oder einer selbst aufgebauten Stellung beginnen. Analysen und
Partien bleiben im gesamten Bestand sichtbar. Wenn Sie mehrere Vorhaben
getrennt bearbeiten möchten, legen Sie Arbeitskontexte an und wählen dort
die passenden Bestandseinträge aus. Ein Arbeitskontext muss nicht vorab
eingerichtet werden.

Für eigene Analysen und die Verwaltung ist keine Schachengine nötig. Für
Enginebewertungen und Partien gegen eine Engine richten Sie diese gesondert
ein; der Installer enthält weder Engines noch Modellgewichte.

## Schachengines einrichten

Stockfish, Lc0 und Maia-Gewichte stammen von externen Projekten. Prüfen Sie
Quelle, Lizenz und Systemanforderungen vor der Installation.

1. **Stockfish:** Eine [offizielle Windows-Version](https://stockfishchess.org/download/)
   herunterladen und in einen dauerhaften Ordner entpacken. Unter
   **Einstellungen > Schachengine > Stockfish hinzufügen** bei **Programmdatei**
   die entpackte `stockfish*.exe` auswählen. Anschließend die Konfiguration
   prüfen und **Geänderte Konfiguration speichern** wählen.
2. **Maia Chess:** Eine passende
   [Lc0-Windows-Version](https://github.com/LeelaChessZero/lc0/releases)
   herunterladen und entpacken. Für Rechner ohne geeignete GPU gibt es
   CPU-Pakete. Ein klassisches `maia-*.pb.gz`-Gewicht aus dem
   [Maia-Chess-Projekt](https://github.com/CSSLab/maia-chess) herunterladen,
   aber nicht entpacken. Unter **Einstellungen > Schachengine > Maia Chess
   hinzufügen** bei **Programmdatei** `lc0.exe` und bei
   **Maia-Gewichtedatei** die `.pb.gz`-Datei auswählen. Danach
   **Geänderte Konfiguration speichern** wählen. Lc0 und Gewichtsdatei
   werden gemeinsam benötigt; die Gewichtsdatei ist keine ausführbare Engine.

Legen Sie Engine-Dateien außerhalb des Plysmith-Installationsordners an einem
dauerhaften Ort ab. Verschieben Sie sie nicht, solange Plysmith sie verwendet.
Falls ein Neustart angezeigt wird, schließen und öffnen Sie Plysmith erneut.
Stockfish und Maia sind unabhängig und optional. Für verschiedene
Maia-Spielstärken können Sie eigene Konfigurationen mit den jeweiligen
Gewichtsdateien anlegen.

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

Einen lokalen Diagnosebericht können Sie unter **Einstellungen > Diagnose >
Inhalt prüfen und Bericht erstellen** erzeugen und mit **Speicherort wählen**
selbst ablegen. Plysmith lädt ihn nicht automatisch hoch. Prüfen Sie vor dem
Anhängen Screenshots und Bericht auf persönliche Inhalte und machen Sie
private Angaben bei Bedarf unkenntlich. Veröffentlichen Sie in öffentlichen
Issues keine Datenbank, aktive Konfiguration, `.env`-Datei, privaten Partien,
Notizen oder unbearbeiteten Logs. Ein Diagnosebericht ist kein Backup.

## Weitere Angaben

Plysmith installiert keinen Systemdienst, Autostart oder automatischen
Updater und lädt weder Telemetrie noch Crashberichte automatisch hoch.
Die Release-Beigaben `sbom.cdx.json`, `release-license-inventory.json`,
`THIRD_PARTY_NOTICES.txt` und `licenses.tar.gz` dokumentieren gelieferte
Komponenten und Lizenznachweise; das Inventar benennt seine Grenzen und ist
keine rechtliche Freigabe. Die Plysmith-Quellen stehen unter
[Apache-2.0](LICENSE).

### Entwicklung

Das Repository verwendet Node 24, pnpm 11 und TypeScript. `pnpm verify`
prüft die Anwendung; `pnpm build:alpha` baut unter Windows x64 den Installer
samt Release-Beigaben unter `build/alpha-release/output`. Für die lokale
Entwicklung starten Sie `pnpm dev:host` und `pnpm dev:desktop`. Entwicklungs-
und Installationsprofil nutzen getrennte Daten und können parallel laufen.
Ein passender Versionstag erstellt auf GitHub einen Release-Entwurf; dessen
Veröffentlichung erfolgt separat.
