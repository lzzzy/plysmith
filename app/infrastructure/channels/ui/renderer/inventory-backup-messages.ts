export const inventoryBackupMessages = {
  'de-DE': {
    'backup.title': 'Datensicherung',
    'backup.scope':
      'Gespeicherte Analysen, Partien, Ordner, Herkunft und allgemeine Notizen. Arbeitskontexte, Entwürfe und Einstellungen sind nicht enthalten.',
    'backup.create': 'Bestand sichern',
    'backup.chooseRestore': 'Sicherung auswählen',
    'backup.confirm': 'Bestand wiederherstellen',
    'backup.review': 'Wiederherstellung prüfen',
    'backup.fresh':
      'Wiederherstellung ist nur in einen frischen, leeren Bestand ohne Arbeitskontexte und Entwürfe möglich. Vorhandene Inhalte werden nicht gelöscht oder zusammengeführt.',
    'backup.blocked':
      'Dieser Bestand ist noch nicht für eine Wiederherstellung bereit.',
    'backup.blocker.stored_content':
      'Gespeicherte Inhalte oder Entwürfe sind vorhanden.',
    'backup.blocker.workspace_state': 'Arbeitsstände sind vorhanden.',
    'backup.blocker.live_session':
      'Eine Livepartie ist noch nicht abgeschlossen.',
    'backup.blocker.import_active':
      'Ein Import oder eine Importvorschau ist noch offen.',
    'backup.blocker.live_active': 'Eine Liveaufnahme ist noch aktiv.',
    'backup.blocker.playout_active': 'Ausspielen ist noch aktiv.',
    'backup.blocker.transfer_busy':
      'Eine Datensicherung oder Vorschau ist noch offen.',
    'backup.localDrafts':
      'Es sind noch lokale Inhaltsentwürfe offen. Bitte zuerst abschließen oder bewusst verwerfen.',
    'backup.checking': 'Ziel wird geprüft …',
    'backup.newFile':
      'Bitte einen neuen Dateinamen wählen. Bestehende Dateien werden nicht überschrieben.',
    'backup.busy': 'Datensicherung wird verarbeitet …',
    'backup.preparing': 'Sicherung wird geprüft …',
    'backup.publishing': 'Bestand wird wiederhergestellt …',
    'backup.created': 'Sicherung erstellt: {fileName}',
    'backup.restored': 'Bestand wiederhergestellt.',
    'backup.noOp':
      'Die Sicherung enthält keinen Bestand. Es wurde nichts geändert.',
    'backup.expires': 'Vorschau gültig bis {time}.',
    'backup.count.analyses': 'Analysen',
    'backup.count.games': 'Partien',
    'backup.count.folders': 'Ordner',
    'backup.count.provenanceRecords': 'Herkunftseinträge',
    'backup.count.contributions': 'Allgemeine Notizen',
    'inventory_transfer.invalid_backup':
      'Die Sicherung ist beschädigt oder unvollständig.',
    'inventory_transfer.unsupported_version':
      'Diese Sicherungsversion wird nicht unterstützt.',
    'inventory_transfer.restore_required':
      'Dies ist eine Plysmith-Sicherung. Bitte unter Einstellungen / Datensicherung in einen frischen, leeren Bestand wiederherstellen.',
    'inventory_transfer.target_not_empty':
      'Wiederherstellung erfordert einen frischen, leeren Bestand ohne Arbeitskontexte oder Entwürfe.',
    'inventory_transfer.transfer_busy':
      'Ein Transfer, Import, Ausspielen oder eine Liveaufnahme ist noch aktiv. Bitte zuerst abschließen.',
    'inventory_transfer.stale_preview':
      'Die Vorschau ist abgelaufen oder nicht mehr gültig. Bitte die Sicherung erneut auswählen.',
    'inventory_transfer.resource_exhausted':
      'Die Sicherung überschreitet eine unterstützte Größen- oder Komplexitätsgrenze.',
    'inventory_transfer.destination_exists':
      'Die Zieldatei existiert bereits. Bitte einen neuen Dateinamen wählen.',
    'inventory_transfer.file_write_failed':
      'Die Sicherung konnte nicht geschrieben werden. Bitte einen zugänglichen Zielordner wählen.',
    'inventory_transfer.file_read_failed':
      'Die Sicherung konnte nicht gelesen werden. Bitte eine zugängliche Datei wählen.',
    'inventory_transfer.interrupted':
      'Die Datensicherung wurde unterbrochen. Bitte erneut starten.',
    'inventory_transfer.invalid_request':
      'Bitte die Sicherung oder den Zielpfad erneut auswählen.',
  },
  'en-GB': {
    'backup.title': 'Data backup',
    'backup.scope':
      'Saved analyses, games, folders, provenance and general notes. Working contexts, drafts and settings are not included.',
    'backup.create': 'Back up inventory',
    'backup.chooseRestore': 'Choose backup',
    'backup.confirm': 'Restore inventory',
    'backup.review': 'Review restore',
    'backup.fresh':
      'Restore requires a fresh, empty inventory without working contexts or drafts. Existing content is never deleted or merged.',
    'backup.blocked': 'This inventory is not ready for a restore yet.',
    'backup.blocker.stored_content': 'Saved content or drafts are present.',
    'backup.blocker.workspace_state': 'Saved work state is present.',
    'backup.blocker.live_session': 'A live game has not finished yet.',
    'backup.blocker.import_active':
      'An import or import preview is still open.',
    'backup.blocker.live_active': 'A live recording is still active.',
    'backup.blocker.playout_active': 'A playout is still active.',
    'backup.blocker.transfer_busy': 'A backup or preview is still open.',
    'backup.localDrafts':
      'Local content drafts are still open. Finish them or explicitly discard them first.',
    'backup.checking': 'Checking destination …',
    'backup.newFile':
      'Choose a new file name. Existing files are never overwritten.',
    'backup.busy': 'Processing backup …',
    'backup.preparing': 'Checking backup …',
    'backup.publishing': 'Restoring inventory …',
    'backup.created': 'Backup created: {fileName}',
    'backup.restored': 'Inventory restored.',
    'backup.noOp': 'This backup contains no inventory. Nothing was changed.',
    'backup.expires': 'Preview valid until {time}.',
    'backup.count.analyses': 'Analyses',
    'backup.count.games': 'Games',
    'backup.count.folders': 'Folders',
    'backup.count.provenanceRecords': 'Provenance records',
    'backup.count.contributions': 'General notes',
    'inventory_transfer.invalid_backup': 'The backup is damaged or incomplete.',
    'inventory_transfer.unsupported_version':
      'This backup version is not supported.',
    'inventory_transfer.restore_required':
      'This is a Plysmith backup. Restore it into a fresh, empty inventory under Settings / Data backup.',
    'inventory_transfer.target_not_empty':
      'Restore requires a fresh, empty inventory without working contexts or drafts.',
    'inventory_transfer.transfer_busy':
      'A transfer, import, playout or live recording is still active. Finish it first.',
    'inventory_transfer.stale_preview':
      'The preview expired or is no longer valid. Choose the backup again.',
    'inventory_transfer.resource_exhausted':
      'The backup exceeds a supported size or complexity limit.',
    'inventory_transfer.destination_exists':
      'The destination already exists. Choose a new file name.',
    'inventory_transfer.file_write_failed':
      'The backup could not be written. Choose an accessible destination folder.',
    'inventory_transfer.file_read_failed':
      'The backup could not be read. Choose an accessible file.',
    'inventory_transfer.interrupted':
      'The transfer was interrupted. Start it again.',
    'inventory_transfer.invalid_request':
      'Choose the backup or destination again.',
  },
};
