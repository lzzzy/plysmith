# Plysmith Chess

Monochromer Schachfont · Regular · Version 1.000 · SIL Open Font License 1.1.
Zwölf Schachzeichen U+2654–U+265F, einheitliche Laufweite, offene Innenflächen bei Weiß.

## Erzeugen

ZIP vollständig in einen eigenen Ordner entpacken und `ERZEUGEN.cmd` ausführen.
Benötigt wird CPython 3.10–3.14 für Windows x64. Auch die Embedded-Ausgabe wird
unterstützt. Keine Systemfont-Installation und keine Administratorrechte nötig.

Ein bestimmter Interpreter lässt sich direkt angeben:

```bat
ERZEUGEN.cmd "C:\Pfad\zu\python.exe"
```

Alternativ:

```bat
python -I -S build.py
```

Der erste Aufruf lädt fontTools 4.63.0 und Brotli 1.2.0 von PyPI. Versionen und
SHA-256-Prüfsummen sind festgelegt. Die Werkzeuge werden ausschließlich in
`.build-cache/` neben diesem Skript abgelegt. Weder `pip` noch `venv` sind nötig;
die Python-Installation und ihre `._pth`-Datei bleiben unverändert. Für spätere
Aufrufe genügt der Werkzeugcache; mit `python -I -S build.py --offline` lässt
sich jeder Netzwerkzugriff unterbinden.

Bei gesperrtem Netzwerk müssen `pypi.org` und `files.pythonhosted.org` erreichbar
sein. Ein HTTPS-Proxy kann über `HTTPS_PROXY` angegeben werden. Bei Fehlern wird
kein neuer Ausgabeordner veröffentlicht; der Fehler erscheint im Terminal.

## Ergebnis

`dist/` enthält die einbaufertigen Assets:

```text
dist/
  PlysmithChess-Regular.ttf
  PlysmithChess-Regular.woff2
  OFL.txt
  Apache-2.0.txt
  README.md
  plysmith-chess.css
  font-ready.ts
  beispiel.html
  font.json
  SHA256SUMS.txt
```

Zusätzlich entsteht `Plysmith-Chess-1.000.zip` mit genau diesen Dateien.
Dieses ZIP weitergeben oder die benötigten Assets aus `dist/` in die Anwendung
übernehmen. Die Einbauanleitung liegt in `dist/README.md`. Python und die
Buildwerkzeuge werden nicht in die Anwendung eingebunden.

Die Erzeugung prüft TTF-Struktur, Zeichenbelegung, Lizenzmetadaten, Laufweiten,
WOFF2-Rückwandlung und die festgelegten Fontprüfsummen. Bereits erzeugte Dateien
prüfen: `python -I -S build.py --verify`.

## Lizenz

Font, Konturquellen, Fontkonfiguration und `build.py`: OFL-1.1; siehe `OFL.txt`.
Keine reservierten Fontnamen. Lizenztext und Copyright-Hinweis sind im Font
enthalten und zusätzlich mitzuliefern. Integration, Startskript,
Abhängigkeitslader und Tests: Apache-2.0; siehe `licenses/Apache-2.0.txt`.

Die heruntergeladenen Buildwerkzeuge behalten ihre jeweiligen Lizenztexte im
privaten Cache. Sie sind keine Bestandteile des erzeugten Font-Assets.
