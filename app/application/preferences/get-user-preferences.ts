import type { UserPreferencesReader } from './preferences-ports.ts';
import type { UserPreferences } from './user-preferences.ts';

export interface GetUserPreferencesUseCase {
  execute(): Promise<UserPreferences>;
}

export class GetUserPreferences implements GetUserPreferencesUseCase {
  readonly #reader: UserPreferencesReader;

  constructor(reader: UserPreferencesReader) {
    this.#reader = reader;
  }

  async execute(): Promise<UserPreferences> {
    return Object.freeze({ ...(await this.#reader.readUserPreferences()) });
  }
}
