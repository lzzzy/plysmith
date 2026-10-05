import {
  ContentFormatError,
  type ContentFormatLimits,
} from '../../../../application/inventory/content-format-port.ts';
import { IMPORT_LIMITS } from '../../../../application/inventory/import-limits.ts';

export const pgnLimits: ContentFormatLimits = Object.freeze({
  maxInputCharacters: IMPORT_LIMITS.maxInputBytes,
  maxCandidateCharacters: IMPORT_LIMITS.maxCandidateCharacters,
  maxCandidates: IMPORT_LIMITS.maxCandidates,
  maxNodesPerCandidate: IMPORT_LIMITS.maxNodesPerCandidate,
  maxVariationDepth: IMPORT_LIMITS.maxVariationDepth,
  maxHeadersPerCandidate: IMPORT_LIMITS.maxHeadersPerCandidate,
  maxStringCharacters: IMPORT_LIMITS.maxStringCharacters,
  maxLineCharacters: IMPORT_LIMITS.maxLineCharacters,
  maxSyntaxCharacters: IMPORT_LIMITS.maxSyntaxCharacters,
  maxTokensPerCandidate: IMPORT_LIMITS.maxTokensPerCandidate,
  maxCommentsPerCandidate: IMPORT_LIMITS.maxCommentsPerCandidate,
  maxVariationsPerCandidate: IMPORT_LIMITS.maxVariationsPerCandidate,
});

export class InvalidPgn extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export function isResult(
  value: string,
): value is '1-0' | '0-1' | '1/2-1/2' | '*' {
  return (
    value === '1-0' || value === '0-1' || value === '1/2-1/2' || value === '*'
  );
}

/** Only frames top-level result boundaries; never guesses recovery inside broken RAVs. */
export class PgnFramer {
  private buffer = '';
  private token = '';
  private mode: 'text' | 'tag' | 'brace' | 'line' = 'text';
  private quoted = false;
  private escaped = false;
  private depth = 0;
  private lineLength = 0;
  private total = 0;
  private limited = false;
  lastCandidateResourceLimited = false;

  private readonly limits: ContentFormatLimits;
  constructor(limits: ContentFormatLimits) {
    this.limits = limits;
  }

  push(character: string): string | undefined {
    this.total += character.length;
    if (this.total > this.limits.maxInputCharacters)
      throw new ContentFormatError('input_too_large');
    let complete: string | undefined;
    if (this.mode === 'text' && /[\s{}();\[\]*]/.test(character)) {
      if (this.depth === 0 && isResult(this.token)) {
        complete = this.buffer;
        this.lastCandidateResourceLimited = this.limited;
        this.buffer = '';
        this.limited = false;
        this.lineLength = 0;
      }
      this.token = '';
    }
    this.lineLength =
      character === '\n' || character === '\r'
        ? 0
        : this.lineLength + character.length;
    if (this.lineLength > this.limits.maxLineCharacters) this.limited = true;
    if (
      this.buffer.length + character.length <=
      this.limits.maxCandidateCharacters
    )
      this.buffer += character;
    else this.limited = true;
    if (this.mode === 'brace') {
      if (character === '}') this.mode = 'text';
    } else if (this.mode === 'line') {
      if (character === '\n' || character === '\r') this.mode = 'text';
    } else if (this.mode === 'tag') {
      if (this.escaped) this.escaped = false;
      else if (this.quoted && character === '\\') this.escaped = true;
      else if (character === '"') this.quoted = !this.quoted;
      else if (character === ']' && !this.quoted) this.mode = 'text';
    } else if (character === '{') this.mode = 'brace';
    else if (character === ';') this.mode = 'line';
    else if (character === '[') this.mode = 'tag';
    else if (character === '(') {
      this.depth += 1;
      if (this.depth > this.limits.maxVariationDepth) this.limited = true;
    } else if (character === ')') this.depth -= 1;
    else if (
      !/\s/.test(character) &&
      this.token.length <= this.limits.maxStringCharacters
    )
      this.token += character;
    return complete;
  }

  finish(): string | undefined {
    this.lastCandidateResourceLimited = this.limited;
    if (
      this.limited &&
      ((this.mode !== 'text' && this.mode !== 'line') || this.depth !== 0)
    )
      throw new ContentFormatError('provider_resource_exhausted');
    return !this.limited && this.buffer.trim().length === 0
      ? undefined
      : this.buffer;
  }
}

export interface ShieldedPgn {
  readonly text: string;
  readonly headers: { name: string; value: string }[];
  readonly comments: string[];
  readonly commentOffsets: number[];
  readonly result?: '1-0' | '0-1' | '1/2-1/2' | '*';
  readonly hasNags: boolean;
  readonly duplicateFen: boolean;
}

