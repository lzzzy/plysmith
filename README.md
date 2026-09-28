# Plysmith

Plysmith ist eine lokale Open-Source-Schachwerkstatt fuer eigene Analysen,
Partien, Eroeffnungsbibliotheken und Arbeitskontexte. Dies ist eine fruehe
Windows-Alpha: Benutzung und Rueckmeldungen helfen, sie zu stabilisieren.
Fehler sind moeglich; spaetere Alpha-Versionen muessen bestehende Daten und
Konfigurationen nicht automatisch lesen koennen. Vor wichtigen Arbeiten
eigene Daten bewusst sichern. Es gibt noch keine Backup-/Restore-Funktion.

## Installieren

Die lokale Alpha ist fuer Windows x64 gebaut. Fuer die Nutzung sind weder
Node.js noch pnpm oder ein Git-Checkout erforderlich. Ein bereitgestelltes
`Plysmith-*-win-x64-Setup.exe` aus den
[versionierten GitHub Releases](https://github.com/lzzzy/plysmith/releases)
herunterladen, installieren und Plysmith aus dem Startmenue
oeffnen. Vor Installation und Deinstallation Plysmith schliessen und mindestens
700 MiB freien Platz auf dem Ziellaufwerk bereithalten. Der Installer ist
derzeit **nicht digital signiert**; Windows kann
deshalb eine Warnung anzeigen. Nur ein Artefakt aus einer selbst geprueften
Quelle ausfuehren. Die zugehoerige `SHA256SUMS.txt` laesst sich mit
`Get-FileHash <Installer> -Algorithm SHA256` vergleichen.

Plysmith startet den lokalen Application Host mit und beendet ihn beim
Schliessen wieder. Es gibt keinen Systemdienst, Autostart, automatischen
Updater, Telemetrie- oder Crashupload. Der Standard-Datenordner ist
`%LOCALAPPDATA%\Plysmith`; er ist vom Installationsordner getrennt und bleibt
bei der normalen Deinstallation erhalten. Der Installer enthaelt keine
Schachengine und keine Modellgewichte. Zum Ausspielen oder fuer
Enginebewertungen muss eine kompatible UCI-Engine in den Einstellungen
explizit eingetragen werden. Verwaltung, eigene Analysen und Partien sind
auch ohne Engine moeglich.

Im installierten Datenordner liegen `configuration/` (Einstellungen),
`data/` (Bestand), `diagnostics/` (lokale Diagnose), `runtime/` (laufender
Host) und `desktop/profile/` (Electron-Profil und Sessiondaten). Die
Programmdateien bleiben im separaten Installationsordner. Fuer die
Entwicklung ist stattdessen die Repositorywurzel der Datenstamm; das
Entwicklungsprofil liegt im ignorierten `desktop/profile/` dieses
Checkouts. Entwicklungs- und Installationsprofil teilen weder Bestand noch
Sessiondaten. Bereits vorhandene Daten oder alte Electron-Profile werden
dabei weder verschoben noch geloescht.

Die Release-Beigaben `sbom.cdx.json`, `release-license-inventory.json`,
`THIRD_PARTY_NOTICES.txt` und `licenses.tar.gz` dokumentieren die gelieferten
Komponenten und Lizenznachweise. Das Inventar kennzeichnet seine
Abdeckungsgrenzen; es ist keine rechtliche Freigabe. Die Plysmith-Quellen
stehen unter [Apache-2.0](LICENSE).

## Rueckmeldung

Fehler und Ideen bitte ueber [GitHub Issues](https://github.com/lzzzy/plysmith/issues/new/choose)
melden. Bei Fehlern helfen die Plysmith-Version aus **Einstellungen >
Lokales System > Technische Details**, Windows-Version, erwartetes und tatsaechliches Verhalten
und konkrete Schritte zur Wiederholung. Screenshots sind hilfreich, koennen
aber eigene Partien, Notizen oder Dateipfade zeigen: vor dem Hochladen pruefen
und bei Bedarf unkenntlich machen.

Unter **Einstellungen > Diagnose** kann ein lokaler, redigierter
Diagnosebericht bewusst erzeugt und an einen selbst gewaehlten Ort gespeichert
werden. Plysmith sendet ihn nie automatisch. Auch diesen Bericht vor dem
Anhaengen pruefen. Datenbank, aktive Konfiguration, `.env`, Partien und
Notizen gehoeren nicht in oeffentliche Issues. Ein Bericht ist kein Backup.

## Entwicklung

Das Repository verwendet Node 24, pnpm 11 und TypeScript. `pnpm verify`
prueft die Anwendung; `pnpm build:alpha` baut unter Windows x64 den lokalen
Installer samt SBOM, Notices, Lizenzarchiv und Pruefsummen unter
`build/alpha-release/output`. Ein passender Versionstag baut auf GitHub einen
Release-Entwurf; dessen Veroeffentlichung erfolgt bewusst separat.
Fuer einen lokalen Vergleich startet `pnpm dev:host` den Entwicklungs-Host
und `pnpm dev:desktop` die daran angeschlossene Desktop-App. Die installierte
App wird unabhaengig ueber das Startmenue gestartet; die beiden Oberflaechen
duerfen gleichzeitig laufen. Der ignorierte Entwicklungsordner `desktop/`
und `%LOCALAPPDATA%\Plysmith\desktop\profile` zeigen, welches Electron-Profil
jeweils verwendet wird. Die produktiven Daten liegen getrennt daneben.
Der MCP-Kanal bleibt fuer Entwicklung und Integrationen im Repository, ist
aber nicht Teil des Alpha-Installers. Der Desktop spricht nur mit dem
gemeinsamen Application Host; fachliche Regeln liegen nicht in der Shell.
