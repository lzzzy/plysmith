# Gesamtbackup und Restore: Umsetzungsslice

Stand: 2026-10-12. Im Arbeitsbaum implementiert, noch nicht veröffentlicht.
Fachliches Format, Scope B und T01-T22 stehen ausschließlich im
[Formatvertrag](pgn-transfer-contract.md). Dieser Plan ergänzt die konkreten
Codeanschlüsse, nicht eine zweite Formatspezifikation.

## Ergebnis und Grenzen

Desktop unter **Einstellungen / Datensicherung**: gesamten gespeicherten Bestand
als PGN sichern und eine solche Sicherung in einen frischen leeren Bestand
wiederherstellen. Keine Teilauswahl, Pakete, Kontexte/Entwürfe, Konfigsicherung,
Merge, automatische Löschung oder SQLite-Migration. Normales PGN-Importieren
bleibt unter Verwalten und fachlich unverändert.

Gemeinsame Dateierfassung, PGN-Syntax-/Baum-/Regelprüfung und vorhandene
Persistenzhilfen. Getrennte Import- und Restore-Use-Cases, weil normaler Import
neue Einträge erzeugt und Restore exakte gespeicherte Beziehungen rekonstruiert.
Keine zweite PGN-Parserimplementierung, neue Jobarchitektur oder zweite Datenbank.

## Anschlüsse aus der Vorbereitungsphase

| Anschluss                                  | Tatsächlicher Stand und Konsequenz                                                                                                                                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PgnContentFormatAdapter`                  | `parseCandidate` verbindet Framing/Shield/Parser/legalen RAV-Lauf mit Headertext, Direktivenfilter, Notizaggregation und Importfindings. Den gemeinsamen Leser vor dieser verlustbehafteten Aufbereitung extrahieren. |
| `ContentFormatLimits` / `pgn-structure.ts` | Syntaxlimits schon parametrisiert; Pfad-/Kinder-/Notizlimits teilweise direkt aus `IMPORT_LIMITS`. Diese Abhängigkeiten im gemeinsamen Kern durch geschlossene Profile ersetzen.                                      |
| `LocalFileSourceAcquisition`               | Registrierung und Streaming sind fest auf 16 MiB begrenzt; UTF-8 strikt, Latin1 nur ausdrücklich. Neue interne Profile, keine globalen Fremdimportlimits erhöhen.                                                     |
| Desktop Main/Preload                       | Nativer PGN-Öffnendialog und Diagnosespeicherdialog mit Senderprüfung existieren. Wiederverwenden beziehungsweise PGN-Speicherdialog hinzufügen.                                                                      |
| Host API                                   | 16-KiB-Requestbody reicht für Pfad/ID/Fingerprint. Keine 64-MiB-Datei oder Bäume durch HTTP/Renderer transportieren. Explizite Preflightmethoden mitführen.                                                           |
| `sqlite-persistence-adapter.ts`            | `#readSnapshot` und synchrones `#enqueueWrite` besitzen bereits Snapshot-/Transaktionsownership. Neue Methoden daran anschließen, nicht neue Connections/Transaktionen im Fachwriter öffnen.                          |
| Normale Importwriter                       | Setzen neue Import-Herkunft, Versions-/Zeitdefaults und Notizen; können nicht unverändert einen Backupgraphen rekonstruieren.                                                                                         |
| Startup/Workspace-Reads                    | Frischer Desktop schreibt keinen Scratch. Jede tatsächliche Scratchzeile sperrt Restore, auch ein ausdrücklich angelegter Nullzugentwurf.                                                                             |
| Notizreader                                | Tatsächliche Reihenfolge `created_at ASC, contribution_id ASC`; der anders sortierte Index ist keine Readersemantik.                                                                                                  |
| Parser/Writer-Abbruch                      | Kooperative Parsercheckpoints vorhanden, kein Parserworker. SQLite-Write ist synchron und darf nicht awaiten. Keine jederzeitige Unterbrechbarkeit behaupten.                                                         |

## Kleine Moduländerungen

