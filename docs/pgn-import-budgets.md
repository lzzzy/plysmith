# PGN Import: Belastbare Budgets Fuer Den Umsetzungsslice

Stand: 5. Oktober 2026, Commit `2981c0a165930995571dbdf529ad78a59e6d25ae`.
Die Richtung der [Inhaltsanalyse](pgn-capacity-analysis.md) ist vom Nutzer
bestaetigt. Die Messbasis unten beschreibt den Zustand vor der Umsetzung.
**Das Grenzprofil ist im Arbeitsbaum umgesetzt, noch nicht neu releast.**

## Aktueller Umsetzungsstand

Der Nutzer akzeptiert die vorhandene Informationsbasis und einen kleinen
Zeitpuffer: 36s kooperative Vorbereitung, 12s Best-effort-Publikationsfrist.
Die Architektur bleibt wichtiger als ein umfassendes Performanceprogramm.
Ein atomarer synchroner SQLite-Writer bleibt bestehen; kein neuer Worker,
keine Jobverwaltung, kein Async-Transaktionsmodell oder globaler Statementcache.
Einzelne SQL-Aufrufe und COMMIT sind nicht unterbrechbar. Deshalb sind die
Fristen keine harten Wallclock-Garantien; ein erfolgreicher Commit wird niemals
nachtraeglich als abgebrochen ausgegeben. Hostreaktion waehrend grosser Writes
bleibt entsprechend begrenzt.

Zentraler Vertrag: `app/application/inventory/import-limits.ts`; unabhängige
Inhaltsprüfung in `import-content-budget.ts`. API-Schemas verwenden die
Konstanten, MCP/Renderer ihren generierten gemeinsamen Vertragsausschnitt.
Importgrenzen gelten nicht als Lebenszeitgrenzen fuer eigene Analysen/Bestaende.
Vorbereitung reserviert kumulative Budgets vor dem Klonen; Fehler, gezielter
Abbruch, Verwerfen, Ablauf und Erfolg geben sie frei. Überschrittene Auswahl
wird atomar abgewiesen, die Vorschau bleibt zur Korrektur erhalten.
Die normale Vorschau zeigt tatsächliche Auswahl/Dateiumfang und ausgewählte
Halbzüge, keine numerischen internen Obergrenzen. Nur bei Überschreitung
erscheint die Handlungsaufforderung, weniger Kapitel auszuwählen. Symboltitel
bleiben originalgetreu; Benennung und Namenskonflikte klärt der Nutzer.

Produktionsdecoder ohne Forschungsprofil: 90 Lern-PGNs, 1.309 Kapitel,
1.272 akzeptiert, 37 abgewiesen (36 ungueltige FEN, eine Schachvariante),
**kein globaler Abbruch**. Identische FEN-Wiederholungen und eindeutig legale
redundante SAN werden am PGN-Rand kanonisiert, nicht im allgemeinen Regeladapter.
Prosa bleibt unveraendert; technische NAGs werden vor Bibliotheksverarbeitung
gefiltert, gleichartige Befunde aggregiert. Nur bewiesene Kapitelgrenzen
erlauben Recovery; offene Tags/Klammerkommentare/RAV bleiben fail-closed.

| Isolierter Produktionslauf           | Vorbereitung | Speichern | Peak RSS |
| ------------------------------------ | -----------: | --------: | -------: |
| Caro-Kann, 63 Kapitel / 8.364 Knoten |        3,06s |     1,22s |  177 MiB |
| 100 Objekte / exakt 16.384 Knoten    |        2,92s |     1,76s |  170 MiB |

Beide gespeicherten Ergebnisse wieder geoeffnet/deepverglichen, SQLite-Integritaet
und Foreign Keys geprueft. Statement-Wiederverwendung gilt pro Operation und
Connection; Tree-Reads laden Positionen gesammelt. Dies sind Einzelmessungen,
kein p95 und kein zusammengesetzter Maximaltest mit allen Text-/Enginebudgets.
Der Nutzer hat diesen Gesamttest ausdruecklich nicht als Umsetzungsvoraussetzung
beibehalten. [Produktionsnachweis](verification/pgn-implementation-2026-10-05.json)
trennt diese neuen Laeufe vom unveraenderten Forschungsledger.

