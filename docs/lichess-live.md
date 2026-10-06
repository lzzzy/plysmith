# Lichess Live

Der Live-Bereich verbindet Plysmith mit einem Lichess-Konto. Auswahl,
Gegnersuche und Partiestart bleiben im Lichess-Browser. Unterstützt wird
ausschließlich normales Schach, einschließlich normaler FEN-Ausgangsstellungen.

## Einrichten

In den Einstellungen ein persönliches Lichess-API-Token mit `board:play`
eintragen und speichern. Anschließend Plysmith neu starten. Kein Passwort
eingeben. Das Token bleibt ausschließlich im benutzergeschützten lokalen
`<application-home>/.env`; die aktive Providerdatei referenziert
`PLYSMITH_LICHESS_TOKEN`. Einstellungen, API-Leseantworten, MCP und Diagnose
geben den Wert nicht zurück. Die Datei ist nicht zusätzlich verschlüsselt.

Der Online/Offline-Schalter in Live steht zunächst auf **Offline**. Ein
gespeichertes Token allein öffnet keine Verbindung. Die bewusst gewählte
Schalterstellung wird im Desktopprofil gemerkt: **Online** verbindet beim
nächsten Desktopstart automatisch wieder, **Offline** öffnet keine Streams.
Nach dem Verbinden bleibt die Kontoüberwachung auch beim Bereichswechsel
aktiv; ohne Verbindung erkennt Plysmith keine Browserstarts.

Offline schließt Konto- und Partiestream, beendet aber keine Lichess-Partie und
verwirft keine lokale Aufnahme. Beim Wiederverbinden wird diese abgeglichen.
Bewusstes Offline wird nicht als Verbindungsabbruch angezeigt; zum Verbinden
dient wieder der Schalter.
Eine bereits gespeicherte Fair-Play-Sperre bleibt bis zur bestätigten Klärung
erhalten. Ohne Desktop bleibt ein neu gestarteter Host zunächst offline;
API-/MCP-Clients können über den ausdrücklichen Live-Refresh verbinden.

Ein fehlendes oder abgelehntes Token ist ein Verbindungsproblem, keine
automatische Löschung des Datenbestands. Syntaktisch inkompatible technische
Konfigurationen folgen weiterhin dem vollständigen Neueinrichtungsvertrag.

## Spielen

Zunächst in Live auf Online stellen, dann eine Partie im Browser starten.
Plysmith meldet eigene laufende Partien über
den Konto-Ereignisstream. Board-kompatible normale Partien lassen sich im
Live-Bereich öffnen und spielen. Andere Partien bleiben im Browser spielbar.
Die Lichess-Board-API erlaubt nicht jede Zeitkontrolle beziehungsweise jeden
Startweg; ein Browserstart hebt diese Einschränkung nicht auf.

Live zeigt die von Lichess für diese Partie übermittelte Wertungszahl neben
dem Spielernamen, beispielsweise `piedeb (1650)`. Das gilt auch für die eigene
Partieauswahl und beim Zuschauen für beide Spieler. Ohne Wertungszahl bleibt
nur der Name sichtbar. Provisorische Wertungen erhalten kein Fragezeichen;
Wertungsänderungen werden nicht angezeigt. Es gibt keine zusätzliche
Profilabfrage. Gespeicherte Partienamen und Notizen bleiben unverändert.

Eigene laufende menschliche Partien sperren Engine- und Wissenshilfe im
gesamten Host, nicht nur auf dem Live-Brett. Stockfish, Maia, lokale
Enginepartien und die entsprechenden MCP-Zugriffe können das nicht umgehen.
Laufende Engineanfragen werden abgebrochen; verspätete Ergebnisse verworfen.
Disconnect, Verlassen, Tokenwechsel oder Neustart sind kein Endnachweis.
Eine kleine kontogebundene Sicherheitslease bleibt deshalb in SQLite erhalten,
bis Lichess den Abschluss beziehungsweise keine laufenden Partien bestätigt.

Züge werden erst durch den autoritativen Boardstream sichtbar bestätigt.
Bei einer unklaren Schreibantwort wird resynchronisiert, niemals automatisch
derselbe Zug erneut gesendet. Ohne bestätigte Verbindung ist das Brett nicht
bedienbar. Aufgabe, Abbruch und Remis verwenden die Board-API.

Die Restzeiten kommen aus dem Partiestream. Zwischen den Meldungen zählt
Plysmith die aktive Uhr lokal herunter und korrigiert sie mit jeder neuen
Zeitmeldung. Diese Anzeige ist eine Schätzung, kein eigener Endentscheid:
0:00 beendet die Partie nicht lokal. Ohne bestätigten Stream oder bei einem
beendeten Spiel werden nur gemeldete Werte angezeigt; historische Auswahl
ändert nicht die laufende Seite. Beim Zuschauen gilt weiterhin der Feed-Delay.

## Zuschauen

Eine fremde normale Partie im Browser auswählen und ihre
`https://lichess.org/<game-id>`-URL in Plysmith eingeben. Auch Links mit
`/white` oder `/black` sind zulässig. Plysmith kann nicht erkennen, welche
Partie gerade in einem Browser-Tab angeschaut wird.

