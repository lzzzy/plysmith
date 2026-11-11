const prefix = 'plysmith.collapsedInventoryFolders:';

export function readCollapsedInventoryFolders(
  scope: string,
): ReadonlySet<string> {
  try {
    const saved: unknown = JSON.parse(
      globalThis.localStorage.getItem(prefix + scope) ?? 'null',
    );
    if (Array.isArray(saved))
      return new Set(
        saved.filter((id): id is string => typeof id === 'string'),
      );
  } catch {
    // An unavailable preference leaves the folders expanded.
  }
  return new Set();
}

export function saveCollapsedInventoryFolders(
  scope: string,
  folders: ReadonlySet<string>,
): void {
  try {
    globalThis.localStorage.setItem(
      prefix + scope,
      JSON.stringify([...folders]),
    );
  } catch {
    // The current desktop session still keeps its folder state.
  }
}