Automatische Regressionen pruefen Grenzpaare, API/MCP, atomare Ruecknahme,
Notizfidelity, gemeinsame Retention, Abbruch/Deadline und Neustart. Der echte
Browserdialog ist in Deutsch/Englisch bei 1280/390px mit Auswahl, Seitenwechsel,
Namenerhalt, Escape, verspäteten Antworten, Publikationssperre und Axe geprueft.
Das ist keine neue menschliche oder vollständige Electron-/Engine-Lastabnahme.
Nach der Mengenanzeigenachpflege bestanden erneut10 Dialogtests und3 Browser-
gruppen DE/EN1280/390 mit Axe sowie Typen/Lint/Build/Format. Der verlinkte
Produktionsnachweis hält bewusst den vorherigen Messsnapshot samt Hashes;
die Anzeigenachpflege verändert keine Importgrenzen oder fachliche Logik.

## Messbasis

47 isolierte Pipelineversuche: 36 erfolgreiche, 11 erwartete Ressourcen-/
Abbruchfaelle. Acht Parserformen jeweils dreimal, zehn Browserpruefungen der
echten Zuglistenkomponente bei 1280/390px. Zusaetzliche Baumformmessung an den
3.545 regelgueltigen Kapiteln der vorherigen Stichprobe: 1.253 Lernkapitel,
1.182 Turnierpartien und 1.110 Archivsamples. Keine neue Internet99%-Behauptung.

Rechner: Windows x64, Intel i5-8350U, vier logische CPUs, etwa 8 GiB RAM,
Node 24.20.0, echte SQLite-Dateien mit aktuellem Schema/WAL. Jeder grosse Versuch
hat einen eigenen Prozess, 768 MiB JS-Heap und 120s externe Notbremse.
Der Heapparameter begrenzt **nicht** die native SQLite-Speicherbelegung.
Keine Daten oder Konfiguration der laufenden Nutzer-App verwendet.

Die festen Produktionslimits lassen sich nicht injizieren. Deshalb verwendet
die erweiterte Messung einen lokalen Forschungsdecoder mit dem Produktions-
`PgnFramer` und `parseCandidate`, aber explizitem Grenzprofil. Danach laufen die
unveraenderten `ActiveImportPreviews`, Namenspruefung, `PublishImport` und
`SqlitePersistenceAdapter`. Italienisch, der aktuelle Caro-Abbruch und ein
Abbruch beim Hostschliessen wurden auch mit dem unveraenderten Decoder geprueft.

RSS-Maxima gelten fuer den ganzen Messprozess; Heap/RSS werden zusaetzlich an
Checkpoints gemessen. Explizite GC zwischen Phasen macht die gehaltene Vorschau
sichtbar. Einzelmessungen sind **keine p95** und kein Versprechen fuer jeden PC.
Browsermessungen pruefen echte Komponenten, nicht den gesamten Electron-Host.
Die zwei SQL-Wiederverwendungsproben unten sind Diagnose, kein Produktpatch.

## Belegte Engpaesse

| Fall                                                   | Vorbereitung | Speichern |  Peak RSS |
| ------------------------------------------------------ | -----------: | --------: | --------: |
| Italienisch, 8 Kapitel / 377 Knoten, heutiger Decoder  |        0,37s |     0,46s |   109 MiB |
| Caro-Kann, 63 Kapitel / 8.364 Knoten, Forschungsprofil |        6,00s |     8,76s |   745 MiB |
| Game of the Week, 17 Kapitel / 6.839 Knoten            |        4,09s |     7,94s |   639 MiB |
| London 1851, 251 vorbereitet / 100 gespeichert         |       11,70s |     7,71s |   697 MiB |
| Synthetisch, 16.384 Knoten / 64 Objekte                |        5,42s |    17,11s | 1.271 MiB |
| Synthetisch, 32.800 Knoten / 100 Objekte               |       10,09s |    41,27s | 2.039 MiB |
| Caro-Kann, isolierte Statement-Wiederverwendung        |        7,22s |     2,43s |   173 MiB |
| Exakt 16.384 Knoten / 100 Objekte, gleiche Probe       |        5,25s |     3,05s |   172 MiB |

