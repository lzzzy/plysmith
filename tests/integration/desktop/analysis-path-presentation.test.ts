import assert from 'node:assert/strict';
import test from 'node:test';
import type { AnalysisRecordDto } from '../../../app/infrastructure/channels/host_client/index.ts';
import {
  chessTreeLines,
  chessTreeLayout,
  chessTreePath,
} from '../../../app/infrastructure/channels/ui/renderer/chess-tree-presentation.ts';
import { formatMoveSequence } from '../../../app/infrastructure/channels/ui/renderer/chess-display.ts';

import {
  analysisMoveRows,
  analysisNoteMoveRows,
  analysisPathPresentation,
} from '../../../app/infrastructure/channels/ui/renderer/analysis-path-presentation.ts';

const move = (san: string) => ({ from: 'a1', to: 'a2', san });
const note = (contributionId: string, anchorId: string, body: string) => ({
  contributionId,
  anchorId,
  body,
  moves: [],
  languageTag: 'de-DE',
  scopeKind: 'global' as const,
  contributionVersion: 1,
  createdAt: '2026-09-13T10:00:00.000Z',
  updatedAt: '2026-09-13T10:00:00.000Z',
});
const state = (sideToMove: 'white' | 'black', fullmoveNumber: number) => ({
  position: {
    ruleSetId: 'standardChess' as const,
    boardKey: `${sideToMove}-${fullmoveNumber}`,
    sideToMove,
    castlingRights: {
      whiteKingSide: false,
      whiteQueenSide: false,
      blackKingSide: false,
      blackQueenSide: false,
    },
    effectiveEnPassantSquare: -1,
    positionKey: `${sideToMove}-${fullmoveNumber}`,
  },
  playState: {
    fullmoveNumber,
    halfmoveClock: 0,
    historyKnowledge: 'complete' as const,
  },
  fen: `${sideToMove}-${fullmoveNumber}`,
});
const step = (
  san: string,
  sideToMove: 'white' | 'black',
  fullmoveNumber: number,
) => ({
  before: state(sideToMove, fullmoveNumber),
  move: move(san),
  after: state(
    sideToMove === 'white' ? 'black' : 'white',
    sideToMove === 'black' ? fullmoveNumber + 1 : fullmoveNumber,
  ),
});

