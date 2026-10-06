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

**Wechsel auf alpha.7:** Das Datenformat wurde geändert. Bestände aus alpha.6
lassen sich nicht in dieser Version öffnen; eine Migration gibt es nicht.
Schließen Sie Plysmith und sichern Sie vor der Aktualisierung den vollständigen
Datenordner. Für einen neuen Bestand können Sie den bisherigen Datenordner
an einen sicheren Ort verschieben. Beim nächsten Start wird ein neuer angelegt.
Alte Daten werden weder automatisch gelöscht noch konvertiert.

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

## Varianten und Kommentare

Beim Analysieren sehen Sie zunächst den Hauptpfad. Über das Variantensymbol
an einer Abzweigstelle klappen Sie Nebenvarianten auf. Untervarianten stehen
innerhalb der jeweiligen Elternvariante. Ein Klick auf einen Zug zeigt die
Stellung, ohne andere aufgeklappte Alternativen auszublenden.

Erkunden Sie eine Fortsetzung auf dem Brett. Am Ende des Analysepfads wählen Sie,
wie Sie ihn ablegen möchten. **Als Variante speichern** ergänzt dieselbe Analyse
im Gesamtbestand; die Hauptlinie bleibt erhalten. Optional übernehmen Sie die
Zugfolge zugleich als frei bearbeitbaren Kommentar. Der Kommentar gilt allgemein
oder nur im aktiven Arbeitskontext; die strukturelle Variante gilt immer im Bestand.
Alternativ speichern Sie nur den Kommentar oder eine eigene benannte Analyse
mit Bezug zum Ausgangspunkt. Die gespielte Zugfolge einer Partie bleibt unverändert.

Eine Variante löschen Sie an ihrer Symbolzeile, den letzten Zug über die
Zugrücknahme. Vor dem Speichern sehen Sie die Änderung und betroffene Notizen.

## Ordner und Arbeitskontexte

In **Verwalten > Ordner** können Sie Analysen und Partien in verschachtelten
Ordnern ablegen. Ordner und Einträge lassen sich per Drag-and-drop
neu einsortieren. Unter **Herkunft** bleiben die tatsächlichen Ableitungen
zwischen Analysen und Partien sichtbar, unabhängig von ihrer Ablage.
Plysmith merkt sich die gewählte Ansicht für den Gesamtbestand und jeden
Arbeitskontext getrennt, auch nach einem Neustart.

Aktionen für Ordner und Einträge finden Sie an ihrer Zeile: als Symbole oder,
bei wenig Platz, im Menü **…**. Rechts sehen Sie die Details und die
Stellungsvorschau. Angekreuzte Einträge verschieben Sie gemeinsam per Auswahlaktion
oder indem Sie einen davon in den gewünschten Ordner ziehen. Die Auswahlaktionen
können mehrere Einträge auch in den aktuellen Arbeitskontext aufnehmen, daraus
entfernen oder nach Bestätigung aus dem Bestand löschen. Bei einem Fehler bleiben
die noch nicht erledigten Einträge ausgewählt.
Das Plus nimmt Inhalte in einen Arbeitskontext auf, das Minus entfernt sie
nur daraus. Der Mülleimer löscht aus dem Bestand.

Einträge stehen in aufsteigender Erstellungsreihenfolge. Importierte Kapitel
folgen ihrer Reihenfolge in der PGN-Datei; spätere Bearbeitungen oder
Verschiebungen ändern diese Reihenfolge nicht.

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

## PGN importieren

Unter **Verwalten > Import** wählen Sie eine lokale `.pgn`-Datei und bereiten
eine Vorschau vor. Wählen Sie die gewünschten Einträge aus und entscheiden
Sie, ob sie als **Analyse** oder **Partie** übernommen werden. Für ein
Eröffnungsrepertoire eignet sich Analyse; ein PGN-Ergebnis bestimmt den Typ
nicht automatisch. Importiert wird immer in den Gesamtbestand.

Wählen Sie einen bestehenden oder neuen Zielordner und einen gemeinsamen
Namenspräfix. Plysmith schlägt den Dateinamen vor: etwa Ordner
`italian-game.pgn` und Präfix `italian-game.pgn - `. Danach können Sie die
Einträge sichten, umbenennen, verschieben, löschen oder in Arbeitskontexten
verwenden. **Nicht eingeordnet** importiert ohne Ordner.

Die Vorschau zeigt Namenskonflikte, Warnungen und erhaltene Inhalte. Sie können
Namen bearbeiten oder die angebotenen Namensvorschläge gemeinsam übernehmen.
**Auswahl importieren** legt neue Einträge an; vorhandene Einträge werden
nicht ersetzt oder zusammengeführt. Ein erneuter Import mit anderen Namen
erzeugt weitere Einträge. Die Vorschau gilt nur für den aktuellen Import;
Schließen oder ein Neustart verwirft sie, ohne den Bestand zu verändern.

