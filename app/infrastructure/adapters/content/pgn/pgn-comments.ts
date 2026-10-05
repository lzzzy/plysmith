const readableTags = [
  'Event',
  'Site',
  'Date',
  'Round',
  'White',
  'Black',
  'Result',
  'WhiteElo',
  'BlackElo',
  'ECO',
  'Opening',
  'Variation',
  'SubVariation',
  'StudyName',
  'ChapterName',
  'Annotator',
  'TimeControl',
  'Termination',
  'EventDate',
];

export function meaningfulTagValue(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return !trimmed || /^[?.\s]+$/.test(trimmed) || trimmed === '*'
    ? undefined
    : trimmed;
}

export function tagComments(
  headers: readonly { name: string; value: string }[],
): string[] {
  const lines: string[] = [];
  for (const name of readableTags) {
    const value = meaningfulTagValue(
      headers.find((header) => header.name.toLowerCase() === name.toLowerCase())
        ?.value,
    );
    if (value !== undefined) lines.push(`${name}: ${value}`);
  }
  const text = lines.join('\n');
  return text ? [text] : [];
}

export function filterCommentDirectives(comment: string): string {
  return comment.replace(/\[%[A-Za-z][A-Za-z0-9_]*(?:\s[^[\]]*)?\]/g, '');
}
