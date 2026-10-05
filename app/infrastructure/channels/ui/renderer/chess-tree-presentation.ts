import type { AnalysisRecordDto } from '../../host_client/index.ts';

export function chessTreeLines(record: AnalysisRecordDto) {
  const nodes =
    record.tree?.nodes ??
    record.steps.map((step, nodeIndex) => ({
      ...step,
      nodeIndex,
      parentNodeIndex: nodeIndex === 0 ? null : nodeIndex - 1,
      siblingOrder: 0,
    }));
  type Node = (typeof nodes)[number];
  const children = new Map<number | null, Node[]>();
  const byIndex = new Map(nodes.map((node) => [node.nodeIndex, node]));
  for (const node of nodes) {
    const group = children.get(node.parentNodeIndex) ?? [];
    group.push(node);
    children.set(node.parentNodeIndex, group);
  }
  for (const group of children.values())
    group.sort((a, b) => a.siblingOrder - b.siblingOrder);
  const lines: {
    key: string;
    parentKey?: string;
    depth: number;
    variation: boolean;
    parentAnchorId: string;
    steps: AnalysisRecordDto['steps'];
  }[] = [];
  const pending = [...(children.get(null) ?? [])].reverse().map((node) => ({
    node,
    depth: node.siblingOrder === 0 ? 0 : 1,
    parentKey: undefined as string | undefined,
  }));
  const visited = new Set<number>();
  while (pending.length > 0) {
    const start = pending.pop()!;
    const key = start.node.anchorId;
    const steps: AnalysisRecordDto['steps'][number][] = [];
    const alternatives: typeof pending = [];
    let node: Node | undefined = start.node;
    while (node !== undefined && !visited.has(node.nodeIndex)) {
      visited.add(node.nodeIndex);
      const parent =
        node.parentNodeIndex === null
          ? undefined
          : byIndex.get(node.parentNodeIndex);
      steps.push({
        anchorId: node.anchorId,
        before: parent?.after ?? record.root,
        move: node.move,
        after: node.after,
      });
      const group: Node[] = children.get(node.nodeIndex) ?? [];
      for (const alternative of group.filter(
        (child) => child.siblingOrder !== 0,
      ))
        alternatives.push({
          node: alternative,
          depth: start.depth + 1,
          parentKey: key,
        });
      node = group.find((child) => child.siblingOrder === 0);
    }
    const parent =
      start.node.parentNodeIndex === null
        ? undefined
        : byIndex.get(start.node.parentNodeIndex);
    lines.push({
      key,
      ...(start.parentKey === undefined ? {} : { parentKey: start.parentKey }),
      depth: start.depth,
      variation: start.depth > 0,
      parentAnchorId: parent?.anchorId ?? record.rootAnchorId,
      steps,
    });
    pending.push(...alternatives.reverse());
  }
  return lines;
}

export function chessTreeLayout(
  record: AnalysisRecordDto,
  draftAnchorId?: string,
) {
  const lines = chessTreeLines(record);
  const main = lines.find((line) => !line.variation);
  const branchesByLine = new Map<string, typeof lines>();
  for (const line of lines) {
    const parentKey =
      line.parentKey ?? (line.variation ? main?.key : undefined);
    if (parentKey === undefined) continue;
    const branches = branchesByLine.get(parentKey) ?? [];
    branches.push(line);
    branchesByLine.set(parentKey, branches);
  }
  return lines.map((line) => {
    const sections: {
      steps: AnalysisRecordDto['steps'];
      branches: string[];
      draft: boolean;
    }[] = [];
    const slots = new Map<number, { branches: string[]; draft: boolean }>();
    const byAnchor = new Map(
      line.steps.map((step, index) => [step.anchorId, index]),
    );
    // Place alternatives after the main sibling, before its continuation.
    const slotAfter = (anchorId: string) => {
      const index = byAnchor.get(anchorId);
      if (
        index === undefined &&
        !(line === main && anchorId === record.rootAnchorId)
      )
        return undefined;
      return Math.min((index ?? -1) + 2, line.steps.length);
    };
    for (const branch of branchesByLine.get(line.key) ?? []) {
      const slot = slotAfter(branch.parentAnchorId)!;
      const contents = slots.get(slot) ?? { branches: [], draft: false };
      contents.branches.push(branch.key);
      slots.set(slot, contents);
    }
    const draftSlot =
      draftAnchorId === undefined ? undefined : slotAfter(draftAnchorId);
    if (draftSlot !== undefined) {
      const contents = slots.get(draftSlot) ?? { branches: [], draft: false };
      contents.draft = true;
      slots.set(draftSlot, contents);
    }
    let offset = 0;
    for (const slot of [...slots.keys()].sort((a, b) => a - b)) {
      sections.push({
        steps: line.steps.slice(offset, slot),
        ...slots.get(slot)!,
      });
      offset = slot;
    }
    if (offset < line.steps.length)
      sections.push({
        steps: line.steps.slice(offset),
        branches: [],
        draft: false,
      });
    return { ...line, sections };
  });
}

export function chessTreePath(record: AnalysisRecordDto, anchorId: string) {
  if (record.tree === undefined)
    return {
      steps: record.steps,
      cursor: record.steps.findIndex((step) => step.anchorId === anchorId) + 1,
    };
  const nodes = record.tree?.nodes ?? [];
  const byIndex = new Map(nodes.map((node) => [node.nodeIndex, node]));
  const selected = nodes.find((node) => node.anchorId === anchorId);
  const ancestors: (typeof nodes)[number][] = [];
  let current = selected;
  const visited = new Set<number>();
  while (current !== undefined && !visited.has(current.nodeIndex)) {
    visited.add(current.nodeIndex);
    ancestors.unshift(current);
    current =
      current.parentNodeIndex === null
        ? undefined
        : byIndex.get(current.parentNodeIndex);
  }
  const cursor = ancestors.length;
  const continuation = new Map(
    nodes
      .filter((node) => node.siblingOrder === 0)
      .map((node) => [node.parentNodeIndex, node]),
  );
  current = continuation.get(selected?.nodeIndex ?? null);
  while (current !== undefined && !visited.has(current.nodeIndex)) {
    visited.add(current.nodeIndex);
    ancestors.push(current);
    current = continuation.get(current.nodeIndex);
  }
  const steps = ancestors.map((node) => ({
    anchorId: node.anchorId,
    before:
      (node.parentNodeIndex === null
        ? undefined
        : byIndex.get(node.parentNodeIndex)?.after) ?? record.root,
    move: node.move,
    after: node.after,
  }));
  return { steps, cursor };
}
