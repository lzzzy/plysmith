# Importing the sample collection

You can follow the steps below with the [sample collection, `manual.pgn`](manual.pgn). Importing it creates six entries. In the next chapter, you will choose which material to work with further.

> Screenshots retain the real German UI. This text uses English controls; the German sample titles match the unchanged PGN. See the [language and notation note](README.en.md).

## Choosing the file

Open **Manage** and select **All inventory** at the top. In a newly set-up app, this area is still empty.

[![Empty All inventory before importing](screenshots/empty-inventory.png)](screenshots/empty-inventory.png)

Click **Import**, then **Choose PGN file**, and select `manual.pgn`. Plysmith reads the file and displays a preview. None of this content has been saved to your inventory yet.

## Checking the selection and names

For this example, leave all six chapters selected. Under **Destination folder**, create a new folder with the **Folder name** `Manual`. Replace the suggested **Name prefix** with `Manual - `, including the space after the hyphen. This gives the chapter "Italienische Eröffnung", for example, the full name "Manual - Italienische Eröffnung".

[![Manual PGN import preview with destination folder, name prefix and chapter selection](screenshots/import-preview.png)](screenshots/import-preview.png)

Explicitly choose **Game** for "Lehrpartie mit Matt". Leave the other five chapters as **Analysis**. The teaching game is a constructed example: we deliberately import its moves as an immutable example of play so we can later demonstrate the different ways of working with games and analyses.

The preview lists the number of half-moves and variations for each chapter. **Content review** opens the details of what is preserved, adjusted or omitted. An analysis without moves is also a valid entry, as "Grundstellung" and "Opposition" demonstrate.

## Completing the import

Check that six chapters are selected and there are no name conflicts. Click **Import selection**. Close the dialogue after the success message.

In **Manage**, you will now find the **Manual** folder. Expand it. It contains:

- Manual - Grundstellung
- Manual - Italienische Eröffnung
- Manual - Lehrpartie mit Matt
- Manual - Opposition
- Manual - Eröffnungsskizze
- Manual - Entwicklungsskizze

You now have five analyses and one game in your inventory. The chapters retain their order from the file when imported.

## Importing other PGN files

Plysmith imports local PGN files for standard chess. Download material from a website first; extract ZIP archives before importing. The [source catalogue](../import-sources.md) (in German) offers suggestions, download links and notes on the material.

For your own files, select the chapters you want to work on. Clear the checkboxes for the other entries. You can set the type per chapter or with **Type for all**. A result in the PGN file does not automatically determine the type.

A name conflict means the full name is already in use. Edit the chapter name or the shared prefix. You can also accept the suggested names. Names apply across the entire inventory, regardless of folder or type; changing only the letter case is not enough. You can replace unclear source titles with meaningful names at this stage.

Read any warnings before confirming that you have reviewed them. Chapters marked **Rejected** cannot be imported. If Plysmith reports that the selection is too large, select fewer chapters. For a file using an older character encoding, the app may offer **Read again as ISO-8859-1**; afterwards, check the names and accented characters in particular.

Plysmith may also reject source files that are too large, files with too many chapters, or individual chapters that are particularly extensive. If reading the file fails, use a smaller PGN file; reducing the selection in the preview only helps once the file has been read successfully.

The main line and variations are preserved. PGN comments and useful information such as players, opening or result are imported as editable notes; information at the same position is combined in one note. Technical clock, evaluation and graphical annotations, as well as evaluation symbols, are omitted. The content review explains these differences.

**Import selection** creates new entries in All inventory; existing entries are neither replaced nor merged. Importing again with different names creates additional entries. If you close the preview or restart Plysmith, the selection that has not yet been imported is discarded without changing the inventory.

[Back to overview](README.en.md). Next: [Reviewing and organising your inventory](02-inventory.en.md).
