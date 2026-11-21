// Starts the built Worker locally with a fresh database and photo store, and records where they are so the
// tests can seed data and read the sign-in codes the Worker prints (no mail key is set, so codes go to its log).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, openSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = process.argv[2] ?? '8799';
const run = join(import.meta.dirname, '.run');
mkdirSync(run, { recursive: true });
const persist = mkdtempSync(join(tmpdir(), 'tpg-ui-'));
const logPath = join(persist, 'worker.log');
const log = openSync(logPath, 'a');
writeFileSync(join(run, 'state.json'), JSON.stringify({ persist, logPath, port }));

const child = spawn('npx', ['wrangler', 'dev', '-c', 'tests/wrangler.e2e.jsonc', '--local', '--port', port, '--persist-to', persist], {
	stdio: ['ignore', log, log],
	detached: true
});
const stop = () => {
	try { process.kill(-child.pid, 'SIGKILL'); } catch {}
	process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (c) => process.exit(c ?? 1));
