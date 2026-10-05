export const importMessages = {
  'de-DE': {
    'import.severity.info': 'Information',
    'import.severity.warning': 'Warnung',
    'import.severity.error': 'Fehler',
    'import.pgn_draw_offer_unsupported':
      'Ein Remisangebot wird nicht übernommen.',
    'import.pgn_text_normalized':
      'Leerraum und Zeilenenden wurden normalisiert.',
    'import.pgn_san_normalized': 'Die Zugnotation wurde normalisiert.',
    'import.pgn_directives_omitted':
      'Technische Angaben zu Markierungen, Bewertungen und Uhren werden nicht übernommen.',
    'import.pgn_nags_omitted': 'Bewertungszeichen werden nicht übernommen.',
    'import.pgn_rav_preserved': 'Nebenvarianten sind erhalten.',
    'import.pgn_unclosed_comment': 'Ein Kommentar ist nicht geschlossen.',
    'import.pgn_misplaced_header':
      'Ein Tag steht an einer ungültigen Position.',
    'import.pgn_invalid_header': 'Ein Quell-Tag ist ungültig.',
    'import.pgn_duplicate_header': 'Ein Quell-Tag kommt mehrfach vor.',
    'import.pgn_duplicate_fen_normalized':
      'Identische Angaben zur Ausgangsstellung wurden zusammengeführt.',
    'import.pgn_unbalanced_rav': 'Die Variantenklammern sind unausgeglichen.',
    'import.pgn_variation_result_unsupported':
      'Eine Ergebnisangabe innerhalb einer Variante wird nicht unterstützt.',
    'chessTree.variation': 'Variante',
    'import.title': 'PGN importieren',
    'import.open': 'Import',
    'import.choose': 'PGN-Datei auswählen',
    'import.file': 'Datei',
    'import.folder': 'Zielordner',
    'import.newFolder': 'Neuen Ordner anlegen',
    'import.folderName': 'Ordnername',
    'import.prefix': 'Namenspräfix',
    'import.checkingNames': 'Namen werden geprüft',
    'import.nameLength':
      'Der vollständige Name muss 1 bis 160 Zeichen enthalten.',
    'import.shortenPrefix':
      'Bitte den Präfix kürzen oder die betroffenen Namen bearbeiten.',
    'import.not_found':
      'Die Vorschau ist nicht mehr verfügbar. Bitte die Datei erneut auswählen.',
    'import.name_conflict':
      'Ein Name ist bereits vergeben. Bitte die Namen prüfen oder den Präfix ändern.',
    'import.invalid_selection': 'Die Auswahl ist ungültig.',
    'import.warning_confirmation_required':
      'Bitte die Warnungen der ausgewählten Inhalte prüfen.',
    'import.preparation_busy':
      'Es werden bereits zu viele Dateien eingelesen. Bitte kurz warten.',
    'import.preparing': 'Wird vorbereitet …',
    'import.choosing': 'Datei wird ausgewählt …',
    'import.publishing': 'Auswahl wird gespeichert …',
    'import.selectedMoves':
      '{moves, plural, one {# Halbzug einschließlich Varianten} other {# Halbzüge einschließlich Varianten}}',
    'import.selectWithinBudget':
      'Die gesamte Datei überschreitet die Grenzen für einen Import. Noch keine Kapitel ausgewählt.',
    'import.selectionOverBudget':
      'Die Auswahl überschreitet die Importgrenzen. Bitte weniger Kapitel auswählen.',
    'import.pgn_resource_limit':
      'Dieses Kapitel überschreitet die zulässige Größe oder Komplexität und kann nicht importiert werden.',
    'import.ready': 'Bereit',
    'import.warning': 'Warnung',
    'import.rejected': 'Abgelehnt',
    'import.counts':
      '{selected} von {total} ausgewählt · {conflicts} Namenskonflikte · {warnings} Warnungen',
    'import.selectAll': 'Alle gültigen Kandidaten auswählen',
    'import.clearSelection': 'Alle abwählen',
    'import.bulkType': 'Typ für alle',
    'import.type': 'Typ',
    'import.names': 'Namensvorschläge für alle übernehmen',
    'import.name': 'Name',
    'import.select': '„{name}“ auswählen',
    'import.conflict': 'Name bereits vergeben',
    'import.suggestion': 'Vorschlag: {name}',
    'import.moves':
      '{moves, plural, one {# Halbzug} other {# Halbzüge}} · {variations, plural, one {# Variante} other {# Varianten}}',
    'import.findings': 'Inhaltsprüfung ({count})',
    'import.preserved': 'Erhalten',
    'import.normalized': 'Normalisiert',
    'import.preserved_opaque': 'Uninterpretiert erhalten',
    'import.unsupported': 'Nicht unterstützt',
    'import.invalid': 'Ungültig',
    'import.node': 'Zugknoten {index}',
    'import.confirmWarnings':
      'Ich habe die Warnungen der ausgewählten Kandidaten geprüft.',
    'import.publish': 'Auswahl importieren',
    'import.cancel': 'Import abbrechen',
    'import.close': 'Schließen',
    'import.previous': 'Vorherige Seite',
    'import.next': 'Nächste Seite',
    'import.page': '{from}–{to} von {total}',
    'import.latin1': 'Erneut als ISO-8859-1 einlesen',
    'import.published': '{count} Objekte importiert',
    'import.encoding_choice_required':
      'Die Datei ist kein gültiges UTF-8. ISO-8859-1 muss ausdrücklich gewählt werden.',
    'import.encoding_unsupported':
      'Die Zeichenkodierung der Datei ist ungültig oder wird nicht unterstützt.',
    'import.input_not_found': 'Die gewählte Datei ist nicht mehr verfügbar.',
    'import.input_changed': 'Die Datei wurde während des Imports verändert.',
    'import.input_too_large': 'Die Datei überschreitet die zulässige Größe.',
    'import.format_not_recognized': 'Kein unterstütztes Format erkannt.',
    'import.provider_resource_exhausted':
      'Der Import überschreitet die zulässigen Ressourcengrenzen.',
    'import.interrupted':
      'Die Vorbereitung wurde unterbrochen. Bitte die Datei erneut auswählen.',
    'import.pgn_variant_unsupported':
      'Diese Schachvariante wird nicht unterstützt.',
    'import.pgn_invalid_setup':
      'SetUp und FEN widersprechen sich oder sind unvollständig.',
    'import.pgn_invalid_fen': 'Die Ausgangsstellung ist ungültig.',
    'import.pgn_invalid_result': 'Das Ergebnis-Tag ist ungültig.',
    'import.pgn_result_mismatch':
      'Ergebnis-Tag und Abschlussmarkierung widersprechen sich.',
    'import.pgn_result_missing': 'Die Abschlussmarkierung fehlt.',
    'import.pgn_fen_normalized': 'Die Ausgangsstellung wurde normalisiert.',
    'import.pgn_invalid_syntax': 'Die PGN-Syntax ist ungültig.',
    'import.pgn_parser_diagnostic':
      'Der PGN-Parser meldet einen Strukturfehler.',
    'import.pgn_empty_candidate': 'Kein gültiger PGN-Inhalt vorhanden.',
    'import.pgn_comment_fidelity':
      'Kommentare können nicht verlustfrei zugeordnet werden.',
    'import.pgn_illegal_san': 'Ein Zug ist in seiner Stellung nicht legal.',
    'import.pgn_invalid_nag': 'Eine Zugbewertung ist ungültig.',
    'import.pgn_tree_preserved': 'Hauptpfad und Varianten sind erhalten.',
    'import.pgn_comments_preserved':
      'Kommentare sind als bearbeitbare Notizen übernommen.',
    'import.pgn_encoding_normalized':
      'Die Zeichenkodierung wurde normalisiert.',
  },
  'en-GB': {
    'import.severity.info': 'Information',
    'import.severity.warning': 'Warning',
    'import.severity.error': 'Error',
    'import.pgn_draw_offer_unsupported': 'A draw offer is not imported.',
    'import.pgn_text_normalized':
      'Whitespace and line endings were normalised.',
    'import.pgn_san_normalized': 'Move notation was normalised.',
    'import.pgn_directives_omitted':
      'Technical marking, evaluation and clock annotations are not imported.',
    'import.pgn_nags_omitted': 'Evaluation symbols are not imported.',
    'import.pgn_rav_preserved': 'Variations are preserved.',
    'import.pgn_unclosed_comment': 'A comment is not closed.',
    'import.pgn_misplaced_header': 'A tag appears in an invalid position.',
    'import.pgn_invalid_header': 'A source tag is invalid.',
    'import.pgn_duplicate_header': 'A source tag occurs more than once.',
    'import.pgn_duplicate_fen_normalized':
      'Identical starting-position tags were combined.',
    'import.pgn_unbalanced_rav': 'Variation brackets are unbalanced.',
    'import.pgn_variation_result_unsupported':
      'A result inside a variation is unsupported.',
    'chessTree.variation': 'Variation',
    'import.title': 'Import PGN',
    'import.open': 'Import',
    'import.choose': 'Choose PGN file',
    'import.file': 'File',
    'import.folder': 'Destination folder',
    'import.newFolder': 'Create new folder',
    'import.folderName': 'Folder name',
    'import.prefix': 'Name prefix',
    'import.checkingNames': 'Checking names',
    'import.nameLength': 'The complete name must contain 1 to 160 characters.',
    'import.shortenPrefix':
      'Please shorten the prefix or edit the affected names.',
    'import.not_found':
      'The preview is no longer available. Please select the file again.',
    'import.name_conflict':
      'A name is already in use. Please check the names or change the prefix.',
    'import.invalid_selection': 'The selection is invalid.',
    'import.warning_confirmation_required':
      'Please review the warnings for the selected entries.',
    'import.preparation_busy':
      'Too many files are being read. Please wait briefly.',
    'import.preparing': 'Preparing …',
    'import.choosing': 'Choosing file …',
    'import.publishing': 'Saving selection …',
    'import.selectedMoves':
      '{moves, plural, one {# half-move including variations} other {# half-moves including variations}}',
    'import.selectWithinBudget':
      'The complete file exceeds the limits for one import. No chapters selected yet.',
    'import.selectionOverBudget':
      'The selection exceeds the import limits. Please select fewer chapters.',
    'import.pgn_resource_limit':
      'This chapter exceeds the allowed size or complexity and cannot be imported.',
    'import.ready': 'Ready',
    'import.warning': 'Warning',
    'import.rejected': 'Rejected',
    'import.counts':
      '{selected} of {total} selected · {conflicts} name conflicts · {warnings} warnings',
    'import.selectAll': 'Select all valid candidates',
    'import.clearSelection': 'Deselect all',
    'import.bulkType': 'Type for all',
    'import.type': 'Type',
    'import.names': 'Apply name suggestions to all',
    'import.name': 'Name',
    'import.select': 'Select “{name}”',
    'import.conflict': 'Name already in use',
    'import.suggestion': 'Suggestion: {name}',
    'import.moves':
      '{moves, plural, one {# half-move} other {# half-moves}} · {variations, plural, one {# variation} other {# variations}}',
    'import.findings': 'Content review ({count})',
    'import.preserved': 'Preserved',
    'import.normalized': 'Normalised',
    'import.preserved_opaque': 'Preserved without interpretation',
    'import.unsupported': 'Unsupported',
    'import.invalid': 'Invalid',
    'import.node': 'Move node {index}',
    'import.confirmWarnings':
      'I have reviewed the warnings for the selected candidates.',
    'import.publish': 'Import selection',
    'import.cancel': 'Cancel import',
    'import.close': 'Close',
    'import.previous': 'Previous page',
    'import.next': 'Next page',
    'import.page': '{from}–{to} of {total}',
    'import.latin1': 'Read again as ISO-8859-1',
    'import.published': '{count} items imported',
    'import.encoding_choice_required':
      'The file is not valid UTF-8. ISO-8859-1 must be explicitly selected.',
    'import.encoding_unsupported':
      'The file has an invalid or unsupported character encoding.',
    'import.input_not_found': 'The selected file is no longer available.',
    'import.input_changed': 'The file changed during import.',
    'import.input_too_large': 'The file exceeds the size limit.',
    'import.format_not_recognized': 'No supported format recognised.',
    'import.provider_resource_exhausted':
      'The import exceeds the resource limits.',
    'import.interrupted':
      'Preparation was interrupted. Please select the file again.',
    'import.pgn_variant_unsupported': 'This chess variant is unsupported.',
    'import.pgn_invalid_setup': 'SetUp and FEN are inconsistent or incomplete.',
    'import.pgn_invalid_fen': 'The starting position is invalid.',
    'import.pgn_invalid_result': 'The result tag is invalid.',
    'import.pgn_result_mismatch':
      'The result tag and termination marker disagree.',
    'import.pgn_result_missing': 'The termination marker is missing.',
    'import.pgn_fen_normalized': 'The starting position was normalised.',
    'import.pgn_invalid_syntax': 'The PGN syntax is invalid.',
    'import.pgn_parser_diagnostic':
      'The PGN parser reports a structural error.',
    'import.pgn_empty_candidate': 'No valid PGN content found.',
    'import.pgn_comment_fidelity': 'Comments cannot be assigned without loss.',
    'import.pgn_illegal_san': 'A move is illegal in its position.',
    'import.pgn_invalid_nag': 'A move annotation is invalid.',
    'import.pgn_tree_preserved': 'The main line and variations are preserved.',
    'import.pgn_comments_preserved':
      'Comments were imported as editable notes.',
    'import.pgn_encoding_normalized': 'The character encoding was normalised.',
  },
} as const;
