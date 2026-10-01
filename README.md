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

Für eigene Analysen und die Verwaltung ist keine Schachengine nötig.
Stockfish liefert objektive Stellungsbewertungen. Maia Chess ergänzt
menschenähnliche Zugvorschläge und kann als Gegner beim Ausspielen dienen.
Auch mit Stockfish können Sie ausspielen. Der Installer enthält weder
Engines noch Modellgewichte.

## Ordner und Arbeitskontexte

In **Verwalten > Ordner** können Sie Analysen und Partien in verschachtelten
Ordnern ablegen. Ordner und Einträge lassen sich per Drag-and-drop
neu einsortieren. Unter **Herkunft** bleiben die tatsächlichen Ableitungen
zwischen Analysen und Partien sichtbar, unabhängig von ihrer Ablage.
Plysmith merkt sich die gewählte Ansicht für den Gesamtbestand und jeden
Arbeitskontext getrennt, auch nach einem Neustart.

Aktionen für Ordner und Einträge finden Sie an ihrer Zeile: als Symbole oder,
bei wenig Platz, im Menü **…**. Rechts sehen Sie die Details und die
Stellungsvorschau. Angekreuzte Einträge verschieben Sie gemeinsam, indem Sie
einen davon in den gewünschten Ordner ziehen.
Gelöscht wird jeweils ein einzelner Eintrag nach Bestätigung.
Das Plus nimmt Inhalte in einen Arbeitskontext auf, das Minus entfernt sie
nur daraus. Der Mülleimer löscht aus dem Bestand.

Ein Arbeitskontext kann einen Ordner samt Unterordnern aufnehmen: nur als
leere Ablageziele oder zusätzlich mit den derzeit darin liegenden Einträgen.
Später hinzugefügte Einträge werden nicht automatisch aufgenommen. Im
Arbeitskontext sehen Sie die passenden Ordner mit ihrem vollständigen Pfad.
Die Ablage bleibt für alle Arbeitskontexte dieselbe.

Das Löschen eines Bestandsordners samt Unterordnern erhält die Einträge;
sie erscheinen danach unter **Nicht eingeordnet**. Entfernen Sie einen Ordner
aus einem Arbeitskontext, entfallen dagegen dessen zugehörige Einträge und
Arbeitsstände nur dort. Vor einem Verlust von Kontextnotizen oder Entwürfen
fragt Plysmith nach. Die Einträge im Gesamtbestand bleiben erhalten.

## Schachengines einrichten

Stockfish, Lc0 und Maia-Gewichte stammen von externen Projekten. Prüfen Sie
Quelle, Lizenz und Systemanforderungen vor der Installation.

1. **Stockfish:** Eine [offizielle Windows-Version](https://stockfishchess.org/download/)
   herunterladen und in einen dauerhaften Ordner entpacken. Unter
   **Einstellungen > Schachengine > Stockfish hinzufügen** bei **Programmdatei**
   die entpackte `stockfish*.exe` auswählen. Anschließend die Konfiguration
   prüfen und **Geänderte Konfiguration speichern** wählen.
2. **Maia Chess:** Eine stabile
   [Lc0-Windows-Version](https://github.com/LeelaChessZero/lc0/releases)
   herunterladen und entpacken. Für Rechner ohne geeignete GPU gibt es
   CPU-Pakete. Ein klassisches `maia-*.pb.gz`-Gewicht aus dem
   [Ordner der Maia-Gewichte](https://github.com/CSSLab/maia-chess/tree/master/maia_weights)
   herunterladen, aber nicht entpacken. Neuere Maia-Modellgenerationen
   verwenden ein anderes Dateiformat. Unter **Einstellungen > Schachengine >
   Maia Chess hinzufügen** bei **Programmdatei** `lc0.exe` und bei
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
selbst ablegen. Plysmith lädt ihn nicht automatisch hoch. Bei einem
wiederholbaren Fehler können Sie vorher unter **Einstellungen > Diagnose**
das Diagnoselevel **Fehler** oder **Info** wählen, **Übernehmen** klicken,
Plysmith neu starten und den Fehler erneut auslösen. Erst danach enthält
der Bericht die zugehörigen technischen Ereignisse. Ein Bericht ohne diese
Schritte kann trotzdem nützlich sein. Prüfen Sie vor dem Anhängen Screenshots
und Bericht auf persönliche Inhalte und machen Sie private Angaben bei Bedarf
unkenntlich. Veröffentlichen Sie in öffentlichen Issues keine Datenbank,
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
