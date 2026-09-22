/* Copyright 2026 The Plysmith Project Authors. SPDX-License-Identifier: Apache-2.0 */
const symbols = '♔♕♖♗♘♙♚♛♜♝♞♟';
let loading: Promise<void> | undefined;

/** Call after the font CSS is available. Keep pieces hidden until resolved. */
export function ensurePlysmithChessFont(): Promise<void> {
  if (loading !== undefined) return loading;
  loading = load().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

async function load(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) {
    throw new Error('Plysmith Chess requires the browser Font Loading API.');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const faces = await Promise.race([
      document.fonts.load('400 32px "Plysmith Chess"', symbols),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Plysmith Chess font load timed out.')), 10_000);
      }),
    ]);
    if (faces.length !== 1 || faces[0]?.status !== 'loaded') {
      throw new Error('Plysmith Chess could not be loaded unambiguously.');
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
