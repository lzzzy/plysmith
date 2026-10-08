# Stellungen ausspielen

Beim Ausspielen erproben Sie eine Stellung gegen eine Engine. So können Sie beispielsweise untersuchen, ob Ihnen die Ideen aus einer Endspielanalyse auch am Brett helfen. Erst nach der Partie entscheiden Sie, ob dieser Versuch in Ihren Bestand gehört.

Richten Sie dafür zunächst eine Engine wie im Kapitel [Einstellungen und Engines](04-settings.md) ein. Für das folgende Beispiel genügt Stockfish mit **Gründlich** als **Detaillevel für Ausspielen**.

## Von einer interessanten Stellung beginnen

Öffnen Sie „Manual - Opposition“ in **Analysieren** und wählen Sie **Ausspielen**. Alternativ können Sie in einer anderen Partie oder Analyse zuerst einen Halbzug anklicken und von der dadurch erreichten Stellung aus beginnen.

[![Vorbereitung einer Partie aus der Opposition mit Gegnerwahl](screenshots/playout-prepare.png)](screenshots/playout-prepare.png)

Wählen Sie unter **Gegner** die gewünschte Engine. Wer den ersten Zug übernimmt, bestimmt Ihre Farbe:

- Führen Sie selbst einen Zug aus, spielen Sie die Seite, die in der Ausgangsstellung am Zug ist. In unserem Beispiel ist das Weiß.
- Mit **Engine ziehen lassen** übernimmt die Engine diese Seite; Sie spielen die andere Farbe.

**Brett drehen** ändert nur die Ansicht, nicht die eigene Farbe. Vor dem Start können Sie den angezeigten Quellverlauf ansehen; zum Beginnen wählen Sie wieder **Partiestart**. Die Markierung trennt den Vorlauf aus dem ursprünglichen Eintrag von den Zügen Ihres Versuchs. Bei unserer zuglosen Opposition gibt es noch keinen solchen Vorlauf.

Für eine Partie aus der normalen Grundstellung können Sie in **Verwalten** auch **Neue Partie** wählen. Eine bereits laufende Partie wird nicht stillschweigend ersetzt: Plysmith fragt nach, bevor Sie diese verwerfen und neu beginnen.

## Spielen und unterbrechen

[![Laufende Trainingspartie aus der Opposition](screenshots/playout-running.png)](screenshots/playout-running.png)

Bei **Am Zug** können Sie ziehen. Während **Engine am Zug** warten Sie auf die Antwort. Das Brett zeigt stets den aktuellen Partiestand; in einer laufenden oder pausierten Partie können Sie nicht zu früheren Zügen zurückspringen.

Mit **Pausieren** unterbrechen Sie den Versuch, mit **Weiterspielen** setzen Sie ihn fort. Kann die Engine keinen Zug liefern, bietet **Enginezug erneut versuchen** einen erneuten Versuch. Prüfen Sie bei wiederholten Problemen die Enginekonfiguration.

Mit **Partie beenden** öffnen Sie den Abschluss. Das ist keine automatische Aufgabe und legt noch keinen Sieger fest. Erst jetzt können Sie den Verlauf zur Nachbetrachtung anklicken. **Zur Partie zurück** führt bei einem manuell vorbereiteten Abschluss wieder zur Partie.

## Speichern oder verwerfen

[![Abschluss einer Trainingspartie mit Titel, Ablage, Ergebnis und Speicherwahl](screenshots/playout-save.png)](screenshots/playout-save.png)

Unter **Partie abschließen** vergeben Sie einen **Titel der Partie**, zum Beispiel „Manual - Opposition ausgespielt“, und wählen die **Ablage**. **Ordner des Ursprungs** übernimmt bei einem Versuch aus einem Bestandseintrag dessen Ordner. Der Titel muss wie jeder Bestandsname eindeutig sein.

Hat die Partie eine regelbedingt entschiedene Endstellung erreicht, zeigt Plysmith das Ergebnis an. Bei einem manuellen Ende wählen Sie selbst: Weiß gewinnt, Schwarz gewinnt, Remis oder **Unvollständig beendet**. Wenn Sie nur einige Züge ausprobiert haben, passt **Unvollständig beendet**.

**Partie speichern** legt Ihren Versuch als neue Partie im Bestand ab. Der ursprüngliche Eintrag wird nicht verändert. Ausgangspunkt und Quellverlauf bleiben nachvollziehbar; die gespeicherten Partiezüge können Sie anschließend analysieren und mit Notizen ergänzen.

**Partie verwerfen** beendet den Versuch ohne neuen Bestandseintrag. Probieren Sie beide Wege aus: Speichern Sie einen lehrreichen Versuch und verwerfen Sie einen zweiten, der Ihnen nichts Neues gebracht hat. So bleibt Ihr Bestand eine bewusste Auswahl.

[Zur Übersicht](README.md) · Weiter mit [Live auf Lichess](06-live.md).
