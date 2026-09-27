import { ApplicationProblem } from '../problems/application-problem.ts';

export function invalidRemovalConfirmation(): ApplicationProblem {
  return new ApplicationProblem(
    'workspace.invalid_removal_confirmation',
    'Removal requires the versions from its current preview.',
  );
}

export function removalPreviewConflict(): ApplicationProblem {
  return new ApplicationProblem(
    'workspace.removal_preview_conflict',
    'The affected work has changed. Read the removal preview again.',
  );
}

export function startupRevisionConflict(): ApplicationProblem {
  return new ApplicationProblem(
    'workspace.startup_revision_conflict',
    'The startup preference has changed. Read it again.',
  );
}

export function invalidWorkingContext(): ApplicationProblem {
  return new ApplicationProblem(
    'workspace.invalid_context',
    'The working context input is invalid.',
  );
}

export function workingContextVersionConflict(): ApplicationProblem {
  return new ApplicationProblem(
    'workspace.context_version_conflict',
    'The working context has changed. Read the current context first.',
  );
}

export function workingContextNotFound(): ApplicationProblem {
  return new ApplicationProblem(
    'workspace.context_not_found',
    'The working context does not exist.',
  );
}

export function invalidWorkspacePage(): ApplicationProblem {
  return new ApplicationProblem(
    'workspace.invalid_page',
    'The working context page request is invalid.',
  );
}

export function invalidResume(): ApplicationProblem {
  return new ApplicationProblem(
    'workspace.invalid_resume',
    'The work-scope resume is invalid.',
  );
}

export function resumeRevisionConflict(
  expectedRevision: number | null,
  currentRevision: number | null,
): ApplicationProblem {
  return new ApplicationProblem(
    'workspace.resume_revision_conflict',
    'The work-scope resume has changed. Read the current workspace first.',
    {
      expectedRevision: expectedRevision ?? 0,
      currentRevision: currentRevision ?? 0,
    },
  );
}

export function contextReferenceNotFound(): ApplicationProblem {
  return new ApplicationProblem(
    'workspace.reference_target_not_found',
    'The referenced inventory item or anchor does not exist.',
  );
}

export function contextReferenceConflict(): ApplicationProblem {
  return new ApplicationProblem(
    'workspace.reference_exists',
    'The context already references this anchor.',
  );
}
