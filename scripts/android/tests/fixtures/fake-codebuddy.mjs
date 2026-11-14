#!/usr/bin/env node
// Offline fixture: does not run CodeBuddy or call a model.
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';

const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const subscribers = new Map();
const permissionReplies = new Map();
let connection = 0, turn = 0, pendingPrompt;
const frame = value => `event: message\r\ndata: ${JSON.stringify(value)}\r\n\r\n`;
const send = (res, value, end = true) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(':ok\r\n\r\n');
  res.write(frame(value));
  if (end) res.end();
};
const server = createServer(async (req, res) => {
  const cid = req.headers['acp-connection-id'];
  if (req.url === '/api/v1/health') { res.end('{}'); return; }
  if (req.url === '/api/v1/acp/connect') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ connectionId: `c${++connection}`, sessionToken: 'fixture-private-token' })); return;
  }
  if (req.headers.authorization !== 'Bearer fixture-private-token') { res.writeHead(401).end(); return; }
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(':ok\r\n\r\n');
    subscribers.set(cid, res); req.on('close', () => subscribers.delete(cid)); return;
  }
  if (req.method === 'DELETE') { res.writeHead(204).end(); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const message = JSON.parse(raw);
  if (!message.method) {
    permissionReplies.get(message.id)?.(message.result); permissionReplies.delete(message.id);
    res.writeHead(204).end(); return;
  }
  const reply = result => {
    const messageReply = { jsonrpc: '2.0', id: message.id, result };
    send(res, messageReply);
    subscribers.get(cid)?.write(frame(messageReply));
  };
  if (message.method === 'initialize') reply({ protocolVersion: 1 });
  else if (message.method === 'session/new') reply({ sessionId: 'fixture-session', models: { availableModels: [{ id: 'test' }] } });
  else if (message.method === 'session/load') reply({});
  else if (message.method === 'session/prompt') {
    turn++;
    if (turn === 3) { pendingPrompt = reply; return; }
    const requestId = `permission-${turn}`;
    const permission = { jsonrpc: '2.0', id: requestId, method: 'session/request_permission', params: {
      toolCall: { title: 'fixture only', rawInput: {} }, options: [{ optionId: 'once', kind: 'allow_once' }],
    } };
    const selected = new Promise(resolve => permissionReplies.set(requestId, resolve));
    // Deliver the same reverse request over both streams.
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(frame(permission));
    subscribers.get(cid)?.write(frame(permission));
    const result = await selected;
    if (result.outcome.outcome === 'selected') {
      await writeFile('probe.txt', turn === 1 ? 'android-p0-first\n' : 'android-p0-second\n');
      if (turn === 2) await writeFile('shell-proof.txt', 'shell-ok\n');
      subscribers.get(cid)?.write(frame({ method: 'session/update', params: { sessionId: 'fixture-session', update: { sessionUpdate: 'tool_call', kind: 'execute' } } }));
    }
    res.end(frame({ jsonrpc: '2.0', id: message.id, result: { stopReason: result.outcome.outcome === 'selected' ? 'end_turn' : 'cancelled' } }));
  } else if (message.method === 'session/cancel') {
    pendingPrompt?.({ stopReason: 'cancelled' }); pendingPrompt = null; res.writeHead(204).end();
  } else { res.writeHead(400).end(); }
});
await writeFile('fixture-pid.txt', String(process.pid));
server.listen(port, '127.0.0.1');
