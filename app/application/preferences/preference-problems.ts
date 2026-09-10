import { ApplicationProblem } from '../problems/application-problem.ts';

export function invalidUiLanguage(): ApplicationProblem {
  return new ApplicationProblem(
    'preference.invalid_ui_language',
    'The UI language must be de-DE or en-GB.',
  );
}

export function invalidPreferenceRevision(): ApplicationProblem {
  return new ApplicationProblem(
    'preference.invalid_revision',
    'The expected preference revision must be a positive safe integer.',
  );
}

export function preferenceRevisionConflict(
  expectedRevision: number,
  currentRevision: number,
): ApplicationProblem {
  return new ApplicationProblem(
    'preference.revision_conflict',
    'The user preferences have changed. Read the current preferences first.',
    { expectedRevision, currentRevision },
  );
}