32.800 ist absichtlich etwas oberhalb des diskutierten 32.768-Budgets, kein
bestandener neuer Grenztest. Exakt 32.768 wurden separat in 9,77s vorbereitet.

Beim Caro-Durchlauf werden 78.143 `prepare`-Aufrufe fuer nur 59 unterschiedliche
SQL-Texte beobachtet, einschliesslich Initialisierung/Reads. Wiederverwendung
erklaert einen grossen Teil der Zeit und des nativen Peaks. Ein globaler,
unbegrenzter Statementcache ist daraus **nicht** abzuleiten: Im Produkt reichen
gezielt vorbereitete Statements pro Importoperation/Connection, mit klarer
Lebensdauer und ohne veraenderliche Statementmodi quer zu Aufrufern.

**Speichern bleibt synchron.** Die langen Speicherzeiten entsprechen auch
mehrsekundigen Eventloop-Luecken. Wiederverwendung allein macht den Host nicht
reaktionsfaehig. Der Transaktionswrapper verbietet asynchrone Arbeit;
ein `await` in die Schleife einzufuegen waere kein korrekter Fix. Die spaetere
Nutzerentscheidung belaesst diesen Vertrag bewusst und begrenzt/optimiert den
vorhandenen Importpfad. Ein serialisierter Writer, atomarer Rollback und
Ereignisse erst nach Commit bleiben; keine Schattenpersistenz.

Weitere belegte Grenzen:

- Drei gleichzeitig vorbereitete Vorschauen mit je 16.384 Knoten dauern
  zusammen 11,55s; Peak 237 MiB, gehaltenes Heap etwa 52 MiB. Drei gehaltene
  Vorschauen mit je 32.800 Knoten halten etwa 95 MiB Heap. Ein Slotzaehler
  begrenzt die Menge der Daten nicht ausreichend.
- 256 textlastige Root-Kapitel mit zusammen etwa 15 MiB Text funktionieren
  technisch, erzeugen aber einen Peak von 241 MiB. Ein etwa 4 MiB grosser
  Vergleich liegt bei 113 MiB. Sinnvolle Textmenge separat begrenzen.
- Der aktuelle Hostschliess-Abbruch stoppt Vorbereitung in insgesamt 112ms.
  Das ist kein UI-Abbruch: Der Dialog deaktiviert seine Abbruchaktionen beim
  Arbeiten; HTTP/MCP reichen keinen passenden Vorbereitungsabbruch durch.
- 8.190 NAGs an einem Zug benoetigen in drei separaten Parsermessungen rund
  0,51-0,57s synchron; eine Pipelineprobe mit 8.000 NAGs blockiert 0,82s.
  Die Korpusmaxima sind drei NAGs pro Zug und 172 pro Lernkapitel. Ignorierte
  technische Annotationen sollten nach begrenzter lexikalischer Validierung
  nicht weiter die teure Bibliotheksverarbeitung belasten. Nicht einfach einen
  weiteren willkuerlichen NAG-Ausschluss einbauen oder Zahlen interpretieren.
- 1.000 legale Halbzuege mit Remisangeboten erzeugen 1.002 Befunde; das
  Vorschau-Wireschema erlaubt nur 1.000. Gleichartige Auslassungen aggregieren,
  wirkliche Fehler weiterhin konkret lokalisieren.
- 2.048 Halbzuege eines Pfads lassen sich speichern/lesen, passen aber nicht
  in die heutigen Engine-/Ausspiel-Eingaben. API und MCP akzeptieren genau
  1.000, nicht 1.001. Baumgesamtmenge und Pfadlaenge getrennt begrenzen.
- Ein 2.047-Knoten-Baum mit 1.023 Alternativen an der Wurzel erzeugt trotz
  zuklappter Varianten 7.174 DOM-Elemente und braucht 405-455ms zum Rendern.
  64 Alternativen: 461 Elemente, 116-124ms; 128: 909, 150-163ms. Desktop und
  schmaler Browser ohne Seitenueberlauf, Auswahl und Aufklappen funktionieren.
  Ein komplexer Baumread benoetigt bis zu etwa 1,5s: auch den Readpfad optimieren.

