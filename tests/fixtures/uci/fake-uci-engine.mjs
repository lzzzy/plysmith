import { createInterface } from 'node:readline';
import { appendFileSync, readFileSync } from 'node:fs';

const mode = process.argv[2] ?? 'normal';
const tracePath = process.argv[3]?.startsWith('--')
  ? undefined
  : process.argv[3];
const input = createInterface({ input: process.stdin });
let positionLine = '';

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
      process.stdout.write(
        'option name Threads type spin default 1 min 1 max 8\n',
      );
      process.stdout.write(
        'option name Hash type spin default 16 min 1 max 128\n',
      );
    }
    if (mode === 'stockfish-analysis') {
      process.stdout.write(
        'option name MultiPV type spin default 1 min 1 max 8\n',
      );
      process.stdout.write(
        'option name UCI_ShowWDL type check default false\n',
      );
      process.stdout.write(
        'option name UCI_LimitStrength type check default false\n',
      );
    }
    if (mode === 'maia-analysis') {
      process.stdout.write(
        'option name VerboseMoveStats type check default false\n',
      );
      process.stdout.write(
        'option name UCI_ShowWDL type check default false\n',
      );
      process.stdout.write(
        'option name PolicyTemperature type string default 1.0\n',
      );
      process.stdout.write(
        'option name ContemptMode type combo default disable var disable\n',
      );
      process.stdout.write(
        'option name WDLCalibrationElo type spin default 0 min -1000 max 1000\n',
      );
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
  if (line.startsWith('position ')) {
    positionLine = line;
    return;
  }
  if (line === 'go' || line.startsWith('go ')) {
    if (mode === 'stockfish-analysis') {
      if (line === 'go movetime 10') {
        process.stdout.write('bestmove e7e5\n');
        return;
      }
      if (line.includes(' searchmoves ')) {
        const moves = line.split(' searchmoves ')[1].split(' ');
        for (const [index, move] of moves.entries()) {
          process.stdout.write(
            `info depth 7 multipv ${index + 1} score cp -73 upperbound wdl 100 300 600 pv ${move}\n`,
          );
        }
        process.stdout.write(`bestmove ${moves[0]}\n`);
        return;
      }
      process.stdout.write(
        'info depth 12 seldepth 18 multipv 1 score cp 34 wdl 430 400 170 nodes 12000 nps 60000 time 200 hashfull 12 tbhits 0 pv e2e4 e7e5 g1f3\n',
      );
      process.stdout.write(
        'info depth 12 seldepth 17 multipv 2 score cp 20 wdl 390 420 190 nodes 12000 nps 60000 time 200 hashfull 12 tbhits 0 pv d2d4 d7d5 c2c4\n',
      );
      process.stdout.write('bestmove e2e4\n');
      return;
    }
    if (mode === 'maia-analysis') {
      if (!positionLine.includes(' moves ')) {
        const moves = [
          'a2a3',
          'a2a4',
          'b2b3',
          'b2b4',
          'c2c3',
          'c2c4',
          'd2d3',
          'e2e3',
          'f2f3',
          'f2f4',
          'g2g3',
          'g2g4',
          'h2h3',
          'h2h4',
          'b1a3',
          'b1c3',
          'g1f3',
          'g1h3',
        ];
        process.stdout.write('info string e2e4 (322) N: 0 (P: 65.00%)\n');
        process.stdout.write('info string d2d4 (322) N: 0 (P: 20.00%)\n');
        for (const move of moves) {
          process.stdout.write(`info string ${move} (322) N: 0 (P: 0.83%)\n`);
        }
        process.stdout.write(
          'info depth 1 score cp 0 wdl 500 200 300 pv e2e4\n',
        );
        process.stdout.write('bestmove e2e4\n');
        return;
      }
      const isE4 = positionLine.endsWith(' e2e4');
      process.stdout.write(
        isE4
          ? 'info depth 1 score cp 0 wdl 200 300 500 pv e7e5\n'
          : 'info depth 1 score cp 0 wdl 250 350 400 pv d7d5\n',
      );
      process.stdout.write(isE4 ? 'bestmove e7e5\n' : 'bestmove d7d5\n');
      return;
    }
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
