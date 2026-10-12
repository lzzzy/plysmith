# PGN-Bestandstransfer

Stand: 2026-10-12. Formatvertrag der im Arbeitsbaum implementierten Datensicherung;
noch nicht veröffentlicht. Nutzerentscheidung B ist verbindlich: aktueller
sichtbarer Bestand plus notwendige Herkunftsabhängigkeiten, kein vollständiges
Application-/Workspacebackup.

## Ziel und Grenze

Ein Export überträgt den kuratierten **Gesamten Bestand** in eine einzige
PGN-Datei. Plysmith kann daraus einen frischen Bestand wiederherstellen.
Andere Schachprogramme können die Datei als gewöhnliche PGN lesen. Eigene
Zusatzinformationen stehen ausschließlich in einem entfernbaren Kommentarblock.

Diese Funktion unterstützt ausschließlich **Gesamtbackup und Restore** des
definierten Bestands. Kein Teilauswahlexport, Teilpaketimport oder Metadaten-
Paketmodus für im Texteditor zusammengestellte Ausschnitte. Diese Erweiterung
hat der Nutzer ausdrücklich verworfen. Der vorhandene gewöhnliche PGN-Import
bleibt unabhängig davon bestehen; er ist keine teilweise Backupwiederherstellung.

Vollständig bedeutet hier:

- alle aktiven sichtbaren Partien und Analysen, jeweils ihre aktuelle Fassung;
- vollständige Hauptlinien und Variantenbäume, auch zuglose Ausgangsstellungen;
- Namen, Beschreibungen, globale aktive Notizen und gespeicherte Notizfortsetzungen;
- alle Bestandsordner einschließlich leerer Ordner und nicht eingeordneter Inhalte;
- Herkunft samt den tatsächlich benötigten älteren Quellfassungen;
- vorhandene gespeicherte Partiefakten und gespeicherter Vorlauf (`SourcePath`).

Nicht enthalten sind Kontexte, kontextlokale Notizen, Mitgliedschaften, Entwürfe,
Analysepfade, Revisionskonflikte, Auswahl/Resume, laufende Partien, Einstellungen,
Enginekonfigurationen, Tokens, Diagnosen, Caches und Suchindizes. Insbesondere
ist ein gespeicherter Notizpfad oder Partievorlauf **kein** ungespeicherter Entwurf.

Sonstige ältere Revisionen, Papierkorbinhalte ohne Herkunftsbedarf sowie
archivierte/erledigte Contributions werden nicht gerettet. Der Export verändert
den Quellbestand nicht. Dies ist kein Datenbankdump und kein Mergeformat.

## Auswahl und Herkunftsabschluss

1. Alle Items mit `lifecycle=active` und aktueller Revision auswählen, unabhängig
   von Suchfilter, Pagination, Ordnerauswahl oder gerade aktivem Kontext.
2. Für jede ausgewählte Revision die konkrete `inventory_anchor`-Herkunft verfolgen:
   Quellitem, **Quellrevision und Quellanker**. Die vollständige referenzierte
   Quellrevision aufnehmen, nicht nur einen ausgeschnittenen Pfad. Rekursiv
   fortsetzen; weder alle alten Revisionen noch alle abgeleiteten Kinder sammeln.
3. Mehrfach benötigte Revisionen/Items genau einmal aufnehmen. Ein aktives Item
   kann seine aktuelle Fassung und mehrere ältere Herkunftsfassungen enthalten.
4. Inaktive Quellitems erhalten Rolle `provenanceOnly` und ihren inaktiven
   Lifecycle. Sie werden beim Restore niemals als aktive Bestandseinträge sichtbar.
   Ihre archivierten Notizen bleiben ausgeschlossen.
5. Globale aktive Contributions aufnehmen, deren Anker in mindestens einer
   ausgewählten Revision gültig ist. Itemanker gehören zum ausgewählten Item;
   Positionsanker zu einer tatsächlich vorkommenden kanonischen Position.
   Keine zusätzliche Revision nur zur Rettung einer sonst historischen Notiz.
6. Fehlende Quellrevision/Anker, unlesbarer Baum, aktives Item ohne aktuelle
   Revision oder Herkunftszyklus sind Exportfehler. Kein Ersatz über Name, FEN
   oder aktuelle Quellfassung; keine scheinbar vollständige Teilmenge ausgeben.

Ein `tombstone` mit nicht mehr vorhandenen erforderlichen Inhalten kann keine
vollständige Herkunft liefern: Export ablehnen und betroffenen Eintrag benennen.
Ein unerwartetes aktives `source`-Item ist ebenfalls nicht still auszulassen;
Version 1 unterstützt die tatsächlich produktiv erzeugten Typen `analysis/game`.

### Bewusste Normalisierung statt zusätzlicher Historie

Für `inventory` bleibt der echte aktuelle Revisionszeiger erhalten. Für ein
`provenanceOnly`-Item bezeichnet das Manifest ausdrücklich `retainedRevision`,
eine enthaltene benötigte Fassung. Der Export wählt dafür die zuerst benötigte
Quellrevision in der deterministischen Abschlussreihenfolge, nicht die höchste
Revisionsnummer. Der Restore darf diese Fassung als technischen Speicherkopf
verwenden; sie ist **keine Aussage über die frühere aktuelle Fassung**.

Das hält bestehende historische Leser mit nichtleerem Revisionszeiger nutzbar,
ohne einen neuen Itemtyp, leeren Kopf oder weitere irrelevante Revisionen
einzuführen. Die Herkunft folgt weiterhin immer ihrer expliziten Revision.
Nicht exportierte Base-Revisionen werden nicht nachgeladen: `baseRevision=null`;
enthaltene Base-Referenzen dürfen erhalten bleiben. Ursprüngliche positive
Revisionsnummern und `changeKind` bleiben Informationswerte, keine Behauptung
einer lückenlosen Historie. SQL-Erzeugungsrevisionen von geteilten Knoten können
auf die erste enthaltene Fassung normalisiert werden. Das Roundtripziel ist der
ausgewählte fachliche Bestand, nicht die gesamte alte Revisionstabelle.