test('whole-tree projection visits nested alternatives once without merging equal positions', () => {
  const node = (
    nodeIndex: number,
    parentNodeIndex: number | null,
    siblingOrder: number,
    san: string,
  ) => ({
    nodeIndex,
    parentNodeIndex,
    siblingOrder,
    anchorId: String(100 + nodeIndex),
    move: move(san),
    after: state('black', 42),
  });
  const record: AnalysisRecordDto = {
    itemType: 'analysis',
    itemId: '1',
    revisionId: '2',
    currentRevisionId: '2',
    revisionNumber: 1,
    historical: false,
    rootAnchorId: '99',
    currentAnchorId: '99',
    displayName: 'Library',
    languageTag: 'en-GB',
    origin: { kind: 'initial_position' },
    root: state('black', 42),
    steps: [],
    cursor: 0,
    contributions: [],
    contextMember: false,
    tree: {
      nodes: [
        node(6, null, 1, 'd4'),
        node(5, 3, 1, 'Nc3'),
        node(4, 3, 0, 'Nf3'),
        node(3, 0, 1, 'c5'),
        node(2, 1, 0, 'Nf3'),
        node(1, 0, 0, 'e5'),
        node(0, null, 0, 'e4'),
      ],
    },
  };
  const lines = chessTreeLines(record);
  assert.deepEqual(
    lines.map((line) => line.steps.map((entry) => entry.anchorId)),
    [['100', '101', '102'], ['103', '104'], ['105'], ['106']],
  );
  assert.deepEqual(
    lines.map((line) => [line.depth, line.parentKey, line.parentAnchorId]),
    [
      [0, undefined, '99'],
      [1, '100', '100'],
      [2, '103', '103'],
      [1, undefined, '99'],
    ],
  );
  assert.equal(
    new Set(lines.flatMap((line) => line.steps.map((entry) => entry.anchorId)))
      .size,
    7,
  );
  const layout = chessTreeLayout(record, '103');
  assert.deepEqual(
    layout.map((line) => [
      line.key,
      line.sections.map((section) => ({
        anchors: section.steps.map((entry) => entry.anchorId),
        branches: section.branches,
        draft: section.draft,
      })),
    ]),
    [
      [
        '100',
        [
          { anchors: ['100'], branches: ['106'], draft: false },
          { anchors: ['101'], branches: ['103'], draft: false },
          { anchors: ['102'], branches: [], draft: false },
        ],
      ],
      ['103', [{ anchors: ['103', '104'], branches: ['105'], draft: true }]],
      ['105', [{ anchors: ['105'], branches: [], draft: false }]],
      ['106', [{ anchors: ['106'], branches: [], draft: false }]],
    ],
  );
  assert.deepEqual(
    chessTreePath(record, '105').steps.map((entry) => entry.anchorId),
    ['100', '103', '105'],
  );
  assert.equal(
    formatMoveSequence(lines[0]!.steps.slice(0, 1), 'de-DE'),
    '42... e4',
  );
  const { tree: _tree, ...withoutTree } = record;
  assert.ok(_tree);
  const linear = {
    ...withoutTree,
    steps: [{ ...step('Nf6', 'black', 42), anchorId: '110' }],
  };
  assert.deepEqual(
    chessTreeLines(linear).map((line) =>
      line.steps.map((entry) => entry.anchorId),
    ),
    [['110']],
  );
  assert.equal(formatMoveSequence(linear.steps, 'de-DE'), '42... Sf6');
  assert.equal(chessTreePath(linear, '110').cursor, 1);
  assert.deepEqual(chessTreePath(linear, '110').steps, linear.steps);
  assert.deepEqual(chessTreeLines({ ...linear, steps: [] }), []);
  const deep = chessTreeLayout({
    ...record,
    tree: {
      nodes: Array.from({ length: 2048 }, (_, index) =>
        node(index, index === 0 ? null : index - 1, 1, 'Nf3'),
      ),
    },
  });
  assert.equal(deep.length, 2048);
  for (const [index, line] of deep.entries()) {
    assert.equal(line.depth, index + 1);
    assert.equal(line.sections[0]!.steps.length, 1);
    assert.deepEqual(
      line.sections[0]!.branches,
      index === 2047 ? [] : [String(101 + index)],
    );
  }
});

test('persisted bridge moves have no invented navigation or note targets and are not duplicated', () => {
  const first = step('e4', 'white', 1);
  const bridge = step('e5', 'black', 1);
  const presentation = analysisPathPresentation({
    record: {
      itemId: '3',
      revisionId: '3',
      rootAnchorId: '15',
      currentAnchorId: '15',
      root: bridge.after,
      cursor: 0,
      contributions: [],
      steps: [],
      sourcePath: {
        displayName: 'Source',
        root: first.before,
        steps: [first, bridge],
      },
      sourceLine: {
        sourceItemId: '1',
        sourceItemType: 'analysis',
        sourceRevisionId: '1',
        sourceAnchorId: '2',
        sourceDisplayName: 'Source',
        root: first.before,
        rootTarget: { itemId: '1', revisionId: '1', anchorId: '1' },
        contributions: [],
        steps: [
          { ...first, itemId: '1', revisionId: '1', anchorId: '2' },
          bridge,
        ],
      },
    },
  });
  assert.deepEqual(
    presentation.entries.map((entry) => entry.move.san),
    ['e4', 'e5'],
  );
  assert.equal(presentation.entries[0]?.noteTarget?.anchorId, '2');
  assert.equal(presentation.entries[1]?.noteTarget, undefined);
  assert.equal(presentation.positions[1]?.target?.anchorId, '2');
  assert.equal(presentation.positions[2]?.target?.itemId, '3');
  assert.equal(presentation.currentPositionIndex, 2);
});

