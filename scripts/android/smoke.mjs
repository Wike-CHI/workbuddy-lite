import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { AcpProbe } from './lib/acp.mjs';
import { parseArgs, saveReport } from './lib/report.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

// Never include agent output, account details, paths or server error messages in reports.
function errorCode(error) {
  const message = String(error?.message ?? '');
  return /^(HTTP_\d{3}|RPC_-?\d+|[A-Z][A-Z_]{2,60})$/.test(message) ? message : 'PROBE_FAILED';
}

export async function runSmoke({ task = false, cancelCheck = false, approve, cli = 'codebuddy',
  token = process.env.WBL_GATEWAY_TOKEN, startupTimeout = 60000, rpcTimeout = 30000,
  promptTimeout = 180000, onClient, signal } = {}) {
  if (process.platform === 'win32') throw new Error('UNIX_REQUIRED');
  const report = { schemaVersion: 1, kind: 'smoke', at: new Date().toISOString(),
    platform: process.platform, arch: process.arch,
    environment: process.env.PREFIX === '/data/data/com.termux/files/usr' ? 'termux' : 'host_only',
    checks: {}, observations: { updates: 0, permissionRequests: 0, permissionsSelected: 0, executeToolSeen: false },
    manual: { browserLogin: 'not_verified', runCommandIntent: 'not_verified', backgroundRecovery: 'not_verified' },
    status: 'failed' };
  const workspace = await mkdtemp(join(tmpdir(), 'workbuddy-android-probe-'));
  // mkdtemp uses a private directory. Keep the tiny artifacts for manual inspection.
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let childError = false, exited = false, client, terminal;
  const child = spawn(cli, ['--serve', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: workspace, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CODEBUDDY_DISABLE_AUTOUPDATE: '1' },
  });
  child.on('error', () => { childError = true; });
  child.on('exit', () => { exited = true; });
  // Drain bounded-by-process streams without persisting OAuth URLs or credentials.
  child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
  const interrupt = () => { void client?.close(); terminal?.close(); };
  signal?.addEventListener('abort', interrupt, { once: true });
  const ensureActive = () => { if (signal?.aborted) throw new Error('INTERRUPTED'); };
  async function permission(options, toolCall) {
    report.observations.permissionRequests++;
    let selected;
    if (approve) selected = await approve(options);
    else if (process.stdin.isTTY && process.stderr.isTTY) {
      terminal ??= createInterface({ input: process.stdin, output: process.stderr });
      // Titles are agent-controlled; print only standardized kind and ordinal.
      const safe = options.map((o, i) => ({ index: i + 1, kind: ['allow_once', 'allow_always', 'reject_once', 'reject_always'].includes(o.kind) ? o.kind : 'unknown' }));
      console.error('CLI requested permission in the disposable probe workspace:', safe);
      console.error('Tool details:', JSON.stringify({ title: toolCall?.title, input: toolCall?.rawInput }).slice(0, 4000));
      console.error('Open the Termux CLI directly to inspect commands if more detail is needed.');
      const answer = await terminal.question('Choose an option number; Enter cancels: ');
      const index = /^\d+$/.test(answer) ? Number(answer) - 1 : -1;
      if (index >= 0 && index < options.length) selected = options[index].optionId;
    }
    if (selected && options.some(o => o.optionId === selected)) report.observations.permissionsSelected++;
    return selected;
  }
  function makeClient() {
    const probe = new AcpProbe(base, { token, timeout: rpcTimeout, onPermission: permission,
      onUpdate(params) {
        report.observations.updates++;
        if (params?.update?.sessionUpdate === 'tool_call' && params.update.kind === 'execute') report.observations.executeToolSeen = true;
      } });
    onClient?.(probe);
    return probe;
  }
  try {
    const deadline = Date.now() + startupTimeout;
    for (;;) {
      ensureActive();
      if (childError || exited) throw new Error('CLI_START_FAILED');
      try {
        const headers = { 'X-CodeBuddy-Request': '1' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await fetch(`${base}/api/v1/health`, { headers, signal: AbortSignal.timeout(1500) });
        await response.arrayBuffer();
        if (response.ok) break;
        if ([401, 403].includes(response.status)) throw new Error(`HTTP_${response.status}`);
      } catch (error) { if (/^HTTP_/.test(error.message)) throw error; }
      if (Date.now() >= deadline) throw new Error('STARTUP_TIMEOUT');
      await delay(200);
    }
    report.checks.health = 'passed';
    client = makeClient();
    await client.connect(); report.checks.initialize = 'passed';
    ensureActive();
    const session = await client.rpc('session/new', { cwd: workspace, mcpServers: [] });
    if (typeof session?.sessionId !== 'string' || !session.sessionId) throw new Error('NO_SESSION_ID');
    const sessionId = session.sessionId;
    report.checks.sessionNew = 'passed';
    report.modelCount = Array.isArray(session.models?.availableModels) ? session.models.availableModels.length : null;
    report.checks.auth = 'session_available';
    if (task) {
      const first = await client.rpc('session/prompt', { sessionId, prompt: [{ type: 'text', text:
        'This is a disposable compatibility test. In the current working directory only, create probe.txt with exactly android-p0-first followed by a newline. Use your file tool. Do not access other directories, install packages or use the network. Then reply briefly.' }] }, promptTimeout);
      if (first?.stopReason !== 'end_turn') throw new Error('FIRST_TURN_INCOMPLETE');
      if (await readFile(join(workspace, 'probe.txt'), 'utf8') !== 'android-p0-first\n') throw new Error('FIRST_FILE_MISMATCH');
      report.checks.firstTurnFile = 'passed';
    } else report.checks.task = 'not_requested';

    await client.close();
    client = makeClient();
    await client.connect();
    await client.rpc('session/load', { sessionId, cwd: workspace, mcpServers: [] });
    report.checks.sessionLoadOnNewConnection = 'passed';
    ensureActive();
    if (task) {
      const second = await client.rpc('session/prompt', { sessionId, prompt: [{ type: 'text', text:
        'Continue the compatibility test in this directory only. Read probe.txt; it must contain android-p0-first plus newline. Change it to exactly android-p0-second plus newline. Then use a shell tool to execute: node -e "const f=require(\'fs\');if(f.readFileSync(\'probe.txt\',\'utf8\')!==\'android-p0-second\\n\')process.exit(1);f.writeFileSync(\'shell-proof.txt\',\'shell-ok\\n\')" . Do not create shell-proof.txt through a file tool. Do not access other directories or the network. Reply briefly.' }] }, promptTimeout);
      if (second?.stopReason !== 'end_turn') throw new Error('SECOND_TURN_INCOMPLETE');
      if (await readFile(join(workspace, 'probe.txt'), 'utf8') !== 'android-p0-second\n') throw new Error('SECOND_FILE_MISMATCH');
      if (await readFile(join(workspace, 'shell-proof.txt'), 'utf8') !== 'shell-ok\n') throw new Error('SHELL_PROOF_MISMATCH');
      if (!report.observations.executeToolSeen) throw new Error('NO_EXECUTE_TOOL_EVENT');
      report.checks.secondTurnFileAndShell = 'passed';
    }
    if (cancelCheck) {
      const pending = client.rpc('session/prompt', { sessionId, prompt: [{ type: 'text', text:
        'Write a long numbered explanation of 200 software design patterns. Do not use tools. This task will be cancelled by the compatibility test.' }] }, promptTimeout);
      // Attach a handler before waiting, so early RPC errors are never unhandled.
      let settled = false;
      const result = pending.then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
      await delay(1000);
      if (settled) throw new Error('CANCEL_NOT_OBSERVED');
      await client.notify('session/cancel', { sessionId });
      const outcome = await result;
      if (outcome.error) throw outcome.error;
      if (outcome.value?.stopReason !== 'cancelled') throw new Error('CANCEL_NOT_OBSERVED');
      report.checks.cancel = 'passed';
    } else report.checks.cancel = 'not_requested';
    ensureActive();
    report.status = 'passed';
  } catch (error) {
    report.error = signal?.aborted ? 'INTERRUPTED' : errorCode(error);
  } finally {
    signal?.removeEventListener('abort', interrupt); terminal?.close();
    await client?.close();
    if (child.pid) {
      // Only the freshly spawned process group; never pkill codebuddy.
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
      await delay(250);
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
    }
  }
  return { report, workspace };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const args = parseArgs(process.argv.slice(2), ['out'], ['task', 'cancel-check']);
    const { report, workspace } = await runSmoke({ task: args.task, cancelCheck: args['cancel-check'], signal: abort.signal });
    console.error(`Probe artifacts retained locally: ${workspace}`);
    await saveReport(report, args.out);
    process.exitCode = report.status === 'passed' ? 0 : 1;
  } catch { console.error('Unable to run/write probe. Use: node smoke.mjs [--task] [--cancel-check] [--out new-file]'); process.exitCode = 2; }
  finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