Der Plan wurde an den vorhandenen Grenzen umgesetzt. Applicationablauf und
Problems liegen gemeinsam in `inventory-transfer.ts`; flüchtige Wiremodelle und
Ports in `pgn-transfer-*` und `inventory-backup-*`. Dateiablage heißt
`file-inventory-backup.ts`, API-Schemas und -Routes `pgn-transfer-*`.
Die folgende Tabelle dokumentiert die ursprünglichen Anschlüsse, nicht zusätzliche
noch zu erstellende Module. Bestehende Domainmodelle und Migrationen bleiben unverändert.

| Bereich                        | Änderung                                                                                                                                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/application/inventory/`   | `pgn-transfer-models.ts`, `pgn-transfer-ports.ts`, `pgn-transfer-use-cases.ts`, `pgn-transfer-problems.ts`, `pgn-transfer-limits.ts`; öffentliche Exporte über vorhandenes `index.ts/public.ts`, keine tiefen Cross-Contextimports.                                    |
| `adapters/content/pgn/`        | `pgn-game-reader.ts` als einziger gemeinsamer legaler PGN-Leser; bestehender Formatadapter bleibt Fremdimportprojektion. `pgn-transfer-codec.ts` ergänzt Manifest/Hash/Validierung und iterative PGN-Ausgabe. Kein zweites `parseGame` oder eigener Schachregelparser. |
| `adapters/content/local/`      | Bestehende LocalFileSourceAcquisition mit festen internen Content-/Backup-Profilen und begrenzter eigener Namespaceerkennung. `file-pgn-backup.ts` für sichere vollständige Dateiablage. Keine beliebigen API-gesteuerten Limits oder generische Dateibroker.          |
| `adapters/persistence/sqlite/` | `sqlite-pgn-transfer-snapshot.ts`, `sqlite-pgn-transfer-restore.ts`; Anschluss im bestehenden PersistenceAdapter. Kleiner `insertGameSourcePath`-Helfer ohne Playout-Draft und konkrete Suchprojektion ergänzen.                                                       |
| `channels/api/`                | `pgn-transfer-schemas.ts`, `pgn-transfer-routes.ts`, bestehende Dependencies/Schemaregistrierung/Problems/Preflightliste ergänzen. OpenAPI bleibt einzige DTO-Quelle.                                                                                                  |
| `channels/host_client/`        | Generierten Vertrag aktualisieren, dünne Clientmethoden und Rediscovery weiterreichen; keine Geschäfts-/Dateilogik.                                                                                                                                                    |
| `channels/ui/desktop/`         | Ein PGN-Speicherkanal plus bestehender Öffnenkanal; vertrauenswürdigen Sender vor und nach Dialog prüfen, Abbruch liefert undefined.                                                                                                                                   |
| `channels/ui/renderer/`        | ApplicationStore um endlichen Transferzustand/Commands ergänzen; kleines `inventory-backup-settings.tsx` mit DE/EN-Messages in Settings. Renderer erhält nur Status, Counts, Dateiname, IDs und Fehler.                                                                |
| `bootstrap/host/`              | Gemeinsamen Leser, konfigurierte Dateiquellen, Codec, Persistenceports und Use Cases verdrahten; Cleanup der laufenden Vorbereitung. Vorhandene Live-Diagnoseänderungen erhalten.                                                                                      |

Der Dateidialog gibt wie heute nur den ausgewählten Pfad zurück. Dieser darf
kurzzeitig durch Renderer/API gehen, aber nicht in Logs, Reports oder langlebigen
UI-Preferences landen. Der Host liest/schreibt die Inhalte direkt; keine zweite
Application-Runtime in Electron oder filesystem-Berechtigung im Renderer.

## Gemeinsamer PGN-Lesekern

1. `PgnFramer`, `shieldPgn`, `parseGame` und iterativen legalen RAV-Lauf aus
   `parseCandidate` zusammenführen. Ergebnis: originale Tags/Kommentarfragmente,
   validierte Root, geordnete kanonische Zugknoten, Result und Syntaxmerkmale.
2. Fremdimportwrapper übernimmt wie bisher Namensvorschlag, Header-Notiztext,
   Direktivenfilter, Whitespace/Notizaggregation und Findings. Seine bisherige
   ready/rejected-Kapitelsemantik und Grenzen unverändert absichern.
3. Transfercodec erkennt/entfernt das Manifest **vor** Direktivenfilter und
   prüft Projection/Hash. Denselben Leser mit dem Backupprofil nutzen; einzelne
   Rejected-Records machen den gesamten Restore ungültig. Manifesttexte und
   Knowledge bleiben maßgeblich, gewöhnliche Kommentare nicht doppelt importieren.
4. Profilwechsel nur durch Composition/Use Case, nicht durch Dateiinhalte oder
   frei wählbare APIzahlen. Der gemeinsame Leser kennt keine SQLite-/UI-/
   Restoretransaktion und normalisiert keine Ankeridentitäten.

Sicherungsausgabe: vollständigen Baum iterativ besuchen, nicht `chess.js.pgn()`
für einen Variantenexport einsetzen. Kommentar-/Latin1-/Tagregeln und Hash aus
dem Formatvertrag beachten. Outputbytes vollständig messen, ehe Erfolg gemeldet
wird. Export und Restore dürfen nicht verschiedene Formatgrenzen erhalten.

Manifest-Schema und fachliche V1-Validatoren nur im Codec halten, nicht als zweite
große API-DTO-Spezifikation. API transportiert nur Status und Counts. JSON via
Standardparser, vorher lexikalische Tiefen-/String-/Byteguards; geschlossene
Schemafelder und sichere Ganzzahlen danach prüfen. Für Duplicate-Key-Erkennung
kompaktes Export-JSON strikt verlangen: `JSON.stringify(JSON.parse(text))` muss
genau den ursprünglichen JSON-Text ergeben. Duplicate-Keys und nichtkanonische
Darstellungen werden damit abgewiesen, ohne einen zweiten JSON-Parser zu bauen.
Ein in Texteditoren bearbeitbares Manifest/Paket ist kein unterstützter Scope.

Eigene Namespaceerkennung an derselben lexikalischen Stelle wiederverwenden.
Normaler Import muss eine Sicherung als `inventory_transfer.restore_required`
ablehnen, bevor Notizen/Metadaten gefiltert werden. Auch eine Sicherung über
16 MiB soll diesen Hinweis erhalten: bei lokaler Registrierung zuerst eine
begrenzt gelesene erste Rootkommentar-Signatur prüfen, anschließend normales
Dateilimit anwenden. Exportformat platziert den Marker garantiert früh; keine
vollständige Großdatei allein für eine Umleitung lesen. Marker in einem Tagstring
ist keine Rootdirektive; unvollständiger/eigener kaputter Marker kein Fremdfallback.

## Applicationabläufe und Hostvertrag

Ein `InventoryTransferRepository` genügt:

- `readPgnTransferSnapshot(checkBudget)` liefert einen vollständig materialisierten
  B-Snapshot mit dataRevision aus **einem** Read-Snapshot.
- `inspectFreshRestoreTarget()` liefert nur Leere/Blocker, keine Nutzerdaten.
- `restorePgnTransfer(prepared, occurredAt, checkBudget)` publiziert atomar,
  nachdem dieselbe Zielprüfung unter Write-Lock nochmals erfolgreich war.

Codec und Datei-I/O sind eigene vorhandenen Grenzen entsprechende Application-
Ports; Use Cases importieren keine konkreten Parser-/SQLite-/fs-Implementierungen.
Kein Repository exportiert sich selbst als SQL oder ruft den Dateidialog auf.

Vorgeschlagene fünf explizite Operationen, Pfade weiterhin unversioniert:

| HTTP                                    | Operation                  | Kleines Request-/Resultmodell                                                            |
| --------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /inventory/backup-status`          | `GetInventoryBackupStatus` | canRestore, geschlossene Blockercodes, suggestedFileName; rein lesend.                   |
| `POST /inventory/backups`               | `CreateInventoryBackup`    | destinationPath, formatVersion; Result Dateiname/Counts/Bytes/snapshotDataRevision.      |
| `POST /inventory/restores/preview`      | `PrepareInventoryRestore`  | restoreId als UUID und inputLocator; Result dieselbe ID, fingerprint, Counts, expiresAt. |
| `POST /inventory/restores/publish`      | `RestoreInventory`         | restoreId und acceptedFingerprint; Result Counts/dataRevision/noOp.                      |
| `DELETE /inventory/restores/:restoreId` | `CancelInventoryRestore`   | laufende Vorprüfung abbrechen oder fertige Vorschau freigeben; keine Undooperation.      |

