import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../store.mjs';
import { createBridge } from '../server.mjs';
import { emptySession, applyEvent, eventNeedsSnapshot } from '../../core/index.js';

async function fixture(t, saved = []) {
  const store = new SessionStore(':memory:');
  for (const session of saved) store.put(session);
  let handlers, count = 0, prompts = [], loads = 0;
  const bridge = createBridge({ token: 'private-token', cwd: '/tmp/isolated', store,
    createClient(options) {
      handlers = options;
      return { connect: async () => {}, close: async () => {}, notify: async () => {},
        rpc: async (method, params) => {
          if (method === 'session/new') return { sessionId: `acp-${++count}`, models: { availableModels: [{ modelId: 'model-a', name: 'A' }] } };
          if (method === 'session/load') { loads++; handlers.onUpdate({ sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { text: 'replayed history' } } }); return {}; }
          if (method === 'session/prompt') return new Promise(resolve => prompts.push({ resolve, params }));
          if (method === 'session/set_config_option') return {};
          throw new Error('unsupported');
        },
      };
    },
  });
  await new Promise(resolve => bridge.server.listen(0, '127.0.0.1', resolve));
  await bridge.connect();
  t.after(() => bridge.close());
  const base = `http://127.0.0.1:${bridge.server.address().port}`;
  async function request(path, data, extra = {}) {
    const response = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer private-token', ...extra }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, ...await response.json() };
  }
  return { request, bridge, handlers, prompts, store, get loads() { return loads; } };
}

test('bridge requires token, rejects browser origins, and resyncs stale cursors', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/v1/status', undefined, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await request('/v1/status', undefined, { Origin: 'https://hostile.example' })).status, 401);
  assert.equal((await request('/v1/events?epoch=stale&after=0')).resync, true);
  assert.equal(eventNeedsSnapshot('same', 1, 'same', 3), true);
});

test('prompt idempotency survives lost responses and serializes concurrent work', async t => {
  const { request, prompts } = await fixture(t);
  const { session } = await request('/v1/sessions', {});
  const prompt = { requestId: 'test-request-001', text: '创建安卓测试文件' };
  assert.equal((await request(`/v1/sessions/${session.id}/prompt`, prompt)).status, 202);
  assert.equal((await request(`/v1/sessions/${session.id}/prompt`, prompt)).duplicate, true);
  assert.equal(prompts.length, 1);
  assert.equal((await request('/v1/sessions', {})).status, 409);
  assert.equal((await request(`/v1/sessions/${session.id}/model`, {model: 'model-a'})).status, 409);
  prompts[0].resolve({ stopReason: 'end_turn' });
});

test('permission response validates session and option; cancellation reaches ACP once', async t => {
  const { request, prompts, handlers } = await fixture(t);
  const first = (await request('/v1/sessions', {})).session;
  const second = (await request('/v1/sessions', {})).session;
  await request(`/v1/sessions/${first.id}/prompt`, {requestId: 'permission-test-001', text: 'read file'});
  const pending = handlers.onPermission([{optionId: 'allow', kind: 'allow_once', name: '允许一次'}], {title: 'Read', rawInput: {path: 'probe.txt'}}, {sessionId: first.acpId});
  const snapshot = await request(`/v1/sessions/${first.id}`);
  const id = snapshot.session.permissions[0].id;
  assert.equal((await request(`/v1/sessions/${second.id}/permission`, {id, optionId: 'allow'})).status, 409);
  assert.equal((await request(`/v1/sessions/${first.id}/permission`, {id, optionId: 'invented'})).status, 400);
  assert.equal((await request(`/v1/sessions/${first.id}/permission`, {id, optionId: 'allow'})).status, 200);
  assert.equal(await pending, 'allow');
  prompts[0].resolve({stopReason: 'end_turn'});
});

test('restart marks running sessions interrupted and never replays their prompt', async t => {
  let saved = emptySession('restored', '/tmp/isolated', 'acp-old');
  saved = applyEvent(saved, {seq: 1, type: 'user', data: {text: 'previous task', requestId: 'previous-task-001'}});
  const setup = await fixture(t, [saved]);
  const snapshot = await setup.request('/v1/sessions/restored');
  assert.equal(snapshot.session.running, false);
  assert.equal(snapshot.session.error, 'INTERRUPTED');
  assert.equal((await setup.request('/v1/sessions/restored/prompt', {text: 'previous task', requestId: 'previous-task-001'})).duplicate, true);
  assert.equal(setup.prompts.length, 0);
  await setup.request('/v1/sessions/restored/prompt', {text: 'new explicit task', requestId: 'new-task-001'});
  assert.equal(setup.loads, 1);
  const afterLoad = await setup.request('/v1/sessions/restored');
  assert.ok(!afterLoad.session.messages.some(m => m.text.includes('replayed history')));
  setup.prompts[0].resolve({stopReason: 'end_turn'});
});

test('usage credits accumulate deltas by request, and token chunks merge', () => {
  let state = emptySession('test', '/tmp', 'acp');
  const update = (seq, content) => ({seq, type: 'update', data: {update: content}});
  state = applyEvent(state, update(1, {sessionUpdate: 'agent_message_chunk', content: {text: '安'}}));
  state = applyEvent(state, update(2, {sessionUpdate: 'agent_message_chunk', content: {text: '卓'}}));
  assert.equal(state.messages.length, 1); assert.equal(state.messages[0].text, '安卓');
  for (const credit of [1, 1, 2]) state = applyEvent(state, update(3, {sessionUpdate: 'usage_update', _meta: {'codebuddy.ai/requestId': 'r1', usage: {credit}}}));
  assert.equal(state.credits, 2);
});