## Gewöhnliche PGN-Projektion

Pro ausgewählter Revision gibt es genau einen PGN-Record. Dessen Hauptlinie
und alle Alternativen sind echtes SAN/RAV, keine eigene Zuggrammatik. Standard-
SAN verwendet englische Figurenbuchstaben, nicht lokalisierte Anzeigezüge.

- STR in Reihenfolge `Event, Site, Date, Round, White, Black, Result`.
- `Event` kann den projizierten Eintragsnamen tragen; wenn die vollständig
  escaped/kodierte Tagzeile 80 Bytes erreicht oder die PGN-Stringgrenze
  überschreitet, `?` verwenden und vollständigen Titel im normalen
  Wurzelkommentar erhalten. Unbekannte historische Felder bleiben `?`, Datum
  `????.??.??`. Keine Spieler/Event/Opening-Fakten aus Notizprosa herauslesen.
- Abweichende Ausgangsstellung mit `SetUp "1"` und vollständiger sechsstelliger
  `FEN`; insbesondere Zugfarbe, Rochade, en passant und beide Zähler erhalten.
  Die Grundstellung kann ohne diese optionalen Tags erscheinen. Ein notwendiger
  FEN-Tag darf ausnahmsweise länger als 79 Bytes sein, maximal 255 einschließlich
  LF. Nicht im String umbrechen oder Zähler kürzen. Sonstige Tagzeilen kurz halten.
- `Result` und Abschlussmarker stimmen überein. Vorhandenes strukturiertes
  Ergebnis auf `1-0/0-1/1/2-1/2/*` abbilden. Analysen und nicht strukturiert
  gespeicherte Ergebnisse verwenden `*`; ein Ergebnis in Notiztext bleibt Text.
- Titel, Beschreibung und gewöhnliche Notizen lesbar an Wurzel/Halbzug abbilden.
  Alle Kommentare derselben Stelle in **einem** Brace-Kommentar zusammenfassen,
  insbesondere bei allen zuglosen Records, nicht nur im ersten Record.
- Notizfortsetzungen als beschrifteten SAN-Text im Notizkommentar projizieren.
  Sie werden nicht zu RAV: Das würde etwa aus einer unveränderlichen Partie eine
  andere gespeicherte Struktur machen. Exakte Zugdaten stehen zusätzlich im
  Manifest. Nach dessen Entfernung bleibt die Fortsetzung als Notiztext lesbar.
- Gespeicherten `SourcePath` als beschrifteten Vorlauf mit Start-FEN und SAN im
  Wurzelkommentar projizieren. Nicht der Spielhauptlinie voranstellen. Native
  Wiederherstellung stellt den separaten strukturierten Vorlauf wieder her.
- Herkunftsfassungen im normalen Kommentar als solche kennzeichnen. Fremdreader
  sehen diese zusätzlich als PGN-Records; sie kennen Plysmiths Sichtbarkeitsrollen
  nicht. Keine Garantie einer gleichen Bestandsansicht in Fremdprogrammen.

### Zeichensatz und Kommentartext

Version 1 verwendet ein einziges klassisches PGN-Zeichenprofil: **ISO-8859-1,
ohne BOM, LF, Movetextzeilen kürzer als 80 Bytes**. Tagzeilen folgen der oben
benannten FEN-Ausnahme. Das ist kein umschaltbarer Encoding-
Modus. Deutscher Text bleibt normalerweise direkt lesbar. Nicht zulässige
Zeichen, insbesondere Unicode außerhalb dieses Profils, werden nur in der
gewöhnlichen Textprojektion als sichtbare `\uXXXX`-Sequenzen dargestellt;
Supplementary Characters als zwei UTF-16-Sequenzen. Das Manifest bewahrt den
Originaltext exakt als UTF-8-JSON.

In Kommentaren außerdem Backslash, rohe `{`/`}` und Kontrollzeichen außer LF
sichtbar escapen. Eine originale `[%`-Zeichenfolge wird als `\u005b%` projiziert,
damit normale Notizprosa keine echte Metadatendirektive erzeugt. In Tagstrings
zusätzlich die vorgeschriebenen Quote-/Backslash-Escapes verwenden. Lange
Kommentarzeilen dürfen umbrochen werden; Originalabsätze stehen im Manifest.
Damit können auch Metadatenblöcke vollständig entfernt werden, ohne ungültige
Klammern oder neue versteckte Anweisungen zurückzulassen.

