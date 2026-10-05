# PGN Import Kapazitaet und Bedienbarkeit

Stand: 5. Oktober 2026. Historische Analyse des unveraenderten Importers auf
Commit `2981c0a165930995571dbdf529ad78a59e6d25ae`, vor der Umsetzungsfreigabe.
Die Befunde bleiben als Messbasis erhalten. Der inzwischen freigegebene und
implementierte Produktstand steht in [PGN-Importbudgets](pgn-import-budgets.md).

Anschluss: Der Nutzer folgt der empfohlenen Richtung. Die weiteren Messungen
und das geschaerfte, inzwischen implementierte Grenzprofil stehen in
[PGN Importbudgets](pgn-import-budgets.md). Insbesondere die Publikations-
Gesamtmenge und der synchrone SQLite-Schreibpfad werden dort konkretisiert.

Plysmith soll interessante Lernsammlungen, kommentierte Analysen und gezielte
Modellpartien zuverlaessig uebernehmen. Das Ziel ist nicht der Import beliebig
grosser Schachdatenbanken. Die Untersuchung trennt deshalb Inhalt pro Kapitel,
Menge pro Sammlung, Publikation in den Bestand und technische Gesamtlast.

## Ergebnis

Die heutige Grenze von 1.000 Eintraegen ist fuer die untersuchten
Lernsammlungen nicht erforderlich. Alle 90 Dateien enthalten hoechstens 64
Kapitel. Die wichtigeren Hindernisse liegen innerhalb einzelner Kapitel:
14 regelgueltige Analysen aus vier Sammlungen scheitern an Parserbudgets,
darunter zwei Naroditsky-Repertoires mit jeweils nur einem Kapitel.

Zusaetzlich verhindern ueberstrenge Notationsregeln und identische doppelte
FEN-Tags den Import weiterer 19 Kapitel. Nicht jedes abgewiesene Kapitel ist
dagegen ein Appfehler: reine Lehrdiagramme ohne Koenige, widerspruechliche
Rochaderechte und nicht unterstuetzte Varianten brauchen eine klare Grenze.

Empfehlung: kleine bis mittlere Lernpakete bevorzugen, groessere Variantenbaeume
zulassen, bedeutungsgleiche Notation gezielt akzeptieren, echte Widersprueche
nicht reparieren und neben Einzelgrenzen die gesamte Vorbereitung begrenzen.
Ein pauschales Anheben der Partienzahl wuerde diese Probleme nicht loesen.

## Korpus und Quellen

135 konkrete Quellangebote wurden recherchiert; 119 PGNs liessen sich beziehen.
15 alte Exeter-Downloadlinks lieferten 404, ein Lichess-Export 403. Diese 16
Beschaffungsfehler werden nicht als Parserfehler gezaehlt. Zugangssperren
wurden nicht umgangen. Kein Inhalt wird mit Plysmith ausgeliefert.

| Inhaltsgruppe                                                              | Dateien | PGN-Eintraege | Strukturell und mit Regeladapter untersucht |
| -------------------------------------------------------------------------- | ------: | ------------: | ------------------------------------------: |
| Lernstudien, Repertoires, kommentierte Auswahlpartien und Autorenlektionen |      90 |         1.309 |                                  alle 1.309 |
| Ueberschaubare historische und moderne Turniere/WM-Matches                 |      18 |         1.182 |                                  alle 1.182 |
| Spieler-, Eroeffnungs- und Wochenarchive                                   |      11 |       101.676 |                1.110 ausgewaehlte Eintraege |
| Gesamt                                                                     |     119 |       104.167 |                                       3.601 |

Die Archive wurden vollstaendig bis zu allen erkannten PGN-Grenzen gerahmt und
gezaehlt, nicht vollstaendig regelvalidiert. Bei mehr als 500 Eintraegen wurden
80 ueber die Datei verteilte Positionen und die 10 groessten Eintraege nach
Textumfang untersucht, ohne doppelte Sampleindizes. Morphy mit 211 Eintraegen
wurde voll untersucht. Die Archivstichprobe ist bewusst auf lange Eintraege
angereichert; ihre Quantile sind keine Schaetzung fuer saemtliche Archivpartien.

Das Quellspektrum besteht aus 26 bisherigen Lichess-Studien/Practice-Paketen,
44 erreichbaren Staff-Picks, 13 weiteren originalen Lehr-/Vereinsstudien,
sieben Autorenlektionen, 18 Turnierdateien und elf Archiven. Es gibt 119
unterschiedliche Datei-SHA256. Verschiedene Dateien koennen dennoch
ueberlappende Partien enthalten; vier abgewiesene ChessGeek-Eintraege stammen
beispielsweise aus zwei Dateien mit je zwei sehr aehnlichen Fassungen.