## Umgesetztes Grenzprofil

Alle Grenzen gelten gemeinsam. **Gezahlte Budgeteinheiten sind deterministisch,
kein vermeintlich exakter Heapzaehler.** Datenbezogene Grenzen werden im
Produkt zentral festgelegt und von Application, Decoder, SQLite sowie
API/MCP identisch verwendet. Keine Nutzerkonfiguration dieser Schutzgrenzen.

| Gegenstand                                    |                               Grenze | Begruendung / Status                                                            |
| --------------------------------------------- | -----------------------------------: | ------------------------------------------------------------------------------- |
| Quelldatei                                    |                         16 MiB Bytes | bestehend, beibehalten; kein stilles Erst-N-Importieren                         |
| Kandidaten pro Vorbereitung                   |          256, inklusive abgewiesener | Studien maximal 64; London 251 erfolgreich vorbereitet                          |
| Objekte pro Bestaetigung                      |                                  100 | akzeptierte Bedienungsgrenze, nicht technische Internetabdeckung                |
| Knoten je Kapitel, gesamter RAV-Baum          |                                2.048 | gueltiges Lernmaximum 1.014; 2.048/2.049 im Forschungsprofil geprueft           |
| Halbzuege je Root-zu-Knoten-Pfad              |                                1.000 | heutige Engine-/Ausspielvertraege; Lern-/Turniermax 271, Archivsample 467       |
| Alternativen je Vorkommen                     | 64, zusaetzlich zur Hauptfortsetzung | Lernmaximum 11; gemessene UI-Reserve, keine Zusammenlegung von Transpositionen  |
| Knoten pro Vorbereitung                       |                               32.768 | exakt vorbereitet; deckt auch groesstes voll untersuchtes Turnier mit 19.866 ab |
| Knoten pro Bestaetigung                       |                               16.384 | alle 90 Lernsammlungen bleiben darunter; nach Writekorrektur Abnahmegate        |
| Kapitel / Zeile                               |                       65.536 Zeichen | bestehende Kapitelgrenze; gleiche Zeilenreserve, ASCII-Grenzpaar geprueft       |
| Einzelstring                                  |                        8.192 Zeichen | 8.192/8.193 geprueft; Text nicht abschneiden                                    |
| Header je Kapitel                             |                                   64 | 64/65 geprueft; Lernmaximum 24                                                  |
| RAV-Verschachtelung                           |                                   32 | 32/33 geprueft; Lernmaximum 7                                                   |
| Syntaxzeichen je Kapitel                      |                               16.384 | simultan zur groesseren Baumgrenze; Lernmaximum 5.690                           |
| Lexikalische Tokens je Kapitel                |                                8.192 | simultan und vor Annotationfilterung, kein Freibrief fuer Parserblockaden       |
| RAVs / Kommentarfragmente je Kapitel          |                             je 1.024 | Varianten bleiben durch Knoten/Verzweigung zusaetzlich begrenzt                 |
| Erhaltener Notiztext je Vorbereitung          |                         4 Mi Zeichen | etwa 4 Mi gemessen; groesste Lernquelle unter 0,2 Mi Quelldaten                 |
| Erhaltener Notiztext je Bestaetigung          |                         4 Mi Zeichen | keine weitere kuenstliche Teilmenge unterhalb des Vorbereitungsbudgets          |
| Einzelne aggregierte Notiz                    |                      128.000 Zeichen | bestehender Schreibvertrag, beim Import explizit pruefen                        |
| Serialisierte neutrale Kandidaten je Vorschau |                         32 MiB UTF-8 | 32.768-Knoten-Probe etwa 21,53 MiB; logische Retentionsgrenze                   |
| Aktive Vorbereitungen plus Vorschauen         |                           zusammen 3 | bestehende Slots; Parallelprobe, nicht drei unabhaengige volle Budgets          |
| Knoten / Notiztext aller aktiven Slots        |                65.536 / 8 Mi Zeichen | rund zwei volle Vorbereitungen mit Reserve fuer kleinere dritte                 |
| Kandidatenvolumen aller aktiven Slots         |                         64 MiB UTF-8 | gemeinsame Retentionsgrenze, vor Klonen reservieren und sicher freigeben        |
| Vorschaulebensdauer                           |                           30 Minuten | beibehalten, Verwerfen/Ablauf/Fehler/Shutdown geben Budgets frei                |
| Vorschau-Befunde je Kapitel                   |    64 aggregierte Kategorien/Befunde | Einzelverortung echter Fehler bleibt; 1.002 gleiche Meldungen nicht uebertragen |
| Bestandabruf                                  |             50 Default / 100 Maximum | bestehend; kein pauschales Lebenszeitlimit fuer den Gesamtbestand               |

