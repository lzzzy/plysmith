import type {
  GetUserPreferencesUseCase,
  SetUiLanguageUseCase,
} from '../../../application/preferences/index.ts';
import type { GetSystemStatusUseCase } from '../../../application/system/index.ts';
import type { HostEventSource } from '../../../application/events/index.ts';

export interface HostDependencies {
  readonly getSystemStatus: GetSystemStatusUseCase;
  readonly getUserPreferences: GetUserPreferencesUseCase;
  readonly setUiLanguage: SetUiLanguageUseCase;
  readonly events: HostEventSource;
  readonly security: { readonly hostToken: string };
  readonly productRelease: string;
  readonly contractFingerprint: string;
  readonly correlationIdFactory: () => string;
}
