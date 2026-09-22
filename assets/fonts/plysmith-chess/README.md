# Plysmith Chess

`Plysmith Chess` ist der kanonische, von Plysmith gebuendelte Figurensatz fuer
alle Brettoberflaechen. Die Anwendung verwendet ausschliesslich die lokale
WOFF2-Datei und mischt sie nicht mit System-, Emoji- oder anderen
Schachschriften.

## Laufzeit-Asset

- Datei:
  `app/infrastructure/channels/ui/assets/fonts/plysmith-chess/PlysmithChess-Regular.woff2`
- Familie: `Plysmith Chess`
- Version: `1.000`
- Zeichen: U+2654 bis U+265F sowie U+0020
- SHA-256:
  `8D8F68BD0489C446B1A6FEC9433157744E92CE51CEE13EC1C6D2A0BE8AB34332`

Die Anwendung laedt den Font vor dem ersten React-Render. Ein Ladefehler darf
daher nicht still zu einem plattformabhaengigen Systemfont fuehren.

## Quellen und Reproduktion

`source/` enthaelt die bearbeitbaren Konturen, Fontmetadaten, den
deterministischen Build, seine Tests und die Integrationsbeispiele. Generierte
Build-Caches, doppelte `dist/`-Artefakte und Ausgabe-ZIPs werden nicht im
Repository gefuehrt.

Der Font kann aus `source/` mit einem kompatiblen CPython neu erzeugt werden:

```text
python -I -S build.py
```

Das dabei entstehende WOFF2-Artefakt wird nach erfolgreicher Verifikation an
den oben genannten Laufzeitpfad uebernommen.

Die festgelegten Versionen und Pruefsummen der Buildwerkzeuge stehen in
`source/build.lock.json` und `source/tools/dependencies.lock.json`. Der Build
prueft Struktur, Zeichenbelegung, Metriken, Lizenzmetadaten und die erwarteten
Fontpruefsummen.

Das vom Projekteigentuemer bereitgestellte vollstaendige Quellpaket
`Plysmith-Chess-Quellen-korrigiert.zip` hatte beim Einbau SHA-256
`630987A864BCF496400C4FC61EAC1143BBE164D6F655842ACF883223FABB00BF`.

## Provenienz

Nach Angabe des Projekteigentuemers entstand der Font in einer dialogischen
Gestaltung mit ChatGPT/OpenAI unter sprachlicher Steuerung des Nutzers. Auswahl,
Korrekturen und die abschliessende visuelle Freigabe fuer Plysmith erfolgten
durch den Nutzer. Eine sachliche Herkunftsangabe lautet:

> AI-assisted chess font design created with ChatGPT / OpenAI under user art
> direction.

Diese Dokumentation behauptet keine ungepruefte ausschliessliche
urheberrechtliche Schutzposition und keine Einzigartigkeit des Ergebnisses.

## Lizenz

Fontdatei, Konturquellen, Fontkonfiguration und Font-Build stehen unter der
SIL Open Font License 1.1 ohne Reserved Font Names. Der vollstaendige Text liegt
in `source/OFL.txt` und zusaetzlich repositoryweit in
`licenses/PlysmithChess-OFL.txt`.

Integrationsbeispiele, Hilfswerkzeuge und Tests im Quellpaket tragen ihre
Apache-2.0-Hinweise. Der Plysmith-Anwendungscode und seine konkrete
Fontintegration bleiben unter der Apache License 2.0. Die OFL-Lizenz der
Fontsoftware wird dadurch nicht geaendert.
