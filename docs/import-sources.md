# Schachmaterial zum Importieren

Diese Auswahl hilft beim Ausprobieren von Plysmith mit fremdem Schachmaterial:
kommentierte Eröffnungen, Taktik, Endspiele und vollständige Meisterpartien.
Plysmith stellt diese Inhalte nicht selbst bereit. Die Links führen zu den
jeweiligen Anbietern; heruntergeladene Dateien gehören nicht in die Sourcen.

Recherche und Downloadprüfung: **2. Oktober 2026**. Inhalte öffentlicher Studien
können sich ändern. Die Zahlen unten beschreiben die bei dieser Prüfung
abgerufenen Dateien, nicht garantierte zukünftige Paketgrößen.

## So lässt sich Material übersichtlich sichten

Die PGN-Datei zunächst im Browser herunterladen. Im Import einen Zielordner und
einen gemeinsamen Namenspräfix verwenden, beispielsweise:

- Datei und Zielordner: `italian-game.pgn`
- Präfix: `italian-game.pgn - `
- Objektname: `italian-game.pgn - Chapter 5: The Italian Giuoco Piano`

Der Präfix ist eine Namenskonvention, kein zusätzlicher technischer Namensraum.
Die vollständigen Namen müssen weiterhin im gesamten Bestand eindeutig sein.
Nach dem Import lassen sich die gewöhnlichen Bestandsobjekte umbenennen,
verschieben, löschen oder einem Arbeitskontext zuweisen. Ein erneuter Import
wird gegen die vorhandenen Namen geprüft; eine Importhistorie ist dafür nicht
erforderlich.

Aktuell werden lokale Standard-PGN-Dateien verarbeitet. Ein Downloadlink ist
noch kein Eingabefeld für einen URL-Import. ZIP-Dateien müssen außerhalb von
Plysmith entpackt werden. Für eine Datei gelten derzeit **16 MiB, höchstens
256 vorbereitete Kapitel und 2.048 Zugknoten je Kapitel** einschließlich Varianten.
Eine Vorbereitung enthält zusammen höchstens 32.768 Knoten. Pro Speicherung
sind höchstens **100 Kapitel und 16.384 Knoten** auswählbar. Einzelne Pfade sind
auf 1.000 Halbzüge, Alternativen an einer Stellung auf 64 begrenzt.
Die Dateigröße allein sagt deshalb wenig über die Importierbarkeit aus.
Die Vorschau ist maßgeblich, insbesondere bei fremden oder veränderten Dateien.

Die [Kapazitätsanalyse vom 5. Oktober 2026](pgn-capacity-analysis.md) untersucht
einen größeren Korpus und trennt Kapitelkomplexität, sinnvolle Importmenge und
Appschutz. Das [umgesetzte Budgetprofil](pgn-import-budgets.md) beschreibt auch
Text-, Speicher- und Laufzeitgrenzen. Zu große klar abgegrenzte Kapitel werden
einzeln abgewiesen; globale Grenzen lassen keine halbe Vorschau entstehen.

**Öffentlich herunterladbar bedeutet nicht automatisch frei weiterverteilbar.**
Für die hier verlinkten Nutzerstudien wird keine CC0-Lizenz behauptet. Für das
eigene Ausprobieren die Angebote und Bedingungen des jeweiligen Anbieters
beachten; die Dateien werden nicht mit Plysmith ausgeliefert.

## Legende und Prüfungsumfang

- **Parser geprüft:** Mit dem vorhandenen Plysmith-PGN-Parser vollständig
  eingelesen; Kandidatenstatus und Knotengrenzen kontrolliert. Das ist kein
  Nachweis eines vollständigen Desktop-Imports.
- **Desktop geprüft:** Im echten isolierten Desktop importiert; vollständige
  Schachbäume und gewöhnliche Notizen mit dem eingelesenen Material verglichen,
  Ordner, Präfix, Typ und fehlende automatische Kontextaufnahme geprüft.
- **Download geprüft:** Öffentlich ohne Anmeldung abgerufen und PGN-Kopfzeilen
  gezählt; keine vollständige Parserprüfung dieser Datei.
- **Grenzfall:** Beim Parserlauf gab es abgewiesene Einträge oder einen Abbruch.
- **Archiv:** Bezugsseite oder ZIP-Angebot geprüft; vor dem Import ist eine
  zusätzliche Auswahl oder Entpackung notwendig.