/** Shields the library's lossy tag coercion/comment directive extraction, not move grammar. */
export function shieldPgn(
  source: string,
  limits: ContentFormatLimits,
): ShieldedPgn {
  const headers: ShieldedPgn['headers'] = [];
  const comments: string[] = [];
  const commentOffsets: number[] = [];
  const output: string[] = [];
  type Annotations = {
    drawOffers: string[];
    comments: string[];
  };
  const annotations = new Map<number, Annotations>();
  const anchors: (number | undefined)[] = [undefined];
  let depth = 0;
  let tokens = 0;
  let variations = 0;
  let syntaxCharacters = 0;
  let seenMoves = false;
  let result: ShieldedPgn['result'];
  let variationResult = false;
  let offset = 0;
  let headerCount = 0;
  let hasNags = false;
  let duplicateFen = false;
  const annotate = (kind: keyof Annotations, value: string): void => {
    const anchor = anchors[depth];
    if (anchor === undefined) {
      output.push(value);
      return;
    }
    let attached = annotations.get(anchor);
    if (attached === undefined) {
      attached = { drawOffers: [], comments: [] };
      annotations.set(anchor, attached);
    }
    attached[kind].push(value);
  };
  while (offset < source.length) {
    const character = source[offset]!;
    if (/\s/.test(character)) {
      output.push(character);
      offset += 1;
      continue;
    }
    if (character === '{' || character === ';') {
      const end =
        character === '{'
          ? source.indexOf('}', offset + 1)
          : source.slice(offset).search(/[\r\n]/);
      if (character === '{' && end < 0)
        throw new InvalidPgn('pgn_unclosed_comment');
      const stop =
        character === '{' ? end : end < 0 ? source.length : offset + end;
      const comment = source.slice(offset + 1, stop);
      if (
        comment.length > limits.maxStringCharacters ||
        comments.length >= limits.maxCommentsPerCandidate
      )
        throw new ContentFormatError('provider_resource_exhausted');
      annotate('comments', ` {PLYSMITHCOMMENT${comments.length}} `);
      comments.push(comment);
      commentOffsets.push(offset);
      offset = character === '{' ? stop + 1 : stop;
      continue;
    }
    if (character === '[') {
      if (seenMoves || depth !== 0)
        throw new InvalidPgn('pgn_misplaced_header');
      const match =
        /^\[\s*([A-Za-z0-9_]+)\s+"((?:[^"\\\r\n]|\\["\\])*)"\s*\]/.exec(
          source.slice(offset),
        );
      if (!match) throw new InvalidPgn('pgn_invalid_header');
      if (
        ++headerCount > limits.maxHeadersPerCandidate ||
        match[1]!.length > limits.maxStringCharacters ||
        match[2]!.length > limits.maxStringCharacters
      )
        throw new ContentFormatError('provider_resource_exhausted');
      const name = match[1]!;
      const value = match[2]!.replace(/\\(["\\])/g, '$1');
      const existing = headers.find(
        (header) => header.name.toLowerCase() === name.toLowerCase(),
      );
      if (existing !== undefined) {
        if (name.toLowerCase() !== 'fen' || existing.value !== value)
          throw new InvalidPgn('pgn_duplicate_header');
        duplicateFen = true;
      } else headers.push({ name, value });
      output.push(' ');
      offset += match[0].length;
      continue;
    }
    if (character === '(' || character === ')') {
      if (source.startsWith('(=)', offset)) {
        syntaxCharacters += 3;
        if (syntaxCharacters > limits.maxSyntaxCharacters)
          throw new ContentFormatError('provider_resource_exhausted');
        annotate('drawOffers', ' (=) ');
        offset += 3;
        continue;
      }
      depth += character === '(' ? 1 : -1;
      if (depth < 0) throw new InvalidPgn('pgn_unbalanced_rav');
      if (
        depth > limits.maxVariationDepth ||
        (character === '(' && ++variations > limits.maxVariationsPerCandidate)
      )
        throw new ContentFormatError('provider_resource_exhausted');
      if (character === '(') anchors.push(undefined);
      else anchors.pop();
      output.push(character);
      offset += 1;
      continue;
    }
    const match = /^(?:\*|\$\d+|[!?]+|[^\s{}();\[\]*$!?]+)/.exec(
      source.slice(offset),
    );
    if (!match) throw new InvalidPgn('pgn_invalid_syntax');
    const token = match[0];
    syntaxCharacters += token.length;
    if (syntaxCharacters > limits.maxSyntaxCharacters)
      throw new ContentFormatError('provider_resource_exhausted');
    if (
      token.length > limits.maxStringCharacters ||
      ++tokens > limits.maxTokensPerCandidate
    )
      throw new ContentFormatError('provider_resource_exhausted');
    seenMoves = true;
    if (isResult(token)) {
      if (depth !== 0) variationResult = true;
      else {
        if (result !== undefined) throw new InvalidPgn('pgn_invalid_result');
        result = token;
      }
    }
    // Validate omitted annotations before the library; prose and move grammar remain untouched.
    if (
      /^(?:\$\d+|[!?]+|\+-|-\+|[=D\u203c\u2047\u2049\u2048\u25a1\u221e\u2a72\u2a71\u00b1\u2213\u2a00\u27f3\u2192\u2191\u21c6])$/.test(
        token,
      )
    ) {
      if (
        anchors[depth] === undefined ||
        (/^\$/.test(token) && Number(token.slice(1)) > 255) ||
        (/^[!?]+$/.test(token) &&
          !['!', '?', '!!', '??', '!?', '?!'].includes(token))
      )
        throw new InvalidPgn('pgn_invalid_nag');
      hasNags = true;
      output.push(' ');
    } else {
      if (!/^\d+\.+$/.test(token))
        anchors[depth] = isResult(token) ? undefined : output.length;
      output.push(token);
    }
    offset += token.length;
  }
  if (depth !== 0) throw new InvalidPgn('pgn_unbalanced_rav');
  if (variationResult) throw new InvalidPgn('pgn_variation_result_unsupported');
  return {
    text: output
      .map((text, index) => {
        const attached = annotations.get(index);
        return attached === undefined
          ? text
          : text + attached.drawOffers.join('') + attached.comments.join('');
      })
      .join(''),
    headers,
    comments,
    commentOffsets,
    hasNags,
    duplicateFen,
    ...(result === undefined ? {} : { result }),
  };
}