`restoreId` vor Beginn im Renderer mit bestehender Browser-UUID-Fähigkeit erzeugen,
damit Abbruch schon während Vorprüfung gezielt möglich ist. Im Host strikt
validieren; gleicher/recycelter ID während Laufzeit nicht zwei Payloads zuordnen.
Ein aktiver Transfer je Host, **eine** Restorevorschau, begrenzt durch Formatbudgets
und zehn Minuten Laufzeit. Kein neues persistentes Preview-/Receiptmodell.

Die ID im Host vor dem ersten await registrieren. Ein DELETE kann trotzdem vor
seinem POST ankommen: frühe Cancels mit streng validierter ID höchstens16fach
für dieselbe zehnminütige Requestlebensdauer im RAM merken. Bei voller Liste
busy melden, keinen Erfolg vortäuschen. Spätere Vorbereitung derselben ID
vor Dateizugriff abweisen; Einträge erst bei Ablauf entfernen. Cancel während
Dateiregistrierung anschließend Inputhandle vergessen und Vorbereitung sauber
beenden. Späte Previewantworten dürfen nach Cancel nicht wieder prepared setzen.

Statusfolge: idle → preparing → prepared → publishing → idle. Abbruch/Fehler
führt vor Publikation zu idle und schließt Inputhandles. Vorbereitetes Paket
bleibt unveränderlich im Hostcache; die Bestätigung bindet exakt dessen
Fingerprint, nicht einen inzwischen geänderten Dateiinhalt. Dateierfassung prüft
Identität vor/nach Lesen wie heute. Kein zweiter Decodepfad für die Bestätigung.

