import { createHash } from 'node:crypto';
import type { ChessRulesPort } from '../../../../application/chess_graph/index.ts';
import type { PgnTransferCodecPort } from '../../../../application/inventory/inventory-backup-ports.ts';
import type {
  InventoryTransferSnapshot,
  PreparedInventoryRestore,
  TransferChessRecord,
} from '../../../../application/inventory/pgn-transfer-models.ts';
import { ApplicationProblem } from '../../../../application/problems/application-problem.ts';
import { PgnGameReader } from './pgn-game-reader.ts';
import {
  transferLimits,
  transferWorkBatch,
  yieldTransferWork,
} from './pgn-transfer-profile.ts';
import { containsPgnTransferMarker } from './pgn-transfer-marker.ts';
import {
  parseTransferManifest,
  validateTransferManifest,
  requireTransfer,
  transferFailure,
} from './pgn-transfer-schema.ts';
import {
  transferCheckpoint,
  validateTransferGraph,
} from './pgn-transfer-graph.ts';
import { writeTransferProjection } from './pgn-transfer-writer.ts';

async function projectionHash(
  projection: string,
  check: () => void,
): Promise<string> {
  const hash = createHash('sha256');
  for (
    let offset = 0;
    offset < projection.length;
    offset += transferWorkBatch.text * 8
  ) {
    await yieldTransferWork(check);
    hash.update(
      projection.slice(offset, offset + transferWorkBatch.text * 8),
      'latin1',
    );
  }
  return hash.digest('hex');
}

async function* chunks(source: string): AsyncIterable<string> {
  for (let offset = 0; offset < source.length; offset += 16384)
    yield source.slice(offset, offset + 16384);
}

export class PgnInventoryTransferCodec implements PgnTransferCodecPort {
  private readonly rules: ChessRulesPort;
  constructor(rules: ChessRulesPort) {
    this.rules = rules;
  }

  async encode(
    snapshot: InventoryTransferSnapshot,
    signal: AbortSignal,
    checkBudget: () => void,
  ): Promise<Uint8Array> {
    try {
      transferCheckpoint(signal, checkBudget);
      const check = (): void => transferCheckpoint(signal, checkBudget);
      const manifest = await validateTransferManifest(
        { ...snapshot.manifest, pgnSha256: '0'.repeat(64) },
        check,
      );
      const records = await validateTransferGraph(
        manifest,
        snapshot.records,
        this.rules,
        signal,
        checkBudget,
      );
      const projection = await writeTransferProjection(
        manifest,
        records,
        this.rules,
        signal,
        checkBudget,
      );
      const full = {
        ...manifest,
        pgnSha256: await projectionHash(projection, check),
      };
      await yieldTransferWork(check);
      const json = JSON.stringify(full);
      await yieldTransferWork(check);
      if (Buffer.byteLength(json, 'utf8') > transferLimits.manifestBytes)
        transferFailure('resource_exhausted');
      const payload = Buffer.from(json, 'utf8').toString('base64url');
      const lines: string[] = [];
      for (
        let index = 0;
        index < payload.length;
        index += transferWorkBatch.text
      ) {
        await yieldTransferWork(check);
        lines.push(
          payload
            .slice(index, index + transferWorkBatch.text)
            .match(/.{1,64}/g)!
            .join('\n'),
        );
      }
      const block = `[%plysmith 1,\n${lines.join('\n')}\n]`;
      if (projection.length + block.length > transferLimits.bytes)
        transferFailure('resource_exhausted');
      const offset = projection.indexOf('{') + 1;
      requireTransfer(offset > 0);
      const bytes = Buffer.from(
        projection.slice(0, offset) + block + projection.slice(offset),
        'latin1',
      );
      // Validate our completed wire representation with exactly the restore profile.
      await this.decode(bytes, signal, checkBudget);
      return bytes;
    } catch (error) {
      return this.fail(error);
    }
  }

