export type ConfigurationProblemCode =
  | 'configuration.active_missing'
  | 'configuration.central_invalid'
  | 'configuration.persistence_invalid'
  | 'configuration.persistence_path_invalid';

export class ConfigurationProblem extends Error {
  readonly code: ConfigurationProblemCode;

  constructor(code: ConfigurationProblemCode) {
    super(code);
    this.name = 'ConfigurationProblem';
    this.code = code;
  }
}
