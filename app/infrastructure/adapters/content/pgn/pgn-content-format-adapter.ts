import { setImmediate } from 'node:timers/promises';

import { parseGame, type ParseTree } from '@mliebelt/pgn-parser';

import type { ChessRulesPort } from '../../../../application/chess_graph/index.ts';
import {
  ContentFormatError,
  type ContentFormatPort,
  type ContentFormatRequest,
  type ContentFormatLimits,
} from '../../../../application/inventory/content-format-port.ts';
import type { ChessState } from '../../../../domain/chess_graph/index.ts';
import { IMPORT_LIMITS } from '../../../../application/inventory/import-limits.ts';
import type {
  ChessTreeCandidate,
  ImportedMoveNode,
  ImportFidelityFinding,
} from '../../../../domain/inventory/chess-tree-candidate.ts';
import {
  InvalidPgn,
  isResult,
  PgnFramer,
  pgnLimits,
  shieldPgn,
} from './pgn-structure.ts';
import {
  filterCommentDirectives,
  meaningfulTagValue,
  tagComments,
} from './pgn-comments.ts';

export { pgnLimits };

export class PgnContentFormatAdapter implements ContentFormatPort {
  readonly descriptor = Object.freeze({
    formatId: 'standard-chess-pgn-v1' as const,
    fileExtensions: ['.pgn'],
    adapterVersion: '1.0.0',
    limits: pgnLimits,
  });
  private readonly rules: ChessRulesPort;

  constructor(rules: ChessRulesPort) {
    this.rules = rules;
  }

  async decode(
    chunks: AsyncIterable<string>,
    request: ContentFormatRequest,
  ): Promise<void> {
    const limits = pgnLimits;
    const framer = new PgnFramer(limits);
    let sourceOrder = 0;
    let characters = 0;
    const emit = async (source: string): Promise<void> => {
      checkAbort(request.signal);
      if (sourceOrder >= limits.maxCandidates)
        throw new ContentFormatError('provider_resource_exhausted');
      const candidate = framer.lastCandidateResourceLimited
        ? {
            sourceOrder: sourceOrder++,
            suggestedName: `PGN ${sourceOrder}`,
            status: 'rejected' as const,
            nodes: [],
            initialComments: [],
            result: '*' as const,
            findings: [
              {
                code: 'pgn_resource_limit',
                disposition: 'invalid' as const,
                feature: 'resources',
                severity: 'error' as const,
              },
            ],
          }
        : await this.parseCandidate(
            source,
            sourceOrder++,
            limits,
            request.signal,
          );
      checkAbort(request.signal);
      await request.onCandidate(candidate);
      checkAbort(request.signal);
    };
    checkAbort(request.signal);
    for await (const chunk of chunks) {
      checkAbort(request.signal);
      for (const character of chunk) {
        if (++characters % 4096 === 0) await checkpoint(request.signal);
        const complete = framer.push(character);
        if (complete !== undefined) await emit(complete);
      }
    }
    checkAbort(request.signal);
    const last = framer.finish();
    if (last !== undefined) await emit(last);
    if (sourceOrder === 0)
      throw new ContentFormatError('format_not_recognized');
  }

