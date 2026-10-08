interface Closeable {
  close(): void | Promise<void>;
}

interface HostCleanupResources {
  readonly clearDiscovery?: () => Promise<void>;
  readonly live: Closeable | undefined;
  readonly host: Closeable | undefined;
  readonly engineRuntimes: readonly Closeable[];
  readonly importPreparations: Closeable | undefined;
  readonly persistence: Closeable | undefined;
  readonly lease: { release(): Promise<void> };
  readonly diagnostics: Closeable | undefined;
  readonly beforeDiagnosticsClose?: () => void;
}

export async function closeHostResources(
  resources: HostCleanupResources,
): Promise<readonly unknown[]> {
  const failures: unknown[] = [];
  const attempt = async (close: () => void | Promise<void>): Promise<void> => {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  };

  await attempt(() => resources.clearDiscovery?.());
  await attempt(() => resources.live?.close());
  // Stop all producers before closing their shared persistence and owner lease.
  await Promise.all([
    attempt(() => resources.host?.close()),
    ...resources.engineRuntimes.map((runtime) =>
      attempt(() => runtime.close()),
    ),
    attempt(() => resources.importPreparations?.close()),
  ]);
  await attempt(() => resources.persistence?.close());
  await attempt(() => resources.lease.release());
  await attempt(() => resources.beforeDiagnosticsClose?.());
  await attempt(() => resources.diagnostics?.close());
  return failures;
}