Hauptpfad und Nebenvarianten bleiben erhalten. Kommentartext und
nützliche Angaben wie Spieler, Eröffnung oder Ergebnis werden als normale
Notizen übernommen, die Sie bearbeiten und löschen können. Angaben an derselben
Stellung stehen zusammen in einer Notiz. Nebenvarianten lassen sich in der
Stellungsvorschau und beim Analysieren aufklappen.
Sie können auch aus einer importierten Stellung ausspielen.
Technische Angaben zu Brettmarkierungen, Bewertungen und Uhren sowie
Bewertungszeichen werden nicht übernommen. Erklärungen des Autors bleiben
unverändert erhalten.

Unterstützt wird Standardschach-PGN bis 16 MiB und 1.000 Einträge, mit
begrenzter Größe je Eintrag. UTF-8 ist die Vorgabe; für ältere Dateien bietet
Plysmith bei Bedarf ISO-8859-1 als ausdrückliche Wiederholungswahl an. Nicht
unterstützte Inhalte werden in der Vorschau benannt. Archive und Downloads
von einer URL sind noch nicht enthalten.

Der [Quellenkatalog](docs/import-sources.md) bietet Eröffnungen, Taktik,
Endspiele und Meisterpartien zum Ausprobieren, mit direkten Downloadlinks
und konkreten Hinweisen zum jeweiligen Material.

## Live auf Lichess

Unter **Einstellungen** richten Sie ein persönliches Lichess-API-Token mit
`board:play` ein und starten Plysmith neu. Das Token wird nur lokal gespeichert
und danach nicht mehr angezeigt. Ein Lichess-Passwort wird nicht benötigt.

Stellen Sie den Schalter in **Live** auf **Online**. Standard ist **Offline**;
die Wahl bleibt im Desktopprofil gespeichert. Online verbindet beim nächsten
Start wieder, Offline schließt die Verbindungen ohne eine Partie zu beenden.
Ohne Verbindung erkennt Plysmith keine Browserstarts; eine bereits bekannte
Fair-Play-Sperre bleibt bis zur bestätigten Klärung erhalten.

Starten Sie danach eigene Partien wie gewohnt im Lichess-Browser. Plysmith meldet den
Start in **Live**; mit der Board API kompatible Standardschachpartien können
Sie dort ohne Enginehilfe spielen. Während einer eigenen laufenden Partie ist
Engine- und Analysehilfe in ganz Plysmith gesperrt, auch beim Browser-Spiel.

Zum Zuschauen übergeben Sie die URL einer fremden Standardschachpartie.
Plysmith zeichnet die ganze Zugfolge auf und bietet eigene Engines zur
angezeigten Stellung. Lichess liefert Zuschauerupdates drei Züge verzögert.
Nach dem Ende können Sie die vollständige Partie speichern oder verwerfen.
Verlassen von Live beendet nur die lokale Aufnahme, nicht eine Onlinepartie.

Einrichtung und Grenzen: [Lichess Live](docs/lichess-live.md).

## Schachengines einrichten

Stockfish, Lc0 und Maia-Gewichte stammen von externen Projekten. Prüfen Sie
Quelle, Lizenz und Systemanforderungen vor der Installation.

1. **Stockfish:** Eine [offizielle Windows-Version](https://stockfishchess.org/download/)
   herunterladen und in einen dauerhaften Ordner entpacken. Unter
   **Einstellungen > Schachengine > Stockfish hinzufügen** bei **Programmdatei**
   die entpackte `stockfish*.exe` auswählen. Anschließend die Konfiguration
   prüfen und **Geänderte Konfiguration speichern** wählen.
   Neue Konfigurationen schlagen 2 Threads und die Detaillevel **Schnell**
   (500 ms), **Gründlich** (1.500 ms) und **Tief** (5.000 ms) vor. Die Zeiten
   gelten für Analyse und Ausspielen; letzteres verwendet standardmäßig
   **Gründlich**. Alle Werte können in der Konfiguration geändert werden.
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

Beim Start wird die gesamte technische Konfiguration geprüft. Ist irgendein
Teil ungültig oder nicht unterstützt, wird der komplette aktive Satz verworfen
und wie beim Erststart aus aktuellen Standards neu erstellt. Es werden keine
alten Werte übernommen, auch keine gültigen Teilkonfigurationen. Richten Sie
die gewünschten Engines anschließend von Anfang an neu ein. Dafür gibt es
keinen zusätzlichen Rücksetzungsbutton und keine Dateireparatur.

Die Datenbank selbst wird nicht gelöscht. Die Standardkonfiguration öffnet
wieder `data/plysmith.db`; sofern deren Datenformat zu dieser Version passt,
ist der dort vorhandene Bestand samt Notizen, Kontexten und Arbeitsständen
wieder verfügbar. Ein inkompatibler Bestand blockiert den Start und bleibt
unangetastet. Ein manuell abweichender
alter Datenbankpfad wird nicht übernommen; dessen Datei bleibt unangetastet.

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
