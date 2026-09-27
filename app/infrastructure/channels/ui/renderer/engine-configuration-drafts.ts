import type {
  EngineProviderConfigurationDto,
  EngineProviderConfigurationInputDto,
} from '../../host_client/index.ts';

type StockfishInput = Extract<
  EngineProviderConfigurationInputDto,
  { providerType: 'stockfish-uci' }
>;
export type EngineConfigurationForm =
  | (Omit<StockfishInput, 'threads' | 'hashMb' | 'moveTimeMs'> & {
      readonly threads: string;
      readonly hashMb: string;
      readonly moveTimeMs: string;
    })
  | Extract<
      EngineProviderConfigurationInputDto,
      { providerType: 'maia-chess' }
    >;

export type EngineConfigurationField =
  | 'displayName'
  | 'executablePath'
  | 'weightsPath'
  | 'threads'
  | 'hashMb'
  | 'moveTimeMs';
export type EngineConfigurationDraftPatch = Partial<
  Record<EngineConfigurationField, string>
>;
export interface EngineConfigurationIssue {
  readonly field?: EngineConfigurationField;
  readonly messageId: string;
  readonly values?: Readonly<Record<string, number>>;
}
export interface EngineConfigurationDraft {
  readonly key: string;
  readonly form: EngineConfigurationForm;
  readonly baseline: EngineConfigurationForm | null;
  readonly expectedConfigurationRevision: string | null;
  readonly dirty: boolean;
  readonly issues: readonly EngineConfigurationIssue[];
}
export interface EngineConfigurationDraftsState {
  readonly selectedKey: string | undefined;
  readonly entries: readonly EngineConfigurationDraft[];
}

export const ENGINE_CONFIGURATION_FIELD_LIMITS = {
  threads: { min: 1, max: 256 },
  hashMb: { min: 1, max: 65_536 },
  moveTimeMs: { min: 10, max: 600_000 },
} as const;

