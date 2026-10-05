export const ENGINE_PROVIDER_TIMEOUT_LIMITS = Object.freeze({
  startup: Object.freeze({ minimum: 100, maximum: 60_000 }),
  stockfishMove: Object.freeze({ minimum: 100, maximum: 660_000 }),
  maiaMove: Object.freeze({ minimum: 100, maximum: 60_000 }),
  stop: Object.freeze({ minimum: 100, maximum: 30_000 }),
});

export const STOCKFISH_DETAIL_LEVEL_DEFAULTS = Object.freeze({
  fast: 500,
  thorough: 1_500,
  very_deep: 5_000,
});

export const STOCKFISH_DETAIL_LEVEL_LIMITS = Object.freeze({
  minimum: 10,
  maximum: 600_000,
});
