import type { ChessRulesPort } from '../../../../application/chess_graph/index.ts';
import type {
  PgnTransferManifest,
  TransferChessRecord,
} from '../../../../application/inventory/pgn-transfer-models.ts';
import {
  playTransferMoves,
  transferCheckpoint,
  transferState,
} from './pgn-transfer-graph.ts';
import {
  transferLimits,
  transferWorkBatch,
  yieldTransferWork,
} from './pgn-transfer-profile.ts';
import { requireTransfer, transferFailure } from './pgn-transfer-schema.ts';

export function projectTransferText(text: string): string {
  let result = '';
  for (let index = 0; index < text.length; index++)
    result += projectTransferCharacter(text, index);
  return result;
}

function projectTransferCharacter(text: string, index: number): string {
  const code = text.charCodeAt(index),
    character = text[index]!;
  return code > 255 ||
    (code < 32 && character !== '\n') ||
    (code >= 127 && code < 160) ||
    character === '\\' ||
    character === '{' ||
    character === '}' ||
    (character === '[' && text[index + 1] === '%')
    ? `\\u${code.toString(16).padStart(4, '0')}`
    : character;
}

function tag(name: string, value: string): string {
  return `[${name} "${projectTransferText(value).replace(/\n/g, '\\u000a').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

class Movetext {
  private lines: string[] = [];
  private current = '';
  private bytes = 0;
  private readonly maximumBytes: number;
  constructor(maximumBytes: number) {
    this.maximumBytes = maximumBytes;
  }
  token(value: string): void {
    this.bytes += value.length + 1;
    if (this.bytes > this.maximumBytes) transferFailure('resource_exhausted');
    if (this.current.length && this.current.length + value.length + 1 > 79)
      this.newline();
    this.current += (this.current.length ? ' ' : '') + value;
  }
  newline(): void {
    this.lines.push(this.current);
    this.current = '';
  }
  async comment(value: string, check: () => void): Promise<void> {
    this.token('{');
    this.newline();
    let line = '',
      hasContent = false;
    for (let index = 0; index < value.length; index++) {
      if (index % transferWorkBatch.text === 0) await yieldTransferWork(check);
      const character = value[index]!;
      if (character === '\n') {
        if (line.length) {
          this.token(line);
          this.newline();
        } else if (!hasContent) this.newline();
        line = '';
        hasContent = false;
        continue;
      }
      hasContent = true;
      line += projectTransferCharacter(value, index);
      if (line.length >= 76) {
        this.token(line.slice(0, 76));
        this.newline();
        line = line.slice(76);
      }
    }
    if (line.length) {
      this.token(line);
      this.newline();
    } else if (!hasContent) this.newline();
    this.token('}');
  }
  finish(): string {
    this.newline();
    return this.lines.join('\n') + '\n';
  }
}

export async function writeTransferProjection(
  manifest: PgnTransferManifest,
  records: readonly TransferChessRecord[],
  rules: ChessRulesPort,
  signal: AbortSignal,
  checkBudget: () => void,
): Promise<string> {
  const check = (): void => transferCheckpoint(signal, checkBudget);
  const items = new Map(manifest.items.map((i) => [i.id, i]));
  const metadataById = new Map(manifest.records.map((r) => [r.id, r]));
  const noteText = new Map<string, string>();
  const notesByAnchor = new Map<string, number[]>();
  for (let index = 0; index < manifest.contributions.length; index++) {
    if (index % transferWorkBatch.objects === 0) await yieldTransferWork(check);
    const note = manifest.contributions[index]!;
    let text = note.body;
    if (note.rationale !== null) text += `\n${note.rationale}`;
    if (note.movesRoot !== null) {
      const witness = note.movesRoot,
        record = metadataById.get(witness.record)!;
      const played = await playTransferMoves(
        rules,
        transferState(records[record.pgnIndex]!, witness.node),
        note.moves,
        check,
      );
      text += `\nContinuation: ${played.san.join(' ')}`;
    }
    noteText.set(note.id, text);
    const list = notesByAnchor.get(note.anchor) ?? [];
    list.push(index);
    notesByAnchor.set(note.anchor, list);
  }
  const anchorNotes = new Map<string, number[]>();
  let anchorIndex = 0;
  for (const anchor of manifest.anchors) {
    if (anchorIndex++ % transferWorkBatch.objects === 0)
      await yieldTransferWork(check);
    let key: string;
    if (anchor.kind === 'position') {
      const r = metadataById.get(anchor.witness.record)!;
      key = `position:${transferState(records[r.pgnIndex]!, anchor.witness.node).position.positionKey}`;
    } else
      key =
        anchor.kind === 'item'
          ? `item:${anchor.item}`
          : anchor.kind === 'occurrence'
            ? `occurrence:${anchor.occurrence}`
            : `move:${anchor.move}`;
    anchorNotes.set(key, notesByAnchor.get(anchor.id) ?? []);
  }
  const chunks: string[] = [];
  let bytes = 0;
  for (let index = 0; index < Math.max(1, records.length); index++) {
    await yieldTransferWork(check);
    const metadata = manifest.records[index];
    const record = records[index] ?? {
      root: rules.initialState(),
      nodes: [],
      result: '*' as const,
    };
    const name = metadata?.name ?? 'Plysmith collection';
    let event = tag('Event', name);
    if (event.length + 1 >= 80) event = tag('Event', '?');
    const headers = [
      event,
      '[Site "?"]',
      '[Date "????.??.??"]',
      '[Round "?"]',
      '[White "?"]',
      '[Black "?"]',
      `[Result "${record.result}"]`,
    ];
    if (record.root.fen !== rules.initialState().fen) {
      const fen = tag('FEN', record.root.fen);
      requireTransfer(fen.length + 1 <= 255);
      headers.push('[SetUp "1"]', fen);
    }
    const text = new Movetext(
      transferLimits.bytes - bytes - headers.join('\n').length - 2,
    );
    const proseAt = (node: number): string => {
      if (!metadata) return '';
      const tuple = metadata.nodes[node]!;
      const ids = [
        ...(node === 0 ? (anchorNotes.get(`item:${metadata.item}`) ?? []) : []),
        ...(anchorNotes.get(`occurrence:${tuple[0]}`) ?? []),
        ...(tuple[1] === null
          ? []
          : (anchorNotes.get(`move:${tuple[1]}`) ?? [])),
        ...(anchorNotes.get(
          `position:${transferState(record, node).position.positionKey}`,
        ) ?? []),
      ];
      ids.sort((a, b) => a - b);
      return ids
        .map((id) => noteText.get(manifest.contributions[id]!.id)!)
        .join('\n\n');
    };
    let rootText = `Title: ${name}`;
    if (metadata?.summary !== null && metadata?.summary !== undefined)
      rootText += `\n\n${metadata.summary}`;
    if (
      metadata &&
      (items.get(metadata.item)!.role === 'provenanceOnly' ||
        items.get(metadata.item)!.currentRevision !== metadata.id)
    )
      rootText += '\nProvenance revision';
    if (metadata?.sourcePath) {
      const path = metadata.sourcePath,
        parsed = rules.parseFen(path.rootFen);
      requireTransfer(parsed.ok);
      const played = await playTransferMoves(
        rules,
        parsed.value,
        path.moves,
        check,
      );
      rootText += `\nSource path: ${path.title}\nFEN: ${path.rootFen}\n${played.san.join(' ')}`;
    }
    const rootNotes = proseAt(0);
    if (rootNotes) rootText += `\n\n${rootNotes}`;
    await text.comment(rootText, check);
    const children = new Map<number | null, number[]>();
    for (const node of record.nodes) {
      if (node.nodeIndex % transferWorkBatch.objects === 0)
        await yieldTransferWork(check);
      const list = children.get(node.parentNodeIndex) ?? [];
      list.push(node.nodeIndex);
      children.set(node.parentNodeIndex, list);
    }
    type Action =
      | { kind: 'move'; index: number; siblings: boolean; depth: number }
      | { kind: 'token'; value: string };
    const stack: Action[] = [];
    if (record.nodes.length)
      stack.push({ kind: 'move', index: 0, siblings: true, depth: 0 });
    let count = 0;
    while (stack.length) {
      if (++count % transferWorkBatch.objects === 0)
        await yieldTransferWork(check);
      const action = stack.pop()!;
      if (action.kind === 'token') {
        text.token(action.value);
        continue;
      }
      if (action.depth > 32) transferFailure('resource_exhausted');
      const node = record.nodes[action.index]!;
      const before =
        node.parentNodeIndex === null
          ? record.root
          : record.nodes[node.parentNodeIndex]!.after;
      text.token(
        `${before.playState.fullmoveNumber}${before.position.sideToMove === 'white' ? '.' : '...'}`,
      );
      text.token(node.move.san);
      const prose = proseAt(node.nodeIndex + 1);
      if (prose) await text.comment(prose, check);
      const continuation = children.get(node.nodeIndex)?.[0];
      if (continuation !== undefined)
        stack.push({
          kind: 'move',
          index: continuation,
          siblings: true,
          depth: action.depth,
        });
      if (action.siblings) {
        const siblings = children.get(node.parentNodeIndex)!;
        for (let i = siblings.length - 1; i > 0; i--)
          stack.push(
            { kind: 'token', value: ')' },
            {
              kind: 'move',
              index: siblings[i]!,
              siblings: false,
              depth: action.depth + 1,
            },
            { kind: 'token', value: '(' },
          );
      }
    }
    text.token(record.result);
    const chunk = headers.join('\n') + '\n\n' + text.finish();
    bytes += chunk.length + (index ? 1 : 0);
    if (bytes > transferLimits.bytes) transferFailure('resource_exhausted');
    chunks.push(chunk);
  }
  const projection = chunks.join('\n');
  check();
  return projection;
}
