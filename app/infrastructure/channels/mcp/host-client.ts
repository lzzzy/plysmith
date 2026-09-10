import type { components } from '../../../../contracts/host/index.ts';

export type SystemStatus = components['schemas']['SystemStatus'];
export type UserPreferences = components['schemas']['UserPreferences'];
export type SetUiLanguageRequest = components['schemas']['SetUiLanguageBody'];
export type SetUiLanguageResult = components['schemas']['SetUiLanguageResult'];
export type UiLocale = UserPreferences['uiLocale'];

/** Safe RFC 9457 DTO from the host; text must already be redacted. */
export type HostProblem = components['schemas']['ProblemDetails'];

export interface HostClientFailure {
  readonly problem: HostProblem;
}

/**
 * Supplied by the composition root using the shared, release-checked host client.
 * Safe failures reject with HostClientFailure. All other rejections are private.
 * setUiLanguage must send at most once, including after a connection failure.
 */
export interface HostClient {
  getSystemStatus(): Promise<SystemStatus>;
  getUserPreferences(): Promise<UserPreferences>;
  setUiLanguage(request: SetUiLanguageRequest): Promise<SetUiLanguageResult>;
}
