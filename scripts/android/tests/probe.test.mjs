import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { AcpProbe, readMessages } from '../lib/acp.mjs';
import { parseArgs, saveReport } from '../lib/report.mjs';
import { runSmoke } from '../smoke.mjs';

async function mock(t, handle) {
  const server = createServer(handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('SSE preserves UTF-8 split across chunks, CRLF and multiline data; ignores comments', async () => {
  const bytes = new TextEncoder().encode(':ok\r\n\r\nevent: message\r\ndata: {"text":\r\ndata: "安卓端"}\r\n\r\n');
  const messages = [];
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  await readMessages(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }), value => messages.push(value));
  assert.deepEqual(messages, [{ text: '安卓端' }]);
});

test('JSON responses, malformed JSON, failed HTTP and size bounds', async () => {
  const messages = [];
  await readMessages(new Response('{"id":1,"result":{}}'), value => messages.push(value));
  assert.equal(messages.length, 1);
  await assert.rejects(readMessages(new Response('{not json'), () => {}), SyntaxError);
  await assert.rejects(readMessages(new Response('', { status: 401 }), () => {}), /HTTP_401/);
  await assert.rejects(readMessages(new Response('x'.repeat(2 * 1024 * 1024 + 1)), () => {}), /FRAME_TOO_LARGE/);
});

test('rejects remote endpoints and malformed arguments', () => {
  for (const base of ['https://127.0.0.1:80', 'http://example.com', 'http://user:secret@127.0.0.1', 'http://127.0.0.1/path']) {
    assert.throws(() => new AcpProbe(base), /LOOPBACK_ONLY/);
  }
  assert.deepEqual(parseArgs(['--task', '--out', 'report.json'], ['out'], ['task']), { task: true, out: 'report.json' });
  for (const args of [['--out'], ['--oops'], ['--task', '--task'], ['task']]) assert.throws(() => parseArgs(args, ['out'], ['task']));
});

test('RPC handles subscription-first response and closes the hanging POST', async t => {
  let subscription, postClosed;
  const closed = new Promise(resolve => { postClosed = resolve; });
  const base = await mock(t, async (req, res) => {
    if (req.url.endsWith('/connect')) { res.setHeader('Content-Type', 'application/json'); res.end('{"connectionId":"c","sessionToken":"private"}'); return; }
    if (req.method === 'DELETE') { res.writeHead(204).end(); return; }
    assert.equal(req.headers.authorization, 'Bearer private');
    if (req.method === 'GET') { subscription = res; res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(':ok\n\n'); return; }
    let data = ''; for await (const chunk of req) data += chunk;
    const msg = JSON.parse(data);
    res.on('close', postClosed);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(':ok\n\n');
    // Wait for GET dispatch if the POST won the initial connection race.
    const deliver = () => subscription ? subscription.write(`data: ${JSON.stringify({ id: msg.id, result: { protocolVersion: 1 } })}\n\n`) : setTimeout(deliver, 5);
    deliver();
  });
  const client = new AcpProbe(base, { timeout: 1000 });
  t.after(() => client.close());
  assert.equal((await client.connect()).protocolVersion, 1);
  await closed;
  assert.equal(client.pending.size, 0);
});

test('timeouts abort requests and clean pending entries without exposing server body', async t => {
  const base = await mock(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(':ok\n\n'); });
  const client = new AcpProbe(base, { timeout: 30 });
  await assert.rejects(client.rpc('test', {}), /RPC_TIMEOUT/);
  assert.equal(client.pending.size, 0);
  await client.close();
});

test('reverse permission requests deduplicate; headless defaults to cancelled', async t => {
  let count = 0;
  const base = await mock(t, async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (raw) { const msg = JSON.parse(raw); assert.deepEqual(msg.result, { outcome: { outcome: 'cancelled' } }); count++; }
    res.writeHead(204).end();
  });
  const client = new AcpProbe(base);
  const msg = { id: 'reverse', method: 'session/request_permission', params: { options: [{ optionId: 'once', kind: 'allow_once' }] } };
  client.dispatch(msg); client.dispatch(msg);
  await Promise.all(client.inbound.values());
  assert.equal(count, 1);
  await client.close();
});

test('RPC errors report codes only, never the private response message', async t => {
  const base = await mock(t, async (req, res) => {
    if (req.method === 'DELETE') { res.writeHead(204).end(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const message = JSON.parse(raw);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: message.id, error: { code: -32000, message: 'private-auth-url-and-token' } }));
  });
  const client = new AcpProbe(base);
  await assert.rejects(client.rpc('session/new', {}), error => error.message === 'RPC_-32000');
  await client.close();
});

test('installer rejects non-pinned versions and non-Termux hosts before calling package tools', () => {
  const script = fileURLToPath(new URL('../bootstrap.sh', import.meta.url));
  for (const args of [[], ['latest'], ['1.2.3;echo'], ['1.2.3', 'extra']]) {
    assert.throws(() => execFileSync('bash', [script, ...args], { stdio: 'pipe' }), error => error.status === 2 && error.stderr.toString().includes('Usage:'));
  }
  assert.throws(() => execFileSync('bash', [script, '1.2.3'], { env: { ...process.env, PREFIX: '/not-termux' }, stdio: 'pipe' }),
    error => error.status === 2 && error.stderr.toString().includes('standard com.termux'));
});

test('protocol smoke fixture: two turns, reload, permission dedupe, cancel and process cleanup', async t => {
  const cli = fileURLToPath(new URL('./fixtures/fake-codebuddy.mjs', import.meta.url));
  await chmod(cli, 0o755);
  let approvals = 0;
  const { report, workspace } = await runSmoke({ cli, task: true, cancelCheck: true, approve: async () => { approvals++; return 'once'; }, startupTimeout: 3000, rpcTimeout: 1500, promptTimeout: 3000 });
  t.after(() => rm(workspace, { recursive: true, force: true }));
  assert.equal(report.status, 'passed', JSON.stringify(report));
  assert.equal(report.checks.sessionLoadOnNewConnection, 'passed');
  assert.equal(report.checks.cancel, 'passed');
  assert.equal(approvals, 2);
  assert.equal(report.observations.permissionRequests, 2);
  assert.equal(report.environment, 'host_only');
  assert.equal(report.manual.browserLogin, 'not_verified');
  assert.ok(!JSON.stringify(report).includes('fixture-private-token'));
  assert.ok(!JSON.stringify(report).includes(workspace));
  const pid = Number(await readFile(join(workspace, 'fixture-pid.txt'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('missing CLI reports failure without raw spawn errors', async t => {
  const { report, workspace } = await runSmoke({ cli: '/no-such-codebuddy', startupTimeout: 1000 });
  t.after(() => rm(workspace, { recursive: true, force: true }));
  assert.equal(report.status, 'failed'); assert.equal(report.error, 'CLI_START_FAILED');
  assert.ok(!JSON.stringify(report).includes('/no-such-codebuddy'));
});

test('report files are private and never overwrite existing files', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wbl-report-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'report.json');
  await saveReport({ test: true }, path);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(saveReport({ test: false }, path), { code: 'EEXIST' });
});
