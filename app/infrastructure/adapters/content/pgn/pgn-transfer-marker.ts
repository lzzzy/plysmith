import { transferLimits } from './pgn-transfer-profile.ts';

/** Recognizes reserved directives, including misplaced ones, without interpreting ordinary inline prose. */
export class PgnTransferMarkerScanner {
  private mode: 'text' | 'tag' | 'brace' | 'line' = 'text';
  private quoted = false;
  private escaped = false;
  private prefix = '';
  private eligible = false;
  private embeddedPrefix = 0;
  private versionLength = 0;
  private versionEnded = false;

  private embedded(character: string): boolean {
    const prefix = '[%plysmith ';
    if (this.embeddedPrefix < prefix.length) {
      this.embeddedPrefix =
        character === prefix[this.embeddedPrefix]
          ? this.embeddedPrefix + 1
          : character === '['
            ? 1
            : 0;
      return false;
    }
    if (this.versionEnded && character === '\n') return true;
    if (this.versionEnded && character === '\r') return false;
    if (!this.versionEnded && character === ',' && this.versionLength > 0) {
      this.versionEnded = true;
      return false;
    }
    if (
      !this.versionEnded &&
      /[A-Za-z0-9_.-]/.test(character) &&
      ++this.versionLength <= 32
    )
      return false;
    this.embeddedPrefix = character === '[' ? 1 : 0;
    this.versionLength = 0;
    this.versionEnded = false;
    return false;
  }

  finish(): boolean {
    return (
      (this.mode === 'brace' || this.mode === 'line') &&
      this.eligible &&
      this.prefix === '[%plysmith'
    );
  }

  push(character: string): boolean {
    if (this.mode === 'tag') {
      if (this.escaped) this.escaped = false;
      else if (this.quoted && character === '\\') this.escaped = true;
      else if (character === '"') this.quoted = !this.quoted;
      else if (!this.quoted && character === ']') this.mode = 'text';
    } else if (this.mode === 'brace' || this.mode === 'line') {
      if (this.embedded(character)) return true;
      if (
        (this.mode === 'brace' && character === '}') ||
        (this.mode === 'line' && (character === '\n' || character === '\r'))
      ) {
        const found = this.finish();
        this.mode = 'text';
        return found;
      } else if (this.eligible) {
        if (this.prefix === '' && /\s/.test(character)) return false;
        if (this.prefix === '[%plysmith') {
          this.eligible = false;
          return /[\s,\]]/.test(character);
        }
        this.prefix += character;
        if (!'[%plysmith'.startsWith(this.prefix)) this.eligible = false;
      }
    } else if (character === '[') {
      this.mode = 'tag';
    } else if (character === '{' || character === ';') {
      this.mode = character === '{' ? 'brace' : 'line';
      this.eligible = true;
      this.prefix = '';
      this.embeddedPrefix = 0;
      this.versionLength = 0;
      this.versionEnded = false;
    }
    return false;
  }
}

export function containsPgnTransferMarker(bytes: Uint8Array): boolean {
  const scanner = new PgnTransferMarkerScanner();
  const end = Math.min(bytes.length, transferLimits.bytes);
  for (let index = 0; index < end; index++)
    if (scanner.push(String.fromCharCode(bytes[index]!))) return true;
  return scanner.finish();
}
