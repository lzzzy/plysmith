export const ENGINE_PROVIDER_TIMEOUT_LIMITS = Object.freeze({
  startup: Object.freeze({ minimum: 100, maximum: 60_000 }),
  stockfishMove: Object.freeze({ minimum: 100, maximum: 660_000 }),
  maiaMove: Object.freeze({ minimum: 100, maximum: 60_000 }),
  stop: Object.freeze({ minimum: 100, maximum: 30_000 }),
});
