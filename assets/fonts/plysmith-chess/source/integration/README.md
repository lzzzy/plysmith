# Plysmith Chess

**Regular · Version 1.000 · SIL Open Font License 1.1**

## Einbindung

TTF und WOFF2 sind zwei Ausgabeformate derselben Schrift. Für eine Web- oder
Electron-Oberfläche bevorzugt `PlysmithChess-Regular.woff2` laden; TTF ist die
Alternative. `plysmith-chess.css` enthält die vollständige Fontdefinition und
die Klasse `.plysmithPieceGlyph`. Die Dateipfade gelten für eine CSS-Datei neben
den beiden Schriftdateien und können an den Assetpfad angepasst werden.

```html
<span class="plysmithPieceGlyph" aria-hidden="true">♘</span>
```

Der umgebende Feld- oder Schaltflächencontainer trägt den zugänglichen
Figurennamen. Textdarstellung verwenden; keine Umwandlung in einzelne Grafiken
und keine zusätzliche figurspezifische Grundlinienkorrektur erforderlich.

`font-ready.ts` enthält eine Ladefunktion für Browser und Electron. Erst nach
erfolgreichem Laden die Figuren anzeigen. Bei Ladefehler den gesamten Satz
sichtbar als Fehler behandeln oder explizit auf einen anderen vollständigen
Satz wechseln. Eine stille Mischung mit System- oder Emoji-Schriften vermeiden.

Es gibt keine Voraussetzung einer Systemfont-Installation. Die Anwendung
lädt ihre eigenen Dateien auf allen Plattformen. Font-Ladewege und Content
Security Policy müssen gebündelte Schriftdateien erlauben.

## Layout

- Familie `Plysmith Chess`, Gewicht `400`, Stil `normal`, `line-height: 1`.
- `font-synthesis: none`, `font-kerning: none`, `font-variant-emoji: text`.
- Units per em: 1000. Laufweite aller Zeichen: 1250 Einheiten.
- Ascent: 1000. Descent: −250. Line gap: 0.
- Auf dem Brett: Schriftgröße etwa 80 % der Feldbreite. Bei einem Brett als
  CSS-Größencontainer entspricht das `10cqi`. Eine unveränderte 1000×1000-Skala
  der Konturquellen wird so auf die Feldfläche abgebildet.
- Weiß ist konturiert mit transparenten Innenräumen, nicht weiß gefüllt.
- Passende Feldfarben: hell `#e7e3d9`, dunkel `#919eae`; Figuren `#151a20`.
- Optional einmal am Figurenwrapper:
  `filter: drop-shadow(0 1px 0 rgb(255 255 255 / 38%))`.

`beispiel.html` zeigt den Font mit denselben Parametern. Sie benötigt die
Schriftdateien und `plysmith-chess.css` im selben Verzeichnis.

## Zeichenbelegung

| Figur | Weiß | Schwarz |
|---|---|---|
| König | ♔ U+2654 | ♚ U+265A |
| Dame | ♕ U+2655 | ♛ U+265B |
| Turm | ♖ U+2656 | ♜ U+265C |
| Läufer | ♗ U+2657 | ♝ U+265D |
| Springer | ♘ U+2658 | ♞ U+265E |
| Bauer | ♙ U+2659 | ♟ U+265F |

Zusätzlich sind U+0020 und `.notdef` vorhanden. Der Font ist keine allgemeine
Textschrift. Keine Private-Use-Zeichen oder Farbfont-Unterstützung erforderlich.

## Lizenz und Weitergabe

Font: **SIL Open Font License 1.1**, vollständiger Text in `OFL.txt` und im Font.
Keine Reserved Font Names. `OS/2.fsType = 0`. Der Font darf unter den Bedingungen
der OFL in kommerziellen und proprietären Anwendungen gebündelt und eingebettet
werden. `OFL.txt` und Copyright-Hinweis bei der Weitergabe beibehalten.

CSS, TypeScript und HTML dieser Integration: **Apache License 2.0**;
`Apache-2.0.txt` und ihre vorhandenen Copyright-Hinweise bei Weitergabe dieser
Dateien beibehalten. Die Fontlizenz bleibt davon unberührt.

`font.json` enthält die technischen Daten und SHA-256-Werte der Fonts.
`SHA256SUMS.txt` enthält die Prüfsummen sämtlicher Ausgabedateien außer sich selbst.