Der Previewfingerprint bindet die gesamte eingelesene Sicherung einschließlich
Manifest, beispielsweise SHA-256 der ursprünglichen Dateibytes. Er ist nicht
der `pgnSha256` des Formats: dieser bindet nur die normale Projection. Auch
eine reine Metadatenänderung muss zu einem anderen Previewfingerprint führen.

Während Vorbereitung kooperativ abbrechen. Bei Hostshutdown Vorbereitung canceln
und Ressourcen schließen. Vor Publikation Signal/Expiry/Fingerprint prüfen;
während synchronem Write keine wirksame neue Cancelanfrage zusagen. Button dann
gesperrt, kein Undo-/Datenlöschfallback. Verbindungsausfall nach Commit bedeutet
unklaren Antwortausgang: Status/Bestand frisch lesen, nicht automatisch nochmal
publizieren. Leerer Carrier ohne Ordner bleibt ein wiederholbarer No-op.

Noch laufende normale Importvorbereitung/-publikation oder gehaltene Import-
vorschau, Playout und Liveaufnahme
sperren Restore. Vor Write-Eintritt Runtimezustand erneut prüfen; persistierte
Liveguards nicht löschen oder zurücksetzen. Backup liest ausschließlich gespeicherten
Bestand und startet keine Engines. Keine Aufweichung bestehender Fair-Play-Grenzen.

## SQLite-Auswahl und Publikation

### Snapshotleser

Aktive Itemköpfe einschließlich ungültiger/missing Currentfälle zuerst direkt
lesen; kein verlustbehafteter Inner Join. Alle Ordner, komplette referenzierte
Revisionen und rekursive Herkunftsclosure, PlayState, Anker, aktive globale
Contributions und gespeicherten Vorlauf materialisieren. Keine UI-Views oder
paginierten Searchresults als Exportquelle.

Prepared Statements einmal je Operation, gebundene Batches/Joins statt großer
IN-Listen oder N+1-Positionreads. Read-Connection nach Materialisierung schließen;
PGN-Serialisierung und Dateizugriff außerhalb der Transaktion. Retained-Heads,
ausgeschlossene historische Notizen und geteilte Identität nach Formatvertrag.

