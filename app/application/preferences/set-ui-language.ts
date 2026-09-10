import type {
  PreferenceClock,
  PreferencesUnitOfWork,
  UiLanguageChangedPublisher,
} from './preferences-ports.ts';
import {
  invalidPreferenceRevision,
  invalidUiLanguage,
  preferenceRevisionConflict,
} from './preference-problems.ts';
import type {
  SetUiLanguageRequest,
  SetUiLanguageResult,
  UiLanguageChanged,
} from './user-preferences.ts';

export interface SetUiLanguageUseCase {
  execute(request: SetUiLanguageRequest): Promise<SetUiLanguageResult>;
}

export class SetUiLanguage implements SetUiLanguageUseCase {
  readonly #unitOfWork: PreferencesUnitOfWork;
  readonly #clock: PreferenceClock;
  readonly #events: UiLanguageChangedPublisher;

  constructor(dependencies: {
    readonly unitOfWork: PreferencesUnitOfWork;
    readonly clock: PreferenceClock;
    readonly events: UiLanguageChangedPublisher;
  }) {
    this.#unitOfWork = dependencies.unitOfWork;
    this.#clock = dependencies.clock;
    this.#events = dependencies.events;
  }

  async execute(request: SetUiLanguageRequest): Promise<SetUiLanguageResult> {
    const { uiLocale, expectedRevision } = request;
    if (uiLocale !== 'de-DE' && uiLocale !== 'en-GB') {
      throw invalidUiLanguage();
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw invalidPreferenceRevision();
    }

    const committed = await this.#unitOfWork.run((transaction) => {
      const current = transaction.getUserPreferences();
      // Check before no-op: a repeated, stale command is not acknowledged anew.
      if (current.preferenceRevision !== expectedRevision) {
        throw preferenceRevisionConflict(
          expectedRevision,
          current.preferenceRevision,
        );
      }
      if (current.uiLocale === uiLocale) {
        return { preferences: current, event: undefined };
      }

      const occurredAt = this.#clock.now();
      const preferences = transaction.setUiLanguage(uiLocale, occurredAt);
      const event: UiLanguageChanged = Object.freeze({
        kind: 'preference.ui-language-changed',
        occurredAt,
        dataRevision: preferences.dataRevision,
        preferenceRevision: preferences.preferenceRevision,
        payload: Object.freeze({
          previousUiLocale: current.uiLocale,
          uiLocale,
        }),
      });
      return { preferences, event };
    });

    if (committed.event !== undefined) {
      this.#events.publish(committed.event);
    }
    return Object.freeze({
      changed: committed.event !== undefined,
      preferences: Object.freeze({ ...committed.preferences }),
    });
  }
}
