const notoVerticalMetrics: Readonly<Record<string, readonly [number, number]>> =
  Object.freeze({
    '♔': [76, 3],
    '♕': [77, 3],
    '♖': [72, 0],
    '♗': [74, 6],
    '♘': [77, 0],
    '♙': [76, 0],
    '♚': [76, 3],
    '♛': [77, 3],
    '♜': [72, 0],
    '♝': [74, 6],
    '♞': [77, 0],
    '♟': [76, 0],
  });

export function notoChessPieceBaseline(symbol: string): number {
  const [ascent, descent] = notoVerticalMetrics[symbol] ?? [75, 0];
  return 50 + (ascent - descent) / 2;
}

export function prefersWindowsChessSymbols(userAgent: string): boolean {
  return userAgent.includes('Windows');
}