### Fresh-Zielprüfung

Alle Items und Ordner unabhängig von Lifecycle, Kontexte, Contributions,
Scratch-/Playout-Drafts sowie referenzierte Revision-/Anchor-/Receipt-/
Mitgliedschafts-/Impactreste zählen als Inhalt. Nur technische Tabellen,
Konfiguration/Preferences, leere FTS-Strukturen und eng neutrale freie Resumezeilen
dürfen bestehen. Keine reine Prüfung sichtbarer Einträge oder dataRevision===0.

Jeder echte Scratch sperrt, auch `scratchHasChanges=false`. Startup und normale
Workspace-Reads erzeugen keinen solchen Scratch. Lokale unspeicherte Inhalts-
formulare im eigenen Renderer über vorhandene Verlustgrenzen zusätzlich schützen;
keine automatische Formlöschung. Enginekonfigurationsentwürfe bleiben unberührt.

### Eine bestehende Schreibtransaktion

1. `#enqueueWrite`/BEGIN IMMEDIATE; Ziel/Runtime/Signal/Budget erneut prüfen.
2. Ordner parent-first; Items in exportierter Bestandsreihenfolge mit vorläufig
   leerem Current; alle Revisionsköpfe, danach enthaltene Base-Referenzen.
3. Kanonische Positionen; Occurrence-/Moveidentitäten genau einmal pro Key;
   vollständige Snapshots und Knowledge jeweils pro Revision.
4. Analysis-/Game-Köpfe mit Originalfakten; normale Navigationsanker für **alle**
   Knoten, nicht nur annotierte Manifestanker. Referenzen umschlüsseln und konkrete
   Herkunftsmitgliedschaft/Closure/Zyklen prüfen.
5. SourcePath ohne Playout-Draft einfügen; separate root/before/after-Knowledge
   erhalten. Contributions/Notizpfade mit Originalfeldern und Leserreihenfolge.
6. Vollständige Graph-/PlayState-/Mainlineinvarianten prüfen, echte Current/
   inaktive retainedRevision-Köpfe setzen. Suchdokumente und FTS atomar aufbauen.
7. Genau eine dataRevision-Erhöhung, letzte Deadlineprüfung, Commit; erst danach
   vorhandenes Bestandsänderungsereignis und UI-Invalidierung.

`prepareEnsurePosition` und vorhandene Graphvalidatoren wiederverwenden.
`prepareImportGraph` erzeugt dagegen Identitäten je Record und Kommentare als
Notes; `insertAnalysisNoteContribution` setzt note/user/Version1/neue Zeitstempel.
Diese kompletten Erzeugungsfunktionen nicht als Restore missbrauchen. Kleine
wirklich doppelte Insert-/Projektionshilfen teilen, keine universelle Graphengine.

Suchdokumente aktuell sichtbarer Items und enthaltener globaler Contributions
neu ableiten; alte IDs/Hashes/FTS nicht importieren. Suchprojektionsversion ist
nicht dataRevision. FTS-Integrität und Fehlerrollback gehören in denselben Write.

## Dateiablage und Sicherheitsgrenzen

Desktop schlägt `plysmith-backup-YYYYMMDD-HHmmss.pgn` vor. Der Host validiert
absoluten .pgn-Zielpfad, echten Parent und geschützte Roots (Applicationhome,
Install-/Source-Root); keine Symlink/Reparse-Umleitung zu geschützten Daten.
Keine Verzeichnisse rekursiv anlegen oder Pfade aus Manifestfeldern verwenden.

Kleinster sicherer Writer wie beim Diagnosebundle: private exklusive Tempdatei
im gewählten Parent, vollständige Daten schreiben/schließen, atomar unter neuem
Zielnamen publizieren, eigene Tempdatei im finally entfernen. **Existierende Ziele
nicht überschreiben.** Keine zusätzliche Replace-/Backuplöschlogik; beim SaveDialog
gegebenenfalls anderen Namen verlangen. Formatvertrag erlaubt bewusste Zielwahl,
erzwingt aber keinen Overwritekomfort.

