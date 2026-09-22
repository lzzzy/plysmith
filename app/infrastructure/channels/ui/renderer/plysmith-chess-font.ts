const plysmithChessSymbols = '♔♕♖♗♘♙♚♛♜♝♞♟';
let loading: Promise<void> | undefined;

interface BrowserFontFace {
  readonly status: string;
}

interface BrowserFontSet {
  load(font: string, text?: string): Promise<readonly BrowserFontFace[]>;
}

export function ensurePlysmithChessFont(): Promise<void> {
  if (loading !== undefined) return loading;

  loading = loadPlysmithChessFont().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

async function loadPlysmithChessFont(): Promise<void> {
  const browser = globalThis as typeof globalThis & {
    readonly document?: { readonly fonts?: BrowserFontSet };
  };
  const fonts = browser.document?.fonts;
  if (fonts === undefined) {
    throw new Error('Plysmith Chess requires the browser Font Loading API.');
  }

  const faces = await fonts.load(
    '400 32px "Plysmith Chess"',
    plysmithChessSymbols,
  );
  if (faces.length !== 1 || faces[0]?.status !== 'loaded') {
    throw new Error('Plysmith Chess could not be loaded unambiguously.');
  }
}