Zeichenbudgets fuer Kapitel, Strings und Notizen werden als JS-UTF-16-Laenge
definiert; Mi Zeichen sind 1.048.576 Code-Units. Quelldateibytes und serialisiertes
Kandidatenvolumen sind andere Einheiten. Rohkommentare vor Filterung gehoeren zum
Kapitelbudget; erhaltene Prosa einschliesslich Tags und Absatztrenner zum Textbudget.
64 MiB Volumen ist kein Versprechen fuer 64 MiB tatsaechlichen RAM.

Die bisherige Idee, auch 32.768 Knoten in **einem** Vorgang zu publizieren, wird
auf 16.384 geschaerft. Nicht die Vorbereitung von London oder aehnlichen Paketen
verhindern; die konkrete Auswahl muss beide Publikationsgrenzen erfuellen.
Diese Schutzgrenzen schliessen keinen zusaetzlichen regelgueltigen Lerninhalt
der untersuchten 90 Dateien aus. Nicht fuer beliebige Internet-PGNs behaupten.

## Urspruengliche Messziele, Nicht Aktuelle Pflichtgates

Die folgenden Forschungsziele wurden vor der Umsetzungsfreigabe formuliert.
Der aktuelle Auftrag ersetzt harte Hostreaktions-/Gesamtlastgates durch die
vorhandene Evidenz, fokussierte Regressionen und den oben beschriebenen Puffer.
Sie sind keine zugesicherten oder noch zu erfuellenden Done Conditions dieses Slice.

- Vorbereitung: bis 15s Zielzeit am beschriebenen Rechner bei Maximalprofil,
  30s harte Frist inklusive Beschaffung/Decodierung; danach keine halbe Vorschau.
- Publikation: bis 5s Zielzeit bei 100 Objekten / 16.384 Knoten / 4 Mi Text,
  10s Abbruch-/Rollbackfrist fuer die Transaktion. Queuewartezeit separat
  erfassen; Deadline vor und nach teurer Arbeit/Commit beachten. Ein bereits
  erfolgreicher Commit wird niemals nachtraeglich als abgebrochen ausgegeben.
- Hostreaktion: keine importbedingte synchrone Arbeitsscheibe ueber 100ms als
  Ziel; Gesundheits-/lesender Kontrollabruf waehrend Import spaetestens in 250ms.
  Abbruchbestaetigung und Ressourcenfreigabe spaetestens nach 1s.
- Aktives Prepare muss ueber UI und gemeinsame Use Cases gezielt abbrechbar
  sein. Erst fertige Vorschau verwerfen ist dafuer nicht ausreichend.
  HTTP/MCP und Clientfristen muessen die Operationsfrist einschliesslich
  getrennter Queuewartezeit abbilden; Transportabbruch allein ersetzt weder
  gezielten Abbruch noch eine eindeutige Publikationsantwort.
- Speicher: isolierter Host-Peak hoechstens 512 MiB bei gemeinsamem Maximalprofil,
  gehaltenes Import-Heapdelta nach GC hoechstens 128 MiB. Das sind Testgates,
  keine zuverlaessige produktive GC-/RSS-Zuteilung; Engine- und Rendererprozesse
  getrennt vermessen. SQL-Probe beseitigt den groben Peak, beweist nicht den
  zusammengesetzten Worst Case von Baeumen, langen Tags, Unicode und Notizen.
