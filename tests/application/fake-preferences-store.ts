import type {
  PreferencesTransaction,
  PreferencesUnitOfWork,
  UserPreferences,
  UserPreferencesReader,
} from '../../app/application/preferences/index.ts';
import type { StoreStatusReader } from '../../app/application/system/index.ts';

export class FakePreferencesStore
  implements UserPreferencesReader, PreferencesUnitOfWork, StoreStatusReader
{
  #state: UserPreferences = Object.freeze({
    uiLocale: 'de-DE',
    preferenceRevision: 1,
    dataRevision: 0,
    updatedAt: '2026-09-08T10:00:00.000Z',
  });
  #tail: Promise<void> = Promise.resolve();
  failCommit = false;

  async readUserPreferences(): Promise<UserPreferences> {
    return this.#state;
  }

  async readStoreStatus() {
    return Object.freeze({
      schemaVersion: 1,
      dataRevision: this.#state.dataRevision,
    });
  }

  run<T>(work: (transaction: PreferencesTransaction) => T): Promise<T> {
    const result = this.#tail.then(() => {
      let draft = this.#state;
      const result = work({
        getUserPreferences: () => draft,
        setUiLanguage: (uiLocale, updatedAt) => {
          if (uiLocale !== draft.uiLocale) {
            draft = Object.freeze({
              uiLocale,
              preferenceRevision: draft.preferenceRevision + 1,
              dataRevision: draft.dataRevision + 1,
              updatedAt,
            });
          }
          return draft;
        },
      });
      if (this.failCommit) throw new Error('Simulated commit failure.');
      this.#state = draft;
      return result;
    });
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