test('a free persisted source prefix does not pretend to have a stored source root', () => {
  const prefix = step('e4', 'white', 1);
  const presentation = analysisPathPresentation({
    record: {
      itemId: '3',
      revisionId: '3',
      rootAnchorId: '15',
      currentAnchorId: '15',
      root: prefix.after,
      cursor: 0,
      contributions: [],
      steps: [],
      sourcePath: {
        displayName: 'Starting position',
        root: prefix.before,
        steps: [prefix],
      },
    },
  });
  assert.equal(presentation.positions[0]?.target, undefined);
  assert.equal(presentation.sourceRootTarget, undefined);
  assert.equal(presentation.entries[0]?.noteTarget, undefined);
  assert.equal(presentation.hasSourcePrefix, true);
});

test('keeps the stored route visible while a noted analysis path remains active', () => {
  const presentation = analysisPathPresentation({
    record: {
      itemId: '3',
      revisionId: '3',
      rootAnchorId: '15',
      currentAnchorId: '18',
      root: state('white', 1),
      cursor: 3,
      contributions: [],
      steps: [
        { anchorId: '16', ...step('e4', 'white', 1) },
        { anchorId: '17', ...step('d5', 'black', 1) },
        { anchorId: '18', ...step('exd5', 'white', 2) },
      ],
    },
    scratch: {
      intent: { kind: 'exploration' },
      origin: {
        kind: 'inventory_anchor',
        itemId: '3',
        revisionId: '3',
        anchorId: '18',
      },
      root: state('black', 2),
      cursor: 1,
      steps: [step('Qxd5', 'black', 2), step('Nc3', 'white', 3)],
      noteDraft: { body: 'Damenrücknahme prüfen.' },
    },
  });

  assert.deepEqual(
    presentation.entries.map((entry) => [
      entry.kind,
      entry.move.san,
      entry.current,
      entry.branchOrigin,
    ]),
    [
      ['stored', 'e4', false, false],
      ['stored', 'd5', false, false],
      ['stored', 'exd5', false, true],
      ['scratch', 'Qxd5', true, false],
      ['scratch', 'Nc3', false, false],
    ],
  );
  assert.equal(presentation.rootCurrent, false);
  assert.equal(presentation.hasStoredPrefix, true);
  assert.equal(presentation.scratchCursor, 1);
  assert.equal(presentation.scratchLength, 2);
  assert.equal(presentation.currentPositionIndex, 4);
  assert.deepEqual(
    presentation.positions.map((position) => position.state.fen),
    ['white-1', 'black-1', 'white-2', 'black-2', 'white-3', 'black-3'],
  );
});

test('keeps the complete stored line visible until a new analysis path has a move', () => {
  const presentation = analysisPathPresentation({
    record: {
      itemId: '3',
      revisionId: '3',
      rootAnchorId: '15',
      currentAnchorId: '15',
      root: state('white', 1),
      cursor: 0,
      contributions: [],
      steps: [
        { anchorId: '16', ...step('e4', 'white', 1) },
        { anchorId: '17', ...step('e6', 'black', 1) },
      ],
    },
    scratch: {
      intent: { kind: 'exploration' },
      origin: {
        kind: 'inventory_anchor',
        itemId: '3',
        revisionId: '3',
        anchorId: '15',
      },
      root: state('white', 1),
      cursor: 0,
      steps: [],
    },
  });

  assert.deepEqual(
    presentation.entries.map((entry) => [entry.kind, entry.move.san]),
    [
      ['stored', 'e4'],
      ['stored', 'e6'],
    ],
  );
  assert.equal(presentation.rootCurrent, true);
  assert.equal(presentation.currentPositionIndex, 0);
  assert.equal(presentation.positions[0]?.scratchCursor, 0);
  assert.equal(
    presentation.entries.some((entry) => entry.branchOrigin),
    false,
  );
});

