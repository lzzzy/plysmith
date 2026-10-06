import {
  ArrowRight,
  ClipboardCheck,
  Minus,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useIntl } from 'react-intl';
import {
  InventoryActions,
  type InventoryAction,
} from './inventory-actions.tsx';
import type {
  InventoryItem,
  PlysmithApplicationState,
} from './plysmith-application-store.ts';

type ReadyState = Extract<PlysmithApplicationState, { phase: 'ready' }>;
export type InventoryItemCommand =
  'open' | 'rename' | 'include' | 'remove' | 'delete' | 'resolve';

export function InventoryItemActions({
  item,
  state,
  onCommand,
}: {
  readonly item: InventoryItem;
  readonly state: ReadyState;
  readonly onCommand: (
    item: InventoryItem,
    command: InventoryItemCommand,
  ) => void;
}) {
  const intl = useIntl();
  const contextId =
    state.scope.kind === 'context' ? state.scope.contextId : undefined;
  const member = contextId !== undefined && item.contextIds.includes(contextId);
  const pending =
    state.contextWorkspace?.pendingRevisionImpacts.some(
      (impact) => impact.itemId === item.itemId,
    ) === true;
  const actions: InventoryAction[] = [];
  function add(
    command: InventoryItemCommand,
    labelId: string,
    icon: React.ReactNode,
    destructive = false,
  ) {
    actions.push({
      id: command,
      label: intl.formatMessage({ id: labelId }),
      icon,
      onPress: () => onCommand(item, command),
      destructive,
    });
  }
  if (!state.fairPlayBlocked) {
    if (pending)
      add('resolve', 'revisionImpact.review', <ClipboardCheck size={16} />);
    else if (contextId === undefined || member)
      add('open', 'activity.analyze', <ArrowRight size={16} />);
    if (!pending) add('rename', 'inventory.rename', <Pencil size={16} />);
  }
  if (contextId !== undefined) {
    if (member)
      add('remove', 'manage.removeFromContext', <Minus size={16} />, true);
    else add('include', 'manage.useInContext', <Plus size={16} />);
  }
  add('delete', 'manage.deleteInventoryItem', <Trash2 size={16} />, true);
  return (
    <InventoryActions
      actions={actions}
      label={intl.formatMessage(
        { id: 'manage.actionsFor' },
        { name: item.displayName },
      )}
      disabled={state.busyCommand !== undefined || state.refreshing}
    />
  );
}