Frühere und neue Züge werden vollständig anhand der gemeinsamen Schachregeln
aufgenommen. Die öffentliche Lichess-Übertragung ist drei Züge verzögert;
ein Token beseitigt diesen Delay nicht. Lokale Engines bewerten ausschließlich
die angezeigte Stellung. Zurückblättern hält den Feed nicht an. Eigene laufende
Partien können nicht als Zuschauerpartie mit Engines geöffnet werden.
Die normale Verzögerung wird nicht als dauerhafter Hinweis eingeblendet.

## Abschluss

Nach dem Ende wird die vollständige Partie einschließlich der letzten Züge
und des Ergebnisses noch einmal abgeglichen. Erst danach ist Speichern möglich.
Bei einem Ende zwischen zwei Zügen, etwa Aufgabe, Remisannahme oder
Zeitüberschreitung, kann Lichess einen zusätzlichen abschließenden Uhrwert
liefern. Er gehört zur aktiven Seite, nicht zu einem zusätzlichen Zug.
Auch ein sauber geschlossener Partiestream löst den Exportabgleich aus;
sein Ende allein bestätigt kein Ergebnis. Ein weiterhin laufender Export
führt zur begrenzten Wiederverbindung, nicht zu einem dauerhaften Abschlussstatus.
Gültige aktuelle Streamdaten löschen eine vorherige Streamwarnung.
Schlägt der Abschlussabruf fehl, bleibt die Aufnahme
erhalten; Aktualisieren kann Ergebnis und Speicheroption wieder freigeben.
Speichern legt eine normale Partie mit global eindeutigem Namen, optionalem
Ordner und Arbeitskontext an. Spielernamen, Ergebnis und Partie-URL stehen als
bearbeitbare allgemeine Notiz an der Ausgangsstellung. Es entsteht keine
Importhistorie, Engine-Provenienz oder automatische Bestandssammlung.

Verwerfen entfernt nur die lokale Aufnahme. Es beendet keine Lichess-Partie.
Bewusstes Verlassen erfordert eine ausdrückliche Entscheidung über die
Aufnahme. Nach Hostneustart ist die Live-Ansicht leer; es gibt kein Live-Resume.
Die Kontoüberwachung und Fair-Play-Sperre sind davon unabhängig.

## Technische Grenzen

Dieser Entwicklungsstand verwendet Datenformat 10. Ein vorhandener alpha.7-
Bestand im Format 9 wird gemäß Greenfield-Vertrag nicht automatisch migriert
und nicht gelöscht. Vor einem Wechsel den geschlossenen Datenordner sichern;
für die Entwicklungsabnahme einen getrennten neuen Datenordner verwenden.
Ein Konfigurationsneustart allein stellt keine Datenformatkompatibilität her.

Ein geöffnetes Brett pro Host, bis zu 1.000 Halbzüge je Aufnahme. Begrenzte
JSON-/NDJSON-Puffer, Request- und Stream-Inaktivitätsfristen sowie begrenzte
Reconnectversuche schützen die Anwendung. Remote-URLs werden nicht als
allgemeiner Proxy verwendet; Redirects und schreibende Wiederholungen fehlen
bewusst. Nach ausgeschöpftem Wiederverbinden ist eine ausdrückliche
Aktualisierung möglich.

Nicht enthalten: Lobby, Seek-/Challenge-Dialog, TV, Spieler-/Follow-Suche,
Broadcastkatalog, OAuth, Browserextension oder anonymer Produktweg.

Grundlagen: [offizielle API](https://lichess.org/api),
[API-Spezifikation](https://github.com/lichess-org/api/tree/master/doc/specs),
[Fair Play](https://lichess.org/page/fair-play).
Die zusätzliche terminale Uhr entspricht
[Lichess Game.finish](https://github.com/lichess-org/lila/blob/master/modules/game/src/main/Game.scala).
Die automatisierte Abnahme verwendet isolierte Fakeprovider und keine
echten Kontotokens oder schreibenden Lichess-Aktionen. Eine manuelle reale
Konto-/Partieabnahme sowie Stockfish im Live-UI bleiben vor einer Veröffentlichung
erforderlich. Der [ursprüngliche technische Nachweis](verification/lichess-live-2026-10-06.json)
und die [Live-Folgeprüfung](verification/lichess-live-followup-2026-10-06.json)
trennen automatisierte Abläufe, Fokusregressionen und verbleibende Prüfgrenzen.
Die [Beobachterkorrektur](verification/lichess-observer-2026-10-06.json) prüft
zusätzlich Aufgabe mit terminaler Uhr, EOF-Abgleich, Warnungsabbau nach
Wiederverbindung und normale Speicherung; sie ist keine erneute Vollsuite.
Die [Wertungszahlanzeige](verification/lichess-ratings-2026-10-06.json) wurde
gezielt einschließlich fehlender Werte, API/MCP und schmalem Renderer geprüft.
