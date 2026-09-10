import type {
  UiLanguageChanged,
  UiLocale,
  UserPreferences,
} from './user-preferences.ts';

export interface UserPreferencesReader {
  readUserPreferences(): Promise<UserPreferences>;
}

export interface PreferencesTransaction {
  getUserPreferences(): UserPreferences;
  // Updates both revisions within this scope; it never commits independently.
  setUiLanguage(uiLocale: UiLocale, updatedAt: string): UserPreferences;
}

export interface PreferencesUnitOfWork {
  // Work is synchronous and bounded. Resolution means the commit succeeded.
  run<T>(work: (transaction: PreferencesTransaction) => T): Promise<T>;
}

export interface PreferenceClock {
  now(): string;
}

export interface UiLanguageChangedPublisher {
  // Delivery is a freshness hint. Implementations must isolate subscriber errors
  // and must not throw or return a promise after the command has committed.
  publish(event: UiLanguageChanged): void;
}
