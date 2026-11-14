import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { AcpProbe } from './acp.mjs';
import { SessionStore } from './store.mjs';
import { createBridge } from './server.mjs';

process.umask(0o077);
const directory = join(homedir(), '.local/share/workbuddy-lite-android');
const statePath = join(directory, 'runtime.json');
const lockPath = join(directory, 'runtime.lock');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function state() { try { return JSON.parse(await readFile(statePath, 'utf8')); } catch { return null; } }
async function status(config) {
  const response = await fetch(`http://127.0.0.1:${config.port}/v1/status`, {
    headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(2000) });
  const result = await response.json();
  if (!response.ok || result.instance !== config.instance) throw new Error('INSTANCE_MISMATCH');
  return result;
}
async function choosePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve)); return port;
}
async function serve() {
  await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
  // An exclusive lock prevents two launch requests from starting duplicate CLI hosts.
  const lock = await open(lockPath, 'wx', 0o600);
  await lock.writeFile(String(process.pid)); await lock.close();
  let bridge, cli;
  let stopped = false;
  async function stop() {
    if (stopped) return; stopped = true;
    try { await bridge?.close(); } finally {
      if (cli?.pid) {
        try { process.kill(-cli.pid, 'SIGTERM'); } catch {}
        await sleep(250);
        try { process.kill(-cli.pid, 'SIGKILL'); } catch {}
      }
      await unlink(statePath).catch(() => {}); await unlink(lockPath).catch(() => {});
    }
  }
  process.once('SIGINT', () => { void stop().finally(() => process.exit()); });
  process.once('SIGTERM', () => { void stop().finally(() => process.exit()); });
  try {
    const cwd = join(homedir(), 'WorkBuddy/mobile');
    await mkdir(cwd, { recursive: true, mode: 0o700 });
    const cliPort = await choosePort();
    let cliFailed = false;
    cli = spawn('codebuddy', ['--serve', '--host', '127.0.0.1', '--port', String(cliPort)], {
      cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CODEBUDDY_DISABLE_AUTOUPDATE: '1' },
    });
    cli.on('error', () => { cliFailed = true; });
    cli.on('exit', () => { cliFailed = true; if (bridge && !stopped) void stop().finally(() => process.exit(1)); });
    cli.stdout.on('data', () => {}); cli.stderr.on('data', () => {});
    const config = { port: 0, token: randomBytes(32).toString('hex'), instance: randomUUID(), pid: process.pid };
    const store = new SessionStore(join(directory, 'sessions.sqlite'));
    bridge = createBridge({ token: config.token, instance: config.instance, cwd, store,
      createClient: options => new AcpProbe(`http://127.0.0.1:${cliPort}`, { ...options, token: process.env.WBL_GATEWAY_TOKEN }) });
    bridge.setShutdown(() => { void stop().finally(() => process.exit()); });
    await new Promise((resolve, reject) => { bridge.server.once('error', reject); bridge.server.listen(0, '127.0.0.1', resolve); });
    config.port = bridge.server.address().port;
    const file = await open(statePath, 'w', 0o600); await file.writeFile(JSON.stringify(config)); await file.close();
    // Control command can pair while the CLI warms up; readiness is separately reported.
    const deadline = Date.now() + 60000;
    while (!stopped && Date.now() < deadline) {
      if (cliFailed) throw new Error('CLI_START_FAILED');
      try {
        const headers = { 'X-CodeBuddy-Request': '1' };
        if (process.env.WBL_GATEWAY_TOKEN) headers.Authorization = `Bearer ${process.env.WBL_GATEWAY_TOKEN}`;
        const res = await fetch(`http://127.0.0.1:${cliPort}/api/v1/health`, { headers, signal: AbortSignal.timeout(1500) });
        await res.arrayBuffer();
        if (res.ok) { await bridge.connect(); return; }
      } catch {}
      await sleep(250);
    }
    throw new Error('CLI_START_TIMEOUT');
  } catch { await stop(); process.exitCode = 1; }
}

async function control(action) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let config = await state();
  if (config) {
    try {
      await status(config);
      if (action === 'stop') {
        await fetch(`http://127.0.0.1:${config.port}/v1/shutdown`, { method: 'POST', headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(3000) });
        process.stdout.write('{"stopping":true}\n'); return;
      }
      process.stdout.write(JSON.stringify(config) + '\n'); return;
    } catch { /* Stale lock below prevents spawning over a possibly live instance. */ }
  }
  if (action === 'stop') throw new Error('SERVICE_UNREACHABLE');
  try {
    const pid = Number(await readFile(lockPath, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid < 2) throw new Error('LOCK_INVALID');
    try { process.kill(pid, 0); throw new Error('SERVICE_ALREADY_STARTING'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    await unlink(lockPath); // PID is absent; remove only this bridge's stale lock.
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // stdout stays private until returned through the explicit PendingIntent callback.
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'], { detached: true, stdio: 'ignore' });
  let failed = false; child.on('error', () => { failed = true; }); child.unref();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !failed) {
    config = await state();
    if (config) { try { await status(config); process.stdout.write(JSON.stringify(config) + '\n'); return; } catch {} }
    await sleep(200);
  }
  throw new Error('SERVICE_START_TIMEOUT');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'serve' && process.argv.length === 3) await serve();
    else if (['start', 'stop'].includes(process.argv[2]) && process.argv.length === 3) await control(process.argv[2]);
    else throw new Error('INVALID_ACTION');
  } catch { process.stderr.write('BRIDGE_CONTROL_FAILED\n'); process.exitCode = 1; }
}
