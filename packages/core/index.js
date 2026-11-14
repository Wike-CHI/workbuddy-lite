// Platform-independent snapshot reducer; shared by the bridge and React Native.
export function emptySession(id, cwd, acpId) {
  return { id, acpId, cwd, title: '新会话', updatedAt: Date.now(), running: false,
    messages: [], permissions: [], models: [], model: '', credits: null, error: '', requestIds: [] };
}

export function applyEvent(session, event) {
  const state = { ...session, updatedAt: Date.now() };
  const data = event.data || {};
  if (event.type === 'user') {
    state.messages = [...state.messages, { id: data.requestId, role: 'user', text: data.text }];
    state.title = state.messages.length === 1 ? data.text.slice(0, 32) : state.title;
    state.requestIds = [...state.requestIds, data.requestId].slice(-100);
    state.running = true; state.error = '';
  } else if (event.type === 'update') {
    const update = data.update || {};
    if (['agent_message_chunk', 'agent_thought_chunk'].includes(update.sessionUpdate)) {
      const kind = update.sessionUpdate === 'agent_thought_chunk' ? 'thought' : 'assistant';
      const text = typeof update.content === 'string' ? update.content : update.content?.text || '';
      const messages = [...state.messages];
      const last = messages.at(-1);
      if (last?.role === kind) messages[messages.length - 1] = { ...last, text: (last.text + text).slice(-131072) };
      else messages.push({ id: `${event.seq}`, role: kind, text });
      state.messages = messages;
    } else if (['tool_call', 'tool_call_update'].includes(update.sessionUpdate)) {
      const index = state.messages.findIndex(m => m.toolId === update.toolCallId);
      const item = { ...(state.messages[index] || { id: `tool-${update.toolCallId}`, role: 'tool', text: '' }),
        toolId: update.toolCallId, title: update.title ?? state.messages[index]?.title ?? update.kind ?? '工具',
        status: update.status ?? state.messages[index]?.status ?? 'pending' };
      state.messages = index < 0 ? [...state.messages, item] : state.messages.map((m, i) => i === index ? item : m);
    } else if (update.sessionUpdate === 'usage_update') {
      const credit = update._meta?.usage?.credit;
      const key = update._meta?.['codebuddy.ai/requestId'];
      if (typeof credit === 'number' && Number.isFinite(credit) && typeof key === 'string' && key) {
        const ledger = { ...state.creditLedger };
        const previous = ledger[key] || 0;
        state.credits = Math.max(0, (state.credits || 0) + credit - previous);
        ledger[key] = credit;
        state.creditLedger = Object.fromEntries(Object.entries(ledger).slice(-200));
      }
    }
  } else if (event.type === 'permission') state.permissions = [...state.permissions, data];
  else if (event.type === 'permission_resolved') state.permissions = state.permissions.filter(p => p.id !== data.id);
  else if (event.type === 'done') { state.running = false; state.permissions = []; }
  else if (event.type === 'error') { state.running = false; state.error = data.code || 'AGENT_ERROR'; state.permissions = []; }
  state.messages = state.messages.slice(-200);
  return state;
}

export function eventNeedsSnapshot(epoch, after, currentEpoch, firstSeq) {
  return epoch !== currentEpoch || !Number.isSafeInteger(after) || after < firstSeq - 1;
}