  private async parseCandidate(
    source: string,
    sourceOrder: number,
    limits: ContentFormatLimits,
    signal: AbortSignal,
  ): Promise<ChessTreeCandidate> {
    const findings: ImportFidelityFinding[] = [];
    let headers: { name: string; value: string }[] = [];
    let initialComments: readonly string[] = [];
    let result: ChessTreeCandidate['result'] = '*';
    let root: ChessState | undefined;
    let nodes: ImportedMoveNode[] = [];
    const add = (
      code: string,
      disposition: ImportFidelityFinding['disposition'],
      feature: string,
      severity: ImportFidelityFinding['severity'] = 'info',
      nodeIndex?: number,
    ): void => {
      if (
        findings.some(
          (finding) =>
            finding.code === code &&
            finding.disposition === disposition &&
            finding.severity === severity,
        )
      )
        return;
      findings.push({
        code,
        disposition,
        severity,
        feature,
        ...(nodeIndex === undefined ? {} : { nodeIndex }),
      });
    };
    try {
      const shielded = shieldPgn(source.replace(/\r\n?/g, '\n'), limits);
      headers = shielded.headers;
      if (shielded.duplicateFen)
        add('pgn_duplicate_fen_normalized', 'normalized', 'fen');
      const tag = (name: string): string | undefined =>
        headers.find(
          (header) => header.name.toLowerCase() === name.toLowerCase(),
        )?.value;
      const variant = tag('Variant');
      if (
        variant !== undefined &&
        variant !== 'Standard' &&
        variant !== 'From Position'
      ) {
        add('pgn_variant_unsupported', 'unsupported', 'variant', 'error');
        throw new InvalidPgn('pgn_variant_unsupported');
      }
      const setup = tag('SetUp');
      const fen = tag('FEN');
      if (
        (setup !== undefined && setup !== '0' && setup !== '1') ||
        (setup === '1' && fen === undefined) ||
        (fen !== undefined && setup !== '1') ||
        (variant === 'From Position' && (fen === undefined || setup !== '1'))
      )
        throw new InvalidPgn('pgn_invalid_setup');
      root = this.rules.initialState();
      if (fen !== undefined) {
        const parsed = this.rules.parseFen(fen.trim().replace(/\s+/g, ' '));
        if (!parsed.ok) throw new InvalidPgn('pgn_invalid_fen');
        root = parsed.value;
        add('pgn_fen_normalized', 'normalized', 'fen');
      }
      const headerResult = tag('Result');
      if (headerResult !== undefined && !isResult(headerResult))
        throw new InvalidPgn('pgn_invalid_result');
      if (
        headerResult !== undefined &&
        shielded.result !== undefined &&
        headerResult !== shielded.result
      )
        throw new InvalidPgn('pgn_result_mismatch');
      result =
        shielded.result ??
        (isResult(headerResult ?? '')
          ? (headerResult as ChessTreeCandidate['result'])
          : '*');
      if (shielded.result === undefined)
        add('pgn_result_missing', 'normalized', 'result', 'warning');
      // Bounds above also cover the library's recursion through moves, NAGs and sibling RAVs.
      await checkpoint(signal);
      let parsed: ParseTree;
      try {
        parsed = parseGame(shielded.text, { startRule: 'game' });
      } catch {
        throw new InvalidPgn('pgn_invalid_syntax');
      }
      if (parsed.messages.length > 0)
        throw new InvalidPgn('pgn_parser_diagnostic');
      if (
        parsed.moves.length === 0 &&
        headers.length === 0 &&
        shielded.result === undefined
      )
        throw new InvalidPgn('pgn_empty_candidate');
      const usedComments = new Set<number>();
      let hasDirectives = false;
      type Fragment = { offset: number; text: string };
      const anchorComments = new Map<number | null, Fragment[]>();
      const restoreComments = (value: string | undefined): Fragment[] => {
        const restored: Fragment[] = [];
        for (const marker of value?.trim().split(/\s+/).filter(Boolean) ?? []) {
          const match = /^PLYSMITHCOMMENT(\d+)$/.exec(marker);
          if (!match) throw new InvalidPgn('pgn_comment_fidelity');
          const index = Number(match[1]);
          const comment = shielded.comments[index];
          if (comment === undefined || usedComments.has(index))
            throw new InvalidPgn('pgn_comment_fidelity');
          usedComments.add(index);
          const text = filterCommentDirectives(comment);
          hasDirectives ||= text !== comment;
          restored.push({
            offset: shielded.commentOffsets[index]!,
            text,
          });
        }
        return restored;
      };
      initialComments = tagComments([
        ...headers.filter((header) => header.name.toLowerCase() !== 'result'),
        { name: 'Result', value: result },
      ]);
      anchorComments.set(null, restoreComments(parsed.gameComment?.comment));
      let hasNags = shielded.hasNags;
      type Frame = {
        line: ParseTree['moves'];
        index: number;
        parent: number | null;
        before: ChessState;
        depth: number;
      };
      const stack: Frame[] = [
        { line: parsed.moves, index: 0, parent: null, before: root, depth: 0 },
      ];
      const siblingCounts = new Map<number | null, number>();
      while (stack.length > 0) {
        if (nodes.length % 32 === 0) await checkpoint(signal);
        const frame = stack.pop()!;
        const move = frame.line[frame.index];
        if (!move) continue;
        if (
          nodes.length >= limits.maxNodesPerCandidate ||
          frame.depth >= IMPORT_LIMITS.maxPathHalfMoves
        )
          throw new ContentFormatError('provider_resource_exhausted');
        const nodeIndex = nodes.length;
        const applied = applyPgnMove(
          this.rules,
          frame.before,
          move.notation.notation,
        );
        if (!applied.ok) {
          add('pgn_illegal_san', 'invalid', 'san', 'error', nodeIndex);
          throw new InvalidPgn('pgn_illegal_san');
        }
        const nags = (move.nag ?? []).map((nag) => Number(nag.slice(1)));
        if (nags.some((nag) => !Number.isInteger(nag) || nag < 0 || nag > 255))
          throw new InvalidPgn('pgn_invalid_nag');
        hasNags ||= nags.length > 0;
        const siblingOrder = siblingCounts.get(frame.parent) ?? 0;
        if (siblingOrder > IMPORT_LIMITS.maxAlternativesPerOccurrence)
          throw new ContentFormatError('provider_resource_exhausted');
        siblingCounts.set(frame.parent, siblingOrder + 1);
        anchorComments.set(nodeIndex, restoreComments(move.commentAfter));
        anchorComments
          .get(frame.parent)!
          .push(...restoreComments(move.commentMove));
        nodes.push({
          nodeIndex,
          parentNodeIndex: frame.parent,
          siblingOrder,
          move: applied.value.move,
          after: applied.value.after,
          comments: [],
          startingComments: [],
        });
        if (move.drawOffer)
          add(
            'pgn_draw_offer_unsupported',
            'unsupported',
            'draw_offer',
            'warning',
            nodeIndex,
          );
        for (const variation of [...move.variations].reverse())
          stack.push({
            line: variation,
            index: 0,
            parent: frame.parent,
            before: frame.before,
            depth: frame.depth,
          });
        stack.push({
          line: frame.line,
          index: frame.index + 1,
          parent: nodeIndex,
          before: applied.value.after,
          depth: frame.depth + 1,
        });
      }
      if (usedComments.size !== shielded.comments.length)
        throw new InvalidPgn('pgn_comment_fidelity');
      // Branch introductions share their parent occurrence; traversal order is not source order.
      const aggregate = (
        anchor: number | null,
        prefix: readonly string[] = [],
      ): string[] => {
        const parts = [
          ...prefix,
          ...anchorComments
            .get(anchor)!
            .sort((a, b) => a.offset - b.offset)
            .map((fragment) => fragment.text.trim()),
        ].filter((text) => text.trim().length > 0);
        const text = parts.join('\n\n');
        if (text.length > IMPORT_LIMITS.maxSingleNoteCharacters)
          throw new ContentFormatError('provider_resource_exhausted');
        return text.length === 0 ? [] : [text];
      };
      initialComments = aggregate(null, initialComments);
      nodes = nodes.map((node) => ({
        ...node,
        comments: aggregate(node.nodeIndex),
      }));
      add('pgn_text_normalized', 'normalized', 'whitespace');
      if (nodes.length > 0) add('pgn_san_normalized', 'normalized', 'san');
      if (
        [...anchorComments.values()].some((fragments) =>
          fragments.some((fragment) => fragment.text.trim().length > 0),
        )
      )
        add('pgn_comments_preserved', 'preserved', 'comments');
      if (hasDirectives)
        add('pgn_directives_omitted', 'unsupported', 'comment_directives');
      if (hasNags) add('pgn_nags_omitted', 'unsupported', 'nags');
      if (nodes.some((node) => node.siblingOrder > 0))
        add('pgn_rav_preserved', 'preserved', 'rav');
    } catch (error) {
      if (
        error instanceof ContentFormatError &&
        error.code === 'provider_resource_exhausted'
      ) {
        add('pgn_resource_limit', 'invalid', 'resources', 'error');
      } else {
        if (!(error instanceof InvalidPgn)) throw error;
        if (!findings.some((finding) => finding.code === error.code))
          add(
            error.code,
            error.code.endsWith('_unsupported') ? 'unsupported' : 'invalid',
            'pgn',
            'error',
          );
      }
      nodes = [];
      root = undefined;
      initialComments = [];
    }
    const titleTag = (name: string): string | undefined =>
      meaningfulTagValue(
        headers.find(
          (header) => header.name.toLowerCase() === name.toLowerCase(),
        )?.value,
      );
    const white = titleTag('White');
    const black = titleTag('Black');
    const event =
      titleTag('ChapterName') ?? titleTag('Event') ?? titleTag('StudyName');
    const suggestedName = (
      white && black ? `${white} - ${black}` : event || `PGN ${sourceOrder + 1}`
    ).slice(0, 200);
    return {
      sourceOrder,
      suggestedName,
      status: findings.some((finding) => finding.severity === 'error')
        ? 'rejected'
        : findings.some((finding) => finding.severity === 'warning')
          ? 'warning'
          : 'ready',
      ...(root === undefined ? {} : { root }),
      nodes,
      initialComments,
      result,
      findings,
    };
  }
}

