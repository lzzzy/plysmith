import type { ContentFormatPort } from './content-format-port.ts';
import { importProblem } from './import-problems.ts';

export class ContentFormatRegistry {
  readonly #formats: readonly ContentFormatPort[];
  constructor(formats: readonly ContentFormatPort[]) {
    if (
      new Set(formats.map((format) => format.descriptor.formatId)).size !==
      formats.length
    )
      throw new Error('Duplicate content format registration.');
    this.#formats = [...formats];
  }
  resolve(displayName: string, formatId?: string): ContentFormatPort {
    const matches = this.#formats.filter((format) =>
      formatId === undefined
        ? format.descriptor.fileExtensions.some((extension) =>
            displayName.toLowerCase().endsWith(extension.toLowerCase()),
          )
        : format.descriptor.formatId === formatId,
    );
    if (matches.length !== 1) throw importProblem('format_not_recognized');
    return matches[0]!;
  }
}
