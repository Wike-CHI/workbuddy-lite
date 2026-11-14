// Shared bounded ACP transport for the Termux bridge and P0 probes.
export async function readMessages(response, onMessage) {
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  if (!response.body) throw new Error('EMPTY_BODY');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const sse = response.headers.get('content-type')?.includes('text/event-stream');
  const dispatch = data => {
    if (!data.trim()) return;
    const message = JSON.parse(data);
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('INVALID_MESSAGE');
    onMessage(message);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 2 * 1024 * 1024) throw new Error('FRAME_TOO_LARGE');
      if (sse) {
        let match;
        while ((match = /\r?\n\r?\n/.exec(buffer))) {
          const frame = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          dispatch(frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).replace(/^ /, '')).join('\n'));
        }
      }
      if (done) break;
    }
    if (!sse) dispatch(buffer);
  } finally { reader.releaseLock(); }
}

export class AcpProbe {
  constructor(baseUrl, { token, timeout = 30000, onUpdate = () => {}, onPermission, onDisconnect = () => {} } = {}) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/') {
      throw new Error('LOOPBACK_ONLY');
    }
    this.base = url.origin; this.timeout = timeout; this.onUpdate = onUpdate; this.onPermission = onPermission; this.onDisconnect = onDisconnect;
    this.headers = { 'X-CodeBuddy-Request': '1', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
    if (token) this.headers.Authorization = `Bearer ${token}`;
    this.pending = new Map(); this.inbound = new Map(); this.nextId = 1;
    this.controller = new AbortController(); this.transports = new Set(); this.closed = false;
  }
  async connect() {
    const res = await fetch(`${this.base}/api/v1/acp/connect`, { method: 'POST', headers: this.headers, body: '{}', signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(this.timeout)]) });
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    const connection = await res.json();
    if (typeof connection.connectionId !== 'string' || !connection.connectionId) throw new Error('NO_CONNECTION_ID');
    this.headers['acp-connection-id'] = connection.connectionId;
    if (connection.sessionToken) this.headers.Authorization = `Bearer ${connection.sessionToken}`;
    this.subscription = (async () => {
      const response = await fetch(`${this.base}/api/v1/acp`, { headers: this.headers, signal: this.controller.signal });
      await readMessages(response, message => this.dispatch(message));
      if (!this.closed) throw new Error('SUBSCRIPTION_ENDED');
    })().catch(error => { if (!this.closed) { this.subscriptionError = error; this.failAll(error); this.onDisconnect(error); } });
    return this.rpc('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
  }
  failAll(error) { for (const p of [...this.pending.values()]) p.reject(error); }
  dispatch(message) {
    if (message.method && message.id !== undefined) {
      // Same reverse request can arrive in the POST and subscription streams.
      if (this.inbound.has(message.id)) return;
      if (this.inbound.size >= 4096) { this.failAll(new Error('TOO_MANY_REQUESTS')); return; }
      const task = (async () => {
        if (message.method !== 'session/request_permission') {
          await this.post({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unsupported client method' } });
          return;
        }
        const options = message.params?.options ?? [];
        const selected = await this.onPermission?.(options, message.params?.toolCall, message.params);
        const outcome = selected && options.some(o => o.optionId === selected)
          ? { outcome: 'selected', optionId: selected } : { outcome: 'cancelled' };
        await this.post({ jsonrpc: '2.0', id: message.id, result: { outcome } });
      })().catch(error => this.failAll(error));
      this.inbound.set(message.id, task);
    } else if (message.method === 'session/update') {
      this.onUpdate(message.params);
    } else if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (pending) {
        if (message.error) pending.reject(new Error(`RPC_${message.error.code ?? 'ERROR'}`));
        else pending.resolve(message.result);
      }
    }
  }
  async post(body, signal = this.controller.signal) {
    const response = await fetch(`${this.base}/api/v1/acp`, { method: 'POST', headers: this.headers, body: JSON.stringify(body), signal });
    if (response.status === 204) return;
    await readMessages(response, message => this.dispatch(message));
  }
  rpc(method, params, timeout = this.timeout) {
    if (this.closed || this.subscriptionError) return Promise.reject(new Error('CONNECTION_CLOSED'));
    const id = this.nextId++;
    const transport = new AbortController();
    this.transports.add(transport);
    return new Promise((resolve, reject) => {
      const finish = callback => value => {
        clearTimeout(timer); this.pending.delete(id);
        // POST may remain open after subscription delivers the RPC result.
        transport.abort(); this.transports.delete(transport); callback(value);
      };
      const timer = setTimeout(() => this.pending.get(id)?.reject(new Error('RPC_TIMEOUT')), timeout);
      this.pending.set(id, { resolve: finish(resolve), reject: finish(reject) });
      this.post({ jsonrpc: '2.0', id, method, params }, AbortSignal.any([transport.signal, this.controller.signal]))
        .catch(error => this.pending.get(id)?.reject(error));
    });
  }
  notify(method, params) {
    return this.post({ jsonrpc: '2.0', method, params }, AbortSignal.any([this.controller.signal, AbortSignal.timeout(this.timeout)]));
  }
  async close() {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.closeInternal();
    return this.closePromise;
  }
  async closeInternal() {
    this.closed = true; this.failAll(new Error('CONNECTION_CLOSED')); this.controller.abort();
    for (const transport of this.transports) transport.abort();
    await this.subscription;
    try { await fetch(`${this.base}/api/v1/acp`, { method: 'DELETE', headers: this.headers, signal: AbortSignal.timeout(2000) }); } catch { /* Process cleanup still runs. */ }
  }
}
