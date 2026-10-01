import { AlertTriangle } from 'lucide-react';
import { FormattedMessage } from 'react-intl';

export function ErrorNotice({
  errorCode,
  className,
}: {
  readonly errorCode: string;
  readonly className?: string | undefined;
}) {
  return (
    <div className={className} role="alert">
      <AlertTriangle aria-hidden="true" size={16} />
      <FormattedMessage id={errorMessageId(errorCode)} />
    </div>
  );
}

function errorMessageId(errorCode: string): string {
  if (errorCode === 'inventory.display_name_conflict')
    return 'error.inventoryNameConflict';
  if (errorCode === 'chess.invalid_fen') return 'error.invalidFen';
  if (errorCode === 'chess.illegal_move') return 'error.illegalMove';
  if (errorCode === 'chess.invalid_move_input') return 'error.invalidMove';
  if (errorCode === 'workspace.context_version_conflict')
    return 'error.contextChanged';
  if (errorCode === 'workspace.inventory_work_not_allowed')
    return 'error.workOutsideContext';
  if (errorCode.endsWith('revision_conflict')) return 'error.revision';
  if (errorCode === 'workspace.reference_exists')
    return 'error.referenceExists';
  if (errorCode === 'playout.provider_timeout') return 'error.engineTimeout';
  if (
    errorCode.startsWith('playout.provider_') ||
    errorCode === 'playout.move_policy_unavailable' ||
    errorCode === 'playout.capability_missing' ||
    errorCode === 'playout.illegal_engine_move'
  )
    return 'error.engine';
  if (errorCode === 'host.unavailable') return 'error.unavailable';
  return 'error.generic';
}