Cleanupschutz beginnt unmittelbar nach erfolgreicher exklusiver Tempanlage,
nicht erst nach writeFile. Schreib-/Closefehler vor Publikation hinterlassen kein
gültiges Ziel; eigene Teiltempdatei bestmöglich entfernen. Erfolgspunkt ist der
atomare **No-Replace-Link** nach vollständigem Write/Close, nicht gewöhnliches
überschreibendes rename. Konkurrierendes Ziel bedeutet destination_exists.
Nach erfolgreicher Veröffentlichung bleibt der Export erfolgreich, auch wenn
Temp-Unlink scheitert; Cleanupfehler separat redigiert behandeln, Ziel nicht
wieder löschen. Dieses präzisierte Verhalten nicht blind vom aktuellen
Diagnosewriter kopieren: dort liegen beide vom Review benannten Cleanupfallen.

Keine Logs/Reports mit Pfaden, Namen, FEN, Zugfolgen, Manifest oder Original-
Parserfehlern. Geschlossene Problemcodes wie invalid_backup, unsupported_version,
restore_required, target_not_empty, transfer_busy, stale_preview, resource_exhausted,
destination_exists und file_write_failed in DE/EN abbilden. Keine alten Inhalte
in technischen Parser-/Dateifehlermeldungen zurückspiegeln. Ein kontrollierter
UI-Hinweis darf den betroffenen zugänglichen Bestandseintrag über seine Identität
benennen; Originalprosa/Dateipfade nicht als Fehlerdetail oder Diagnose ausgeben.

API-Schemas: additionalProperties=false, keine Dateibytes/Manifestpayloads als
Body, keine Inputlimitparameter. Auth/Localhost/CORS/Preflightmethoden unverändert
streng; neue Pfade ausdrücklich registrieren. Hostclient generieren, Browser-
Buildprüfung beibehalten. Keine neuen MCP-Dateischreib-/Restoretools in diesem
Desktop-Slice; normale MCP-Importstrecke bekommt dieselbe Backup-Erkennung.

## Desktopablauf

- Datensicherung als sichtbarer eigener Settingsabschnitt, nicht unter technischen
  Systemdetails. Globale Aktionen ohne Kontext-/Ordnerauswahl.
- Sichern: Dateidialog → Hostoperation → Erfolg mit Dateiname und Anzahl; kein
  zusätzlicher Bestätigungsdialog für rein lesenden Export.
- Restore: Zielstatus prüfen → nativen PGN-Dialog öffnen → Vorprüfung → kompakte
  Bestätigung mit Anzahl von Analysen/Partien/Ordnern und Hinweis auf ausgeschlossene
  Arbeitsstände → atomare Übernahme → Bestand/Status frisch laden.
- Kein Kapitelpicker, Typumschalten, Präfix oder Ordnerziel im Restore. Kein
  automatisch ausgeführter Restore aus dem gewöhnlichen Importdialog; erkannte
  Sicherung verweist auf Einstellungen/Datensicherung.
- Fortschrittszustand und Abbrechen bei Vorprüfung, keine erfundenen Prozente.
  Nach Publikationsbeginn Aktionen gesperrt. Escape/Navigation darf kein laufendes
  Commit als abgebrochen darstellen. Neue Hostgeneration darf keine alte Vorschau
  bestätigen; inaktuelle Antworten wie im bestehenden Store verwerfen.
- Status nur bei Settingsbedarf/Änderungsereignis laden; keine neuen großen
  Snapshotreads beim Desktopstart. Rechte von Kontexten nicht verändern.

## Umsetzung in sechs überprüfbaren Schritten

1. **Gemeinsamen Leser herauslösen.** Normales Verhalten identisch; bestehende
   PGN-/Dateierfassungs-/Importregressionen grün. Kein Feature vorzeitig anbieten.
2. **Codec und V1-Validierung.** Iterativer Writer, Marker/Hash, Referenzen,
   Text/Knowledge/Fakten, Leserprofile und strenge Gesamtabweisung. T01-T17.
