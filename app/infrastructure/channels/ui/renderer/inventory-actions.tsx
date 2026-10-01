import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Tooltip,
  TooltipTrigger,
} from 'react-aria-components';
import styles from './inventory-actions.module.css';

export interface InventoryAction {
  id: string;
  label: string;
  icon: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

export function InventoryActions({
  actions,
  label,
  disabled = false,
}: {
  actions: readonly InventoryAction[];
  label: string;
  disabled?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const inline = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const focusWithin = useRef(false);
  const frame = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [tooltipContainer, setTooltipContainer] = useState<Element>();
  useEffect(() => {
    // Keep descriptions in the view landmark, outside the clipped list.
    setTooltipContainer(root.current?.closest('main') ?? undefined);
  }, []);
  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );
  useEffect(() => {
    function reflow() {
      const ownsFocus =
        root.current?.contains(document.activeElement) ||
        (focusWithin.current && document.activeElement === document.body);
      if ((!open && !ownsFocus) || inline.current === null) return;
      // CSS owns the breakpoint; only repair focus when its visible controls change.
      const expanded = getComputedStyle(inline.current).display !== 'none';
      if (
        expanded &&
        (open ||
          document.activeElement === trigger.current ||
          (ownsFocus && document.activeElement === document.body))
      ) {
        setOpen(false);
        if (frame.current !== undefined) cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() =>
          inline.current
            ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
            ?.focus(),
        );
      } else if (!expanded && ownsFocus) trigger.current?.focus();
    }
    window.addEventListener('resize', reflow);
    return () => {
      window.removeEventListener('resize', reflow);
    };
  }, [open]);
  if (actions.length === 0) return null;

  return (
    <div
      ref={root}
      className={styles.actions}
      role="group"
      aria-label={label}
      onFocusCapture={() => {
        focusWithin.current = true;
      }}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget !== null &&
          !event.currentTarget.contains(event.relatedTarget as Node)
        )
          focusWithin.current = false;
      }}
    >
      <div ref={inline} className={styles.inline}>
        {actions.map((action) => (
          <TooltipTrigger key={action.id}>
            <Button
              className={styles.iconButton!}
              aria-label={action.label}
              isDisabled={disabled || action.disabled === true}
              data-destructive={action.destructive || undefined}
              onPress={action.onPress}
            >
              <span className={styles.icon} aria-hidden="true">
                {action.icon}
              </span>
            </Button>
            <Tooltip
              className={styles.tooltip!}
              placement="top"
              {...(tooltipContainer === undefined
                ? {}
                : { UNSTABLE_portalContainer: tooltipContainer })}
            >
              {action.label}
            </Tooltip>
          </TooltipTrigger>
        ))}
      </div>
      <div className={styles.compact}>
        <MenuTrigger isOpen={open} onOpenChange={setOpen}>
          <Button
            ref={trigger}
            className={styles.iconButton!}
            aria-label={label}
            isDisabled={disabled || actions.every((action) => action.disabled)}
          >
            <MoreHorizontal size={18} aria-hidden="true" />
          </Button>
          <Popover
            className={styles.popover!}
            placement="bottom end"
            offset={4}
          >
            <Menu
              className={styles.menu!}
              aria-label={label}
              disabledKeys={actions
                .filter((action) => disabled || action.disabled)
                .map((action) => action.id)}
            >
              {actions.map((action) => (
                <MenuItem
                  key={action.id}
                  id={action.id}
                  textValue={action.label}
                  className={styles.menuItem!}
                  data-destructive={action.destructive || undefined}
                  onAction={() => {
                    setOpen(false);
                    if (!disabled && !action.disabled) action.onPress();
                  }}
                >
                  <span className={styles.icon} aria-hidden="true">
                    {action.icon}
                  </span>
                  <span className={styles.itemLabel}>{action.label}</span>
                </MenuItem>
              ))}
            </Menu>
          </Popover>
        </MenuTrigger>
      </div>
    </div>
  );
}
