import { ApplicationProblem } from '../../../../application/problems/application-problem.ts';
import type { PgnTransferManifest } from '../../../../application/inventory/pgn-transfer-models.ts';
import {
  transferLimits as limits,
  transferWorkBatch,
  yieldTransferWork,
} from './pgn-transfer-profile.ts';

export function transferFailure(code = 'invalid_backup'): never {
  throw new ApplicationProblem(
    `inventory_transfer.${code}`,
    `Inventory transfer: ${code}.`,
  );
}

export function requireTransfer(condition: unknown): asserts condition {
  if (!condition) transferFailure();
}

function object(value: unknown, fields: string): Record<string, unknown> {
  requireTransfer(
    value !== null && typeof value === 'object' && !Array.isArray(value),
  );
  const keys = Object.keys(value);
  const expected = fields.split(' ');
  requireTransfer(
    keys.length === expected.length &&
      keys.every((key) => expected.includes(key)),
  );
  return value as Record<string, unknown>;
}

function text(
  value: unknown,
  max: number,
  nonempty = true,
): asserts value is string {
  requireTransfer(
    typeof value === 'string' &&
      value.length <= max &&
      (!nonempty || value.trim().length > 0),
  );
}

function choice(value: unknown, values: string): void {
  requireTransfer(
    typeof value === 'string' && values.split(' ').includes(value),
  );
}

function integer(value: unknown, min = 0): void {
  requireTransfer(Number.isSafeInteger(value) && (value as number) >= min);
}

function key(value: unknown, prefix: string, nullable = false): void {
  if (nullable && value === null) return;
  requireTransfer(
    typeof value === 'string' &&
      value.length <= 32 &&
      new RegExp(`^${prefix}[1-9][0-9]*$`).test(value),
  );
}

function timestamp(value: unknown): void {
  text(value, 32);
  requireTransfer(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value),
  );
  const time = Date.parse(value);
  requireTransfer(
    Number.isFinite(time) &&
      new Date(time).toISOString() ===
        (value.length === 20 ? value.replace('Z', '.000Z') : value),
  );
}

function language(value: unknown): void {
  text(value, 35);
  requireTransfer(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value));
}

function array(value: unknown, max: number): unknown[] {
  requireTransfer(Array.isArray(value));
  if (value.length > max) transferFailure('resource_exhausted');
  return value;
}

function witness(value: unknown): void {
  const v = object(value, 'record node');
  key(v.record, 'r');
  integer(v.node);
}

async function moves(value: unknown, check: () => void): Promise<number> {
  const values = array(value, limits.path);
  for (let index = 0; index < values.length; index++) {
    if (index % transferWorkBatch.objects === 0) await yieldTransferWork(check);
    const move = values[index]!;
    const v = object(move, 'from to promotion');
    requireTransfer(typeof v.from === 'string' && /^[a-h][1-8]$/.test(v.from));
    requireTransfer(typeof v.to === 'string' && /^[a-h][1-8]$/.test(v.to));
    if (v.promotion !== null) choice(v.promotion, 'queen rook bishop knight');
  }
  return values.length;
}

function knowledge(value: unknown): void {
  choice(value, 'complete partial unknown');
}

function game(value: unknown): void {
  const g = object(value, 'playerSide result policy');
  choice(g.playerSide, 'white black');
  const r = object(g.result, 'kind source reason');
  choice(r.kind, 'white_win black_win draw unfinished');
  choice(r.source, 'manual automatic');
  if (r.source === 'manual') requireTransfer(r.reason === null);
  else if (r.kind === 'white_win' || r.kind === 'black_win')
    requireTransfer(r.reason === 'checkmate');
  else {
    requireTransfer(r.kind === 'draw');
    choice(
      r.reason,
      'stalemate insufficient_material threefold_repetition seventy_five_move',
    );
  }
  const p = object(
    g.policy,
    'capability providerInstanceId providerFingerprint providerType providerDisplayName profile',
  );
  choice(p.capability, 'best_move human_profile');
  for (const name of [
    'providerInstanceId',
    'providerFingerprint',
    'providerType',
    'providerDisplayName',
  ])
    text(p[name], 1024);
  if (p.capability === 'best_move') requireTransfer(p.profile === null);
  else {
    const profile = object(
      p.profile,
      'modelName selectionMode historyMode reproducibility',
    );
    text(profile.modelName, 160);
    choice(profile.selectionMode, 'most_likely sampled');
    choice(profile.historyMode, 'known_position_history position_only');
    choice(profile.reproducibility, 'deterministic stochastic');
  }
}