3. **Snapshot/Restorepersistenz.** Ein Read und ein Write, vollständige Leere-
   prüfung, SourcePath/Notes/Search und Failpointrollbacks; T05-T12/T17-T22.
4. **Use Cases und sichere Dateien.** Endlicher Cache, Previewbindung, Abbruch/
   Shutdown/Dateiraces/konkurrierende Writes, Schutzroots; T18-T21.
5. **Hostclient und Desktop.** Closed API/Preflight/Redaktion, Datei-IPC,
   Settings/Store/DE-EN und Backup-Erkennung im normalen Import; keine MCPwrites.
6. **Gesamtverifikation und Manual.** Native isolierte Backup-/Restoreabnahme
   plus vollständige Sourcegates, vorhandenes Manual DE/EN gezielt ergänzen.

Die Schritte sind eine interne Reihenfolge, keine sechs unabhängigen Releases.
Ownership bei delegierter Umsetzung disjunkt: Parent Application/Codec/API/
Integration, Worker Persistenz oder UI mit getrennten Dateien. Astra bewertet
Identity-/Rollbackinvarianten und finalen Gesamtstand; keine gleichzeitigen Edits
am Composition Root/Store durch mehrere Agenten.

## Verifikation und verbleibende Risiken

T01-T22 aus dem Formatvertrag bleiben die Pflichtbasis. Zusätzlich konkret:

- PGN-Goldens vor/nach Kernextraktion, nur eine Parser-/Legalityimplementierung,
  verschiedene Profile; normale Limits und Herkunfts-/Kommentarprojektion erhalten.
- Normaler Import erkennt auch großes/Latin1-eigenes Backup vor lossy Verarbeitung;
  normalen Tag-/Kommentartext nicht fälschlich zur Sicherung erklären.
- Frischer Desktop nach Startup/Workspace-Reads restorierbar; Trash, neutrale
  aber explizite Scratches, Setup/FEN und Receipt-/Anchorreste sperren.
- Notizen: gleiche createdAt, verschiedene updatedAt und identische Texte nach
  Restore/Neustart in derselben Leserreihenfolge. Unannotierte Knoten navigierbar.
- Zwei Restoreanfragen, Write zwischen Preview/Publish, ID/Fingerprintwechsel,
  fehlgeschlagene letzte Budget-/FTS-/Revisionprüfung: vollständiger Rollback.
- Cancel während Lesen/Queue; nach sync Writebeginn kein falsches Cancelversprechen.
  Replyverlust nach Commit kein automatischer zweiter Import.
- DELETE vor POST sowie während Dateiregistrierung, Ablauf/voller Early-Cancel-
  Speicher und späte Previewantwort: keine resurrected Vorschau oder offene Handles.
- Dateiablage: existing target, symlink/reparse, geschützte Roots, Diskfull,
  Cleanupfehler und Dateiaustausch beim Lesen; bestehende Daten bytegleich.
- Teilwritefehler räumt eigene Tempdatei auf; konkurrierendes Ziel bleibt
  bytegleich; Temp-Unlink nach erfolgreichem Link ändert den Exporterfolg nicht.
- Desktop DE/EN, Tastatur/Fokus, 1280/900/390px, kleine und größere Sicherung,
  mehr als100 Records ohne Kapitelpicker, Neustart und normale Weiterbearbeitung.

Aktuelle Baseline dieser Vorbereitung: **78/78** bestehende PGN-Reader-/
LocalFileSourceAcquisitiontests grün, keine Skips oder Abbrüche. Keine Produkt-
Roundtrip-, SQLite-, Kapazitäts- oder native Transferabnahme bereits behaupten.

Startbudgets bleiben konkrete Vorschläge, keine gemessenen Maximalzusagen.
`parseGame` ist synchron, aber Kommentare werden vor Bibliotheksparse bereits
abgeschirmt. Gemeinsame Grenzen und Checkpoints nutzen; keinen bestehenden
Worker behaupten. Synchrone Library-/Writeabschnitte sind ausdrücklich zu messen.
Zunächst Parserprofile/bounded Work kalibrieren; keine automatisch daraus
abgeleitete neue Worker-/Job-/Persistenzarchitektur. Ein unvertretbarer Hänger
bleibt ein Umsetzungsgatefehler, keine durch Timer lösbare Unterbrechung.

