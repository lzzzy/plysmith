# Plysmith Grundlagen

Mit Plysmith können Sie sich gezielt mit Ihren Schachthemen beschäftigen: Fortsetzungen ausprobieren, Stellungen und Fortsetzungen bewerten lassen und eigene Gedanken dazu festhalten. Dafür wählen Sie die Partien und Analysen aus, die für Ihr persönliches Schachspiel interessant sind.

Zur Illustration verwenden wir in diesem Manual einen kleinen [Beispielbestand als PGN](manual.pgn). Auf diesem Material beruhen die Screenshots und die späteren Übungen. Sie können es importieren und die beschriebenen Abläufe selbst nachvollziehen. Der Beispielbestand enthält unter anderem eine italienische Eröffnung, eine Endspielstellung und eine kurze, konstruierte Lehrpartie mit Matt. Die Lehrpartie ist keine historische oder tatsächlich gespielte Partie und keine Eröffnungsempfehlung.

## Gesamter Bestand

In Plysmith verwalten Sie einen zentralen **Bestand** von Partien und Analysen. Die Idee ist, darin eine persönliche Sammlung zu Themen rund um Ihr Schachspiel aufzubauen: bewusst ausgewähltes Arbeitsmaterial für Ihr Training, Ihre Turniervorbereitung und Ihre schachlichen Interessen. Mit eigenen Notizen und Analysen können Sie dieses Material nach und nach weiterentwickeln.

In **Verwalten** können Sie diesen Bestand sichten, Unpassendes entfernen und interessante Inhalte ordnen und vertiefen. Mit den später vorgestellten **Arbeitskontexten** können Sie parallel an einzelnen Themen dieses Bestands arbeiten. Dabei entwickeln Sie dieselbe persönliche Sammlung weiter und passen sie an Ihre Bedürfnisse an.

[![Gesamter Bestand mit dem Ordner Manual, sechs Einträgen und der Detailansicht der italienischen Eröffnung](screenshots/inventory.png)](screenshots/inventory.png)

Im Beispielordner **Manual** liegen sechs Einträge. Die italienische Eröffnung ist ausgewählt; rechts sehen Sie ihre Details und eine Vorschau der Zugfolge.

Mit **Ordnern** geben Sie Ihrem Bestand eine logische Struktur, etwa nach Themen. Sie gliedern die gemeinsame Sammlung, bilden aber keine unabhängigen Bestände. Ein Eintrag gehört höchstens zu einem Ordner. Beim Verschieben bleibt es dieselbe Partie oder Analyse; es entsteht keine Kopie. Einträge ohne Ordner erscheinen unter **Nicht eingeordnet** und gehören ebenso zum Bestand.

Die Ordnerstruktur ändert nichts daran, dass **Namen im gesamten Bestand eindeutig sein müssen**. Das gilt auch für Einträge in verschiedenen Ordnern oder mit unterschiedlichen Typen. Eine andere Groß- oder Kleinschreibung allein genügt nicht zur Unterscheidung. Der Name „Manual - Italienische Eröffnung“ ist deshalb bereits vergeben, auch wenn Sie einen neuen Eintrag mit demselben Namen in einem anderen Ordner ablegen möchten.

Anders als Ordner beschreibt die **Herkunft** nicht die thematische Einordnung, sondern die Entstehung einer Analyse. Wenn Sie aus einer Partie oder Analyse eine eigene Analyse ableiten und speichern, merkt sich Plysmith den ursprünglichen Eintrag und den Ausgangspunkt. So bleibt nachvollziehbar, wo Ihre Untersuchung begonnen hat. Ein gemeinsamer Ordner oder Import aus derselben Datei stellt keine solche Verbindung her.

## Partie und Analyse

Eine **Partie** hält fest, was gespielt wurde. Dabei spielt es keine Rolle, ob Sie sie importiert, selbst gespielt oder beim Zuschauen aufgezeichnet haben. Ihre gespeicherten Züge bleiben unverändert.

Eine **Analyse** dient dagegen dazu, Fortsetzungen ab einer gewählten Ausgangsstellung zu untersuchen und festzuhalten. Sie kann aus dieser Ausgangsstellung alleine bestehen, ganz ohne gespeicherte Züge. Die Beispielanalyse „Manual - Grundstellung“ ist deshalb bereits ein vollständiger Bestandseintrag.