/** Lexical bound before JSON.parse; canonical stringify subsequently rejects duplicate keys. */
export async function parseTransferManifest(
  json: string,
  check: () => void,
): Promise<PgnTransferManifest> {
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let index = 0; index < json.length; index++) {
    if (index % transferWorkBatch.text === 0) await yieldTransferWork(check);
    const c = json[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{' || c === '[') {
      if (++depth > 16) transferFailure('resource_exhausted');
    } else if (c === '}' || c === ']') depth--;
  }
  let value: unknown;
  await yieldTransferWork(check);
  try {
    value = JSON.parse(json);
  } catch {
    transferFailure();
  }
  requireTransfer(JSON.stringify(value) === json);
  await yieldTransferWork(check);
  return validateTransferManifest(value, check);
}

export async function validateTransferManifest(
  value: unknown,
  check: () => void,
): Promise<PgnTransferManifest> {
  check();
  const m = object(
    value,
    'version pgnSha256 carrier folders items records anchors contributions',
  );
  if (m.version !== 1) transferFailure('unsupported_version');
  requireTransfer(
    typeof m.pgnSha256 === 'string' && /^[a-f0-9]{64}$/.test(m.pgnSha256),
  );
  requireTransfer(typeof m.carrier === 'boolean');
  let nodeCount = 0,
    textCount = 0;
  const note = (value: unknown): void => {
    text(value, limits.note, false);
    textCount += value.length;
  };
  const seen = new Set<string>();
  let entries = 0;
  const id = (value: unknown, prefix: string): void => {
    key(value, prefix);
    requireTransfer(!seen.has(value as string));
    seen.add(value as string);
  };
  for (const entry of array(m.folders, limits.folders)) {
    if (entries++ % transferWorkBatch.objects === 0)
      await yieldTransferWork(check);
    const f = object(entry, 'id parent name');
    id(f.id, 'f');
    key(f.parent, 'f', true);
    text(f.name, 200);
  }
  for (const entry of array(m.items, limits.records)) {
    if (entries++ % transferWorkBatch.objects === 0)
      await yieldTransferWork(check);
    const i = object(
      entry,
      'id role itemType originKind lifecycle folder currentRevision retainedRevision createdAt updatedAt',
    );
    id(i.id, 'i');
    choice(i.role, 'inventory provenanceOnly');
    choice(i.itemType, 'analysis game');
    choice(
      i.originKind,
      'manual structured_import playout live_observed live_played',
    );
    choice(i.lifecycle, 'active archived trashed tombstone');
    key(i.folder, 'f', true);
    key(i.currentRevision, 'r', true);
    key(i.retainedRevision, 'r', true);
    timestamp(i.createdAt);
    timestamp(i.updatedAt);
    requireTransfer(
      i.role === 'inventory'
        ? i.lifecycle === 'active' &&
            i.currentRevision !== null &&
            i.retainedRevision === null
        : i.lifecycle !== 'active' &&
            i.currentRevision === null &&
            i.retainedRevision !== null,
    );
  }
  for (const entry of array(m.records, limits.records)) {
    if (entries++ % transferWorkBatch.objects === 0)
      await yieldTransferWork(check);
    const r = object(
      entry,
      'id item pgnIndex revisionNumber baseRevision changeKind name summary languageTag creatorRole createdAt origin nodes game sourcePath',
    );
    id(r.id, 'r');
    key(r.item, 'i');
    integer(r.pgnIndex);
    integer(r.revisionNumber, 1);
    key(r.baseRevision, 'r', true);
    choice(
      r.changeKind,
      'created extend truncate_after replace_move metadata add_variation',
    );
    text(r.name, 200);
    if (r.summary !== null) note(r.summary);
    language(r.languageTag);
    choice(r.creatorRole, 'user importer playout live');
    timestamp(r.createdAt);
    requireTransfer(r.origin !== null && typeof r.origin === 'object');
    const originKind = (r.origin as { kind?: unknown }).kind;
    if (originKind === 'inventory_anchor') {
      const o = object(r.origin, 'kind item revision anchor');
      key(o.item, 'i');
      key(o.revision, 'r');
      key(o.anchor, 'a');
    } else {
      object(r.origin, 'kind');
      choice(originKind, 'initial_position fen position_setup');
    }
    const nodes = array(r.nodes, limits.recordNodes + 1);
    requireTransfer(nodes.length > 0);
    const occurrences = new Set(),
      moveKeys = new Set();
    for (let index = 0; index < nodes.length; index++) {
      if (index % transferWorkBatch.objects === 0)
        await yieldTransferWork(check);
      const node = nodes[index]!;
      const n = array(node, 3);
      requireTransfer(n.length === 3);
      key(n[0], 'o');
      key(n[1], 'm', index === 0);
      knowledge(n[2]);
      requireTransfer(index !== 0 || n[1] === null);
      requireTransfer(
        !occurrences.has(n[0]) && (n[1] === null || !moveKeys.has(n[1])),
      );
      occurrences.add(n[0]);
      moveKeys.add(n[1]);
    }
    nodeCount += nodes.length - 1;
    if (r.game !== null) game(r.game);
    if (r.sourcePath !== null) {
      const s = object(r.sourcePath, 'title rootFen moves historyKnowledge');
      text(s.title, 200);
      text(s.rootFen, 255);
      const count = await moves(s.moves, check);
      nodeCount += count;
      const h = object(s.historyKnowledge, 'root before after');
      knowledge(h.root);
      for (const name of ['before', 'after']) {
        const states = array(h[name], limits.path);
        requireTransfer(states.length === count);
        states.forEach(knowledge);
      }
    }
  }
  for (const entry of array(m.anchors, 2 * limits.nodes + limits.records)) {
    if (entries++ % transferWorkBatch.objects === 0)
      await yieldTransferWork(check);
    requireTransfer(entry !== null && typeof entry === 'object');
    const kind = (entry as { kind?: unknown }).kind;
    if (kind === 'position') {
      const a = object(entry, 'id kind witness');
      id(a.id, 'a');
      witness(a.witness);
    } else if (kind === 'item') {
      const a = object(entry, 'id kind item');
      id(a.id, 'a');
      key(a.item, 'i');
    } else if (kind === 'occurrence') {
      const a = object(entry, 'id kind item occurrence');
      id(a.id, 'a');
      key(a.item, 'i');
      key(a.occurrence, 'o');
    } else {
      requireTransfer(kind === 'move_node');
      const a = object(entry, 'id kind item move');
      id(a.id, 'a');
      key(a.item, 'i');
      key(a.move, 'm');
    }
  }
  for (const entry of array(m.contributions, limits.contributions)) {
    if (entries++ % transferWorkBatch.objects === 0)
      await yieldTransferWork(check);
    const n = object(
      entry,
      'id anchor contributionType authorRole body rationale languageTag version createdAt updatedAt moves movesRoot',
    );
    id(n.id, 'n');
    key(n.anchor, 'a');
    choice(
      n.contributionType,
      'note question decision machine_finding source_statement',
    );
    choice(n.authorRole, 'user engine source');
    note(n.body);
    if (n.rationale !== null) note(n.rationale);
    language(n.languageTag);
    integer(n.version, 1);
    timestamp(n.createdAt);
    timestamp(n.updatedAt);
    const count = await moves(n.moves, check);
    nodeCount += count;
    if (count === 0) requireTransfer(n.movesRoot === null);
    else witness(n.movesRoot);
  }
  if (nodeCount > limits.nodes || textCount > limits.text)
    transferFailure('resource_exhausted');
  const manifest = value as PgnTransferManifest;
  requireTransfer(manifest.carrier === (manifest.records.length === 0));
  if (manifest.carrier)
    requireTransfer(
      manifest.items.length === 0 &&
        manifest.anchors.length === 0 &&
        manifest.contributions.length === 0,
    );
  check();
  return manifest;
}