  async decode(
    bytes: Uint8Array,
    signal: AbortSignal,
    checkBudget: () => void,
  ): Promise<PreparedInventoryRestore> {
    try {
      transferCheckpoint(signal, checkBudget);
      if (bytes.byteLength > transferLimits.bytes)
        transferFailure('resource_exhausted');
      const check = (): void => transferCheckpoint(signal, checkBudget);
      requireTransfer(containsPgnTransferMarker(bytes.subarray(0, 4096)));
      const source = Buffer.from(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      )
        .toString('latin1')
        .replace(/\r\n/g, '\n');
      requireTransfer(
        !source.includes('\r') && !source.startsWith('\xef\xbb\xbf'),
      );
      const first = /^(?:\s*\[[A-Za-z]+ "(?:[^"\\\n]|\\["\\])*"\]\n)+\n\{/.exec(
        source.slice(0, 4096),
      );
      requireTransfer(first);
      const start = first[0].length;
      requireTransfer(source.startsWith('[%plysmith ', start));
      const version = /^\[%plysmith ([0-9]+),\n/.exec(
        source.slice(start, start + 64),
      );
      requireTransfer(version);
      if (version[1] !== '1') transferFailure('unsupported_version');
      const end = source.indexOf(']', start);
      requireTransfer(end > start);
      const encoded = source.slice(start + version[0].length, end);
      const maxEncoded = Math.ceil((transferLimits.manifestBytes * 4) / 3);
      let lineLength = 0,
        payloadLength = 0;
      for (let index = 0; index < encoded.length; index++) {
        if (index % transferWorkBatch.text === 0)
          await yieldTransferWork(check);
        const code = encoded.charCodeAt(index);
        if (code === 10) {
          requireTransfer(lineLength > 0);
          lineLength = 0;
        } else {
          requireTransfer(
            ++lineLength <= 64 &&
              ((code >= 65 && code <= 90) ||
                (code >= 97 && code <= 122) ||
                (code >= 48 && code <= 57) ||
                code === 45 ||
                code === 95),
          );
          if (++payloadLength > maxEncoded)
            transferFailure('resource_exhausted');
        }
      }
      requireTransfer(payloadLength > 0 && lineLength === 0);
      const compact = encoded.replace(/\n/g, '');
      if (compact.length > maxEncoded) transferFailure('resource_exhausted');
      const payload = Buffer.from(compact, 'base64url');
      requireTransfer(payload.toString('base64url') === compact);
      if (payload.length > transferLimits.manifestBytes)
        transferFailure('resource_exhausted');
      let json: string;
      try {
        json = new TextDecoder('utf-8', {
          fatal: true,
          ignoreBOM: true,
        }).decode(payload);
      } catch {
        transferFailure();
      }
      const manifest = await parseTransferManifest(json, check);
      const projection = source.slice(0, start) + source.slice(end + 1);
      requireTransfer(
        !/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(projection) &&
          !projection.includes('[%plysmith') &&
          manifest.pgnSha256 === (await projectionHash(projection, check)),
      );
      let lineIndex = 0;
      for (let offset = 0; offset < projection.length;) {
        if (lineIndex++ % transferWorkBatch.lines === 0)
          await yieldTransferWork(check);
        const end = projection.indexOf('\n', offset);
        const line = projection.slice(
          offset,
          end < 0 ? projection.length : end,
        );
        requireTransfer(
          line.length < 80 || (line.startsWith('[FEN "') && line.length < 255),
        );
        offset = end < 0 ? projection.length : end + 1;
      }
      const records: TransferChessRecord[] = [];
      await new PgnGameReader(this.rules, 'transfer', checkBudget).decode(
        chunks(projection),
        {
          signal,
          onCandidate: async (candidate) => {
            requireTransfer(candidate.status !== 'rejected' && candidate.root);
            records.push({
              root: candidate.root,
              nodes: candidate.nodes,
              result: candidate.result,
            });
          },
        },
      );
      transferCheckpoint(signal, checkBudget);
      if (manifest.carrier) {
        requireTransfer(
          records.length === 1 &&
            records[0]!.nodes.length === 0 &&
            records[0]!.root.fen === this.rules.initialState().fen &&
            records[0]!.result === '*' &&
            projection.startsWith('[Event "Plysmith collection"]\n'),
        );
        records.length = 0;
      }
      const validated = await validateTransferGraph(
        manifest,
        records,
        this.rules,
        signal,
        checkBudget,
      );
      return { manifest, records: validated };
    } catch (error) {
      return this.fail(error);
    }
  }

  private fail(error: unknown): never {
    if (
      error instanceof ApplicationProblem &&
      error.problemCode.startsWith('inventory_transfer.')
    )
      throw error;
    if (
      error instanceof ApplicationProblem &&
      error.problemCode === 'import.interrupted'
    )
      transferFailure('interrupted');
    if (
      error instanceof ApplicationProblem &&
      (error.problemCode === 'import.input_too_large' ||
        error.problemCode === 'import.provider_resource_exhausted')
    )
      transferFailure('resource_exhausted');
    transferFailure();
  }
}
