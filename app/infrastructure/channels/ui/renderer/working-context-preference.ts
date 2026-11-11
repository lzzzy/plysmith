const storageKey = 'plysmith.useWorkingContexts';

export function readWorkingContextPreference(): boolean | undefined {
  try {
    const value = globalThis.localStorage.getItem(storageKey);
    if (value === 'true' || value === 'false') return value === 'true';
  } catch {
    // The first coherent workspace read can still choose the default.
  }
  return undefined;
}

export function saveWorkingContextPreference(enabled: boolean): boolean {
  try {
    globalThis.localStorage.setItem(storageKey, String(enabled));
    return true;
  } catch {
    return false;
  }
}