// Owned by the application store for the current session only.
export class EngineConfigurationDrafts {
  #state: EngineConfigurationDraftsState = {
    selectedKey: undefined,
    entries: [],
  };
  #sequence = 0;

  get snapshot(): EngineConfigurationDraftsState {
    return this.#state;
  }

  synchronize(providers: readonly EngineProviderConfigurationDto[]): void {
    const entries = this.#state.entries
      .filter(
        (entry) =>
          entry.dirty ||
          providers.some(
            (provider) => provider.instanceId === entry.form.instanceId,
          ),
      )
      .map((entry) => {
        const provider = providers.find(
          (value) => value.instanceId === entry.form.instanceId,
        );
        return !entry.dirty && provider !== undefined
          ? fromProvider(provider, entry.key)
          : entry;
      });
    for (const provider of providers) {
      if (
        !entries.some((entry) => entry.form.instanceId === provider.instanceId)
      ) {
        entries.push(fromProvider(provider));
      }
    }
    this.#state = {
      entries,
      selectedKey: entries.some(
        (entry) => entry.key === this.#state.selectedKey,
      )
        ? this.#state.selectedKey
        : entries[0]?.key,
    };
  }

  select(key: string): void {
    if (this.#state.entries.some((entry) => entry.key === key)) {
      this.#state = { ...this.#state, selectedKey: key };
    }
  }

  create(providerType: EngineConfigurationForm['providerType']): string {
    const key = `draft:${++this.#sequence}`;
    const displayName =
      providerType === 'stockfish-uci' ? 'Stockfish' : 'Maia 1500';
    const common = {
      instanceId: this.#instanceId(displayName, providerType),
      displayName,
      executablePath: '',
      stopTimeoutMs: 1_000,
      maxOutputBytes: 1_048_576,
    };
    const form: EngineConfigurationForm =
      providerType === 'stockfish-uci'
        ? {
            ...common,
            providerType,
            arguments: [],
            threads: '1',
            hashMb: '64',
            moveTimeMs: '500',
            startupTimeoutMs: 5_000,
            moveTimeoutMs: 10_000,
          }
        : {
            ...common,
            providerType,
            weightsPath: '',
            startupTimeoutMs: 30_000,
            moveTimeoutMs: 30_000,
          };
    this.#state = {
      selectedKey: key,
      entries: [
        ...this.#state.entries,
        {
          key,
          form,
          baseline: null,
          expectedConfigurationRevision: null,
          dirty: true,
          issues: [],
        },
      ],
    };
    return key;
  }

  update(key: string, patch: EngineConfigurationDraftPatch): void {
    this.#replace(key, (entry) => {
      const form = { ...entry.form };
      for (const field of Object.keys(patch) as EngineConfigurationField[]) {
        const value = patch[field];
        if (value === undefined) continue;
        if (field === 'displayName' || field === 'executablePath')
          form[field] = value;
        else if (field === 'weightsPath' && form.providerType === 'maia-chess')
          form.weightsPath = value;
        else if (
          (field === 'threads' ||
            field === 'hashMb' ||
            field === 'moveTimeMs') &&
          form.providerType === 'stockfish-uci'
        )
          form[field] = value;
      }
      if (entry.baseline === null && patch.displayName !== undefined) {
        form.instanceId = this.#instanceId(
          form.displayName,
          form.providerType,
          key,
        );
      }
      return {
        ...entry,
        form,
        dirty: entry.baseline === null || !sameForm(form, entry.baseline),
        issues: entry.issues.filter(
          (issue) =>
            issue.field !== undefined && patch[issue.field] === undefined,
        ),
      };
    });
  }

  discard(key: string): void {
    const entry = this.#state.entries.find((value) => value.key === key);
    if (entry === undefined) return;
    if (entry.baseline !== null) {
      const baseline = entry.baseline;
      this.#replace(key, (current) => ({
        ...current,
        form: baseline,
        dirty: false,
        issues: [],
      }));
      return;
    }
    const entries = this.#state.entries.filter((value) => value.key !== key);
    this.#state = {
      entries,
      selectedKey:
        this.#state.selectedKey === key
          ? entries[0]?.key
          : this.#state.selectedKey,
    };
  }

  prepareSave(key: string):
    | {
        readonly input: EngineProviderConfigurationInputDto;
        readonly expectedConfigurationRevision: string | null;
      }
    | undefined {
    const entry = this.#state.entries.find((value) => value.key === key);
    if (entry === undefined || !entry.dirty) return undefined;
    const issues = validateEngineConfigurationForm(entry.form);
    this.setIssues(key, issues);
    if (issues.length > 0) return undefined;
    const input: EngineProviderConfigurationInputDto =
      entry.form.providerType === 'stockfish-uci'
        ? {
            ...entry.form,
            threads: Number(entry.form.threads),
            hashMb: Number(entry.form.hashMb),
            moveTimeMs: Number(entry.form.moveTimeMs),
          }
        : { ...entry.form };
    return {
      input,
      expectedConfigurationRevision: entry.expectedConfigurationRevision,
    };
  }

  saved(key: string, provider: EngineProviderConfigurationDto): void {
    this.#replace(key, () => fromProvider(provider, key));
  }

  removed(instanceId: string): void {
    const entries = this.#state.entries.filter(
      (entry) => entry.form.instanceId !== instanceId,
    );
    this.#state = {
      entries,
      selectedKey: entries.some(
        (entry) => entry.key === this.#state.selectedKey,
      )
        ? this.#state.selectedKey
        : entries[0]?.key,
    };
  }

  setIssues(key: string, issues: readonly EngineConfigurationIssue[]): void {
    this.#replace(key, (entry) => ({ ...entry, issues: [...issues] }));
  }

  #replace(
    key: string,
    replace: (entry: EngineConfigurationDraft) => EngineConfigurationDraft,
  ): void {
    this.#state = {
      ...this.#state,
      entries: this.#state.entries.map((entry) =>
        entry.key === key ? replace(entry) : entry,
      ),
    };
  }

  #instanceId(
    displayName: string,
    providerType: EngineConfigurationForm['providerType'],
    exceptKey?: string,
  ): string {
    const used = this.#state.entries
      .filter((entry) => entry.key !== exceptKey)
      .map((entry) => entry.form.instanceId);
    const base = (
      displayName
        .trim()
        .replace(/\u00df/g, 'ss')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') ||
      (providerType === 'maia-chess' ? 'maia' : 'stockfish')
    ).slice(0, 72);
    let instanceId = base;
    let suffix = 2;
    while (used.includes(instanceId)) instanceId = `${base}-${suffix++}`;
    return instanceId;
  }
}