test('shows only the retained prefix of an empty inventory revision draft', () => {
  const presentation = analysisPathPresentation({
    record: {
      itemId: '3',
      revisionId: '3',
      rootAnchorId: '15',
      currentAnchorId: '17',
      root: state('white', 1),
      cursor: 2,
      contributions: [],
      steps: [
        { anchorId: '16', ...step('e4', 'white', 1) },
        { anchorId: '17', ...step('e6', 'black', 1) },
        { anchorId: '18', ...step('d4', 'white', 2) },
      ],
    },
    scratch: {
      intent: { kind: 'inventory_revision' },
      origin: {
        kind: 'inventory_anchor',
        itemId: '3',
        revisionId: '3',
        anchorId: '17',
      },
      root: state('white', 2),
      cursor: 0,
      steps: [],
    },
  });

  assert.deepEqual(
    presentation.entries.map((entry) => [entry.kind, entry.move.san]),
    [
      ['stored', 'e4'],
      ['stored', 'e6'],
    ],
  );
  assert.equal(presentation.currentPositionIndex, 2);
  assert.equal(presentation.entries.at(-1)?.current, true);
});

test('does not attach an unrelated context scratch to the displayed record', () => {
  const presentation = analysisPathPresentation({
    record: {
      itemId: '3',
      revisionId: '3',
      rootAnchorId: '15',
      currentAnchorId: '18',
      root: state('white', 1),
      cursor: 3,
      contributions: [],
      steps: [{ anchorId: '16', ...step('e4', 'white', 1) }],
    },
    scratch: {
      intent: { kind: 'exploration' },
      origin: {
        kind: 'inventory_anchor',
        itemId: '1',
        revisionId: '1',
        anchorId: '2',
      },
      root: state('white', 1),
      cursor: 1,
      steps: [step('Nf3', 'white', 1)],
    },
  });

  assert.deepEqual(
    presentation.entries.map((entry) => entry.move.san),
    ['Nf3'],
  );
  assert.equal(presentation.hasStoredPrefix, false);
});

test('keeps the source route visible for a persisted derived analysis', () => {
  const presentation = analysisPathPresentation({
    record: {
      itemId: '9',
      revisionId: '9',
      rootAnchorId: '30',
      currentAnchorId: '31',
      root: state('white', 2),
      cursor: 1,
      contributions: [],
      sourceLine: {
        sourceItemId: '3',
        sourceItemType: 'game',
        sourceRevisionId: '3',
        sourceAnchorId: '17',
        sourceDisplayName: 'e4 d5',
        root: state('white', 1),
        rootTarget: { itemId: '3', revisionId: '3', anchorId: '15' },
        steps: [
          {
            itemId: '3',
            revisionId: '3',
            anchorId: '16',
            ...step('e4', 'white', 1),
          },
          {
            itemId: '3',
            revisionId: '3',
            anchorId: '17',
            ...step('d5', 'black', 1),
          },
        ],
        contributions: [],
      },
      steps: [{ anchorId: '31', ...step('e5', 'white', 2) }],
    },
  });

  assert.equal(presentation.sourceDisplayName, 'e4 d5');
  assert.equal(presentation.sourceItemType, 'game');
  assert.equal(presentation.hasSourcePrefix, true);
  assert.deepEqual(presentation.sourceOriginTarget, {
    itemId: '3',
    revisionId: '3',
    anchorId: '17',
  });
  assert.deepEqual(
    presentation.entries.map((entry) => [
      entry.kind,
      entry.move.san,
      entry.positionIndex,
      entry.branchOrigin,
    ]),
    [
      ['source', 'e4', 1, false],
      ['source', 'd5', 2, true],
      ['stored', 'e5', 3, false],
    ],
  );
  assert.equal(presentation.currentPositionIndex, 3);
  assert.equal(presentation.analysisOriginPositionIndex, 2);
  assert.deepEqual(presentation.positions[0]?.target, {
    itemId: '3',
    revisionId: '3',
    anchorId: '15',
    start: state('white', 1),
    contributions: [],
  });
  assert.deepEqual(presentation.positions[2]?.target, {
    itemId: '9',
    revisionId: '9',
    anchorId: '30',
    start: state('white', 2),
    contributions: [],
  });
});

