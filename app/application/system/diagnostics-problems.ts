import { ApplicationProblem } from '../problems/application-problem.ts';

export function invalidDiagnosticLogLevel(): ApplicationProblem {
  return new ApplicationProblem(
    'diagnostics.invalid_log_level',
    'The diagnostic log level is invalid.',
  );
}

export function invalidDiagnosticConfigurationRevision(): ApplicationProblem {
  return new ApplicationProblem(
    'diagnostics.invalid_configuration_revision',
    'The diagnostic configuration revision is invalid.',
  );
}

export function diagnosticConfigurationConflict(): ApplicationProblem {
  return new ApplicationProblem(
    'diagnostics.configuration_conflict',
    'The diagnostic configuration has changed. Read it again before writing.',
  );
}

export function invalidDiagnosticReportRequest(): ApplicationProblem {
  return new ApplicationProblem(
    'diagnostics.invalid_report_request',
    'The diagnostic report request is invalid.',
  );
}

export function invalidDiagnosticReportTarget(): ApplicationProblem {
  return new ApplicationProblem(
    'diagnostics.invalid_report_target',
    'The diagnostic report target is not permitted.',
  );
}

export function diagnosticReportTargetExists(): ApplicationProblem {
  return new ApplicationProblem(
    'diagnostics.report_target_exists',
    'The diagnostic report target already exists.',
  );
}
