# Einstellungen und Engines

Bis hierher haben Sie selbst Fortsetzungen untersucht. Eine Engine ergänzt Ihre Überlegungen: Stockfish bewertet Stellungen und sucht gute Züge, Maia zeigt für ein gewähltes Profil wahrscheinliche menschliche Züge. Beide können Ihnen außerdem beim Ausspielen als Gegner dienen.

## Sprache und Daten

Unter **Einstellungen > Sprache** wählen Sie **Deutsch** oder **English** und klicken auf **Übernehmen**. Die Wahl betrifft die Oberfläche und die Schachnotation. Ihre eigenen Namen und Notiztexte werden dadurch nicht übersetzt.

[![Sprache und weitere Einstellungen in Plysmith](screenshots/settings-general.png)](screenshots/settings-general.png)

Der persönliche Datenordner einer Standardinstallation liegt unter `%LOCALAPPDATA%\Plysmith`, getrennt vom Programm. In den Einstellungen gibt es derzeit keine Auswahl für einen anderen Datenpfad. Für eine Sicherung schließen Sie Plysmith und kopieren den gesamten Datenordner an einen sicheren Ort. Ein Diagnosebericht ersetzt diese Sicherung nicht.

Unter **Lokales System** sehen Sie, ob der **Datenspeicher** verbunden ist. **Technische Details** enthält unter anderem das Release, das Sie bei einer Fehlermeldung angeben können.

## Stockfish einrichten

Sie benötigen eine entpackte Stockfish-Programmdatei für Ihren Rechner. Bewahren Sie Engine-Dateien an einem dauerhaften Ort außerhalb des Plysmith-Installationsordners auf. Verschieben Sie sie nicht, solange Plysmith sie verwendet. Engines und Modellgewichte sind nicht im Installer enthalten; Stockfish und Maia können Sie unabhängig voneinander einrichten.