[![Lehrpartie in Analysieren, mit Buchsymbol, Typ und Name in der Kopfzeile](screenshots/game-type.png)](screenshots/game-type.png)

[![Italienische Analyse in Analysieren, mit Verzweigungssymbol, Typ und Name in der Kopfzeile](screenshots/analysis-type.png)](screenshots/analysis-type.png)

In der Kopfzeile erkennen Sie den Typ am Wort **Partie** oder **Analyse** und am zugehörigen Symbol: dem Buch für eine Partie, der Verzweigung für eine Analyse. Wenn Sie eine Partie im Bereich **Analysieren** öffnen, bleibt sie eine Partie.

### Gemeinsamkeiten

Beide beginnen an einer **Ausgangsstellung**. Das kann die **Grundstellung** oder eine frei aufgebaute Position sein, etwa der Beginn einer Eröffnungsvariante oder eine Endspielstellung. Die zentrale gespeicherte Zugfolge, die an diese Ausgangsstellung anschließt, heißt **Hauptlinie**. Bei einer Partie hält sie den gespielten Verlauf fest, bei einer Analyse eine untersuchte Hauptvariante.

**Notizen** können eine Partie oder Analyse als Ganzes beschreiben oder sich auf einen bestimmten Halbzug beziehen. Sie können Notizen ergänzen und bearbeiten. Auch Angaben aus Importen werden als Notizen übernommen.

Auch auf dem Analysebrett ausprobierte Fortsetzungen können Sie festhalten. Ein solcher **Analysepfad** lässt sich bei beiden als Notiz am Ausgangspunkt übernehmen. Die Notiz können Sie anschließend unabhängig vom Analysepfad bearbeiten; die Hauptlinie bleibt unverändert.

Wenn Sie eine Untersuchung getrennt weiterführen möchten, können Sie eine **eigene Analyse** beginnen und als neuen Eintrag im Bestand speichern. Das ist sowohl bei einer Partie als auch bei einer Analyse möglich: ab jedem beliebigen Halbzug oder direkt ab der Ausgangsstellung. Die **Herkunft** hält dabei die Verbindung zum ursprünglichen Eintrag und zum Ausgangspunkt fest. Der ursprüngliche Eintrag bleibt unverändert.

### Unterschiede

Der entscheidende Unterschied liegt darin, wie Sie die Hauptlinie bearbeiten und ergänzen können. Bei einer **Partie** bleiben die gespeicherten Züge unverändert, damit sie den gespielten Verlauf festhält. Ihre Notizen ergänzen diesen Verlauf, verändern aber keine Züge.

Bei einer **Analyse** können Sie die Hauptlinie dagegen verlängern, ersetzen oder kürzen. Alternative Fortsetzungen müssen dabei nicht die Hauptlinie ersetzen: In einer Analyse können Sie sie zusätzlich als **Varianten** speichern. Auch innerhalb einer Variante können weitere Abzweigungen liegen.

[![Italienische Analyse mit gespeicherten Varianten und einer Notiz zur Rochade in der Zugfolge](screenshots/saved-line.png)](screenshots/saved-line.png)

Im Beispiel zweigt 3…Sf6 von der Hauptlinie mit 3…Lc5 ab. Innerhalb dieser Variante ist 4.Sg5 eine Alternative zu 4.d3. Die Verzweigungssymbole kennzeichnen beide Ebenen. Der Text zur Rochade ist dagegen eine stellungsbezogene Notiz.

## Züge betrachten und ausprobieren

Wenn Sie in **Analysieren** einen Zug im Zugverlauf anklicken, zeigt das Brett die Stellung nach diesem Zug. Dabei verändern Sie keine gespeicherten Züge. Von dieser Stellung aus können Sie eine andere Fortsetzung ausprobieren, auch bei einer Partie.

[![Italienische Analyse mit vorläufigem d4-Pfad und dem Hinweis Ungespeicherte Änderung](screenshots/analysis-path.png)](screenshots/analysis-path.png)

Hier wurde ab der Grundstellung 1.d4 ausprobiert. „Neuer Analysepfad“ und „Ungespeicherte Änderung“ markieren den vorläufigen Pfad. Plysmith merkt ihn sich vorübergehend auch über Kontextwechsel und einen Neustart hinweg. Dadurch wird er aber weder automatisch Teil der gespeicherten Partie oder Analyse noch ein neuer Bestandseintrag. Sie entscheiden, was daraus werden soll.

## Untersuchung übernehmen

