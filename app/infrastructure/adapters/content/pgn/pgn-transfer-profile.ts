import { setImmediate } from 'node:timers/promises';
import type { ContentFormatLimits } from '../../../../application/inventory/content-format-port.ts';

export const transferWorkBatch = Object.freeze({
  moves: 8,
  objects: 128,
  text: 8192,
  lines: 256,
});

export async function yieldTransferWork(check: () => void): Promise<void> {
  check();
  await setImmediate();
  check();
}

export const transferLimits = Object.freeze({
  bytes: 64 * 1024 * 1024,
  manifestBytes: 32 * 1024 * 1024,
  records: 4096,
  folders: 4096,
  folderDepth: 64,
  nodes: 262144,
  recordNodes: 16384,
  path: 1000,
  contributions: 65536,
  note: 128000,
  text: 8 * 1024 * 1024,
});

export const transferPgnLimits: ContentFormatLimits = Object.freeze({
  maxInputCharacters: transferLimits.bytes,
  maxCandidateCharacters: transferLimits.bytes,
  maxCandidates: transferLimits.records,
  maxNodesPerCandidate: transferLimits.recordNodes,
  maxVariationDepth: 32,
  maxHeadersPerCandidate: 9,
  maxStringCharacters: transferLimits.bytes,
  maxLineCharacters: 254,
  maxSyntaxCharacters: 32 * (transferLimits.recordNodes + 1),
  maxTokensPerCandidate: 32 * (transferLimits.recordNodes + 1),
  maxCommentsPerCandidate: transferLimits.recordNodes + 1,
  maxVariationsPerCandidate: transferLimits.recordNodes,
});