test('groups half-moves into conventional move rows using chess state', () => {
  const presentation = analysisPathPresentation({
    record: {
      itemId: '9',
      revisionId: '9',
      rootAnchorId: '30',
      currentAnchorId: '31',
      root: state('white', 2),
      cursor: 1,
      contributions: [],
      sourceLine: {
        sourceItemId: '3',
        sourceItemType: 'analysis',
        sourceRevisionId: '3',
        sourceAnchorId: '17',
        sourceDisplayName: 'e4 d5',
        root: state('white', 1),
        rootTarget: { itemId: '3', revisionId: '3', anchorId: '15' },
        steps: [
          {
            itemId: '3',
            revisionId: '3',
            anchorId: '16',
            ...step('e4', 'white', 1),
          },
          {
            itemId: '3',
            revisionId: '3',
            anchorId: '17',
            ...step('d5', 'black', 1),
          },
        ],
        contributions: [],
      },
      steps: [{ anchorId: '31', ...step('e5', 'white', 2) }],
    },
  });

  const rows = analysisMoveRows(presentation.entries);
  assert.deepEqual(
    rows.map((row) => ({
      fullmoveNumber: row.fullmoveNumber,
      white: row.white?.move.san,
      black: row.black?.move.san,
    })),
    [
      { fullmoveNumber: 1, white: 'e4', black: 'd5' },
      { fullmoveNumber: 2, white: 'e5', black: undefined },
    ],
  );

  const blackOnly = analysisMoveRows([
    {
      kind: 'scratch',
      ...step('Kh7', 'black', 23),
      positionIndex: 1,
      scratchCursor: 1,
      current: true,
      branchOrigin: false,
    },
  ]);
  assert.equal(blackOnly[0]?.fullmoveNumber, 23);
  assert.equal(blackOnly[0]?.white, undefined);
  assert.equal(blackOnly[0]?.black?.move.san, 'Kh7');
});

test('numbers a saved variation from the exact note anchor', () => {
  const rows = analysisNoteMoveRows(
    {
      itemId: '9',
      revisionId: '9',
      anchorId: '31',
      start: state('black', 2),
      contributions: [],
    },
    [move('dxc4'), move('e3'), move('e5')],
  );

  assert.deepEqual(
    rows.map((row) => ({
      fullmoveNumber: row.fullmoveNumber,
      white: row.white?.san,
      black: row.black?.san,
    })),
    [
      { fullmoveNumber: 2, white: undefined, black: 'dxc4' },
      { fullmoveNumber: 3, white: 'e3', black: 'e5' },
    ],
  );
});

test('binds inline notes to their exact source and record anchors', () => {
  const presentation = analysisPathPresentation({
    record: {
      itemId: '9',
      revisionId: '9',
      rootAnchorId: '30',
      currentAnchorId: '31',
      root: state('white', 2),
      cursor: 1,
      contributions: [
        note('3', '30', 'Am Ausgangspunkt'),
        note('4', '31', 'Nach e5'),
      ],
      sourceLine: {
        sourceItemId: '3',
        sourceItemType: 'analysis',
        sourceRevisionId: '3',
        sourceAnchorId: '17',
        sourceDisplayName: 'e4 d5',
        root: state('white', 1),
        rootTarget: { itemId: '3', revisionId: '3', anchorId: '15' },
        steps: [
          {
            itemId: '3',
            revisionId: '3',
            anchorId: '16',
            ...step('e4', 'white', 1),
          },
          {
            itemId: '3',
            revisionId: '3',
            anchorId: '17',
            ...step('d5', 'black', 1),
          },
        ],
        contributions: [
          note('1', '15', 'Quellwurzel'),
          note('2', '16', 'Nach e4'),
        ],
      },
      steps: [{ anchorId: '31', ...step('e5', 'white', 2) }],
    },
  });

  assert.deepEqual(
    presentation.sourceRootTarget?.contributions.map((entry) => entry.body),
    ['Quellwurzel'],
  );
  assert.deepEqual(
    presentation.entries[0]?.noteTarget?.contributions.map(
      (entry) => entry.body,
    ),
    ['Nach e4'],
  );
  assert.deepEqual(
    presentation.recordRootTarget?.contributions.map((entry) => entry.body),
    ['Am Ausgangspunkt'],
  );
  assert.deepEqual(
    presentation.entries
      .at(-1)
      ?.noteTarget?.contributions.map((entry) => entry.body),
    ['Nach e5'],
  );
  assert.deepEqual(
    presentation.entries.at(-1)?.noteTarget?.start,
    state('black', 2),
  );
});