Die [Bezugsquellen für Stockfish, Lc0 und Maia](../../README.md#schachengines-einrichten) finden Sie in der Projektübersicht.

1. Öffnen Sie **Einstellungen > Schachengine** und wählen Sie **Stockfish hinzufügen**.
2. Wählen Sie bei **Programmdatei** über **Auswählen** die Stockfish-Datei aus.
3. Prüfen Sie den **Anzeigenamen** und die vorgeschlagenen Werte.
4. Klicken Sie auf **Geänderte Konfiguration speichern** und starten Sie Plysmith anschließend neu.

[![Stockfish-Konfiguration mit drei Detailleveln und Gründlich für Ausspielen](screenshots/settings-stockfish.png)](screenshots/settings-stockfish.png)

Die drei Detaillevel verwenden zunächst folgende Rechenzeiten:

| Detaillevel | Rechenzeit | Verwendung                                        |
| ----------- | ---------: | ------------------------------------------------- |
| Schnell     |     500 ms | Erste Orientierung beim Durchgehen von Stellungen |
| Gründlich   |   1.500 ms | Genauer nachsehen bei kurzer Wartezeit            |
| Tief        |   5.000 ms | Eine interessante Stellung länger untersuchen     |

Alle drei verwenden die eingestellte Zahl **Threads**, zunächst **2**. **Hash (MB)** legt den Arbeitsspeicher für die Suchergebnisse fest; vorgeschlagen sind **64 MB**. Für den Einstieg können Sie diese Werte beibehalten. Mehr Rechenzeit erlaubt eine längere Suche, garantiert aber keine bestimmte Spielstärke oder fehlerfreie Bewertung.

Unter **Detaillevel für Ausspielen** wählen Sie, welche dieser Rechenzeiten Stockfish als Gegner erhält. Voreingestellt ist **Gründlich**. Die Wahl der Rechenzeit im Analysebereich erfolgt davon unabhängig.

Über **Konfiguration** können Sie später eine vorhandene Engine auswählen und bearbeiten. **Änderungen verwerfen** nimmt Ihre noch nicht gespeicherten Eingaben zurück. **Engine entfernen** entfernt die Konfiguration aus Plysmith; die externe Programmdatei bleibt erhalten. Beachten Sie jeweils den angezeigten Neustarthinweis.

## Maia einrichten

Für Maia benötigen Sie zwei Dateien: die entpackte Programmdatei `lc0.exe` und eine klassische Maia-Gewichtedatei im Format `.pb.gz`. Lassen Sie die Gewichtedatei komprimiert. Sie enthält das Modell; sie ist keine ausführbare Programmdatei.

Wählen Sie **Maia Chess hinzufügen**, ordnen Sie **Programmdatei** und **Maia-Gewichtedatei** zu und vergeben Sie einen passenden **Anzeigenamen**, beispielsweise „Maia 1500“. Speichern Sie die Konfiguration und starten Sie Plysmith neu. Für weitere Profile legen Sie weitere Konfigurationen mit den jeweiligen Gewichtedateien an. Dieselbe Lc0-Programmdatei kann dabei verwendet werden.

[![Maia-Konfiguration mit Programmdatei, Anzeigename und Gewichtedatei](screenshots/settings-maia.png)](screenshots/settings-maia.png)

Das Profil wird durch die Gewichtedatei bestimmt, nicht durch den Namen. Eine Umbenennung von „Maia 1500“ in „Maia 1900“ ändert deshalb das Modell nicht. Die Zahl bezeichnet das Trainingsprofil und ist keine zugesicherte Spielstärke des Gegners. Beim Ausspielen wählt Maia den vom Modell am wahrscheinlichsten eingeschätzten Zug. Die drei Stockfish-Detaillevel gelten nicht für Maia.

## Stellung einschätzen

Öffnen Sie „Manual - Italienische Eröffnung“ in **Analysieren** und wählen Sie eine Stellung, etwa nach 3.Lc4. Unter **Stellung einschätzen** beziehen sich alle Ergebnisse auf die gerade auf dem Brett gezeigte Stellung.

[![Stockfish-Bewertungen und Maia-Zugwahrscheinlichkeiten für die angezeigte Stellung](screenshots/engine-analysis.png)](screenshots/engine-analysis.png)

Wählen Sie **Schnell**, **Gründlich** oder **Tief**. Sind mehrere Stockfish-Konfigurationen eingerichtet, können Sie auch zwischen diesen wählen. Über die Checkboxen schalten Sie einzelne Maia-Profile hinzu. Plysmith merkt sich Rechenzeit, Engineauswahl, Maia-Auswahl und Sortierung über einen Neustart hinweg.

Jeder Eintrag beginnt mit einem vorgeschlagenen Zug. Rechts steht seine Stockfish-Bewertung, darunter gegebenenfalls die von Stockfish erwartete Fortsetzung. So lesen Sie die Anzeige:

| Anzeige                         | Bedeutung                                                              |
| ------------------------------- | ---------------------------------------------------------------------- |
| `+0.50`                         | Vorteil für Weiß, ausgedrückt in Bauerneinheiten                       |
| `-0.50`                         | Vorteil für Schwarz                                                    |
| `#3` / `#-3`                    | Stockfish meldet Matt in drei Zügen für Weiß beziehungsweise Schwarz   |
| `≥` oder `≤` vor dem Wert       | Die Engine kennt hier eine Grenze, keinen genauen Wert                 |
| Grüner, grauer und roter Balken | Geschätzte Anteile für Sieg Weiß, Remis und Sieg Schwarz               |
| Blauer Maia-Balken              | Wahrscheinlichkeit, mit der das betreffende Modell diesen Zug erwartet |

Die Bewertung bleibt immer aus Sicht von **Weiß**, auch wenn Schwarz am Zug ist oder Sie das Brett drehen. Ein positiver Wert ist keine Gewinnwahrscheinlichkeit und kein sicherer Materialgewinn. Die Ergebnisbalken sind ebenfalls Schätzungen des Modells. Der breite Balken über der Liste gehört zur aktuellen Stellung, die kleinen Ergebnisbalken zu den jeweiligen Fortsetzungen. Wenn Sie den Mauszeiger über einen Balken halten, erscheinen seine Prozentwerte.

Maia zeigt je Profil höchstens die fünf bevorzugten Züge. Bei mehreren Profilen werden gleiche Züge in einer Zeile zusammengeführt. Fehlt dort ein Maia-Balken, gehört der Zug nicht zu den angezeigten Vorschlägen dieses Profils; das bedeutet weder null Wahrscheinlichkeit noch automatisch einen Fehler. Die sichtbaren Maia-Balken müssen zusammen keine 100 Prozent ergeben.

Mit **Sortieren nach** bestimmen Sie die Reihenfolge. Der Wahlschalter steht rechts neben dem Detaillevel und erscheint, sobald mindestens ein Maia-Profil ausgewählt ist. Bei einer einzigen Stockfish-Konfiguration bezeichnet das im Bild dort sichtbare **Stockfish** die Sortierung, nicht die Engineauswahl. **Stockfish** stellt die aus Sicht der am Zug befindlichen Seite besseren Vorschläge nach oben. Bei Schwarz können daher stärker negative angezeigte Werte oben stehen. Ein Maia-Profil sortiert nach dessen Zugwahrscheinlichkeit. Sortieren ändert keine gespeicherten Züge.

Die Vorschläge sind Anregungen für Ihre Untersuchung. Um einen Zug auszuprobieren, führen Sie ihn auf dem Brett aus. Erst Ihre anschließende Entscheidung, den Analysepfad zu übernehmen oder zu speichern, hält ihn fest. Eine Engineberechnung allein legt weder Varianten noch neue Bestandseinträge an.

**Die Bewertung kennt nicht die vollständige Partievorgeschichte** kann beispielsweise bei einer frei aufgebauten Stellung erscheinen. Plysmith kann deren fehlende Vorgeschichte nicht aus der Stellung zurückgewinnen. Bei einem Enginefehler können Sie über das Aktualisierungssymbol **Erneut versuchen**. Fehlt eine Engine ganz, prüfen Sie ihre Konfiguration und den erforderlichen Neustart.

## Lichess-Zugang

Unter **Einstellungen > Lichess** tragen Sie ein **Persönliches API-Token** Ihres Lichess-Kontos mit der Berechtigung `board:play` ein, auf Lichess als „Mit der Board API spielen“ bezeichnet. Verwenden Sie dafür nicht Ihr Lichess-Passwort.

Erstellen Sie es auf der Lichess-Seite [Persönliches API-Token erstellen](https://lichess.org/account/oauth/token). Melden Sie sich dort mit Ihrem Konto an, vergeben Sie eine Bezeichnung wie „Plysmith“ und wählen Sie die genannte Berechtigung. Tragen Sie das erzeugte Token anschließend in Plysmith ein; geben Sie es nicht an andere weiter.

[![Lichess-Einstellungen mit leerem Tokenfeld](screenshots/settings-lichess.png)](screenshots/settings-lichess.png)

Klicken Sie auf **Zugang speichern** und starten Sie Plysmith neu. Das Token wird lokal gespeichert und anschließend nicht wieder angezeigt. Ein leeres Eingabefeld bedeutet deshalb nicht, dass der Zugang fehlt; maßgeblich ist die Anzeige **Zugang eingerichtet**.

Ein neues Token können Sie über dasselbe Feld speichern. Einen Button zum Löschen des Tokens gibt es derzeit nicht. Sie können das Token in Ihrem Lichess-Konto widerrufen. Wenn Sie lediglich keine Verbindung wünschen, stellen Sie in **Live** auf **Offline**. Die gespeicherte Wahl **Online** oder **Offline** bestimmt auch das Verhalten beim nächsten Start. Den eigentlichen Ablauf beschreibt [Live auf Lichess](06-live.md).

## Diagnose und Neueinrichtung

Unter **Diagnose** wählen Sie **Aus**, **Fehler**, **Info** oder **Debug** und bestätigen mit **Übernehmen**. Die Stufen erfassen zunehmend mehr technische Ereignisse. Beachten Sie den Neustarthinweis und die Zeile **In Plysmith aktiv**. Für einen nachvollziehbaren Fehler wählen Sie beispielsweise **Info**, starten neu und wiederholen die betroffenen Schritte.

[![Diagnoselevel und aktuell aktive Einstellung](screenshots/settings-diagnostics.png)](screenshots/settings-diagnostics.png)

**Inhalt prüfen und Bericht erstellen** zeigt Ihnen, welche Datenkategorien der Fehlerbericht enthält und ausschließt. Mit **Speicherort wählen** legen Sie die Datei selbst ab. Plysmith lädt sie nicht automatisch hoch. Prüfen Sie einen Bericht und ergänzende Screenshots vor der Weitergabe auf persönliche Inhalte.

Wo Sie einen Fehler melden können und welche Angaben dabei helfen, beschreibt
[Fehler und Ideen melden](../../README.md#fehler-und-ideen-melden).

[![Vorschau der enthaltenen und ausgeschlossenen Kategorien eines Fehlerberichts](screenshots/settings-report.png)](screenshots/settings-report.png)

Ist die gespeicherte technische Konfiguration beim Start ungültig oder nicht mehr unterstützt, richtet Plysmith die gesamte Konfiguration neu ein, ohne alte Teilkonfigurationen zu übernehmen. Gewünschte Engines müssen Sie dann erneut konfigurieren. Die Bestandsdatenbank wird dabei nicht gelöscht. Der Standarddatenbestand wird wieder geöffnet, sofern sein Datenformat unterstützt wird. Bei einem inkompatiblen Datenformat kann Plysmith nicht starten; die Daten bleiben unangetastet. Ein zuvor manuell abweichender Datenpfad wird nicht übernommen; die dortige Datei bleibt erhalten. Ein falsches oder widerrufenes Lichess-Token ist dagegen zunächst ein Zugangsfehler.

[Zur Übersicht](README.md) · Weiter mit [Stellungen ausspielen](05-playout.md).
