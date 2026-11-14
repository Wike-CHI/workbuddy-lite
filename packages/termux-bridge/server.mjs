import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { emptySession, applyEvent, eventNeedsSnapshot } from '../core/index.js';

const safeCode = error => /^RPC_-?\d+$|^HTTP_\d+$/.test(error?.message || '') ? error.message : 'AGENT_UNAVAILABLE';
export function compactUpdate(update) {
  if (!update || typeof update !== 'object') return null;
  const kind = update.sessionUpdate;
  if (['agent_message_chunk', 'agent_thought_chunk'].includes(kind)) {
    const content = update.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(c => c?.text || '').join('') : content?.text || '';
    return { sessionUpdate: kind, content: { text: String(text).slice(0, 65536) } };
  }
  if (['tool_call', 'tool_call_update'].includes(kind)) {
    const text = key => typeof update[key] === 'string' ? update[key].slice(0, 512) : undefined;
    return { sessionUpdate: kind, toolCallId: text('toolCallId'), title: text('title'), kind: text('kind'), status: text('status') };
  }
  if (kind === 'usage_update') return { sessionUpdate: kind, _meta: {
    'codebuddy.ai/requestId': String(update._meta?.['codebuddy.ai/requestId'] || '').slice(0, 512), usage: { credit: update._meta?.usage?.credit },
  } };
  return null;
}
export function createBridge({ token, instance = randomUUID(), cwd, store, createClient }) {
  const sessions = new Map(store.load().map(s => [s.id, s]));
  const dirty = new Set();
  const epoch = randomUUID();
  const journal = [];
  let seq = 0, active = '', ready = false, agentError = '', closing = false;
  let client, onShutdown = () => {};
  const loaded = new Set();
  const hydrating = new Set();
  const permissions = new Map();
  const persist = id => { store.put(sessions.get(id)); dirty.delete(id); };
  const emit = (id, type, data) => {
    const event = { seq: ++seq, type, sessionId: id, data };
    sessions.set(id, applyEvent(sessions.get(id), event));
    journal.push(event); if (journal.length > 1000) journal.shift();
    dirty.add(id);
    return event;
  };
  const flush = setInterval(() => { for (const id of dirty) persist(id); }, 200);
  flush.unref();
  const failActive = code => {
    for (const permission of permissions.values()) permission.finish();
    if (sessions.has(active)) { emit(active, 'error', { code }); persist(active); }
    active = '';
  };
  async function connect() {
    try {
      client = createClient({
        onDisconnect(error) { ready = false; agentError = safeCode(error); failActive('CONNECTION_LOST'); },
        onUpdate(params) {
          const session = [...sessions.values()].find(s => s.acpId === params?.sessionId);
          const update = compactUpdate(params?.update);
          if (!closing && session && update && !hydrating.has(session.id)) emit(session.id, 'update', { update });
        },
        onPermission(options, toolCall, params) {
          const sessionId = [...sessions.values()].find(s => s.acpId === params?.sessionId)?.id || active;
          if (!sessionId || !sessions.get(sessionId)?.running) return undefined;
          const id = randomUUID();
          return new Promise(resolve => {
            const finish = option => {
              clearTimeout(timer); permissions.delete(id);
              emit(sessionId, 'permission_resolved', { id }); resolve(option);
            };
            const timer = setTimeout(() => finish(), 90000);
            permissions.set(id, { sessionId, options, finish });
            emit(sessionId, 'permission', { id, title: String(toolCall?.title || '工具权限'),
              input: JSON.stringify(toolCall?.rawInput ?? {}).slice(0, 8000), options });
          });
        },
      });
      await client.connect(); ready = true; agentError = '';
    } catch (error) { agentError = safeCode(error); ready = false; }
  }
  async function body(req) {
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) throw Object.assign(new Error(), { status: 413 });
      chunks.push(chunk);
    }
    try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; } catch { throw Object.assign(new Error(), { status: 400 }); }
  }
  const server = createServer(async (req, res) => {
    const send = (status, result) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(result));
    };
    try {
      const auth = Buffer.from(req.headers.authorization || '');
      const expected = Buffer.from(`Bearer ${token}`);
      // Browser origins are never valid callers, including hostile localhost web pages.
      if (req.headers.origin || auth.length !== expected.length || !timingSafeEqual(auth, expected)) return send(401, { code: 'UNAUTHORIZED' });
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/v1/status') return send(200, { instance, epoch, seq, ready, agentError, busy: !!active });
      if (req.method === 'POST' && url.pathname === '/v1/shutdown') { send(200, { ok: true }); setImmediate(onShutdown); return; }
      if (!ready) return send(503, { code: agentError || 'AGENT_STARTING' });
      if (req.method === 'GET' && url.pathname === '/v1/sessions') return send(200, {
        sessions: [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(({ id, title, updatedAt, running }) => ({ id, title, updatedAt, running })), epoch, seq });
      if (req.method === 'GET' && url.pathname === '/v1/events') {
        const after = Number(url.searchParams.get('after'));
        const resync = eventNeedsSnapshot(url.searchParams.get('epoch'), after, epoch, journal[0]?.seq || seq + 1) || after > seq;
        return send(200, { epoch, seq, resync, events: resync ? [] : journal.filter(e => e.seq > after) });
      }
      if (req.method === 'POST' && url.pathname === '/v1/sessions') {
        if (active) return send(409, { code: 'AGENT_BUSY' });
        // Reserve the execution slot across await to prevent concurrent session creation.
        active = 'creating';
        try {
          const info = await client.rpc('session/new', { cwd, mcpServers: [] });
          if (typeof info?.sessionId !== 'string') throw new Error('NO_SESSION_ID');
          const session = emptySession(randomUUID(), cwd, info.sessionId);
          session.models = info.models?.availableModels || [];
          session.model = info.models?.currentModelId || '';
          sessions.set(session.id, session); loaded.add(session.id); persist(session.id);
          return send(201, { session, epoch, seq });
        } finally { active = ''; }
      }
      const match = /^\/v1\/sessions\/([a-zA-Z0-9-]+)(?:\/(prompt|cancel|permission|model))?$/.exec(url.pathname);
      let session = match && sessions.get(match[1]);
      if (!session) return send(404, { code: 'NOT_FOUND' });
      const action = match[2];
      if (req.method === 'GET' && !action) return send(200, { session, epoch, seq });
      if (req.method !== 'POST') return send(405, { code: 'METHOD_NOT_ALLOWED' });
      const data = await body(req);
      session = sessions.get(match[1]);
      if (action === 'permission') {
        const permission = permissions.get(data.id);
        if (!permission || permission.sessionId !== session.id) return send(409, { code: 'PERMISSION_EXPIRED' });
        if (data.optionId !== null && !permission.options.some(o => o.optionId === data.optionId)) return send(400, { code: 'INVALID_OPTION' });
        permission.finish(data.optionId || undefined); return send(200, { ok: true });
      }
      if (action === 'cancel') {
        if (active !== session.id) return send(409, { code: 'NOT_RUNNING' });
        await client.notify('session/cancel', { sessionId: session.acpId });
        // Do not claim cancellation before the prompt result confirms completion.
        return send(202, { ok: true });
      }
      if (!['prompt', 'model'].includes(action)) return send(404, { code: 'NOT_FOUND' });
      if (action === 'prompt' && session.requestIds.includes(data.requestId)) return send(202, { accepted: true, duplicate: true });
      if (active) return send(409, { code: 'AGENT_BUSY' });
      if (action === 'prompt' && (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 16000 || !/^[a-zA-Z0-9-]{8,100}$/.test(data.requestId || ''))) return send(400, { code: 'INVALID_PROMPT' });
      if (action === 'model' && !session.models.some(m => m.modelId === data.model)) return send(400, { code: 'INVALID_MODEL' });
      active = session.id;
      try {
        if (!loaded.has(session.id)) {
          hydrating.add(session.id);
          try { await client.rpc('session/load', { sessionId: session.acpId, cwd: session.cwd, mcpServers: [] }); }
          finally { hydrating.delete(session.id); }
          loaded.add(session.id);
        }
        if (action === 'model') {
          await client.rpc('session/set_config_option', { sessionId: session.acpId, configId: 'model', value: data.model });
          sessions.get(session.id).model = data.model; persist(session.id); active = ''; return send(200, { ok: true });
        }
        emit(session.id, 'user', { requestId: data.requestId, text: data.text }); persist(session.id);
        send(202, { accepted: true });
        void client.rpc('session/prompt', { sessionId: session.acpId, prompt: [{ type: 'text', text: data.text }] }, 600000)
          .then(result => { emit(session.id, 'done', { stopReason: result?.stopReason }); persist(session.id); })
          .catch(error => { emit(session.id, 'error', { code: safeCode(error) }); persist(session.id); })
          .finally(() => {
            for (const permission of permissions.values()) if (permission.sessionId === session.id) permission.finish();
            if (active === session.id) active = '';
          });
      } catch (error) { active = ''; throw error; }
    } catch (error) { if (!res.headersSent) send(error.status || 502, { code: error.status ? 'INVALID_REQUEST' : safeCode(error) }); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return { server, connect, setShutdown(callback) { onShutdown = callback; },
    async close() { closing = true; clearInterval(flush); failActive('INTERRUPTED'); await client?.close(); for (const id of dirty) persist(id); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); },
    get closing() { return closing; } };
}
