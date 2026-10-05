import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { GripHorizontal } from 'lucide-react';
import { useIntl } from 'react-intl';
import styles from './analysis-panel-layout.module.css';

const storageKey = 'Plysmith.analysisPanelShare';
const defaultShare = 0.55;
const minimumMoveHeight = 180;
const minimumEngineHeight = 240;
const dividerHeight = 18;

function readShare(): number {
  try {
    const value = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(value) && value >= 0.2 && value <= 0.8
      ? value
      : defaultShare;
  } catch {
    return defaultShare;
  }
}

export function AnalysisPanelLayout({
  children,
  engine,
}: {
  readonly children: ReactNode;
  readonly engine?: ReactNode;
}) {
  const intl = useIntl();
  const id = useId();
  const layoutRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    startY: number;
    share: number;
  } | null>(null);
  const [share, setShare] = useState(readShare);
  const shareRef = useRef(share);
  const [height, setHeight] = useState(600);
  const availableHeight = Math.max(
    minimumMoveHeight + minimumEngineHeight,
    height - dividerHeight,
  );
  const minimum = Math.max(0.2, minimumMoveHeight / availableHeight);
  const maximum = Math.min(0.8, 1 - minimumEngineHeight / availableHeight);
  const effectiveShare = Math.max(minimum, Math.min(maximum, share));
  const hasEngine = engine !== undefined && engine !== false && engine !== null;

  useEffect(() => {
    const layout = layoutRef.current;
    if (!layout || !hasEngine) return;
    const observer = new ResizeObserver(() => setHeight(layout.clientHeight));
    observer.observe(layout);
    return () => observer.disconnect();
  }, [hasEngine]);

  function update(value: number, persist = false) {
    const next = Math.max(minimum, Math.min(maximum, value));
    shareRef.current = next;
    setShare(next);
    if (persist) {
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        // Resizing remains available if the desktop profile cannot save it.
      }
    }
  }

  function cancelDrag() {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    shareRef.current = current.share;
    setShare(current.share);
    if (dividerRef.current?.hasPointerCapture(current.pointerId))
      dividerRef.current.releasePointerCapture(current.pointerId);
  }

  const label = intl.formatMessage({ id: 'analysis.resizePanels' });
  return (
    <div
      ref={layoutRef}
      className={`${styles.layout!} ${hasEngine ? styles.split : ''}`}
      data-analysis-layout=""
      style={
        hasEngine
          ? {
              gridTemplateRows: `${effectiveShare * availableHeight}px ${dividerHeight}px minmax(0, 1fr)`,
            }
          : undefined
      }
    >
      <div className={styles.pane} id={`${id}-moves`}>
        {children}
      </div>
      {hasEngine && (
        <>
          <div
            ref={dividerRef}
            className={styles.divider}
            role="separator"
            tabIndex={0}
            aria-label={label}
            title={label}
            aria-orientation="horizontal"
            aria-controls={`${id}-moves ${id}-engine`}
            aria-valuemin={Math.round(minimum * 100)}
            aria-valuemax={Math.round(maximum * 100)}
            aria-valuenow={Math.round(effectiveShare * 100)}
            aria-valuetext={intl.formatMessage(
              { id: 'analysis.panelShare' },
              {
                moves: Math.round(effectiveShare * 100),
                engine: Math.round((1 - effectiveShare) * 100),
              },
            )}
            onPointerDown={(event) => {
              if (event.button !== 0 || !event.isPrimary) return;
              event.preventDefault();
              event.currentTarget.focus();
              drag.current = {
                pointerId: event.pointerId,
                startY: event.clientY,
                share,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const current = drag.current;
              if (!current || current.pointerId !== event.pointerId) return;
              const start = Math.max(minimum, Math.min(maximum, current.share));
              update(
                start + (event.clientY - current.startY) / availableHeight,
              );
            }}
            onPointerUp={(event) => {
              if (drag.current?.pointerId !== event.pointerId) return;
              drag.current = null;
              update(shareRef.current, true);
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={cancelDrag}
            onLostPointerCapture={cancelDrag}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && drag.current) {
                event.preventDefault();
                cancelDrag();
                return;
              }
              if (drag.current) return;
              const next =
                event.key === 'ArrowUp'
                  ? effectiveShare - 0.05
                  : event.key === 'ArrowDown'
                    ? effectiveShare + 0.05
                    : event.key === 'Home'
                      ? minimum
                      : event.key === 'End'
                        ? maximum
                        : undefined;
              if (next !== undefined) {
                event.preventDefault();
                update(next, true);
              }
            }}
          >
            <GripHorizontal size={16} aria-hidden="true" />
          </div>
          <div className={styles.pane} id={`${id}-engine`}>
            {engine}
          </div>
        </>
      )}
    </div>
  );
}