Diese äußere Zeichenprojektion betrifft nur Fremd-PGN-Anzeige. Native Namen,
Unicode, Leerzeichen, Zeilenumbrüche, Beschreibung und Notizgrenzen werden nicht
umgeschrieben. Klassische Zeichen-/String-/Zeilenregeln:
[PGN Specification](https://www.saremba.de/chessgml/standards/pgn/pgn-complete.htm).

## Ein Kommentarblock, ein Manifest

Der **erste** PGN-Record trägt unmittelbar nach seinen Tagpairs einen einzelnen
Wurzelkommentar. Darin steht am Anfang genau ein Block:

```text
{[%plysmith 1,
<Base64url-Zeile mit maximal 64 Zeichen>
<weitere Base64url-Zeilen>
]
Titel und gewöhnliche Wurzelnotizen bleiben hier lesbar.
}
```

Die Winkelklammertexte erklären die Grammatik, sie sind kein gültiges Payload.
Keine eigenen Tags, Metadaten vor den Tagpairs, zweiten Wurzelkommentare,
Seitendateien, Archive oder Kompression. Der Block besteht aus Literal
`[%plysmith 1,`, LF, einer oder mehreren nichtleeren Base64url-Zeilen, LF, `]`.
Payload: kanonisch ungepaddetes Base64url (`A-Z a-z 0-9 _ -`), strikt decodiertes
UTF-8, genau ein JSON-Objekt. LF/CRLF akzeptieren, kein beliebiges ignoriertes
Interpunktion/Padding. JSON-Objektkeys dürfen nicht doppelt vorkommen. Beim
nativen Pfad den Marker zuerst auf den Eingabebytes erkennen und die Datei
fest als ISO-8859-1 lesen, nicht mittels UTF-8-/Latin-1-Heuristik. Den Block
vor dem gewöhnlichen PGN-Parser entfernen; seine Größe zählt separat.

V1-Payload ist kompaktes kanonisches JSON im `JSON.stringify`-Stil des Exporters:
keine Formatwhitespace, alternativen Zahlen-/Escapeformen oder Duplicate-Keys.
Nach lexikalischem Ressourcencheck und Standardparse muss erneutes Stringify
bytegleich zum decodierten JSON sein; danach geschlossene Schemafelder prüfen.
Dies betrifft nur das eigene Manifest, nicht normale PGN-Kommentare und deren
manuelle Entfernung. Kein zweiter selbst gebauter JSON-Parser erforderlich.

**Entfernung:** Nur von `[%plysmith` bis zum zugehörigen `]` entfernen, nicht den
ganzen umgebenden Brace-Kommentar. Der übrige Kommentar enthält normale Notizen.
Ein danach leerer `{}`-Kommentar ist gültig und kann ebenfalls entfernt werden.

Die Restore-Erkennung erfolgt **vor** dem bisherigen Entfernen von `[%...]`-
Direktiven. Ein erkannter beschädigter/unbekannter/ein zweiter eigener Block
ist ein Fehler, kein stiller Wechsel zum Fremdimport. Ohne eigenen Block gilt
der vorhandene gewöhnliche PGN-Import mit seinen bestehenden Grenzen.

### Sonderfall ohne Records

Auch ein leerer Bestand mit leeren Ordnern muss exportierbar sein. Nur bei null
Revisionen wird ein gewöhnlicher Nullzug-Record mit `Event "Plysmith collection"`
und `*` zum Manifestträger. `carrier=true` verlangt genau diesen einen Record;
`records/items/anchors/contributions` sind leer. Native Wiederherstellung
erzeugt daraus **keinen** Bestandseintrag. Fremdreader sehen eine Nullzugpartie,
auch nach Entfernung des Blocks. Diese kleine Ausnahme ist bewusst offengelegt;
bei echten Inhalten gibt es keinen zusätzlichen künstlichen Record.

### Vollständiges kleines Formatbeispiel

Ein leerer Bestand mit einem leeren Ordner; die folgende PGN wurde im RAM
mit beiden lokalen Readern geprüft. Die Markdowndatei selbst ist UTF-8;
eine spätere Exportdatei enthält die entsprechenden ISO-8859-1-Bytes.

```pgn
[Event "Plysmith collection"]
[Site "?"]
[Date "????.??.??"]
[Round "?"]
[White "?"]
[Black "?"]
[Result "*"]

{[%plysmith 1,
eyJ2ZXJzaW9uIjoxLCJwZ25TaGEyNTYiOiJmZWNiNTM2MTY5NWMwMDI1NzliMzAx
YzczNmRmMTljODEyODVlZjkxNzUwNGE2NWZkOWNhZmFjOWYzZWIzMmFhIiwiY2Fy
cmllciI6dHJ1ZSwiZm9sZGVycyI6W3siaWQiOiJmMSIsInBhcmVudCI6bnVsbCwi
bmFtZSI6IkvDtm5pZ3NmbMO8Z2VsIn1dLCJpdGVtcyI6W10sInJlY29yZHMiOltd
LCJhbmNob3JzIjpbXSwiY29udHJpYnV0aW9ucyI6W119
]
Sammlung: Königsflügel
} *
```

Decodiertes Manifest:

```json
{
  "version": 1,
  "pgnSha256": "fecb5361695c002579b301c736df19c81285ef917504a65fd9cafac9f3eb32aa",
  "carrier": true,
  "folders": [{ "id": "f1", "parent": null, "name": "Königsflügel" }],
  "items": [],
  "records": [],
  "anchors": [],
  "contributions": []
}
```

Der Hash schließt den abschließenden LF nach `} *` ein. Entfernen des markierten
Blocks lässt den normalen Kommentar einschließlich seiner ersten LF bestehen;
keine zusätzliche Leerzeile einfügen oder bestehende Zeilen entfernen.

## Manifest Version 1

Englische technische Begriffe: `Inventory` = sichtbarer Bestand;
`ProvenanceOnly` = ausschließlich Herkunftsabhängigkeit;
`Record` = übertragener Revisionssnapshot;
`Contribution` = einzelne gespeicherte globale Notiz/Beitrag;
`Projection` = gewöhnlicher PGN-Inhalt ohne Manifestblock.

Dateilokale Keys sind kurze Strings mit Präfix und positiver Dezimalzahl:
`f/i/r/o/m/a/n` für Folder/Item/Record/Occurrence/Move/Anchor/Contribution.
Keine SQL-IDs, UUIDs des alten Stores, Dateipfade oder externen Referenzauflösungen.
Jeder Key muss innerhalb seiner Art eindeutig sein und zum passenden Typ zeigen.
Alle Objekte haben eine geschlossene Feldmenge, Enums und Ganzzahl-/Textgrenzen;
keine beliebige Attributtasche oder ausführbaren Inhalte. Nicht genannte
optionale Werte werden ausdrücklich als `null` geschrieben.

| Feld            | Inhalt und Invariante                                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`       | Ganzzahl `1`, identisch mit Kommentarversion.                                                                                                              |
| `pgnSha256`     | 64 kleine Hexzeichen über die vollständige Projection.                                                                                                     |
| `carrier`       | Boolean, Sonderfall oben; sonst `false`.                                                                                                                   |
| `folders`       | `{id,parent,name}`; Parent `f*` oder null; inklusive leerer Ordner.                                                                                        |
| `items`         | `{id,role,itemType,originKind,lifecycle,folder,currentRevision,retainedRevision,createdAt,updatedAt}`.                                                     |
| `records`       | `{id,item,pgnIndex,revisionNumber,baseRevision,changeKind,name,summary,languageTag,creatorRole,createdAt,origin,nodes,game,sourcePath}`.                   |
| `anchors`       | Geschlossene Union aus den vier Formen unten.                                                                                                              |
| `contributions` | `{id,anchor,contributionType,authorRole,body,rationale,languageTag,version,createdAt,updatedAt,moves,movesRoot}`. Scope immer global, Status immer active. |

`role=inventory` verlangt `lifecycle=active`, echte enthaltene `currentRevision`
und `retainedRevision=null`. `role=provenanceOnly` verlangt inaktiven Lifecycle,
`currentRevision=null` und enthaltene `retainedRevision`. Beide Pointer gehören
dem Item. `itemType=analysis/game`; `originKind` bleibt
`manual/structured_import/playout/live_observed/live_played`. Die öffentliche
Bestandsreihenfolge wird durch die Itemarray-Reihenfolge erhalten. Gleichzeitige
Erzeugung darf bei neu vergebenen SQL-IDs nicht zur Umkehr führen.

`pgnIndex` ist nullbasiert und lückenlos; die Recordarray-Reihenfolge entspricht
der PGN-Reihenfolge. Sichtbare aktuelle Records zuerst in Bestandsreihenfolge,
danach noch nicht enthaltene Herkunftsrecords in deterministischer rekursiver
Abschlussreihenfolge. Keine Zuordnung anhand des Titels oder der FEN.

### Bäume und Anker

Der Baum selbst kommt aus PGN. `nodes` ist ein Array von Tupeln
`[occurrenceKey, moveKeyOrNull, historyKnowledge]`, jeweils Root zuerst, danach
kanonischer Tiefensuche: Hauptfortsetzung zuerst, Alternativen in gespeicherter
Geschwisterreihenfolge. Index 0 ist Root ohne Move, jeder andere Knoten das
Ergebnis eines Halbzugs. Arraylänge muss exakt zur PGN-Baumgröße passen.
Relative Reihenfolge ist fachlich; Lücken alter SQL-`sibling_order` sind es nicht.

`historyKnowledge=complete/partial/unknown` bleibt pro Vorkommen erhalten:
FEN allein enthält diese Information nicht. Identische Occurrence-/Move-Keys
über mehrere Records desselben Items bedeuten dieselbe persistente Identität.
Sie müssen zum selben Item und derselben Position beziehungsweise zum selben
Halbzug mit identischen Endpunktidentitäten und Koordinaten gehören;
niemals bloß wegen gleicher FEN oder gleicher SAN zusammenlegen. Verschiedene
Vorkommen derselben Position bleiben verschieden. Positionidentitäten werden
mit der vorhandenen fachlichen Kanonisierung wieder aufgebaut. PlayState und
Knowledge bleiben Attribute des jeweiligen Snapshots und dürfen nicht durch
eine gemeinsame Identität auf die Werte einer anderen Revision reduziert werden.

Anchorformen, jeweils einschließlich `id`:

- `{id,kind:"item",item}`.
- `{id,kind:"position",witness:{record,node}}`: kanonische Position am Zeugen;
  kein besitzendes Item, keine Übertragung alter Positionshashes.
- `{id,kind:"occurrence",item,occurrence}`.
- `{id,kind:"move_node",item,move}`.

Zwei Anchor-Keys dürfen nicht heimlich dieselbe kanonische Anchoridentität
duplizieren. Zeugen und Mitgliedschaften müssen in aufgenommenen Records
existieren. Herkunftsanker muss tatsächlich in der genannten Quellrevision liegen.
Ohne separaten Partievorlauf liefert er direkt die Ausgangsstellung der Ableitung.
Bei Partien mit Vorlauf muss die konkrete Herkunftslinie dessen Präfix sein;
zusätzliche Fortsetzungen dürfen erst danach zum eigentlichen Partieroot führen.
Positions-/Zähleranschluss wie in `validateInventorySourcePath` prüfen,
Knowledge separat erhalten. Ein anderer Halbzug mit gleicher Stellung ist
kein Ersatz für den expliziten Quellanker.

`origin` ist `{kind}` bei `initial_position/fen/position_setup` oder
`{kind:"inventory_anchor",item,revision,anchor}`. Zusätzliche unpassende Felder,
Ownershipfehler, ungültige oder zyklische Referenzen werden abgewiesen.

### Notizen, Partiefakten und Vorlauf

Contributions bleiben getrennte Objekte, auch bei gleichem Text/Anker. Alle
vorhandenen fachlichen Felder einschließlich Sprache, Zeitstempeln, aktuellem
Versionswert und optionalem `rationale` erhalten. Zulässige Contribution-/
Autorenwerte entsprechen dem aktuellen geschlossenen Domainvertrag. Keine
Annahme, dass `workspace_contribution` immer kontextlokal wäre.

Contributionarray und Wiederherstellung erhalten die Lesereihenfolge auch bei
identischen `createdAt`-Werten. Neue lokale IDs müssen den tatsächlichen
Reader-Tie-Breaker `created_at ASC, contribution_id ASC` entsprechend abbilden,
nicht identische Notizen willkürlich umordnen. Der Index mit `updated_at DESC`
bestimmt nicht diese Lesereihenfolge. Contributiontypen sind
`note/question/decision/machine_finding/source_statement`, Autoren
`user/engine/source`. Version/Revisionsnummer und alle Zähler sind positive
beziehungsweise nichtnegative sichere Ganzzahlen, Zeitstempel gültiges UTC.

`moves` ist ein geordnetes Array `{from,to,promotion}` mit englischem Promotion-
Enum oder null. Leer bedeutet keine gespeicherte Fortsetzung. SAN wird legal
vom Ausgangsanker neu erzeugt. Kein Engineaufruf. Bei mehrdeutigem Item-/
Positionsanker verlangt eine nichtleere Fortsetzung zusätzlich einen expliziten
PlayState-Zeugen `{record,node}` als Feld `movesRoot`; bei leerem `moves` null.
Auch eindeutige Vorkommens-/Moveanker bekommen diesen Zeugen, damit Zähler und
HistoryKnowledge nicht implizit gewählt werden. Er muss zur Anchorposition
passen. Jeder Schritt muss legal sein; eine ungültige Notizfortsetzung macht
den Transfer fehlerhaft, nicht eine erfolgreich importierte gekürzte Notiz.

Für Occurrenceanker muss der Zeuge exakt ihren Occurrence-Key treffen, für
Moveanker exakt das Zielvorkommen dieses Move-Keys. Nur bei Positionsankern
genügt die kanonische Positionsgleichheit; Itemanker verlangt den Itemroot.

Der heutige Notizspeicher enthält selbst keinen vollständigen PlayState dieser
Fortsetzung. `movesRoot` ist deshalb ein Exportzeuge, keine erfundene historische
Notizwurzel: erste passende aktuelle Revision in Exportreihenfolge bevorzugen,
sonst erste passende Herkunftsfassung; bei mehreren passenden Knoten deren
kanonische Reihenfolge. Itemanker verwendet deren Root. Nach Restore dürfen
Note-Reads dieselben gespeicherten Koordinaten/SAN liefern, aber keine zusätzliche
garantierte Notiz-HistoryKnowledge behaupten, die die Quelle nie gespeichert hat.

`game=null` bei Analysen und bei Partien ohne strukturierte Ausspielfakten.
Der Eintragstyp Partie bleibt dabei erhalten. Ansonsten genau
`{playerSide,result,policy}` mit dem vollständig vorhandenen Pflichtsatz;
keine Teilkombinationen, keine aus Notizprosa ergänzten Spieler/Resultate.

- `playerSide=white/black`.
- `result={kind,source,reason}`: `kind=white_win/black_win/draw/unfinished`,
  `source=manual/automatic`. Bei manual ist reason null. Bei automatic verlangt
  ein Gewinn `checkmate`; draw verlangt
  `stalemate/insufficient_material/threefold_repetition/seventy_five_move`.
  Automatic unfinished ist ungültig. Dies ist die geschlossene Wireabbildung
  der gespeicherten `GameOutcome`-/Quellenwerte, nicht nur der PGN-Resultmarker.
- `policy={capability,providerInstanceId,providerFingerprint,providerType,
providerDisplayName,profile}`. Historische Strings nichtleer und begrenzt;
  keine Konfigurations-/Netzauflösung. `capability=best_move` verlangt profile
  null; `human_profile` verlangt vollständiges Profil.
- `profile={modelName,selectionMode,historyMode,reproducibility}` mit Modellname
  wie im bestehenden Domainlimit und Enums `most_likely/sampled`,
  `known_position_history/position_only`, `deterministic/stochastic`.

Unbekannt bleibt null, insbesondere bei importierten oder Livepartien. Eine
historische Providerkennung ist eine Partiefakt, keine ausführbare
Enginekonfiguration oder Zugangsdaten. Resulttag und Result-Wireobjekt müssen
übereinstimmen; bei fehlenden strukturierten Fakten wird kein Ergebnis erfunden.

`sourcePath` ist null oder `{title,rootFen,moves,historyKnowledge}`. `moves`
wie oben; `historyKnowledge={root,before,after}`, root ist ein Enumwert,
before/after sind Arrays mit jeweils genau `moves.length` Enumwerten. Legal
vom eigenen Vorlaufroot abspielen; letzter FEN-/Positionszustand muss dem
eigentlichen Partieroot entsprechen. Gespeicherte Knowledgewerte danach den
jeweiligen Zuständen zuweisen, nicht aus dem Root ableiten. Sie müssen an den
Grenzen nicht gleich sein: heutiges `sameChessState` vergleicht nur FEN/Position,
und `applyMove` kann unknown vor dem ersten Zug zu partial machen.

Dieser gespeicherte Pfad ist eigenständig, keine Suche nach einem anderen Item
oder nach einem verschwundenen Entwurf. Vor-/Nachpositionen, Zähler und SAN,
Fingerprints und Positionskeys werden aus Regeln wieder aufgebaut; originale
Knowledge pro Root/before/after bleibt erhalten. Eine Analyse verlangt
`sourcePath=null`; bei einer Partie ist der Vorlauf unabhängig von game-Fakten.

Native Wiederherstellung verwendet ausschließlich Manifest-Contributions und
Beschreibung. Die lesbare Kommentarprojektion wird **nicht ein zweites Mal**
zu Notizen importiert. Sonst entstünden Duplikate und falsche Notizgrenzen.

### Integrität und Editierbarkeit

Projection bedeutet vollständige Datei nach Entfernung nur des eingebetteten
Manifestblocks. CRLF zuerst zu LF normalisieren, kein BOM; übrige Bytes bleiben
unverändert. SHA-256 über diese ISO-8859-1-Bytes bilden. Export erzeugt zuerst
diese gewöhnliche PGN, berechnet den Hash und fügt dann den Block ein. Die
Entfernung muss exakt wieder dieselbe Projection ergeben.

Veränderte/vertauschte/fehlende/zusätzliche Records, geänderte Notizprojektion
oder Formatierung werden beim nativen Restore abgewiesen. Zeilenenden LF/CRLF
sind die einzige tolerierte Neudarstellung. Nutzer können den Block komplett
entfernen und die Datei gewöhnlich importieren; das ist bewusst kein vollständiger
Plysmith-Restore mehr. Kein stilles Überschreiben extern geänderter Züge durch
alte Metadaten. Der Hash schützt vor Inkonsistenz, **nicht** vor einem Angreifer,
der die Datei und den Hash gemeinsam verändert; sämtliche Daten weiter validieren.

## Export- und Restoreablauf

**Export:** konsistenten SQLite-Lesesnapshot verwenden, vollständigen Scope und
Budgets prüfen, deterministisch serialisieren. Eine Änderung während des Exports
darf nicht zwei Revisionsstände vermischen. In temporäre Datei im explizit
gewählten Zielverzeichnis schreiben, erst nach vollständigem Erfolg atomar
ohne Überschreiben veröffentlichen.
Fehler/Abbruch hinterlassen keine scheinbar gültige Teil-PGN und beschädigen
keine vorhandene Exportdatei. Auch bewusst ausgewählte bestehende Dateien werden
nicht überschrieben; ein neuer Dateiname ist erforderlich.

**Restore:** Datei unabhängig vom aktuellen UI-Kontext einlesen und vollständig
vorprüfen: Grammatik/Version/Hash, Anzahl, Typen, Bäume, Rechtmäßigkeit,
Knowledge, Referenzen, Ordnerzyklen, Namensregeln und Budgets. Danach bewusste
Bestätigung und **eine** atomare Publikation. Neue lokale IDs vergeben,
geteilte Identitäten erhalten, Referenzen umschlüsseln, Indizes/Fingerprints
neu aufbauen. Keine SQL-/Pfad-/Netzwerk-/Providerbefehle aus dem Manifest.

Restore validiert bestehende Snapshotdaten, nicht durch Wiederholen normaler
Erzeugungskommandos mit heutigen Defaults. Beispielsweise erlaubt die vorhandene
Revisionspersistenz Namen bis 200 Zeichen, während manche neuen Erzeugungs-
entwürfe 160 verlangen. Ein gültiger importierter 200-Zeichen-Name darf deshalb
nicht beim Restore gekürzt werden oder an einem unpassenden Creation-DTO scheitern.

Ziel muss frisch und leer sein: keine Items, Ordner oder Arbeitskontexte,
Beiträge oder Entwürfe. Konfiguration darf vorhanden sein und bleibt unberührt.
Leere technische Standard-Resumezeilen zählen nicht als Benutzerinhalt. Bei
vorhandenem Bestand Restore ablehnen; keine implizite Löschung, Umbenennung,
Namenssuffixe, Teilauswahl oder Duplikaterkennung. Unmittelbar im Write-Lock die
Leere nochmals prüfen. Fehler/Race/angenommener Abbruch vor Publikationsbeginn
bedeutet keine Änderung. Während des synchronen SQLite-Writes ist keine neue
Eventloop-Abbruchanfrage wirksam; danach vollständig Commit oder Rollback.
Eine letzte Deadlineprüfung vor Commit bleibt verpflichtend. Kein asynchroner
Writer, Schema-/Stagingwechsel oder jederzeit wirksames AbortSignal versprechen.
Erfolg publiziert genau eine neue Bestandsrevision und invalidiert abhängige
Reads. Ein zweiter inhaltlicher Restore derselben Datei wird abgewiesen, nicht
angehängt. Ein vollständig leerer Carrier ohne Ordner ist nach Validierung ein
wiederholbarer No-op ohne Publikation; kein eigener Receiptmechanismus dafür.

Sichtbare Namen bleiben bestandsweit eindeutig nach der bestehenden fachlichen
Normalisierung, unabhängig vom Ordner. Historische Quellnamen dürfen mit heutigen
Namen kollidieren, ohne sie umzubenennen oder unsichtbare Vorgänger zu aktivieren.
Ordnernamen sind Namen, keine Dateipfade; gleiche Namen unter unterschiedlichen
Eltern sind erlaubt, normalisierte Geschwisterkonflikte nicht.

## Ressourcenprofil für die Umsetzung

Eigener Restore ist **kein** gewöhnlicher Importlauf mit 100-Kapitel-Auswahl.
Er muss mehr als einen früheren Import übertragen können und deshalb einen
eigenen schmalen Adapter-/Use-Case-Vertrag haben. Kein allgemeines Jobframework,
ZIP, Schema-Migration oder unbeschränkter privilegierter Parser.

Konkrete V1-Budgets, durch Zusammenspieltests zu
verifizieren; keine bereits gemessene Kapazitäts- oder 99-Prozent-Zusage:

| Grenze                                                          |                Startwert |
| --------------------------------------------------------------- | -----------------------: |
| Gesamte PGN-Datei                                               |                   64 MiB |
| Decodiertes UTF-8-Manifest                                      |                   32 MiB |
| PGN-Records inklusive Herkunft                                  |                    4.096 |
| Ordner / Tiefe                                                  |               4.096 / 64 |
| Alle Zugknoten inklusive Herkunft, Notizpfaden und Vorlauf      |                  262.144 |
| Zugknoten je Record                                             |                   16.384 |
| Halbzüge je Pfad / RAV-Tiefe / Kinder je Vorkommen              |          1.000 / 32 / 65 |
| Contributions                                                   |                   65.536 |
| Einzelner originaler Notiztext                                  | 128.000 UTF-16-Codeunits |
| Originaler Notiztext insgesamt inklusive Rationale/Beschreibung |    8 Mi UTF-16-Codeunits |
| JSON-Verschachtelung                                            |                       16 |
| Vorprüfung / Publikation                                        |             120 s / 30 s |

Das formatgebundene Parserprofil arbeitet auf der Projection nach Manifest-
entfernung. Nicht das heutige Fremdimportprofil unverändert wiederverwenden:
ein konsolidierter Notizkommentar kann dessen 8.192-Zeichen-Grenze überschreiten.
Folgende Syntaxgrenzen sind aus den obigen Transfergrenzen abgeleitet:

- Kandidatenbytes, einzelner Kommentar und Kommentartext insgesamt: jeweils
  durch verbleibende **64-MiB-Dateigrenze** begrenzt. Kein zusätzliches 8.192-
  oder 128.000-Zeichen-Limit auf bereits aggregierte/escaped Projection anwenden.
- Höchstens ein Wurzelkommentar plus ein Kommentar je Zugknoten und nur die
  tatsächlich benötigten RAVs. Syntax-/Tokenbudget linear aus Recordzugbudget:
  `32 * (maxRecordNodes + 1)` Tokens und Satzzeichen außerhalb von Kommentaren.
  Kommentarinhalt ist Text, keine mitgezählte Schachsyntax.
- Genau STR plus höchstens `SetUp/FEN`, keine beliebigen Fremdheaders/NAGs.
  RAV-/Pfad-/Kindergrenzen wie oben, übrige Zeichen durch Dateibudget begrenzt.

Unicode-Escapes können Text um Faktor sechs vergrößern, mehrere Notizen zu
einem Kommentar werden addiert. Export zählt daher auch die **fertigen Bytes**;
er muss nicht das gleichzeitige Erreichen aller Einzelmaxima zusagen. T18 prüft
große zulässige Notes jenseits 8.192 sowie gemeinsame Byteüberläufe. Gewöhnlicher
PGN-Import behält vollständig sein vorhandenes kleineres Profil.

Datei und Payload vor Parser-/Decodeallokation begrenzen; Objekt-/Referenzzahlen
und Textlängen beim Validieren mitzählen. Iterativer Baum-/Herkunftslauf statt
unbegrenzter Rekursion. Bestehende kooperative Parsercheckpoints/Abbruchmuster
nutzen; es gibt derzeit keinen Parserworker. Keine unvertretbar langen synchronen
Parser-/Writeabschnitte, sondern explizites Messgate; Timer unterbrechen solche
Abschnitte nicht. Keine Deadlineverlängerung als Fix oder neue Architekturpflicht.
Geschlossene DTOs statt Objektmerge, keine Prototype-Keys oder Duplicate-Keys.

Beide Richtungen nutzen dasselbe Ressourcenprofil: kein erfolgreich erzeugter
Export, den die eigene Version wegen geringerer Restoregrenzen ablehnt. Bei
Grenzüberschreitung verständlicher Fehler, niemals abschneiden oder eine unvoll-
ständige Sicherung als Erfolg melden. Ein unbegrenzt großer Bestand ist damit
nicht zugesagt. Produkttexte nennen keine internen Zahlen, sondern erklären den
konkreten Fehler. Aktuelle übrige Domainlimits gelten zusätzlich; diese Tabelle
ist keine pauschale Aufweichung von Domain-/Namens-/Fair-Play-Regeln.

## Tests und Abnahmekriterien

Roundtrip-Orakel: aus Exportscope eine kanonische fachliche Projektion bilden
und nach Restore erneut vergleichen. SQL-IDs, Datenrevision, FTS, Fingerprints,
technische Created-Revision und ausgeblendete Geschichte ignorieren; gleiche
referenzielle Identitäten/Unterschiede, Baumordnung, PlayState, Texte, Rollen,
Herkunft und sichtbare Bestandsreihenfolge **nicht** ignorieren. Zusätzlich
FK-/Integritätsprüfung und dieselben Application-Reads wie in der Oberfläche.

| Test                                                                              | Erwartung                                                                                                                                                                   |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01 Leerer Bestand, nur leere verschachtelte Ordner                               | Carrier lesbar; Restore erzeugt null Items, alle Ordner; Entfernen lässt eine Nullzug-PGN.                                                                                  |
| T02 Zuglose Analyse Grundstellung und freie Endspiel-FEN                          | Nullzüge, vollständige Zähler/Knowledge; nur erster Record trägt Manifest.                                                                                                  |
| T03 Hauptlinie mit Alternativen und verschachtelten RAV                           | Vollständiger Baum/Ordnung, nicht nur gerade selektierter Pfad; Promotion/Rochade/en passant legal.                                                                         |
| T04 Unicode, Klammern, Backslash, `[%plysmith`, mehrere gleiche Notizen           | Originaltexte/grenzen exakt; nur echte Direktive erkannt; externe Projection bleibt gültig.                                                                                 |
| T05 Alle vier Anchorarten, wiederholte Positionen, geteilte Knoten                | Keine FEN-/SAN-Verschmelzung; gemeinsame Notes genau einmal, Membership korrekt.                                                                                            |
| T06 Notizfortsetzung außerhalb Hauptlinie und Varianten                           | Exakt legal wiederhergestellt; nach Metadatenentfernung lesbarer Notiztext, keine neue RAV.                                                                                 |
| T07 Ableitung aus alter Revision, aktive Quelle später geändert                   | Aktuelle Quelle und benötigte alte Fassung; Herkunft bleibt an alter Revision/Anker.                                                                                        |
| T08 Mehrstufige Herkunft mit gelöschtem Vorgänger                                 | Referenzabschluss vollständig; Vorgänger bleibt unsichtbar, keine Archivnotiz zurückgeholt; Export-Restore-Export mit mehreren benötigten Fassungen erhält den Scope.       |
| T09 Irrelevante Historie/Trash, historische Notiz ohne ausgewählten Anker         | Bewusst ausgeschlossen; kein heimliches Vollbackup.                                                                                                                         |
| T10 Partien: manuell/automatisch beendetes Ausspielen, Import, Live               | Typ/Unveränderlichkeit, bekannte Resultquelle/Providerfakten erhalten, unbekannte Werte bleiben null.                                                                       |
| T11 Gespeicherter Vorlauf aus früherem Scratch                                    | Zusätzliche Züge nach Herkunftsanker als echter Vorlauf; root/before-/after-Knowledge separat, auch unknown/partial-Grenze; keine doppelten Spielzüge, kein Scratchrestore. |
| T12 Mehrere Importchargen, gleiche Erzeugungszeit, leere/unfiled Ordner           | Über 100 Records möglich; sichtbare Reihenfolge und globale Namen erhalten.                                                                                                 |
| T13 Eigener Export, Parser und mindestens ein unabhängiger RAV-Reader             | Alle Bäume/Result/FEN/Kommentare lesbar; Nulllinien und schwarzer erster Zug.                                                                                               |
| T14 Alle Zusatzblöcke manuell entfernen                                           | Gewöhnlicher PGN-Import möglich; Züge/RAV/Result und lesbare Notes bleiben, keine Zusatzobjekte erwartet.                                                                   |
| T15 Falsche Version/Payload, Duplicate-Keys/IDs, falsche Typen                    | Verständlicher Fehler, kein verlustreicher Fremdimportfallback.                                                                                                             |
| T16 Veränderte, vertauschte, fehlende/zusätzliche Records; LF/CRLF                | Jede Inhaltsänderung rejected; reine Zeilenendkonversion akzeptiert.                                                                                                        |
| T17 Dangling/Cross-Item-Refs, zyklische Herkunft/Ordner, illegaler Notezug        | Gesamter Restore abgewiesen, kein repariertes Teilresultat.                                                                                                                 |
| T18 Grenzen N/N+1 und gleichzeitig große Bäume/Texte/Herkunft                     | Gültige Grenzfälle vollständig; Überlast vor Publikation, kein Hostfreeze/Teilexport.                                                                                       |
| T19 Quelländerung beim Export, Diskfull/Abbruch; Write-Race/DBfehler beim Restore | Konsistenter Snapshot; Ziel/Bestand unverändert bei Fehler, FK und Rollback geprüft.                                                                                        |
| T20 Zielbestand nicht leer, zweiter Restore, Namen-/Ordnerkonflikt                | Kein Merge/Reset/Suffix; vollständig leerer Carrier als No-op wiederholbar; historische Namen zulässig, sichtbare Konflikte rejected.                                       |
| T21 Kontexte/Resume/Scratch/Token/Enginecache als Canaries                        | Nicht im Export, nicht angelegt; lokale Einstellungen und Quelle unverändert.                                                                                               |
| T22 Restore, Appneustart, normale Bearbeitung danach                              | Ordner-/Herkunftsansicht, globale Notes, unveränderliche Partie, Analyserevision und neue Ableitung funktionieren.                                                          |

T13 benötigt einen unabhängigen **baumfähigen** Reader. `chess.js.loadPgn`
allein genügt nicht: Es liest die Hauptlinie, bewahrt aber nicht den ganzen RAV-
Baum. Format-/Semantiktests klein und deterministisch; SQLite-Integration für
Identität/Rollback, ein nativer Manual-Roundtrip für T22. Keine Vollverdopplung
aller UI-/Importtests, aber Herkunftlöschung und Notizpfade ausdrücklich prüfen.

## Versionsvertrag und Umsetzungsgrenze

Format 1 bleibt ein stabiler fachlicher Leservertrag, unabhängig von SQLite-
Schema- und Appversion. Neue Felder/Enums benötigen einen bewusst kompatiblen
Leser oder eine neue Formatversion, nicht blind ignorierte Daten. Eine neue App
muss ein unterstütztes altes Exportformat in ihre aktuelle Domain überführen
können; das ist keine SQL-Migrationskette. Unbekannte Versionen klar ablehnen.
Vor einem inkompatiblen Storewechsel muss die alte lesefähige App exportieren.
Eine bereits unlesbare Datenbank kann dieser PGN-Weg nicht nachträglich retten.

Für die Umsetzung reichen ein formatgebundener PGN-Codec, ein konsistenter
Snapshotleser und eine atomare Restore-Publikation an vorhandenen Grenzen.
Kein zusätzlicher universeller Transferlayer, History-Archiv, Recoverymodus,
Onlineformat oder automatischer Merge.

### Vertragsvorbereitung

Aktuelle Domain-/Applicationmodelle, Tabellen und normale Reader/Writers wurden
lesend abgeglichen. Astra hat unabhängig die Datenabdeckung geprüft und die
Herkunfts-/Notizpfad-/Knowledge-Lücken des einfachen Viewexports benannt.
Die Nutzerentscheidung B sowie die kommentarbasierten Sonderfälle sind hier
integriert. Im Gesamtreview ein P1 und vier P2 lokal korrigiert: Herkunft mit
Vorlauf, exakte Notizzeugen, Tagzeilen, Projection-Parserbudgets und leerer No-op.
Astra bestätigt im begrenzten Schluss-Recheck: keine verbleibenden P1/P2,
fachlich vollständiger B-Scope und angemessen einfacher Vertrag.

Kleine RAM-Proben mit `@mliebelt/pgn-parser@1.4.19` und `chess.js@1.4.0`:
Metadaten nach Headers, kombinierter Wurzelkommentar, SAN/RAV und Nullzugträger
werden akzeptiert. Metadaten vor Headers und mehrere Wurzelkommentare wurden
als inkompatibel verworfen. Das ist **kein** produktiver Export-/Restore-
Roundtrip, Kapazitätsnachweis oder nativer UI-Test. Diese Vorbereitung ist vom
anschließenden Implementierungsnachweis zu unterscheiden.
Gespeichertes Carrierbeispiel nach Formatierung nochmals gelesen: JSON/Payload
gleich, Hash und LF/CRLF konsistent, zwei Reader erfolgreich,22 eindeutige Test-IDs.

### Implementierungsabnahme

Umgesetzt ohne Änderung bestehender Domainmodelle oder SQLite-Migrationen.
Vollsuite **1.357/1.357** grün; der abschließende Formatbefund des ersten
`pnpm verify`-Laufs wurde gezielt behoben und die betroffenen Gates nachgeprüft.
Native Manual-PGN-Sicherung und Fresh-Restore, bytegleicher Re-Export,
Host-/Desktopneustart und normale Weiterbearbeitung sind geprüft. Der unabhängige
baumfähige `python-chess`-Reader liest Original, entfernte Zusatzmetadaten und
CRLF; eine zusätzliche Fixture enthält Rochade, Promotion, en passant und RAV.

Gemessener großer Codecfall: 4.096 Knoten, 2.048.000 Textzeichen, 5.044.462 Bytes;
Encode/Decode 5.142 ms, maximaler Eventloopabstand 66 ms. Das ist ein konkreter
Zusammenspielnachweis, keine Zusage für jedes gleichzeitige Einzelmaximum.
Native Dateidialogantworten wurden im eigenen Electron-Prozess vorgegeben;
keine menschliche Dialog-/Installerabnahme oder Nutzerkontoaktion behaupten.
Ausführlicher Nachweis: [Verifikationsledger](verification/pgn-transfer-2026-10-12.json).

Primäre Codeanker: `inventory-models.ts`, `sqlite-inventory.ts`,
`sqlite-analysis-record.ts`, `sqlite-game-record.ts`, `sqlite-game-source-path.ts`,
Migrationen `002-analysis-workspace.sql`/`007-game-source-path.sql`/
`008-inventory-folders.sql` und `import-limits.ts`.