export function validateEngineConfigurationForm(
  form: EngineConfigurationForm,
): readonly EngineConfigurationIssue[] {
  const issues: EngineConfigurationIssue[] = [];
  const textFields = {
    displayName: 160,
    executablePath: 1_024,
    ...(form.providerType === 'maia-chess' ? { weightsPath: 1_024 } : {}),
  };
  for (const [field, max] of Object.entries(textFields)) {
    const value = form[field as keyof typeof form] as string;
    if (value.trim().length === 0)
      issues.push({
        field: field as EngineConfigurationField,
        messageId: 'engines.validation.required',
      });
    else if ([...value].length > max)
      issues.push({
        field: field as EngineConfigurationField,
        messageId: 'engines.validation.maxLength',
        values: { max },
      });
  }
  if (form.providerType === 'stockfish-uci') {
    for (const field of ['threads', 'hashMb', 'moveTimeMs'] as const) {
      const { min, max } = ENGINE_CONFIGURATION_FIELD_LIMITS[field];
      const value = Number(form[field]);
      if (
        form[field].trim() === '' ||
        !Number.isInteger(value) ||
        value < min ||
        value > max
      ) {
        issues.push({
          field,
          messageId: 'engines.validation.integerRange',
          values: { min, max },
        });
      }
    }
  }
  return issues;
}

export function mapEngineConfigurationIssues(
  issues: readonly string[],
): readonly EngineConfigurationIssue[] {
  return issues.map((issue) => {
    if (issue === 'executable_not_found')
      return { field: 'executablePath', messageId: `engines.issue.${issue}` };
    if (issue === 'weights_not_found')
      return { field: 'weightsPath', messageId: `engines.issue.${issue}` };
    return { messageId: 'engines.issue.configuration_invalid' };
  });
}

function fromProvider(
  provider: EngineProviderConfigurationDto,
  key = provider.instanceId,
): EngineConfigurationDraft {
  const common = {
    instanceId: provider.instanceId,
    displayName: provider.displayName,
    executablePath: provider.executablePath,
    startupTimeoutMs: provider.startupTimeoutMs,
    moveTimeoutMs: provider.moveTimeoutMs,
    stopTimeoutMs: provider.stopTimeoutMs,
    maxOutputBytes: provider.maxOutputBytes,
  };
  const form: EngineConfigurationForm =
    provider.providerType === 'stockfish-uci'
      ? {
          ...common,
          providerType: provider.providerType,
          arguments: [...provider.arguments],
          threads: String(provider.threads),
          hashMb: String(provider.hashMb),
          moveTimeMs: String(provider.moveTimeMs),
        }
      : {
          ...common,
          providerType: provider.providerType,
          weightsPath: provider.weightsPath,
        };
  return {
    key,
    form,
    baseline: form,
    expectedConfigurationRevision: provider.configurationRevision,
    dirty: false,
    issues: [],
  };
}

function sameForm(
  left: EngineConfigurationForm,
  right: EngineConfigurationForm,
): boolean {
  return Object.keys(left).every(
    (key) =>
      JSON.stringify(left[key as keyof EngineConfigurationForm]) ===
      JSON.stringify(right[key as keyof EngineConfigurationForm]),
  );
}