Größen sind auf eine Dezimalstelle gerundete KiB. Bei Lichess zählt ein Kapitel
als ein PGN-Eintrag. Kommentare meint Text im PGN; Angaben wie Event oder
Kapitelname können zusätzlich als normale Notiz erscheinen. Strukturierte
Befehle für Pfeile, Farben, Enginewerte und Uhren sowie Bewertungszeichen werden
nicht übernommen oder in Ersatztexte übersetzt. Autorentext bleibt unverändert;
die erhaltenen Kommentarfragmente je Vorkommen bilden eine bearbeitbare Notiz.

## Kommentierte Eröffnungen

Die Studienseiten zeigen Autor, Kapitel und Material im Original. Die
PGN-Links wurden direkt abgerufen. Erläuterungen sind überwiegend englisch.

| Nr. | Material und Bezug                                                                                                          | Umfang                | Inhalt und Prüfung                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [Everybody's Favorite Italian Game](https://lichess.org/study/5BCGvHhL) · [PGN](https://lichess.org/api/study/5BCGvHhL.pgn) | 8 Kapitel, 17,6 KiB   | Italienisch, Giuoco Piano und Zweispringerspiel; viele Kommentare und Varianten. **Parser geprüft: 8 bereit**, maximal 94 Zugknoten. Guter Einstieg.                                                                                                        |
| 2   | [Ruy Lopez (my old study)](https://lichess.org/study/NaF8Gmsc) · [PGN](https://lichess.org/api/study/NaF8Gmsc.pgn)          | 17 Kapitel, 21,4 KiB  | Spanisch mit Erklärungen und verschiedenen schwarzen Antworten. **Parser geprüft: 17 bereit**, maximal 46 Zugknoten.                                                                                                                                        |
| 3   | [Complete French Defense (Winawer)](https://lichess.org/study/riK38kdr) · [PGN](https://lichess.org/api/study/riK38kdr.pgn) | 24 Kapitel, 18,0 KiB  | Französische Verteidigung, Schwerpunkt Winawer; Varianten und etwas Text. **Parser geprüft: 24 bereit**, maximal 45 Zugknoten.                                                                                                                              |
| 4   | [London System: A Primer](https://lichess.org/study/7NKYIHqN) · [PGN](https://lichess.org/api/study/7NKYIHqN.pgn)           | 8 Kapitel, 15,3 KiB   | Grundlagen, Antworten auf verschiedene Aufbauten und Modellpartien; kommentiert. **Parser geprüft: 8 bereit**, maximal 241 Zugknoten.                                                                                                                       |
| 5   | [The London system](https://lichess.org/study/4NBHImfM) · [PGN](https://lichess.org/api/study/4NBHImfM.pgn)                 | 7 Kapitel, 7,5 KiB    | Kürzere Einführung, Pläne und Fallen; einzelne Kapitel als unfertig bezeichnet. **Parser geprüft: 7 bereit**, maximal 30 Zugknoten.                                                                                                                         |
| 6   | [Caro-Kann Study — Part 1](https://lichess.org/study/RYHFfN40) · [PGN](https://lichess.org/api/study/RYHFfN40.pgn)          | 63 Kapitel, 190,8 KiB | Umfangreiche Kommentare und Verzweigungen. **Grenzfall:** vollständiger Parserlauf brach mit `provider_resource_exhausted` ab. Nicht als direkt erfolgreich importierbares Gesamtpaket verwenden; gegebenenfalls einzelne Kapitel über Lichess exportieren. |

## Taktik und Matt

Die folgenden Originalstudien gehören zum öffentlich zugänglichen
[Lichess-Übungsbereich](https://lichess.org/practice). Ein PGN-Export überträgt
Stellungen und vorhandene Züge/Kommentare, aber **nicht die interaktive
Lichess-Aufgabenlogik**. Insbesondere darf man nicht überall eine ausgeschriebene
Lösung erwarten. Als eigene Analyse oder zum Ausspielen können reine
Ausgangsstellungen trotzdem nützlich sein.

| Nr. | Material und Bezug                                                                                               | Umfang               | Inhalt und Prüfung                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7   | [Piece Checkmates I](https://lichess.org/study/BJy6fEDf) · [PGN](https://lichess.org/api/study/BJy6fEDf.pgn)     | 6 Kapitel, 2,8 KiB   | Elementare Mattführung, FEN-Ausgangsstellungen und teilweise Zugfolgen; ohne Textkommentare. **Parser geprüft: 6 bereit**, maximal 21 Zugknoten.                                                                                                                 |
| 8   | [Checkmate Patterns I](https://lichess.org/study/fE4k21MW) · [PGN](https://lichess.org/api/study/fE4k21MW.pgn)   | 18 Kapitel, 8,3 KiB  | Mattbilder als FEN-Stellungen. **Parser geprüft: 18 bereit**, alle ohne Zugfolge und ohne Textkommentare. Gut zum Prüfen von nullzügigen Analysen.                                                                                                               |
| 9   | [Knight and Bishop Mate](https://lichess.org/study/ByhlXnmM) · [PGN](https://lichess.org/api/study/ByhlXnmM.pgn) | 12 Kapitel, 15,5 KiB | Matt mit Läufer und Springer; ausführlicher kommentiert, FEN und Varianten. **Parser geprüft: 12 bereit**, maximal 251 Zugknoten.                                                                                                                                |
| 10  | [The Pin](https://lichess.org/study/9ogFv8Ac) · [PGN](https://lichess.org/api/study/9ogFv8Ac.pgn)                | 8 Kapitel, 3,6 KiB   | Fesselungen; FEN, kaum Text. **Parser geprüft: 8 bereit**, alle ohne Zugfolge.                                                                                                                                                                                   |
| 11  | [The Skewer](https://lichess.org/study/tuoBxVE5) · [PGN](https://lichess.org/api/study/tuoBxVE5.pgn)             | 8 Kapitel, 3,7 KiB   | Spieße; FEN, teilweise kurze Züge, kaum Text. **Parser geprüft: 8 bereit**, maximal 6 Zugknoten.                                                                                                                                                                 |
| 12  | [The Fork](https://lichess.org/study/Qj281y1p) · [PGN](https://lichess.org/api/study/Qj281y1p.pgn)               | 16 Kapitel, 7,2 KiB  | Gabelmotive; FEN, überwiegend Aufgabenstellungen. **Parser geprüft: 16 bereit**, maximal 6 Zugknoten.                                                                                                                                                            |
| 13  | [Discovered Attacks](https://lichess.org/study/MnsJEWnI) · [PGN](https://lichess.org/api/study/MnsJEWnI.pgn)     | 10 Kapitel, 4,8 KiB  | Abzugsangriffe; FEN und vereinzelte kurze Fortsetzungen. **Parser geprüft: 10 bereit**, maximal 6 Zugknoten.                                                                                                                                                     |
| 14  | [Double Check](https://lichess.org/study/RUQASaZm) · [PGN](https://lichess.org/api/study/RUQASaZm.pgn)           | 6 Kapitel, 2,9 KiB   | Doppelschach, kurze taktische Fortsetzungen; ohne Textkommentare. **Parser geprüft: 6 bereit**, maximal 10 Zugknoten.                                                                                                                                            |
| 15  | [Zwischenzug](https://lichess.org/study/ITWY4GN2) · [PGN](https://lichess.org/api/study/ITWY4GN2.pgn)            | 5 Kapitel, 2,5 KiB   | Kleine Sammlung mit FEN, kurzen Fortsetzungen und wenig Text. **Parser geprüft: 5 bereit**, maximal 5 Zugknoten.                                                                                                                                                 |
| 16  | [Zugzwang](https://lichess.org/study/9cKgYrHb) · [PGN](https://lichess.org/api/study/9cKgYrHb.pgn)               | 4 Kapitel, 1,7 KiB   | Zugzwangstellungen; kaum Text. **Parser geprüft: 4 bereit**, alle ohne Zugfolge.                                                                                                                                                                                 |
| 17  | [Greek Gift](https://lichess.org/study/s5pLU7Of) · [PGN](https://lichess.org/api/study/s5pLU7Of.pgn)             | 6 Kapitel, 3,3 KiB   | Läuferopfer gegen den König, FEN und kurze Fortsetzungen. **Grenzfall: 5 bereit, 1 abgewiesen**. In „Greek Gift Introduction“ ist `Kf8` nach `Bxh7+` in einer Nebenvariante illegal: auf f8 steht bereits der eigene Turm. Knotenindex14 ist kein Partiehalbzug. |
| 18  | [Underpromotion](https://lichess.org/study/49fDW0wP) · [PGN](https://lichess.org/api/study/49fDW0wP.pgn)         | 10 Kapitel, 4,5 KiB  | Unterverwandlung als FEN-Aufgaben. **Parser geprüft: 10 bereit**, alle ohne Zugfolge und ohne Textkommentare.                                                                                                                                                    |

## Endspiele und Studien

Hier lässt sich besonders gut prüfen, ob die importierte Analyse wirklich an
der besonderen Ausgangsstellung beginnt. Ein FEN-Diagramm darf nicht zu einer
normalen Anfangsstellung werden. Für kommentierte Studien zuerst Nr. 21, 25
oder 26 ausprobieren.

| Nr. | Material und Bezug                                                                                                    | Umfang               | Inhalt und Prüfung                                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 19  | [Key Squares](https://lichess.org/study/xebrDvFe) · [PGN](https://lichess.org/api/study/xebrDvFe.pgn)                 | 11 Kapitel, 5,4 KiB  | Schlüsselfelder im Bauernendspiel; FEN, etwas Erklärung, meist Aufgabenstellungen. **Parser geprüft: 11 bereit**, maximal 16 Zugknoten.                                                                                                                                                                                                                                  |
| 20  | [Opposition](https://lichess.org/study/A4ujYOer) · [PGN](https://lichess.org/api/study/A4ujYOer.pgn)                  | 8 Kapitel, 3,6 KiB   | Opposition; reine FEN-Aufgaben ohne Textkommentare. **Parser geprüft: 8 bereit**, alle ohne Zugfolge.                                                                                                                                                                                                                                                                    |
| 21  | [Basic Rook Endgames](https://lichess.org/study/pqUSUw8Y) · [PGN](https://lichess.org/api/study/pqUSUw8Y.pgn)         | 10 Kapitel, 6,5 KiB  | Lucena und Philidor; FEN, Kommentare und kurze Varianten. **Parser geprüft: 10 bereit**, maximal 18 Zugknoten.                                                                                                                                                                                                                                                           |
| 22  | [Intermediate Rook Endings](https://lichess.org/study/heQDnvq7) · [PGN](https://lichess.org/api/study/heQDnvq7.pgn)   | 15 Kapitel, 15,3 KiB | Weitere kommentierte Turmendspiele. **Parser und Desktop geprüft: 15/15 bereit, 127 Zugknoten.** Unterstützung von `Variant "From Position"` umfasst auch „Advanced Philidor“ und „A Tricky Resource“.                                                                                                                                                                   |
| 23  | [Practical Rook Endings](https://lichess.org/study/wS23j5Tm) · [PGN](https://lichess.org/api/study/wS23j5Tm.pgn)      | 10 Kapitel, 7,0 KiB  | Turmendspiele mit mehreren Bauern und Kommentaren. **Parser geprüft: 10/10 bereit, 49 Zugknoten.** Sieben Kapitel sind reine Ausgangsstellungen; „4 vs 4 - A trick“, „R2p vs R - Stalemate Trick“ und „Kasparian’s Draw“ enthalten 9, 23 und 17 Zugknoten. `Variant "From Position"` wird mit gültiger Standardschach-FEN akzeptiert. Nicht Teil des Desktop-Paketlaufs. |
| 24  | [Pawn Endgame](https://lichess.org/study/OS8WX5yO) · [PGN](https://lichess.org/api/study/OS8WX5yO.pgn)                | 38 Kapitel, 43,7 KiB | Bauernquadrat, Opposition, Schlüsselfelder und Tempi; viel Text und Varianten. **Grenzfall: 37 bereit, 1 abgewiesen**. Im Lehrdiagramm „Concept: Rank“ fehlen beide Könige; es ist keine spielbare Standardschachstellung. Maximal116 Zugknoten bei den bereiten Einträgen.                                                                                              |
| 25  | [Fortresses in Pawn Endgames](https://lichess.org/study/AXFEM2vt) · [PGN](https://lichess.org/api/study/AXFEM2vt.pgn) | 37 Kapitel, 33,8 KiB | Festungen, Patt und Unterverwandlung, auch komponierte Studien; ausführlich kommentiert. **Parser geprüft: 37 bereit**, maximal 118 Zugknoten.                                                                                                                                                                                                                           |
| 26  | [Bishop And Pawn Endgames](https://lichess.org/study/mp0Ct7Vu) · [PGN](https://lichess.org/api/study/mp0Ct7Vu.pgn)    | 25 Kapitel, 29,0 KiB | Läufer- und Bauernendspiele, unter anderem ungleichfarbige Läufer; FEN, Kommentare und Varianten. **Parser geprüft: 25 bereit**, maximal 90 Zugknoten.                                                                                                                                                                                                                   |

## Meisterpartien und Turniere

Diese direkten PGNs stammen aus dem
[Downloadverzeichnis von PGN Mentor](https://www.pgnmentor.com/files.html).
Alle acht wurden vollständig heruntergeladen. In diesen Dateien wurden keine
PGN-Textkommentare gefunden: Es sind Partien zum eigenen Analysieren, keine
fertigen kommentierten Kurse. Die Eintragszahl beschreibt die tatsächlich
angebotene Datei und ist keine Vollständigkeitsgarantie für das Turnier.

| Nr. | Direkter Download                                                             | Umfang                  | Interesse und Prüfung                                                                                         |
| --- | ----------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| 27  | [WM 1972](https://www.pgnmentor.com/events/WorldChamp1972.pgn)                | 21 Partien, 14,6 KiB    | Fischer–Spassky. **Parser geprüft: 21 bereit**, maximal 148 Zugknoten.                                        |
| 28  | [WM 2024](https://www.pgnmentor.com/events/WorldChamp2024.pgn)                | 14 Partien, 9,4 KiB     | Ding–Gukesh. **Parser geprüft: 14 bereit**, maximal 143 Zugknoten.                                            |
| 29  | [WM 1921](https://www.pgnmentor.com/events/WorldChamp1921.pgn)                | 14 Partien, 9,2 KiB     | Lasker–Capablanca; kleine historische Sammlung. **Download geprüft.**                                         |
| 30  | [Kandidatenturnier 2024](https://www.pgnmentor.com/events/Candidates2024.pgn) | 55 Einträge, 49,7 KiB   | Moderne Spitzenschachpartien. **Download geprüft**; die angebotene Datei enthält bei der Prüfung 55 Einträge. |
| 31  | [London 1851](https://www.pgnmentor.com/events/London1851.pgn)                | 251 Einträge, 156,8 KiB | Historisches Material. **Download geprüft**; Inhalt und Auswahl vor dem Speichern sichten.                    |
| 32  | [Hastings 1895](https://www.pgnmentor.com/events/Hastings1895.pgn)            | 231 Partien, 154,1 KiB  | Klassisches Turnier für eine größere Bestandssichtung. **Download geprüft.**                                  |
| 33  | [New York 1924](https://www.pgnmentor.com/events/NewYork1924.pgn)             | 110 Partien, 79,3 KiB   | Historisches Spitzenturnier. **Download geprüft.**                                                            |
| 34  | [Wijk aan Zee 2024](https://www.pgnmentor.com/events/WijkaanZee2024.pgn)      | 91 Partien, 80,2 KiB    | Modernes Rundenturnier. **Download geprüft.**                                                                 |

## Weitere Sammlungen mit zusätzlichem Aufwand

Diese vier Angebote ergänzen die Auswahl. Sie sind ausdrücklich **keine
bestätigten direkten Komplettimporte**.

| Nr. | Bezug                                                                             | Inhalt                                                                                                                                                                       | Vorher notwendig                                                                                                                                             |
| --- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 35  | [Morphy, ZIP](https://www.pgnmentor.com/players/Morphy.zip)                       | Laut Anbieter 211 Partien, überwiegend zum eigenen Kommentieren.                                                                                                             | Entpacken und PGN auswählen; Archivlink geprüft, Inhalt nicht mit Plysmith geprüft.                                                                          |
| 36  | [Capablanca, ZIP](https://www.pgnmentor.com/players/Capablanca.zip)               | Laut Anbieter 597 Partien; interessant für Technik und Positionsspiel.                                                                                                       | Entpacken; anschließend Dateigröße und Vorschau prüfen. Keine Zusage zur Knotengrenze aller Partien.                                                         |
| 37  | [Eröffnungsarchive von PGN Mentor](https://www.pgnmentor.com/files.html#openings) | Zahlreiche Eröffnungen, z. B. [Smith-Morra-Gambit, ZIP](https://www.pgnmentor.com/openings/SicilianSmith-Morra.zip). Partiensammlungen, keine kommentierten Repertoirebäume. | Viele Archive enthalten deutlich mehr als 1.000 Partien. Entpacken und extern eine kleinere PGN-Auswahl exportieren.                                         |
| 38  | [The Week in Chess](https://theweekinchess.com/twic)                              | Wöchentliche internationale Turnierpartien als ZIP/PGN.                                                                                                                      | Wochenpakete meist über 1.000 Partien; ein einzelnes Turnier oder eine kleinere Auswahl verwenden. Anbieter nennt persönliche Nutzung und behält Rechte vor. |

## Empfehlenswerte erste Abnahmerunde

Diese zehn Dateien wurden vom Parser vollständig als bereit eingestuft und
auch im echten Desktop importiert. Sie bieten unterschiedliche Schwerpunkte.

| Datei/Präfixvorschlag                                  | Download                                                   | Erwartung                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `italian-game.pgn` / `italian-game.pgn - `             | [PGN](https://lichess.org/api/study/5BCGvHhL.pgn)          | 8 Analysen, Kommentare, Varianten und ein besonderer Start.          |
| `french-winawer.pgn` / `french-winawer.pgn - `         | [PGN](https://lichess.org/api/study/riK38kdr.pgn)          | 24 kurze Eröffnungskapitel.                                          |
| `london-primer.pgn` / `london-primer.pgn - `           | [PGN](https://lichess.org/api/study/7NKYIHqN.pgn)          | 8 Kapitel, längere Varianten und kommentierte Modellpartien.         |
| `mate-patterns.pgn` / `mate-patterns.pgn - `           | [PGN](https://lichess.org/api/study/fE4k21MW.pgn)          | 18 nullzügige Analysen aus FEN.                                      |
| `bishop-knight-mate.pgn` / `bishop-knight-mate.pgn - ` | [PGN](https://lichess.org/api/study/ByhlXnmM.pgn)          | 12 Kapitel mit kommentierten Mattführungen und Varianten.            |
| `opposition.pgn` / `opposition.pgn - `                 | [PGN](https://lichess.org/api/study/A4ujYOer.pgn)          | 8 Bauernendspielstellungen ohne Züge.                                |
| `rook-endgames.pgn` / `rook-endgames.pgn - `           | [PGN](https://lichess.org/api/study/pqUSUw8Y.pgn)          | 10 Endspiele mit FEN und kurzen Fortsetzungen.                       |
| `pawn-fortresses.pgn` / `pawn-fortresses.pgn - `       | [PGN](https://lichess.org/api/study/AXFEM2vt.pgn)          | 37 kommentierte Endspiele/Studien.                                   |
| `world-championship-1972.pgn` / `wm1972 - `            | [PGN](https://www.pgnmentor.com/events/WorldChamp1972.pgn) | 21 Partien; Ergebnis und Spielernamen, keine Quellkommentare.        |
| `world-championship-2024.pgn` / `wm2024 - `            | [PGN](https://www.pgnmentor.com/events/WorldChamp2024.pgn) | 14 moderne Partien, gut für wiederholten Import und Namenskonflikte. |

Zusätzlich eignen sich Nr. 6, 17 und 24 als gezielte Grenzfallprüfung.
Nr. 22 und 23 prüfen die inzwischen unterstützten `From Position`-Exporte.
Ein abgewiesener Eintrag darf keinen teilweise gespeicherten Bestand erzeugen.
Das eigenständige Testen solcher Dateien ist nützlicher als eine Zusage, jede
öffentlich angebotene PGN ohne Einschränkung verarbeiten zu können.

## Tatsächliche Desktop-Abnahme

Der isolierte Host-/Electron-Durchlauf am 2. Oktober 2026 bestand **25/25
Szenarien**. Alle gespeicherten Bäume, Notizen und Zuordnungen wurden geprüft;
der abschließende Neustart erhielt den Bestand. Die native Dateiauswahl war
im eigenen Prüfprozess gestubbt, keine menschliche Betriebssystemdialog-Abnahme.

| Lokale Datei                  | Gespeicherte Objekte | Zugknoten | Ergebnis                                                                                                         |
| ----------------------------- | -------------------: | --------: | ---------------------------------------------------------------------------------------------------------------- |
| `italian-game.pgn`            |                    8 |       377 | Kommentare, Varianten, Kommentaränderung, Umbenennen, Kontextnotizen, Stockfish-Ausspielen und Neustart geprüft. |
| `french-winawer.pgn`          |                   24 |       593 | Vollständig als Analysen.                                                                                        |
| `london-primer.pgn`           |                    8 |       759 | Vollständig als Analysen.                                                                                        |
| `mate-patterns.pgn`           |                   18 |         0 | Reine FEN-Ausgangsstellungen erhalten.                                                                           |
| `bishop-knight-mate.pgn`      |                   12 |       364 | Kommentierte Mattführungen und Varianten.                                                                        |
| `opposition.pgn`              |                    8 |         0 | Nullzügige Endspielanalysen.                                                                                     |
| `rook-endgames.pgn`           |                   10 |        37 | Ausgangsstellungen und Fortsetzungen.                                                                            |
| `pawn-fortresses.pgn`         |                   37 |       909 | Kommentierte Studien.                                                                                            |
| `world-championship-1972.pgn` |                   21 |     1.814 | Als Partien; wiederholte Spielernamen gemeinsam aufgelöst.                                                       |
| `world-championship-2024.pgn` |                   14 |     1.270 | Als Partien mit Ergebnis.                                                                                        |
| `rook-from-position.pgn`      |                   15 |       127 | Standardschach-Export mit `From Position`.                                                                       |
| `greek-gift.pgn`              |                    5 |        31 | Ein Kapitel mit illegalem Zug nicht importiert.                                                                  |
| `pawn-endgames.pgn`           |                   37 |       643 | Ein Diagramm ohne Könige nicht importiert.                                                                       |
| `caro-kann-large.pgn`         |                    0 |         0 | Ressourcengrenze verständlich gemeldet; Bestand und Ordner unverändert.                                          |

Insgesamt **217 Objekte und 6.924 Zugknoten** aus 13 Dateien. Kein Import
nimmt Inhalte automatisch in einen Arbeitskontext auf. Namenskonflikte beim
Wiederimport, Präfixe mit führendem Leerraum, ungekürzte lange Namensvorschläge,
Bestandsänderungen während eines offenen Dialogs und Deutsch/Englisch bei
390 und 1.600 Pixeln wurden zusätzlich geprüft. Keine Rendererfehler oder
automatisch erkannten Axe-Verstöße. Kein Versprechen, jedes fremde Paket sei
gültig oder innerhalb der aktuellen Grenzen.

## Interessante spätere Importanbieter und Formate

Ein Anbieter zum Beschaffen von Daten und ein Dateiformat sind unterschiedliche
Dinge: Lichess und Chess.com können beide PGN liefern; ZIP verpackt eine PGN,
während EPD oder Puzzle-CSV tatsächlich anders interpretiert werden müssen.
Die Prioritäten sind Vorschläge für spätere Entscheidungen, keine zugesagten
Funktionen dieser Slice.

| Priorität | Kandidat und Primärquelle                                                                                                                                                                                            | Nutzen                                                                                         | Grenzen und passender Ausbau                                                                                                                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hoch      | [FEN und EPD, Formatspezifikation](https://www.saremba.de/chessgml/standards/pgn/pgn-complete.htm)                                                                                                                   | Einzelstellungen, Endspiel- und Taktikaufgaben; auch kleine Textdateien mit vielen Positionen. | FEN enthält keine Lösung. EPD-Operationen wie `bm`, `am` und `id` benötigen eine definierte Abbildung auf Züge, Namen und gewöhnliche Kommentare. Stellungsvalidierung und Ressourcenlimits bleiben nötig.                                |
| Hoch      | [Lichess-Studienexport, offizielle API](https://lichess.org/api#tag/Studies) und [Endpunktspezifikation](https://raw.githubusercontent.com/lichess-org/api/master/doc/specs/tags/studies/api-study-studyId.pgn.yaml) | Studienlink statt manuellem Download; alle Kapitel oder gezieltes Kapitel als PGN.             | Bestehenden PGN-Parser wiederverwenden. Sichtbarkeit, deaktivierter Export, Anmeldung bei privaten Inhalten und Rate Limits beachten. Die offizielle Exportform ist PGN; keinen universellen öffentlichen Studien-JSON-Baum voraussetzen. |
| Hoch      | [ZIP von PGN bei PGN Mentor](https://www.pgnmentor.com/files.html) oder [TWIC](https://theweekinchess.com/twic)                                                                                                      | Viele reale Downloadangebote direkt öffnen.                                                    | Containeranbieter, kein neues Schachformat. Auswahl bei mehreren Dateien und Grenzen für die entpackte Größe erforderlich; der ZIP-Dateiname ist keine verbindliche Ordnerstruktur.                                                       |
| Mittel    | [Chess.com Published-Data API](https://www.chess.com/news/view/published-data-api)                                                                                                                                   | Eigene oder öffentliche Spielerpartien monatsweise, JSON-Archivliste und PGN-Monatsdownload.   | Monatsarchive können zu groß sein; Auswahl/Begrenzung vorsehen. Regeln und Varianten prüfen. JSON enthält weitere Angaben, die nicht zu neuen Bestandsmetadaten werden müssen.                                                            |
| Mittel    | [Lichess-Partienexport](https://lichess.org/api#tag/Games)                                                                                                                                                           | Eigene Partien, Datumsbereiche und einzelne Partien.                                           | PGN als einfachster Transport; NDJSON nur bei konkretem Nutzen. Keine automatische Kontosynchronisierung oder Importhistorie ableiten. Netzwerkabbrüche und Rate Limits gehören zur Beschaffung.                                          |
| Mittel    | [Lichess-Puzzle-Datenbank](https://database.lichess.org/#puzzles)                                                                                                                                                    | Nach Themen und Schwierigkeit auswählbare Taktik aus CSV mit FEN und UCI-Zügen.                | Sehr große komprimierte Datei; erst filtern. Die FEN liegt **vor dem ersten gegnerischen Zug**, die eigentliche Lösung beginnt mit dem zweiten UCI-Zug. Diese Semantik muss ein Adapter korrekt umsetzen.                                 |
| Mittel    | [Lichess-Eröffnungsnamen, TSV](https://github.com/lichess-org/chess-openings)                                                                                                                                        | Benannte Eröffnungslinien für eine eigene kleine Bibliothek.                                   | Namen/ECO/Züge, kein kommentierter Kurs. Auswahl nötig; keine eigene Aufbereitung als mitgeliefertes Plysmith-Contentpaket.                                                                                                               |
| Mittel    | [Lichess-Broadcasts, API](https://lichess.org/api#tag/Broadcasts)                                                                                                                                                    | Runden oder einzelne Ereignisse als PGN.                                                       | Für einen einmaligen Import einen abgeschlossenen Ausschnitt bevorzugen. Live-Aktualisierung wäre eine eigene Funktion und darf nicht stillschweigend zum Import gehören.                                                                 |
| Niedrig   | [SCID](https://scid.sourceforge.net/) und [Scid vs. PC](https://scidvspc.sourceforge.net/)                                                                                                                           | Bestehende persönliche Schachdatenbanken übernehmen.                                           | Zunächst über den angebotenen PGN-Export. Nativer Import von Datenbankdateien bedeutet deutlich mehr Format- und Versionspflege; große Bestände vorab auswählen.                                                                          |
| Niedrig   | [ChessBase: Datenbankformate](https://help.chessbase.com/reader/12/eng/database_formats.htm) und [PGN-Export im Replayer](https://help.chessbase.com/apps/en/pgn_tool.htm)                                           | Rechtmäßig bezogenes Material und eigene Analysen über offene Exporte.                         | Auf vom Anbieter erlaubte PGN-/FEN-Exporte begrenzen. Keine Annahme, dass CBH/CBV offen, frei verteilt oder ohne autorisierten Export lesbar sein muss.                                                                                   |
| Niedrig   | [Lichess-Monatsdatenbanken, PGN/Zstandard](https://database.lichess.org/)                                                                                                                                            | Sehr große Partiebestände, später eventuell gezielte Auswahl.                                  | Weit außerhalb der aktuellen Größenordnung. Streaming, Dekompression und Filter wären Voraussetzung; kein direkter Import eines kompletten Monats versprechen.                                                                            |
| Niedrig   | [Lichess-Bewertungen, JSONL/Zstandard](https://database.lichess.org/#evals)                                                                                                                                          | Positionen mit vorberechneten Fortsetzungen als mögliches Analyse-Ausgangsmaterial.            | Riesiger Datensatz; Bewertungen sind fremde berechnete Angaben, keine aktuelle eigene Engine-Analyse. Nur bei einem konkreten Nutzerfall sinnvoll.                                                                                        |

Alle diese Wege sollten letztlich gewöhnliche Analysen oder Partien mit
bearbeitbaren Kommentaren liefern. Quellkonten, Downloadadressen oder
Formatspezifika benötigen dafür kein dauerhaftes Provenienzmodell im Bestand.

## Zugang und bekannte Grenzen dieser Recherche

Die 34 direkten PGN-Downloads wurden ohne Anmeldung abgerufen; es wurden keine
Zugriffssperren umgangen. 26 Lichess-Dateien und zwei WM-Dateien wurden zusätzlich
mit dem vorhandenen Parser geprüft. Nach den `From Position`-Nachproben waren
25 Dateien vollständig bereit, zwei hatten einzelne abgewiesene Kandidaten und eine brach an einer
Ressourcengrenze ab. Für die übrigen sechs Turnierdateien ist nur der Download
und der erkennbare PGN-Inhalt geprüft. Archive und große Kataloge wurden über
die Originalangebote verifiziert, nicht als vollständige Imports getestet.

Die Daten wurden bei der Recherche im Speicher geprüft. Diese Dokumentation
enthält ausschließlich Links und Befunde, keine Kopien der Schachpakete.
Externe Abnahmedateien können lokal unter einem ignorierten Verifikationsordner
liegen. Bei späteren Änderungen an Parser oder Quellstudie müssen die
entsprechenden Befunde erneut geprüft werden.