- Oeffnen/Fokuswechsel eines Maximalbaums: gesamter Hostread bis 500ms,
  Browserrender und Aufklappen bis 200ms. Historische Maximalpfade, ausgeklappte
  Nachfahren und Kommentare sind zusammen zu pruefen; nicht nur der Startzustand.

## Historische Umsetzungsvorlage

Die damalige Vorlage bleibt zur Einordnung der Messung erhalten. Aktuelle
Umsetzung/Verifikation und bewusst nicht verlangte Lastgates stehen oben;
insbesondere kein offener Auftrag fuer einen neuen Writer oder weitere Formate.

1. Ein zentraler Budgetvertrag mit eindeutigem Ownership: Acquisition fuer
   Dateibytes, Format fuer Grammatik/Kapitel, Application fuer Operation und
   kumulative Slots, Persistenz fuer erneute Auswahlpruefung/atomaren Write.
   Alle Zaehler vor weiterer Retention/Klonung pruefen; keine Teilpublikation.
2. Statementlebensdauer und Hostreaktion beim Write korrigieren, grosse Reads
   mit Queryplan/Bulkzugriff pruefen. Async-Transaktions-/Writervertrag explizit
   loesen; kein blindes Yield innerhalb des heutigen synchronen Wrappers.
3. Ignorierte technische Annotationen frueh, aber grammatisch korrekt filtern;
   Auslassungsbefunde aggregieren. Originaltext und Ankerreihenfolge erhalten.
4. Auswahlbudget sichtbar: kleinere Studien bequem komplett; bei groesseren
   Paketen keine verdeckte Auswahl der ersten 100. Blaettern erhaelt Auswahl,
   Namen und Limits; Speichern ueber Grenzen bleibt vorab verhindert/erklaert.
5. Sicher abgegrenzte ueberkomplexe Kapitel konkret abweisen, nicht eine
   komplette gueltige Sammlung wegen eines Kapitels verlieren. Globale Grenze,
   unbalancierte Struktur oder Abbruch bleiben fail-closed.
6. Grenzpaare und kombiniertes Worst-Case-Profil mit echten Host-HTTP/MCP/
   Electron pruefen, auch unter Enginebetrieb und Konkurrenz. Allgemeine
   Pfadfortsetzung darf beim 1.001. eigenen Zug nicht erst im Engineaufruf
   ueberraschend scheitern; gemeinsame Pfadvertraege im Slice klaeren.
7. Bestehende Bestandsseiten, Suche, Ordner, Nachladen und Mehrfachauswahl mit
   wachsendem Bestand pruefen. Nachgeladene Seiten werden heute alle gehalten
   und gerendert; daraus folgt keine unbegrenzte DOM-Freigabe. Kein unbelegtes
   neues Gesamtbestandslimit, kein vorsorgliches Datenbank-/Archivprodukt.

Vorhandene Regressionen: **32/32**, keine Fehler/Skips. Sie decken atomare
Ruecknahme inklusive neuer Ordner, Notizen, Namenskonflikte, API/MCP-Vertraege,
Encoding, parallele Publikation und Neustart ab. Erfolgreiche Messpublikationen
wurden wieder geoeffnet, erste Analyse verglichen, SQLite-Integritaet und
Foreign Keys geprueft. Keine Behauptung einer fertigen erweiterten Produktabnahme.

## Nachweis

[Messledger](verification/pgn-budgets-2026-10-05.json): Konfigurationen, Rechner,
Inputhashes, Phasenzeiten, RSS/Heap, SQL-Aufrufzahlen, negative Grenzfaelle,
Parser-/Wireproben, Baumformmaxima und Browserergebnisse. Kein PGN-Autorentext,
keine Nutzerdaten. Lokale Skripte und isolierte Stores liegen ignoriert unter
`build/verification/pgn-capacity`; ihre SHA256 und Methoden stehen im Ledger.
Die Grenzfaelle sind temporaere Belastungsproben, kein gebuendelter Schachinhalt.