Wichtige Primaerangebote:

- [Lichess Staff Picks](https://lichess.org/study/staff-picks): kuratierte
  Erklaerungen, Repertoires, kommentierte Partien und Endspiele.
- [PGN Mentor](https://www.pgnmentor.com/files.html): WM-Matches, einzelne
  Turniere, Spieler- und Eroeffnungssammlungen.
- [ChessGeek Pawn Structures](https://www.chessgeek.org/free-masterclasses/pawn-structures):
  sieben vom Autor angebotene PGN-Lektionen mit Beispielen und Varianten.
- [Exeter Chess Club](https://exeterchessclub.org.uk): aktuelle Kongresslektionen
  ueber verlinkte Studien; historische direkte PGN-Links separat als 404 erfasst.
- [The Week in Chess](https://theweekinchess.com/twic): zwei Wochenpakete als
  Kontrast zur sinnvoll begrenzten Lernsammlung, nicht als Ausbauziel.

Kostenfreie Bezugsmoeglichkeit ist keine pauschale Weiterverbreitungslizenz.
TWIC nennt persoenliche Nutzung und behaelt Rechte vor. Keine Buchkopien,
Bezahlkurse oder unklar autorisierten Spiegel wurden absichtlich aufgenommen.

## Was die Inhalte verlangen

Fuer bereits regelgueltige beziehungsweise mit erhoehten Forschungsbudgets
regelvalidierte Lernkapitel ergeben sich folgende deskriptive Werte. Es sind
keine repraesentativen Internetquantile. p99 verwendet den naechsten Rang.

| Messgroesse                                         | Median |   p95 |   p99 | Maximum |
| --------------------------------------------------- | -----: | ----: | ----: | ------: |
| Kapitel pro Lerndatei                               |     10 |    39 |    64 |      64 |
| Zugknoten pro Kapitel, gesamter Variantenbaum       |     16 |   140 |   408 |   1.014 |
| Halbzuege der Hauptlinie                            |     10 |    87 |   131 |     271 |
| Varianten pro Kapitel                               |      1 |    12 |    32 |     133 |
| Verschachtelungstiefe der Varianten                 |      1 |     2 |     4 |       7 |
| Textzeichen pro Kapitel, inklusive Tags/Kommentaren |  1.254 | 4.051 | 7.621 |  15.564 |
| Syntaxzeichen ohne Tags/Kommentartext               |     88 |   840 | 2.233 |   5.690 |
| Parser-Token pro Kapitel                            |     31 |   265 |   725 |   1.792 |
| Rohe Kommentarfragmente pro Kapitel                 |      5 |    59 |   135 |     221 |
| Groesstes einzelnes Kommentar-/Tagtextfeld          |    184 |   596 | 1.060 |   1.806 |

Die groesste Lerndatei hat 195.335 Bytes, die groesste zusammenhaengende
Lernsammlung 8.364 Zugknoten. Die 735 Kapitel mit Zuegen, Varianten und echtem
Kommentartext haben p99=501 Knoten, aber weiterhin Maximum 1.014. Viele kurze
Uebungen duerfen die wichtigen komplexen Repertoires nicht statistisch verdecken.

Die 18 Turnierdateien enthalten 10 bis 251 Eintraege; ihre Hauptlinien erreichen
maximal 271 Halbzuege. Vier davon haben mehr als 100 Partien: New York 1924 mit 110,
Nuernberg 1896 mit 172, Hastings 1895 mit 231 und London 1851 mit 251. Die Aufnahme
kompletter Turniere ist deshalb eine separate Mengenentscheidung, kein Beweis,
dass ein Lernimport 1.000 oder 10.000 Objekte erzeugen sollte.

Die Archive reichen von 211 bis 40.775 Partien. TWIC 1664/1663 enthalten 9.114/10.030,
die untersuchte Carlsen-Datei 7.818. Auch unter 16 MiB koennen zehntausende
Eintraege liegen; die SicilianClosedMain-Datei hat 23.690 Eintraege bei 15.642.677
Bytes. Eine reine Dateigroessengrenze schuetzt den Bestand daher nicht.

## Konkrete Hindernisse

### Ressourcenbudgets

| Lernsammlung                                                                | Kapitel insgesamt | An heutigen Budgets gescheiterte Kapitel | Groesster Baum |
| --------------------------------------------------------------------------- | ----------------: | ---------------------------------------: | -------------: |
| [Caro-Kann Study Part 1](https://lichess.org/study/RYHFfN40)                |                63 |                                        3 |            772 |
| [Danish Gambit von Daniel Naroditsky](https://lichess.org/study/udExyu0p)   |                 1 |                                        1 |            911 |
| [Englund Gambit von Daniel Naroditsky](https://lichess.org/study/inBWS4oN)  |                 1 |                                        1 |            909 |
| [Game of the Week von Vasif Durarbayli](https://lichess.org/study/GWPZqTsb) |                17 |                                        9 |          1.014 |

Alle 14 ueberschreiten `maxSyntaxCharacters=2048`; sieben zusaetzlich die 512
Knoten, fuenf die 1.024 Token, eines die 128 Varianten. Alle 14 werden mit
groesseren isolierten Forschungsbudgets vom unveraenderten Regel-/Fidelitypfad
als bereit validiert. Das beweist die inhaltliche Verarbeitbarkeit, noch nicht
die sichere Leistungsfaehigkeit eines kuenftigen Produktlimits.

Der unveraenderte Adapter wurde zusaetzlich fuer alle vier kompletten Dateien
ausgefuehrt. Er bricht jeweils mit `provider_resource_exhausted` ab: Caro-Kann
nach drei, Game of the Week nach einem, beide Einzelrepertoires vor dem ersten
bereiten Kandidaten. Die Application verwirft dann die Vorbereitung; bereits
decodierte Kandidaten sind keine gespeicherten oder veroeffentlichbaren Objekte.

In den Archivsamples scheitern zwei lange TWIC 1663-Partien allein an der
Syntaxgrenze, obwohl sie mit 453/467 Knoten unter 512 bleiben. Das heutige
Syntaxbudget ist somit auch fuer normale lange Partien ein eigenes Hindernis.

### Gleichbedeutende Schreibweisen

15 Kapitel aus drei Staff-Pick-Studien enthalten denselben FEN-Tag zweimal mit
identischem Wert. Der aktuelle Adapter weist sie als `pgn_duplicate_header`
ab. Nach ausschliesslich diagnostischem Entfernen der identischen Wiederholung
sind alle 15 bereit. Vorschlag: identische Wiederholungen tolerieren, aber
widerspruechliche Werte weiterhin ablehnen; keine First-/Last-wins-Heuristik.

Vier ChessGeek-Kapitel enthalten `Rcg8` statt kanonischem `Rg8` beziehungsweise
`Nbd2` statt `Nd2`. Die ueberzaehlige Herkunftsangabe verhindert den strikten
SAN-Import. Der vorhandene permissive Bibliotheksparser validiert alle Zuege
und Varianten dieser vier Kapitel, ohne illegalen Zug. Eine gezielte
Importnormalisierung solcher eindeutigen SAN-Formen ist sinnvoll. Daraus folgt
keine Freigabe fuer beliebige Notationsheuristiken oder eine globale Lockerung
des Regeladapters. Die [PGN-Spezifikation, Abschnitt 8.2.3.7](https://www.saremba.de/chessgml/standards/pgn/pgn-complete.htm)
unterscheidet kanonischen Export von toleranterem Import;
[chess.js](https://jhlywa.github.io/chess.js/) dokumentiert beide Parsermodi.

### Wirkliche Modell- und Inhaltsgrenzen

36 Lernkapitel werden wegen FEN abgewiesen: 22 Diagramme ohne mindestens einen
Koenig und 14 mit zu ihrer Figurenstellung widerspruechlichen Rochaderechten.
Ein weiteres Kapitel ist eine ausdruecklich nicht unterstuetzte Schachvariante.
Rochaderechte loeschen, Koenige erfinden oder ein Textkapitel auf eine andere
Ausgangsstellung umbiegen waere eine Inhaltsaenderung, nicht Parsernormalisierung.

Der aktuelle Umfang bleibt Standardschach mit spielbarer Stellung. Fuer
leere Einleitungstafeln oder reine Figurendiagramme muesste gesondert entschieden
werden, ob ein zusaetzliches nicht spielbares Inhaltsmodell gewollt ist.
Hier wird das nicht empfohlen oder still vorausgesetzt. Die verstaendliche
Ablehnung einzelner Kapitel darf gueltige Nachbarkapitel nicht blockieren.

Vier Archive brauchen die bereits vorhandene ausdrueckliche Latin-1-Auswahl.
Es gibt keinen Befund fuer eine erforderliche neue Encoding-Heuristik. Die
Messung benutzt hier dieselbe Latin-1-Decodierung wie die App, nicht eine
stille Windows-1252-Interpretation.

## Was 99 Prozent sinnvoll bedeutet

Eine weltweite 99%-Abdeckung laesst sich aus diesem Korpus nicht behaupten:
kuratierte Auswahl, gemeinsame Lichess-Exportfamilie, keine Zufallsstichprobe,
begrenzte Anzahl unabhaengiger Autoren-/Programmexporte, veraenderliche Inhalte.
Archive werden nicht in die Lernquote hineingemischt. Mehr als 100.000 einfache
Archivpartien koennten sonst wenige wichtige gescheiterte Repertoires verdecken.

Aktueller Lernbefund: 1.239 von 1.309 Kapiteln sind einzeln bereit, 14 scheitern an
Ressourcen und 56 an Format-/Stellungsvertraegen. Von diesen 56 sind 19 durch die
oben belegten bedeutungsgleichen Schreibweisen blockiert. 37 bleiben ausserhalb
des heutigen Modells. Diese Ausschluesse bleiben im Gesamtbericht sichtbar.

Allein fuer die 1.253 mit heutigen Formregeln grundsaetzlich regelgueltigen
Kapitel betraegt die Ressourcenabdeckung 98,88%. Auf Dateiebene werden aber
vier von 90 Lernsammlungen wegen Ressourcen komplett blockiert, also nur 95,56%
ohne Ressourcenabbruch. Selbst eine scheinbar gute Kapitelquote ersetzt deshalb
keine Vollsammlungsabnahme.

Vorgeschlagenes Qualitaetsziel: mindestens 99% der geeigneten Standardschach-
Lernkapitel eines versionierten, quellengeschichteten Referenzkorpus sowie
mindestens 99% der Lernsammlungen ohne unnoetigen Gesamtabbruch. Alle benannten
wichtigen Referenzsammlungen muessen zusaetzlich funktionieren. Modellgrenzen,
Beschaffungsfehler und echte Quellwidersprueche getrennt ausweisen, nicht
nachtraeglich fuer eine schoene Quote unsichtbar machen. Neue unabhaengige
Exportfamilien als Holdout pruefen, bevor eine allgemeine Abdeckung beworben wird.

## Vorschlag fuer die App

### Mengen und Arbeitsweise

| Grenze                                            | Arbeitsvorschlag             | Begruendung und Trade-off                                                                                                                                                                               |
| ------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lokal eingelesene Datei                           | 16 MiB beibehalten           | Alle 90 Lern- und 18 Turnierdateien liegen weit darunter; fuer den Zielinhalt gibt es keinen belegten Erhoehungsbedarf.                                                                                 |
| Kandidaten in einer Vorbereitung                  | 256 statt 1.000              | Umfasst alle untersuchten Lernsammlungen und einzelnen Turniere; setzt grossen Archiven eine klare Grenze.                                                                                              |
| Tatsaechlich publizierte Objekte pro Bestaetigung | 100                          | Alle Lernsammlungen passen vollstaendig. Groessere Turniere/Morphy erfordern bewusste Auswahl beziehungsweise kleinere Quellenpakete; das ist eine UX-Produktentscheidung, kein gemessenes Naturgesetz. |
| Zugknoten je Kapitel, gesamter Baum               | 2.048 statt 512              | Etwa doppelter Spielraum ueber dem gemessenen Maximum 1.014, ohne Anzahl der Bestandsobjekte zu steigern.                                                                                               |
| Gesamtknoten pro Vorbereitung und Publikation     | 32.768 als Benchmarkkandidat | Oberhalb des gemessenen Maximums 19.866 der ueberschaubaren Dateien; verhindert das Produkt 256 mal 2.048 Knoten. Noch nicht als sicher nachgewiesen.                                                   |

Die Grenze 100 begrenzt einen einzelnen Bestandszuwachs, nicht den gesamten
Bestand. Fuer die 109 voll gemessenen Dateien inklusive Morphy waeren fuenf
Dateien nicht auf einmal voll publizierbar. Das ist ein sichtbarer Trade-off,
kein vermeintlicher Parserfehler. Soll ein komplettes Turnier mit 110 bis 251
Partien ausdruecklich ein Kernablauf sein, waere eine gemeinsame 256-Grenze
fuer Vorschau und Publikation die einfachere Alternative. Kein automatisches
Importieren oder stilles Abschneiden der ersten 100 Eintraege.

Grosse Archive ueber 256 Kandidaten werden fuer diesen ersten Ausbau nicht zu
einem Archivbrowser. Konkrete Meldung mit erlaubter Menge und Hinweis auf eine
kleinere exportierte Auswahl. Eine Auswahl direkt aus beliebig grossen Archiven
waere eine eigene Erweiterung, nicht Voraussetzung fuer den Lernimport.

### Kohaerente Parserbudgets

Nur das Knotenlimit zu aendern reicht nicht. Als gemeinsam zu pruefendes Profil:
2.048 Knoten, 16.384 Syntaxzeichen, 8.192 Token, 1.024 Varianten und 1.024 rohe
Kommentarfragmente pro Kandidat. 64 Ki Zeichen pro Kandidat, 8.192 pro String,
64 Header und 32 Verschachtelungsebenen vorerst beibehalten; die Messung zeigt
hier keinen entsprechenden Ausschluss geeigneter Inhalte. Die Zeilengrenze
sollte bis zur Kandidatengrenze reichen, damit ein anders umgebrochener,
ansonsten identischer Export nicht kuenstlich scheitert.

Diese Kombination deckt alle gemessenen regelgueltigen Zielkapitel ab und gibt
Reserve; sie ist noch keine Sicherheitszusage. Besonders die synchrone
Bibliotheksrekursion durch lange Linien, NAGs und Geschwistervarianten muss
unter diesen Budgets getestet werden. Ein Gesamt-Text-/Speicherbudget fuer
alle aktiven Vorbereitungen ist zusaetzlich erforderlich. Seine endgueltige
Zahl muss aus Messungen des echten Application-/Hostpfads folgen.

### Bedienung und Fehlerbehandlung

- Groesse, erkannte Kapitel, ausgewaehlte Objekte und konkrete Begrenzung sind
  sichtbar. Auswahl und Namenskonfliktloesung bleiben beim Blaettern erhalten.
- Kapitelbezogene Inhalts- oder Komplexitaetsprobleme sind klar benannt. Nur
  bei sicher erkannter PGN-Grenze duerfen gueltige Nachbarkapitel weiter in die
  Vorschau gelangen. Keine automatische Heilung unbalancierter Kommentare/RAVs.
- Globales Datei-, Gesamtlast- oder Abbruchproblem verwirft die Vorbereitung.
  Ohne ausdrueckliche Bestaetigung entsteht kein Objekt; bestaetigte Auswahl
  wird unveraendert atomar publiziert. Keine verdeckte Teilpublikation.
- Kommentare bleiben Originaltext, pro Anker zusammengefasst und bearbeitbar.
  Brettmarkierungen, technische Direktiven und Bewertungen werden weiterhin
  gefiltert, ohne daraus kuenstliche Erklaerungen oder Bewertungen zu erzeugen.
- Abbrechen, neu versuchen und Encoding wechseln hinterlassen keinen Bestand,
  leeren Importordner oder dauerhaft verlorene Arbeitsstaende.

## Architekturfolgen

Beschaffung streamt bereits 64 KiB-Chunks mit Bytebudget und prueft Dateiaenderungen.
Ein neues Streamingversprechen allein behebt den Befund nicht. `ActiveImportPreviews`
haelt alle decodierten Baeume im Speicher, klont sie und erlaubt drei gleichzeitige
Vorbereitungen/Vorschauen. Die 100 er Seiten der UI begrenzen nur die angezeigten
Zeilen, nicht die vorbereiteten Baeume im Host oder alle uebertragenen Zusammenfassungen.

Die groesste Lerndatei erzeugt etwa 5,58 MiB serialisierte Kandidaten, eine
Turnierdatei etwa 13,18 MiB aus nur 156,78 KiB PGN. JSON-Groesse ist **nicht** Heap-
Verbrauch; Klone, Parserobjekte, FEN-/Figurenstrukturen und mehrere Vorschauen
erhoehen die Last. Deshalb braucht es ein kumulatives Budget vor weiterer
Retention/Klonung, nicht nur eine Grenze fuer Dateibytes oder Tabellenzeilen.

Die 1.000 er Grenze steht getrennt im Formatadapter, in Application-Auswahl/
Namenspruefung, in API-/MCP-Schemas und im SQLite-Publikationspfad. Ein neuer
Vertrag muss diese Stellen zusammenziehen, nicht nur Konstanten im Parser
aendern. RAV-Pfade muessen zudem mit den heutigen 1.000 er Move-Array-Vertraegen
abgeglichen werden; 2.048 Gesamtbaumknoten bedeuten nicht automatisch 2.048
Halbzuege eines einzelnen API-Pfads.

Der Bestand ist bereits mit 50 Eintraegen pro Abruf paginiert und durchsuchbar.
Nachgeladenes wird jedoch angesammelt und gerendert; es gibt keine daraus
abzuleitende beliebige DOM-Groessenfreigabe. Erhoehtes Volumen muss auch
Gruppierung, Nachladen, Mehrfachauswahl, Refresh und Kontextansichten bestehen.
Kein pauschales Limit fuer einen langfristig aufgebauten Gesamtbestand.

## Noetige Abnahme vor einer Umsetzung

1. Alle vier Ressourcen-Referenzsammlungen voll vorbereiten; Originaltexte,
   Varianten, Cursor-/Vorwaertsnavigation und normal gespeicherte Objekte pruefen.
2. Identische/widerspruechliche doppelte Tags und eindeutige/mehrdeutige/
   illegale SAN separat testen. Importtoleranz darf Regeln an anderen Kanaelen
   nicht unbeabsichtigt lockern. FEN-Widersprueche bleiben abgewiesen.
3. Grenzfaelle knapp unter/ueber jeder numerischen Grenze sowie gleiche PGNs
   mit anderer Zeilenaufteilung, UTF-8/BOM und ausdruecklichem Latin-1 pruefen.
4. Echten Host mit Maximalbaeumen, maximaler Auswahl, viel Text und drei
   parallelen Vorschauen messen: Spitzenheap/RSS, Vorbereitungs-/Speicherzeit,
   UI-Reaktionsfaehigkeit und zeitnaher Abbruch. Fuer den letzten Punkt ist
   hoechstens eine Sekunde ein vorgeschlagenes Bedienungsziel, kein Messbefund.
5. Abbruch, abgelaufene Vorschau, Dateiwechsel, Namenskonflikt und Fehler beim
   Speichern ohne halbe Objekte/Ordner testen; danach Neustart und Wiederoeffnen.
6. Bestandsansicht mit mehreren bereits importierten Lernsammlungen pruefen,
   Desktop/schmal, Seitenwechsel/Mehrfachauswahl/Ordner/Kontext. API/MCP identisch.

Diese Abnahme wurde hier **nicht** durchgefuehrt: Kein Produktcode geaendert,
kein neues Limit aktiviert, keine native App oder Nutzerdaten uebernommen.
Die Korpusdiagnose prueft Struktur, aktuelle Einzeldecoder und regelvalidierte
Forschungsfaelle, nicht den vollstaendigen Desktop-/SQLite-Import aller Quellen.

## Nachweise und Reproduktion

[Kennzahlen und Quellnachweise](verification/pgn-capacity-2026-10-05.json) enthalten
alle 135 Angebote mit URLs, Status, Dateigroesse, SHA256, Kandidaten-/Samplezahlen
und Fehlertypen sowie die aggregierte Statistik. Keine PGN-Inhalte enthalten.
Lokal liegen Messskripte, Dateien und ausfuehrliche Ergebnisse im ignorierten
`build/verification/pgn-capacity`; sie sind keine Runtime- oder Testabhaengigkeit.

Die Diagnose lief in isolierten Node-Prozessen mit 384 MiB Heapbudget und 90s
Timeout. Zwei grosse Archive ueberlasteten anfangs das Messwerkzeug durch
festgehaltene Zeichenketten-Ropes. Nach deren Flattening liessen sich beide
unter demselben Budget vermessen. Das ist kein nachgewiesener App-OOM-Bug.
Am Ende keine Worker-/Framingfehler, keine doppelten Dateihashes und keine
Abweichung zwischen vorhergesagter Einzelbudgetverletzung und echtem Adapterabbruch.
Italienisch 8 Kapitel/maximal 94 Knoten und Caro-Kann 63 Kapitel/drei Budgetfaelle
wurden als Regressionanker geprueft; die vier Ganzdatei-Abbrueche separat bestaetigt.

Oeffentliche Inhalte koennen sich aendern. Ein spaeterer Abgleich muss sich auf
die dokumentierten Hashes beziehen oder die Messung neu versionieren, nicht
abweichende Kapitelzahlen als Appregression missverstehen.
