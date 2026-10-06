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
  if (errorCode === 'live.stale_state') return 'error.revision';
  if (errorCode === 'live.illegal_move') return 'error.illegalMove';
  if (errorCode === 'live.not_playable') return 'live.browserOnly';
  if (errorCode === 'live.not_configured')
    return 'live.connection.unconfigured';
  if (errorCode === 'live.own_game') return 'live.fairPlay';
  if (errorCode === 'live.account_mismatch') return 'live.error.authentication';
  if (errorCode === 'live.authentication_failed')
    return 'live.error.authentication';
  if (errorCode === 'live.rate_limited') return 'live.error.rateLimited';
  if (errorCode === 'live.protocol_error') return 'live.error.protocol';
  if (errorCode === 'live.move_uncertain') return 'live.error.uncertain';
  if (errorCode === 'live.move_rejected') return 'live.error.rejected';
  if (
    errorCode === 'live.invalid_game' ||
    errorCode === 'live.unsupported_variant'
  )
    return 'live.error.game';
  if (errorCode.startsWith('configuration.live_'))
    return 'live.error.configuration';
  if (errorCode === 'live.fair_play_blocked') return 'live.fairPlay';
  if (errorCode.startsWith('live.')) return 'live.error.unavailable';
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