function applyPgnMove(
  rules: ChessRulesPort,
  before: ChessState,
  notation: string,
) {
  const applied = rules.applyMove(before, [], {
    kind: 'notation',
    value: notation,
    locale: 'en-GB',
  });
  if (applied.ok) return applied;
  // Accept redundant origins only when the legal move set proves a unique match.
  const match = /^([KQRBN])([a-h])?([1-8])?([x-]?)([a-h][1-8])([+#]?)$/.exec(
    notation,
  );
  if (!match || (!match[2] && !match[3])) return applied;
  const legal = rules.legalMoves(before, []);
  if (!legal.ok) return applied;
  const matches = legal.value.filter(
    (move) =>
      move.san[0] === match[1] &&
      move.to === match[5] &&
      (!match[2] || move.from[0] === match[2]) &&
      (!match[3] || move.from[1] === match[3]) &&
      move.san.includes('x') === (match[4] === 'x') &&
      (!match[6] || move.san.endsWith(match[6])),
  );
  if (matches.length !== 1) return applied;
  return rules.applyMove(before, [], {
    kind: 'coordinates',
    value: matches[0]!.from + matches[0]!.to,
  });
}

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new ContentFormatError('interrupted');
}

async function checkpoint(signal: AbortSignal): Promise<void> {
  checkAbort(signal);
  await setImmediate();
  checkAbort(signal);
}
