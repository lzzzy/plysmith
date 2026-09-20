import { createInterface } from 'node:readline';

const mode = process.argv[2] ?? 'normal';
const input = createInterface({ input: process.stdin });

input.on('line', (line) => {
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
    process.stdout.write('readyok\n');
    return;
  }
  if (line.startsWith('go ')) {
    if (mode === 'crash') process.exit(3);
    if (mode === 'timeout') return;
    if (mode === 'flood') {
      process.stdout.write(`info string ${'x'.repeat(20_000)}\n`);
      return;
    }
    if (mode === 'chatter') {
      setInterval(() => process.stdout.write('info depth 1 score cp 0\n'), 5);
      return;
    }
    process.stdout.write(
      mode === 'illegal' ? 'bestmove e7e4\n' : 'bestmove e7e5 ponder g1f3\n',
    );
    return;
  }
  if (line === 'quit') process.exit(0);
});
