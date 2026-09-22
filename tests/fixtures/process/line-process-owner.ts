import { LineProcessSupervisor } from '../../../app/infrastructure/adapters/process/index.ts';

const executablePath = process.argv[2];
const fakeEngine = process.argv[3];
const tracePath = process.argv[4];
if (
  executablePath === undefined ||
  fakeEngine === undefined ||
  tracePath === undefined
) {
  throw new Error('Expected executable, fake engine, and trace paths.');
}

const supervisor = new LineProcessSupervisor();
const handle = await supervisor.open({
  executablePath,
  arguments: [fakeEngine, 'timeout', tracePath],
  startupTimeoutMs: 1_000,
  stopTimeoutMs: 250,
  maxOutputBytes: 64_000,
});
process.stdout.write(`guardian ${handle.processId}\n`);
process.stdout.write('ready\n');
setInterval(() => undefined, 1_000);
