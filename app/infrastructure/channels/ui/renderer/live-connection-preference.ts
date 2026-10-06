const storageKey = 'Plysmith.liveOnline';

export function readLiveOnlinePreference(): boolean {
  try {
    return globalThis.localStorage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
}

export function saveLiveOnlinePreference(online: boolean): void {
  try {
    globalThis.localStorage.setItem(storageKey, String(online));
  } catch {
    // The connection remains usable without writable desktop profile storage.
  }
}
