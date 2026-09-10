export type UiLocale = 'de-DE' | 'en-GB';

export interface UserPreferences {
  readonly uiLocale: UiLocale;
  readonly preferenceRevision: number;
  readonly dataRevision: number;
  readonly updatedAt: string;
}

export interface SetUiLanguageRequest {
  readonly uiLocale: string;
  readonly expectedRevision: number;
}

export interface SetUiLanguageResult {
  readonly changed: boolean;
  readonly preferences: UserPreferences;
}

export interface UiLanguageChanged {
  readonly kind: 'preference.ui-language-changed';
  readonly occurredAt: string;
  readonly dataRevision: number;
  readonly preferenceRevision: number;
  readonly payload: {
    readonly previousUiLocale: UiLocale;
    readonly uiLocale: UiLocale;
  };
}