Ein Analysepfad muss nicht gleich die gespeicherte Zugfolge verändern. Sie können den Pfad als **Notiz** übernehmen und erweitern. Oder Sie speichern ihn als **eigene Analyse**, also als unabhängigen neuen Eintrag im Bestand.

[![Lehrpartie mit den geöffneten Speicheroptionen ihres Analysepfads](screenshots/game-save-options.png)](screenshots/game-save-options.png)

Die Abbildung zeigt einen Analysepfad an einer **Partie**. Mit **Pfad in Notiz übernehmen** halten Sie die Fortsetzung als Notiz am Ausgangspunkt fest. Sie können die Notiz ergänzen und bearbeiten. Mit **Als eigene Analyse speichern** legen Sie einen neuen Eintrag an, in dem Sie die Untersuchung getrennt weiterführen können. In beiden Fällen bleiben die gespeicherten Züge der Partie unverändert.

[![Italienische Analyse mit den zusätzlichen Speicheroptionen ihres Analysepfads](screenshots/analysis-save-options.png)](screenshots/analysis-save-options.png)

Auch bei einer **Analyse** können Sie den Pfad als Notiz übernehmen oder als eigene Analyse speichern. Zusätzlich können Sie die Fortsetzung mit **Als Variante speichern**, also als Alternative in derselben Analyse behalten. Die Hauptlinie bleibt dabei bestehen.

Wenn Sie stattdessen die Hauptlinie ändern möchten, können Sie eine Fortsetzung an ihrem Ende anhängen oder die bisherigen Züge ab dem Ausgangspunkt ersetzen. Im Bild heißt diese zweite Möglichkeit **Hauptvariante ab hier ersetzen**. Varianten und Änderungen an der Hauptlinie bleiben Teil derselben Analyse; es entsteht kein neuer Bestandseintrag.

Mit **Analysepfad verwerfen** beenden Sie die vorläufige Untersuchung, ohne sie zu übernehmen. Der gespeicherte Eintrag bleibt unverändert.

## Herkunft einer eigenen Analyse

Im Beispiel wurde nach 3.Lc4 aus „Manual - Italienische Eröffnung“ eine eigene Analyse gespeichert: „Manual - Italienisch mit d6“. Ihre Ausgangsstellung ist die Stellung nach diesem Halbzug.

[![Abgeleitete Analyse mit Quellverlauf und markierter Ausgangsstellung vor d6](screenshots/origin.png)](screenshots/origin.png)

Die blaue Grenze **Ausgangsstellung dieser Analyse** trennt den Quellverlauf von der eigenen Analyse. Die Züge davor zeigen, wie die Ausgangsstellung erreicht wurde. Sie gehören zur Quelle und wurden nicht als eigene Züge in die neue Analyse kopiert. Der erste und bislang einzige eigene Zug ist 3…d6.

Quelle und Ableitung sind zwei eigenständige Einträge im Bestand. Sie können die neue Analyse weiterentwickeln, ohne den ursprünglichen Eintrag zu verändern. Umgekehrt werden spätere Änderungen an der Quelle nicht automatisch in die abgeleitete Analyse übernommen.

## Durch das Manual

Hinweise zu [Installation und Aktualisierung](../../README.md#installieren)
finden Sie in der Projektübersicht.

Die folgenden Kapitel führen Sie vom Import des Beispielmaterials zu eigenen
Untersuchungen und Trainingspartien. Arbeiten Sie zunächst im **Gesamten Bestand**;
erst das letzte Kapitel führt die parallele Arbeit mit Kontexten ein.

1. [Beispielbestand importieren](01-import.md)
2. [Bestand sichten und ordnen](02-inventory.md)
3. [Stellungen untersuchen und Gedanken festhalten](03-analysis.md)
4. [Einstellungen und Engines](04-settings.md)
5. [Stellungen ausspielen](05-playout.md)
6. [Live auf Lichess](06-live.md)
7. [Eine Eröffnungsbibliothek aufbauen](07-opening-library.md)
8. [Mit Arbeitskontexten parallel arbeiten](08-contexts.md)

Beginnen Sie mit [Beispielbestand importieren](01-import.md). Die konstruierte
Lehrpartie dient nur dazu, die Bedienung an einer Partie zu zeigen. Die übrigen
Beispiele sind Arbeitsmaterial zum Untersuchen, keine fertigen Eröffnungsempfehlungen.
