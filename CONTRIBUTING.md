# Zu Plysmith beitragen

[Deutsch](CONTRIBUTING.md) | [English](CONTRIBUTING.en.md)

Danke für Ihr Interesse. Fehlerberichte, Ideen, Korrekturen der Dokumentation,
Übersetzungen, Tests und Code sind willkommen. Plysmith ist eine frühe
Windows-Alpha; ein Vorschlag ist noch keine Zusage für eine bestimmte Release.

## Austausch

Melden Sie Fehler und schlagen Sie Funktionen über
[GitHub Issues](https://github.com/lzzzy/plysmith/issues/new/choose) vor.
Deutsch und Englisch sind willkommen. Besprechen Sie größere Änderungen zuerst
in einem Issue, damit Ziel und Umfang klar sind. Kleine, nachvollziehbare
Korrekturen können Sie direkt als Pull Request einreichen. Veröffentlichen Sie
keine Zugangsdaten, privaten Partien, Datenbanken oder unbearbeiteten Logs.

## Lokal entwickeln

Die Entwicklung und der Installer-Build sind derzeit für Windows x64
eingerichtet. Sie benötigen Git sowie die in `package.json` unter `engines.node`
und `packageManager` angegebenen Versionen von Node.js und pnpm. Nach dem
Klonen des Repositories:

```powershell
pnpm install --frozen-lockfile
```

Die Skriptstarts prüfen die Abhängigkeiten, installieren aber nichts automatisch.
Nach Änderungen an den Paketdateien kann erneut `pnpm install --frozen-lockfile`
erforderlich sein. Erscheint eine Aufforderung, `node_modules` vollständig neu
anzulegen, brechen Sie zunächst ab: Ein abweichender pnpm-Store kann die Ursache
sein. Vergleichen Sie `pnpm config get storeDir` mit `storeDir` in
`node_modules/.modules.yaml`. Ergänzen Sie beim Installieren die Option
`--store-dir "<bisheriger Store-Stammpfad>"`, um den bisherigen Store ohne Änderung
der globalen Konfiguration zu verwenden. Den Versionsunterordner wie `v11` nicht
mit angeben.

Starten Sie Host und Desktop in zwei getrennten Terminals im Repository:

```powershell
pnpm dev:host
```

```powershell
pnpm dev:desktop
```

Entwicklung und installierte App verwenden getrennte Datenprofile. Stockfish
und Maia sind optional und werden nicht mitgeliefert. Für die meisten
Codeänderungen benötigen Sie keinen Installer-Build.

## Änderungen prüfen

Der Anwendungscode liegt in `app/domain`, `app/application`,
`app/infrastructure` und `app/bootstrap`. Fachliche Regeln gehören nicht in
UI- oder Speicheradapter. Halten Sie Änderungen eng am Anwendungsfall und
ergänzen Sie passende Tests für Verhalten und wichtige Fehlerfälle.
Generierte Verträge unter `contracts/host` nicht von Hand ändern: Ändern Sie
die Quelle und führen Sie bei Vertragsänderungen `pnpm generate` aus.

Prüfen Sie vor einem Pull Request:

```powershell
pnpm verify
```

Der Windows-Installer samt Release-Beigaben lässt sich bei Bedarf mit
`pnpm build:alpha` unter `build/alpha-release/output` bauen. Eine normale
Beitragsänderung braucht keinen Versionstag und keinen Release-Build.

## Pull Request

Beschreiben Sie Zweck und sichtbare Änderung, verlinken Sie ein passendes
Issue und nennen Sie die ausgeführten Tests. Bei UI-Änderungen hilft ein
Screenshot; prüfen Sie ihn vorher auf private Inhalte. Die CI prüft Pull
Requests, ersetzt aber keine eigene Prüfung. Versionierung, Tag und
Veröffentlichung übernehmen die Maintainer.

Der Anwendungscode steht unter [Apache-2.0](LICENSE). Für den Schachfont und
seine Quellen gilt die [SIL Open Font License 1.1](licenses/PlysmithChess-OFL.txt).