Restore setzt einen lesefähigen **frischen aktuellen Store** voraus. Eine alte
inkompatible DB kann nicht über Startup hinweg automatisch gerettet, gelöscht
oder ersetzt werden. Vor Storeformatwechsel aus alter Version sichern und
frisches Profil/aktuelle DB einrichten. Kein zusätzlicher Recovery-/Resetmodus.

Geplante Abschlussgates: fokussierte Tests, vollständiges `pnpm verify`, eigene
native Temp-Profile mit Restart/Weiterbearbeitung, unabhängiger baumfähiger PGN-
Reader und manuelle Metadatenentfernung. Nur eigene Testprofile/Prozesse verwenden;
keine echte Installation/Konten/Bestände übernehmen, kein Release/Commit/Push.

## Reviewstatus

Astra-Persistenzanalyse integriert: bestehende Transaktionsgrenzen tragen den
Slice; keine Migration/zweite DB nötig. Notizreihenfolge und Abbruchsemantik im
Formatvertrag korrigiert. Im integrierten Planreview zwei lokale P2 zu Early-Cancel
und Dateipublikation präzisiert; keine P1. Begrenzter Schluss-Recheck bestanden,
keine verbleibenden P1/P2; Astra bewertet den Plan als implementierungsreif.
Diese Aussage betrifft die Planvorbereitung. In der anschließenden Umsetzung
wurden Produktdateien geändert, ausschließlich eigene Testprofile verwendet und
mehrstufige Herkunft sowie Abbruch-/Dateipublikationsraces zusätzlich geprüft.
Die finale Source- und native Abnahme wird getrennt dokumentiert.

## Implementierungsabnahme

Der Slice ist im Arbeitsbaum fertig. Desktop: **Einstellungen / Datensicherung**;
ein vollständiges PGN-Backup und bewusster Fresh-Restore, ohne Teilauswahl/Merge.
Ein gemeinsamer PGN-Leser trägt beide Fachprojektionen. Neue Datei-/Kanalports
und flüchtige V1-Modelle ändern weder bestehende Domainmodelle noch SQLite-Schema.

Vollsuite **1.357/1.357**; zusätzliche DE/EN-Tastatur-/Layoutfälle **6/6**.
Codec/SQLite **51/51**, Application **10/10**, Writer **11/11** und vier
Cancel-/Generationregressionen grün. Astra fand und behob die mehrstufige
SourcePath-Invariante; Early-Cancel-Cache, späte UI-Busy-Antwort und Dialoglayout
wurden mit gezielten Regressionen korrigiert. Schluss-Recheck ohne konkrete P1/P2.

Eigene native Manual-PGN-Profile sichern und restaurieren bytegleich. Nach
physischem Host-/Desktopneustart funktionieren RAV-Navigation, globale Notiz,
neue Ableitung und Hauptlinienrevision; Partieänderung bleibt gesperrt. Weiterer
Hostneustart erhält diese Bearbeitung. Konfiguration unverändert; alle eigenen
Prozesse beendet. Zwei Originalaufnahmen ergänzen das Manual DE/EN.

Der erste kombinierte Vollgate-Lauf endete nur wegen zweier Formatbefunde mit
Exit1. Nach Formatkorrektur und dem letzten Dialog-/Prüferdelta wurden Typen,
Lint und Format separat erneut geprüft. Kein neuer Vollsuitenlauf nach reinem
Dialoglayout nötig; dafür Browser- und native Abnahme auf endgültigem Layout.
Reader/Metadatenentfernung zusätzlich mit unabhängigem python-chess geprüft.
Keine weitere Architektur, Nutzerdatenänderung, Release, Commit oder Push.

Anschließend hat der Nutzer Commit und Push des geprüften Gesamtstands freigegeben;
eine neue Release ist damit nicht beauftragt.

Details, gemessene Budgetprobe und Grenzen:
[Verifikationsledger](verification/pgn-transfer-2026-10-12.json).
