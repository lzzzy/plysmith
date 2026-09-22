import { createInterface } from 'node:readline';
import { appendFileSync, readFileSync } from 'node:fs';

const mode = process.argv[2] ?? 'normal';
const tracePath = process.argv[3]?.startsWith('--')
  ? undefined
  : process.argv[3];
const input = createInterface({ input: process.stdin });

if (tracePath !== undefined) {
  appendFileSync(
    tracePath,
    `pid ${process.pid}\nargv ${process.argv.slice(4).join(' ')}\n`,
    'utf8',
  );
}

input.on('line', (line) => {
  if (tracePath !== undefined) appendFileSync(tracePath, `${line}\n`, 'utf8');
  if (line === 'uci') {
    process.stdout.write('id name Plysmith Fake UCI\n');
    if (mode !== 'missing-option') {
      process.stdout.write('option name Threads type spin default 1 min 1 max 8\n');
      process.stdout.write('option name Hash type spin default 16 min 1 max 128\n');
    }
    process.stdout.write('uciok\n');
    return;
  }
  if (line === 'isready') {
    if (mode === 'hang-ready-once' && processStarts() === 1) return;
    if (mode === 'slow-ready') {
      setTimeout(() => process.stdout.write('readyok\n'), 50);
    } else {
      process.stdout.write('readyok\n');
    }
    return;
  }
  if (line === 'go' || line.startsWith('go ')) {
    if (mode === 'crash') process.exit(3);
    if (mode === 'crash-once' || mode === 'timeout-once') {
      const starts = processStarts();
      if (starts === 1) {
        if (mode === 'crash-once') process.exit(3);
        return;
      }
    }
    if (mode === 'timeout') return;
    if (mode === 'flood') {
      process.stdout.write(`info string ${'x'.repeat(20_000)}\n`);
      return;
    }
    if (mode === 'chatter') {
      setInterval(() => process.stdout.write('info depth 1 score cp 0\n'), 5);
      return;
    }
    if (mode === 'bounded-chatter') {
      process.stdout.write(`info string ${'x'.repeat(700)}\n`);
    }
    process.stdout.write(
      mode === 'illegal' ? 'bestmove e7e4\n' : 'bestmove e7e5 ponder g1f3\n',
    );
    return;
  }
  if (line === 'quit') process.exit(0);
});

function processStarts() {
  return tracePath === undefined
    ? 1
    : (readFileSync(tracePath, 'utf8').match(/^argv /gm)?.length ?? 0);
}
