# Plysmith-Branding

Dieser Ordner enthält die kanonische Auswahl aus dem am 11. September 2026 vom
Projekteigentümer bereitgestellten Paket `Plysmith_Logo.zip`.

SHA-256 des Quellpakets:
`6b9f5401cd9407a6f7ab1eaf71904283c2066e38071f5b05b02554681ebbd04e`

## Gestaltungsvertrag

- Die schwarze Version ist die Primärmarke auf hellen Flächen.
- Die weiße Version ist ihre Inversion für dunkle Flächen.
- Das Zeichen bleibt monochrom und transparent. Es erhält weder Kachel noch
  Rahmen, Schatten, Verlauf oder zusätzliche Effekte.
- Die empfohlene Mindestgröße beträgt 24 Pixel; für Fenstertitel und kompakte
  UI-Flächen sind 32 Pixel vorgesehen.
- Wenn möglich, bleibt rund um das Zeichen mindestens 12,5 Prozent seiner
  Breite frei.

## Struktur und Verwendung

- `source/plysmith-icon-symbolic.svg` ist die farbneutrale, über
  `currentColor` steuerbare Mastergeometrie.
- `source/plysmith-icon-black.svg` und `plysmith-icon-white.svg` sind die
  freigegebenen festen Farbvarianten.
- `source/plysmith-wordmark-black.svg` und `plysmith-wordmark-white.svg`
  bewahren die fontunabhängige Wortmarke. Sie werden derzeit nicht in den
  Desktop-Build kopiert.
- `public/branding/plysmith-icon-{black|white}-{32|64|256}.png` sind die
  Rastervarianten für UI und spätere Packaging-Schritte.
- `public/branding/plysmith-icon-{black|white}.ico` sind die Windows-Icons.
  Das Desktop-Fenster verwendet die schwarze Primärvariante.
- `public/branding/favicon.ico` ist das dafür erzeugte Web-Favicon.

Die dunkle Sidebar verwendet das weiße Icon mit einer 64-Pixel-Quelle für
hochauflösende Displays. Die Wortmarke wird dort als Text gesetzt; dadurch
bleibt sie scharf, zugänglich und lokalisierungsunabhängig.

## Provenienz

Das Logo entstand laut Quellpaket in einer iterativen Gestaltungssitzung mit
ChatGPT/OpenAI-Bildgenerierung unter konkreter gestalterischer Steuerung des
Nutzers. Auswahl und finale Designentscheidungen wurden vom Nutzer vorgegeben
oder freigegeben. Eine passende sachliche Herkunftsangabe lautet:

> AI-assisted logo design created with ChatGPT / OpenAI image generation
> under user art direction.

Die am 11. September 2026 geprüften
[OpenAI-Nutzungsbedingungen für Europa](https://openai.com/de-DE/policies/terms-of-use/)
ordnen im Verhältnis zwischen Nutzer und OpenAI und soweit gesetzlich zulässig
den Output dem Nutzer zu und übertragen etwaige OpenAI-Rechte daran. Sie weisen
zugleich darauf hin, dass Output nicht einzigartig sein muss.

## Urheberrecht, Lizenz und Marke

Ob und in welchem Umfang ein KI-unterstütztes Ergebnis urheberrechtlich
geschützt ist, hängt vom anwendbaren Recht und den konkreten menschlichen
Beiträgen ab. Nach
[§ 2 Abs. 2 UrhG](https://www.gesetze-im-internet.de/urhg/__2.html)
sind Werke im deutschen Urheberrecht nur persönliche geistige Schöpfungen.
Diese Dokumentation behauptet deshalb weder OpenAI als Urheber noch eine
ungeprüfte ausschließliche Schutzposition.

Soweit an den Branding-Dateien urheberrechtliche Rechte bestehen und dem
Projekteigentümer zustehen, werden sie als Bestandteil dieses Repositorys
unter der Apache-Lizenz 2.0 bereitgestellt. Dies gewährt keine Markenrechte:
Abschnitt 6 der Apache-Lizenz nimmt Handelsnamen, Marken, Dienstleistungsmarken
und Produktnamen ausdrücklich von der Rechteeinräumung aus. Eine
markenrechtliche Kollisionsfreiheit oder Eintragungsfähigkeit des Zeichens ist
nicht geprüft.
