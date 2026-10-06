import type { LiveStateDto } from '../../host_client/index.ts';

type Session = NonNullable<LiveStateDto['session']>;

export function liveClockDisplay(
  session: Pick<
    Session,
    | 'status'
    | 'connected'
    | 'clockUpdatedAt'
    | 'whiteClockMs'
    | 'blackClockMs'
    | 'root'
    | 'steps'
  >,
  now: number,
) {
  const side = (session.steps.at(-1)?.after ?? session.root).position
    .sideToMove;
  const updatedAt = Date.parse(session.clockUpdatedAt ?? '');
  const activeClock =
    side === 'white' ? session.whiteClockMs : session.blackClockMs;
  // Lichess starts the normal clock after both players' first move.
  const running =
    session.status === 'ongoing' &&
    session.connected &&
    session.steps.length >= 2 &&
    Number.isFinite(updatedAt) &&
    activeClock !== undefined &&
    Number.isFinite(activeClock);
  const elapsed = running ? Math.max(0, now - updatedAt) : 0;
  return {
    running,
    whiteClockMs:
      side === 'white' && session.whiteClockMs !== undefined
        ? Math.max(0, session.whiteClockMs - elapsed)
        : session.whiteClockMs,
    blackClockMs:
      side === 'black' && session.blackClockMs !== undefined
        ? Math.max(0, session.blackClockMs - elapsed)
        : session.blackClockMs,
  };
}
