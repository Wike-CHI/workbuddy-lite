// WorkBuddy Lite 前端：只做三件事——把话递出去、把工具调用画清楚、把权限交回用户。
(() => {
  const $ = (id) => document.getElementById(id);
  const messagesEl = $('messages');
  const inputEl = $('input');
  const sendBtn = $('send');
  const listEl = $('session-list');
  const paletteEl = $('palette');
  const attachStrip = $('attach-strip');
  const fileInput = $('file-input');
  const composerEl = document.querySelector('.composer');
  const modalEl = $('market-modal');
  const marketBody = $('market-body');
  const marketFoot = $('market-foot');
  const catalogFilter = $('catalog-filter');
  const modelSelect = $('model-select');
  const modeSelect = $('mode-select');
  const creditBtn = $('credit-btn');
  const creditText = $('credit-text');
  const usageModal = $('usage-modal');
  const usageBody = $('usage-body');
  const wsModal = $('ws-modal');
  const wsList = $('ws-list');
  const wsCurrent = $('ws-current');
  const wsPath = $('ws-path');

  const S = {
    demo: false,
    cwd: '',
    workspace: '',
    agentReady: false,
    sessions: [],
    activeId: null,
    lastSeq: 0,
    running: false,
    mode: 'fullAccess',
    model: '',
    models: [],
    modelTouched: false,
    modeTouched: false,
    usage: null,
    quota: null,
    credits: 0,
    turn: null,        // 当前 assistant turn 容器
    textEl: null,      // 正在流式追加的文本块
    thoughtEl: null,
    tools: new Map(),  // toolCallId -> element
    perms: new Map(),  // requestId -> element
    replaying: false,
    turnHasContent: false,
    turnCredit: null,
    turnCreditShown: false,
    composing: false,
    history: [],
    histIndex: -1,

    // 技能 / 连接器 / 插件市场
    catalog: { skills: [], connectors: [], plugins: [], marketplaces: [], codebuddyDir: '' },
    acpCommands: [],          // ACP 下发的 available_commands_update
    attachments: [],          // {name, mime, dataUrl, data}
    connectorRefs: [],        // 本轮显式引用的连接器名
    palette: { open: false, mode: '', items: [], index: 0, start: 0, end: 0 },
    modalTab: 'skills',
    workspaces: [],
  };

  const DRAFT_KEY = 'wbl.drafts';
  const PREF_KEY = 'wbl.prefs';
  let drafts = {};
  let prefs = {};
  try { drafts = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') || {}; } catch { drafts = {}; }
  try { prefs = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch { prefs = {}; }
  function savePrefs() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ mode: S.mode, model: S.model }));
    } catch { }
  }

  // ---------------- 工具函数 ----------------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 前端日志回传，便于在 app.log 里定位问题
  function plog(msg) {
    try {
      fetch('/api/log', { method: 'POST', body: new Date().toISOString().slice(11, 19) + ' ' + msg, keepalive: true });
    } catch { }
  }

  function fmtNum(n) {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return String(n || 0);
  }

  function fmtCredits(n) {
    const v = Number(n || 0);
    if (!v) return '0';
    if (v >= 100) return v.toFixed(0);
    if (v >= 10) return v.toFixed(1).replace(/\.0$/, '');
    return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function multiplierOf(m) {
    const raw = m && (m.credits || '');
    const hit = String(raw).match(/[x×]\s*([\d.]+)/i);
    if (hit) return parseFloat(hit[1]);
    if (m && typeof m.multiplier === 'number') return m.multiplier;
    return null;
  }

  function modelShort(m) {
    if (!m) return '';
    const v = multiplierOf(m);
    if (v === null) return m.name || m.id || '';
    return (m.name || m.id) + ' · ' + (v === 0 ? '免费' : '×' + v);
  }

  function fmtReset(ms) {
    if (!ms) return '—';
    const d = new Date(Number(ms));
    if (Number.isNaN(d.getTime())) return '—';
    const p = (x) => String(x).padStart(2, '0');
    return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function todayStr() {
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function relTime(ts) {
    const d = Date.now() - ts;
    if (d < 60000) return '刚刚';
    if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
    return Math.floor(d / 86400000) + ' 天前';
  }

  // 极简 Markdown：够用就行，不做完整实现
  function md(src) {
    const blocks = [];
    let text = String(src || '').replace(/\r\n/g, '\n');
    // 先抠出代码块
    text = text.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
      blocks.push(`<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`);
      return `\u0000${blocks.length - 1}\u0000`;
    });

    const lines = text.split('\n');
    const out = [];
    let list = null;      // 'ul' | 'ol'
    let para = [];

    const flushPara = () => {
      if (para.length) {
        out.push(`<p>${inline(para.join(' '))}</p>`);
        para = [];
      }
    };
    const flushList = () => {
      if (list) {
        out.push(`</${list}>`);
        list = null;
      }
    };

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      const placeholder = line.match(/^\u0000(\d+)\u0000$/);
      if (placeholder) {
        flushPara(); flushList();
        out.push(blocks[+placeholder[1]]);
        continue;
      }
      if (!line.trim()) { flushPara(); flushList(); continue; }

      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) {
        flushPara(); flushList();
        out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
        continue;
      }
      const ul = line.match(/^\s*[-*]\s+(.*)$/);
      const ol = line.match(/^\s*\d+\.\s+(.*)$/);
      if (ul || ol) {
        flushPara();
        const want = ul ? 'ul' : 'ol';
        if (list !== want) { flushList(); out.push(`<${want}>`); list = want; }
        out.push(`<li>${inline((ul || ol)[1])}</li>`);
        continue;
      }
      const bq = line.match(/^>\s?(.*)$/);
      if (bq) {
        flushPara(); flushList();
        out.push(`<blockquote>${inline(bq[1])}</blockquote>`);
        continue;
      }
      flushList();
      para.push(line);
    }
    flushPara(); flushList();

    function inline(s) {
      return esc(s)
        .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    }

    return out.join('');
  }

  function atBottom() {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 90;
  }
  function scrollDown(force) {
    if (force || atBottom()) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ---------------- 渲染 ----------------
  function clearMessages() {
    messagesEl.innerHTML = '';
    S.turn = null;
    S.textEl = null;
    S.thoughtEl = null;
    S.tools.clear();
    S.perms.clear();
    S.turnCredit = null;
    S.turnCreditShown = false;
    updateUsage(0, 0);  // 换会话时用量环要跟着归零，否则显示上一个会话的残留
  }

  function ensureTurn() {
    if (S.turn) return S.turn;
    const wrap = document.createElement('div');
    wrap.className = 'msg-assistant';
    wrap.innerHTML = '<div class="avatar">W</div><div class="assistant-body"></div>';
    messagesEl.appendChild(wrap);
    S.turn = wrap.querySelector('.assistant-body');
    return S.turn;
  }

  function addUser(text, data) {
    $('empty-state')?.remove();
    S.turnHasContent = false;
    S.turn = null;
    S.textEl = null;
    S.thoughtEl = null;

    const refs = ((data && data.connectors) || []).filter((x) => typeof x === 'string');
    const imgs = ((data && data.images) || []).filter((x) => x && x.url);

    const d = document.createElement('div');
    d.className = 'turn';
    const row = document.createElement('div');
    row.className = 'msg-user';
    const stack = document.createElement('div');
    stack.className = 'user-stack';

    if (text || !imgs.length) {
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = text || '';
      stack.appendChild(bubble);
    }
    if (imgs.length) {
      const box = document.createElement('div');
      box.className = 'user-images';
      for (const img of imgs) {
        const el = document.createElement('img');
        el.src = img.url;
        el.alt = img.name || '图片';
        el.title = img.name || '';
        box.appendChild(el);
      }
      stack.appendChild(box);
    }
    if (refs.length) {
      const meta = document.createElement('div');
      meta.className = 'u-meta';
      meta.textContent = '连接器：' + refs.join(' · ');
      stack.appendChild(meta);
    }

    row.appendChild(stack);
    d.appendChild(row);
    messagesEl.appendChild(d);
    scrollDown(true);
  }

  function addText(chunk) {
    const body = ensureTurn();
    S.turnHasContent = true;
    if (!S.textEl) {
      S.textEl = document.createElement('div');
      S.textEl.className = 'block-text';
      body.appendChild(S.textEl);
      S.textEl._raw = '';
    }
    S.textEl._raw += chunk;
    S.textEl.innerHTML = md(S.textEl._raw);
    scrollDown();
  }

  function addThought(chunk) {
    const body = ensureTurn();
    if (!S.thoughtEl) {
      S.thoughtEl = document.createElement('div');
      S.thoughtEl.className = 'block-thought';
      S.thoughtEl.innerHTML = '<span class="label">思考</span><span class="t"></span>';
      body.appendChild(S.thoughtEl);
      S.thoughtEl.querySelector('.t').textContent = '';
    }
    S.thoughtEl.querySelector('.t').textContent += chunk;
    scrollDown();
  }

  const KIND_ICON = { edit: '✎', execute: '▶', read: '▤', search: '⌕', fetch: '⤓', think: '✳', delete: '⌫', move: '⇄' };
  const STATUS_TEXT = { pending: '待执行', in_progress: '进行中', completed: '已完成', failed: '失败', cancelled: '已取消' };
  const STATUS_CLASS = { pending: '', in_progress: 'running', completed: 'done', failed: 'fail', cancelled: 'fail' };

  function toolBodyHtml(data) {
    let html = '';
    if (data.rawInput && Object.keys(data.rawInput).length) {
      html += `<div class="kv">${esc(JSON.stringify(data.rawInput, null, 2))}</div>`;
    }
    for (const b of data.content || []) {
      if (b.type === 'diff') {
        const oldLines = String(b.oldText || '').split('\n');
        const newLines = String(b.newText || '').split('\n');
        let rows = '';
        oldLines.forEach((l) => { if (l !== '' || oldLines.length > 1) rows += `<div class="dl del">- ${esc(l)}</div>`; });
        newLines.forEach((l) => { if (l !== '' || newLines.length > 1) rows += `<div class="dl add">+ ${esc(l)}</div>`; });
        html += `<div class="diff"><div class="dh">${esc(b.path || '')}</div>${rows}</div>`;
      } else if (b.type === 'text') {
        html += `<div class="kv">${esc(b.text)}</div>`;
      } else if (b.type === 'link') {
        html += `<div class="kv">${esc(b.name || b.uri || '')}</div>`;
      }
    }
    if (data.rawOutput) {
      html += `<div class="kv">${esc(typeof data.rawOutput === 'string' ? data.rawOutput : JSON.stringify(data.rawOutput, null, 2))}</div>`;
    }
    return html;
  }

  function upsertTool(data) {
    S.turnHasContent = true;
    let el = S.tools.get(data.id);
    if (!el) {
      const body = ensureTurn();
      el = document.createElement('div');
      el.className = 'tool';
      el.innerHTML = `<div class="tool-head"><span class="tool-icon"></span><span class="tool-title"></span><span class="pill"></span></div><div class="tool-body"></div>`;
      el.querySelector('.tool-head').addEventListener('click', () => el.classList.toggle('open'));
      body.appendChild(el);
      S.tools.set(data.id, el);
      el._data = {};
      if (data.rawInput || (data.content && data.content.length)) el.classList.add('open');
    }
    el._data = { ...el._data, ...data };
    const d = el._data;
    el.querySelector('.tool-icon').textContent = KIND_ICON[d.kind] || '⚙';
    el.querySelector('.tool-title').textContent = d.title || '工具调用';
    const pill = el.querySelector('.pill');
    const st = d.status || 'pending';
    pill.textContent = STATUS_TEXT[st] || st;
    pill.className = 'pill ' + (STATUS_CLASS[st] || '');
    el.querySelector('.tool-body').innerHTML = toolBodyHtml(d);
    scrollDown();
  }

  function addPlan(entries) {
    S.turnHasContent = true;
    const body = ensureTurn();
    const el = document.createElement('div');
    el.className = 'plan';
    const items = (entries || []).map((e) => {
      const st = (e.status || 'pending').replace(/-/g, '_');
      const mark = st === 'completed' ? '✓' : st === 'in_progress' ? '◐' : '○';
      return `<li class="${st}"><span class="mk">${mark}</span><span>${esc(e.content || '')}</span></li>`;
    }).join('');
    el.innerHTML = `<div class="plan-t">执行计划</div><ul>${items}</ul>`;
    body.appendChild(el);
    scrollDown();
  }

  function addPermission(data) {
    const body = ensureTurn();
    const el = document.createElement('div');
    el.className = 'perm';
    const opts = (data.options || []).map((o, i) =>
      `<button data-opt="${esc(o.optionId)}" class="${i === 0 ? 'primary' : ''}">${esc(o.name || o.optionId)}</button>`
    ).join('');
    el.innerHTML = `<div class="q"><span>⚠</span><span>${esc(data.title)}</span></div><div class="btns">${opts}</div>`;
    if (S.replaying) {
      // 历史记录里的授权请求已经失效，不能点
      el.querySelectorAll('button').forEach((b) => (b.disabled = true));
      el.querySelector('.btns').innerHTML += `<span class="resolved">（历史记录）</span>`;
    }
    el.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', async () => {
        el.querySelectorAll('button').forEach((x) => (x.disabled = true));
        await fetch('/api/permission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: data.requestId, optionId: b.dataset.opt }),
        });
      });
    });
    S.perms.set(data.requestId, { el, options: data.options || [] });
    body.appendChild(el);
    scrollDown(true);
  }

  function resolvePermission(data) {
    const rec = S.perms.get(data.requestId);
    if (!rec) return;
    const chosen = (rec.options || []).find((o) => o.optionId === data.optionId);
    rec.el.querySelector('.btns').innerHTML =
      `<div class="resolved">已选择：${esc(chosen ? chosen.name : data.optionId)}</div>`;
    S.perms.delete(data.requestId);
  }

  function addError(msg, kind) {
    const body = ensureTurn();
    const el = document.createElement('div');
    el.className = 'error-card';
    el.textContent = msg;
    if (kind === 'auth') {
      el.innerHTML += `<div style="margin-top:8px;color:#4b5158">终端执行 <code>codebuddy</code> 后输入 <code>/login</code>，再重启本应用即可。</div>`;
    }
    body.appendChild(el);
    scrollDown(true);
  }

  function setRunning(on) {
    S.running = on;
    sendBtn.textContent = on ? '■' : '↑';
    sendBtn.classList.toggle('stop', on);
    sendBtn.title = on ? '停止' : '发送';
    $('foot-status').textContent = on ? '工作中' : '就绪';
    inputEl.placeholder = on
      ? '正在处理，点右侧 ■ 停止…'
      : '输入消息，Enter 发送 · Shift+Enter 换行 · / 技能 · @ 连接器';
    updateSendState();
    if (!on) inputEl.focus();
  }

  function addTurnCredit() {
    if (S.turnCreditShown || S.replaying || !S.turnCredit) return;
    const nominal = Number(S.turnCredit.nominal || 0);
    const actual = Number(S.turnCredit.actual || 0);
    if (!nominal && !actual) return;
    const body = ensureTurn();
    const el = document.createElement('div');
    el.className = 'turn-credit' + (nominal > 0 && actual === 0 ? ' free' : '');
    el.textContent = '本轮 ' + fmtCredits(nominal || actual) + ' 积分';
    el.title = '实扣 ' + fmtCredits(actual) + ' 积分' +
      (S.quota && S.quota.percent !== undefined ? ' · 额度已用 ' + Number(S.quota.percent).toFixed(1) + '%' : '');
    body.appendChild(el);
    S.turnCreditShown = true;
    scrollDown();
  }

  function updateUsage(used, size) {
    const c = 2 * Math.PI * 15;
    const ratio = size > 0 ? Math.min(1, used / size) : 0;
    $('usage-arc').style.strokeDashoffset = String(c * (1 - ratio));
    $('usage-text').textContent = fmtNum(used);
  }

  // ---------------- 模型 / 积分 / 工作空间 ----------------
  function updateCreditChip(total) {
    creditText.textContent = fmtCredits(total);
    const q = S.quota || {};
    const bits = ['累计 ' + fmtCredits(total) + ' 积分'];
    if (q.model) bits.push('额度模型 ' + q.model);
    if (q.percent !== undefined) bits.push('预算已用 ' + Number(q.percent).toFixed(1) + '%');
    if (q.resetAt) bits.push('重置 ' + fmtReset(q.resetAt));
    creditBtn.title = bits.join(' · ');
  }

  function updateQuotaBadge(quota) {
    const el = $('quota-badge');
    if (!el) return;
    const q = quota || {};
    if (q.percent === undefined || q.percent === null) {
      el.textContent = '额度 —';
      el.title = '发一条消息后从 usage_update 读取额度';
      return;
    }
    const pct = Number(q.percent || 0);
    el.textContent = '额度 ' + pct.toFixed(pct % 1 ? 1 : 0) + '%';
    el.title = (q.model ? '额度模型 ' + q.model + ' · ' : '') + '重置 ' + fmtReset(q.resetAt);
  }

  function renderModelSelect() {
    const models = S.models || [];
    if (!models.length) {
      modelSelect.innerHTML = `<option value="${esc(S.model)}">${esc(S.model || '模型')}</option>`;
      modelSelect.value = S.model || '';
      return;
    }
    const list = models.slice();
    if (S.model && !list.some((m) => m.id === S.model)) {
      list.push({ id: S.model, name: S.model, credits: '' });
    }
    modelSelect.innerHTML = list
      .map((m) => `<option value="${esc(m.id)}">${esc(modelShort(m))}</option>`)
      .join('');
    if (S.model) modelSelect.value = S.model;
  }

  function applyModelConfig(options, current) {
    if (Array.isArray(options) && options.length) {
      const prev = new Map((S.models || []).map((m) => [m.id, m]));
      S.models = options.map((o) => {
        const old = prev.get(o.value) || {};
        return { ...old, id: o.value, name: o.name || o.value, credits: o.description || old.credits || '' };
      });
    }
    if (current && !S.modelTouched) S.model = current;
    renderModelSelect();
    const cur = (S.models || []).find((m) => m.id === S.model);
    if (cur) $('model-name').textContent = cur.name;
  }

  const MODE_LABELS = {
    default: '每次询问',
    acceptEdits: '自动改文件',
    plan: '只读规划',
    auto: '自动审查',
    dontAsk: '不询问',
    bypassPermissions: '跳过权限',
    fullAccess: '完全放行',
  };

  function applyModeConfig(options, current) {
    if (Array.isArray(options) && options.length) {
      modeSelect.innerHTML = options
        .map((o) => `<option value="${esc(o.value)}">${esc(MODE_LABELS[o.value] || o.name || o.value)}</option>`)
        .join('');
    }
    if (current && !S.modeTouched) S.mode = current;
    if (modeSelect.querySelector(`option[value="${CSS.escape(S.mode)}"]`)) modeSelect.value = S.mode;
    savePrefs();
  }

  async function loadModels() {
    try {
      const r = await fetch('/api/models').then((x) => x.json());
      if (Array.isArray(r.models) && r.models.length) S.models = r.models;
      if (!S.modelTouched) S.model = r.selected || r.currentId || S.model;
      renderModelSelect();
      const cur = (S.models || []).find((m) => m.id === S.model);
      if (cur) $('model-name').textContent = cur.name;
      if (r.quota && r.quota.percent !== undefined) {
        S.quota = r.quota;
        updateQuotaBadge(r.quota);
        updateCreditChip(S.credits || 0);
      }
      if (r.error) note('模型目录：' + r.error);
    } catch (e) {
      plog('models error ' + e.message);
    }
  }

  async function changeModel(id) {
    S.model = id;
    S.modelTouched = true;
    renderModelSelect();
    savePrefs();
    const cur = (S.models || []).find((m) => m.id === id);
    $('model-name').textContent = cur ? cur.name : id;
    note('模型切换为 ' + (cur ? modelShort(cur) : id));
    try {
      const r = await fetch('/api/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: S.activeId || '', model: id }),
      }).then((x) => x.json());
      if (r && r.error) note('模型切换失败：' + r.error);
    } catch (e) {
      note('模型切换失败：' + e.message);
    }
  }

  function usageHeroHtml() {
    const u = S.usage || {};
    const q = u.quota || S.quota || {};
    const pct = q.percent === undefined ? null : Number(q.percent || 0);
    const pctText = pct === null ? '—' : pct.toFixed(1) + '%';
    const width = pct === null ? 0 : Math.max(0, Math.min(100, pct));
    return `<div class="u-hero">
      <div class="u-hero-top">
        <div>
          <div class="u-label">共享积分预算</div>
          <div class="u-big">${pctText} <small>已用</small></div>
        </div>
        <div class="u-meta">
          <span>额度模型 ${esc(q.model || '—')}</span>
          <span>重置 ${esc(fmtReset(q.resetAt))}</span>
        </div>
      </div>
      <div class="u-bar"><i style="width:${width}%"></i></div>
      <div class="u-meta">
        <span>预算百分比来自 CodeBuddy 的 usage_update.quota</span>
      </div>
    </div>`;
  }

  function usageStatsHtml() {
    const u = S.usage || {};
    const cur = (S.models || []).find((m) => m.id === S.model);
    const mult = multiplierOf(cur);
    const big = (v) => fmtCredits(v);
    return `<div class="u-grid">
      <div class="u-stat"><b>${big(u.workspaceCredits)}</b><span>本工作空间积分</span></div>
      <div class="u-stat"><b>${big(u.workspaceToday)}</b><span>本工作空间今日</span></div>
      <div class="u-stat"><b>${big(u.totalCredits)}</b><span>全部累计积分</span></div>
      <div class="u-stat"><b>${big(u.totalCharged)}</b><span>实际扣除</span></div>
    </div>
    <div class="u-section">
      <h3>当前模型</h3>
      <div class="u-row"><span class="t">${esc(cur ? modelShort(cur) : S.model || '—')}</span>
        <span class="v">${mult === null ? '' : (mult === 0 ? '免费' : '×' + mult + ' 积分倍率')}</span></div>
      <div class="u-note">本轮积分按 original_credit 记录，实际扣除以 credit 为准；免费模型会显示「免费额度」。</div>
    </div>`;
  }

  function usageSessionsHtml() {
    const u = S.usage || {};
    const items = (u.sessions || []).filter((s) => Number(s.credits || 0) > 0).slice(0, 8);
    if (!items.length) return `<div class="u-section"><h3>最近会话</h3><div class="u-empty">还没有积分记录</div></div>`;
    const rows = items.map((s) => `<div class="u-row">
      <span class="t">${esc(s.title || '新会话')}${s.inWorkspace ? ' <span class="badge ok">本空间</span>' : ''}</span>
      <span class="v">${fmtCredits(s.credits)} 积分</span>
    </div>`).join('');
    return `<div class="u-section"><h3>最近会话</h3>${rows}</div>`;
  }

  function usageCliHtml() {
    const stats = (S.usage || {}).cliStats;
    if (!stats) return `<div class="u-section"><h3>CodeBuddy 历史用量</h3><div class="u-empty">${S.demo ? '演示模式不读取全局统计' : 'Agent 未就绪时读不到全局统计'}</div></div>`;
    let tokens = 0;
    for (const k of Object.keys(stats.modelUsage || {})) {
      const m = stats.modelUsage[k] || {};
      tokens += Number(m.inputTokens || 0) + Number(m.outputTokens || 0);
    }
    const models = Object.keys(stats.modelUsage || {}).length;
    return `<div class="u-section">
      <h3>CodeBuddy 历史用量</h3>
      <div class="u-grid">
        <div class="u-stat"><b>${stats.totalSessions || 0}</b><span>历史会话</span></div>
        <div class="u-stat"><b>${fmtNum(stats.totalMessages || 0)}</b><span>历史消息</span></div>
        <div class="u-stat"><b>${fmtNum(tokens)}</b><span>历史 Token</span></div>
        <div class="u-stat"><b>${models}</b><span>使用过的模型</span></div>
      </div>
    </div>`;
  }

  function renderUsage() {
    if (!S.usage) {
      usageBody.innerHTML = `<div class="u-empty">正在读取…</div>`;
      return;
    }
    usageBody.innerHTML =
      usageHeroHtml() +
      usageStatsHtml() +
      usageSessionsHtml() +
      usageCliHtml() +
      `<div class="u-actions">
         <button class="row-btn primary" data-act="cost">让 CodeBuddy 跑 /cost 核对</button>
         <button class="row-btn" data-act="refresh">刷新</button>
       </div>`;
  }

  async function loadUsage() {
    try {
      S.usage = await fetch('/api/usage').then((x) => x.json());
      if (S.usage.quota && S.usage.quota.percent !== undefined) {
        S.quota = S.usage.quota;
        updateQuotaBadge(S.usage.quota);
      }
      updateCreditChip(S.usage.workspaceCredits || 0);
      if (!usageModal.classList.contains('hidden')) renderUsage();
    } catch (e) {
      plog('usage error ' + e.message);
      usageBody.innerHTML = `<div class="u-empty">读取失败：${esc(e.message)}</div>`;
    }
  }

  function openUsage() {
    usageModal.classList.remove('hidden');
    if (!S.usage) usageBody.innerHTML = `<div class="u-empty">正在读取…</div>`;
    else renderUsage();
    loadUsage();
  }

  function closeUsage() {
    usageModal.classList.add('hidden');
  }

  function leafOf(path) {
    const p = String(path || '').replace(/[\\/]+$/, '');
    const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
    return i >= 0 ? p.slice(i + 1) : p;
  }

  function updateCwdChip() {
    const chip = $('cwd-chip');
    chip.textContent = S.cwd || '—';
    chip.title = '工作空间：' + (S.cwd || '—') + '（点击切换或新窗口打开）';
  }

  function renderWorkspaces() {
    const cur = S.cwd;
    wsCurrent.innerHTML = `<div class="l">当前工作空间</div><div class="p">${esc(cur || '—')}</div>`;
    if (!S.workspaces.length) {
      wsList.innerHTML = `<div class="u-empty">还没有更多工作空间</div>`;
      return;
    }
    const label = { current: '当前', recent: '最近', session: '会话', subdir: '子目录' };
    wsList.innerHTML = S.workspaces
      .filter((w) => !w.current)
      .map((w) => `<div class="ws-row">
        <div class="ws-ico">▣</div>
        <div class="ws-main">
          <div class="ws-name">${esc(w.label || leafOf(w.path))}
            <span class="badge ${w.source === 'current' ? 'ok' : 'off'}">${esc(label[w.source] || w.source || '')}</span>
          </div>
          <div class="ws-path-txt">${esc(w.path)}</div>
        </div>
        <div class="ws-actions">
          <button class="row-btn" data-act="use" data-path="${esc(w.path)}">切换</button>
          <button class="row-btn primary" data-act="open" data-path="${esc(w.path)}">新窗口</button>
        </div>
      </div>`)
      .join('');
  }

  async function loadWorkspaces() {
    try {
      const r = await fetch('/api/workspaces').then((x) => x.json());
      S.workspaces = r.workspaces || [];
      S.cwd = r.cwd || S.cwd;
      updateCwdChip();
      renderWorkspaces();
      if (!r.agentReady && !r.demo) note('Agent 还在启动，最近工作空间可能不全');
    } catch (e) {
      plog('workspaces error ' + e.message);
      wsList.innerHTML = `<div class="u-empty">读取失败：${esc(e.message)}</div>`;
    }
  }

  function openWorkspaces() {
    wsModal.classList.remove('hidden');
    wsPath.value = S.cwd || '';
    wsList.innerHTML = `<div class="u-empty">正在读取…</div>`;
    loadWorkspaces();
  }

  function closeWorkspaces() {
    wsModal.classList.add('hidden');
  }

  async function useWorkspace(path) {
    if (!path) return;
    try {
      const r = await fetch('/api/workspaces/use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      }).then((x) => x.json());
      if (!r.ok) { note(r.error || '切换失败'); return; }
      S.cwd = r.cwd;
      S.workspace = r.workspace || leafOf(r.cwd);
      updateCwdChip();
      closeWorkspaces();
      newSession();
      loadCatalog();
      loadUsage();
      note('已切换到 ' + S.workspace);
    } catch (e) {
      note('切换失败：' + e.message);
    }
  }

  async function openWorkspaceWindow(path) {
    if (!path) return;
    try {
      const r = await fetch('/api/workspaces/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      }).then((x) => x.json());
      if (!r.ok) { note(r.error || '打开失败'); return; }
      note('已在新窗口打开 ' + leafOf(path));
    } catch (e) {
      note('打开失败：' + e.message);
    }
  }

  async function pickWorkspace() {
    try {
      const r = await fetch('/api/workspaces/pick', { method: 'POST', body: '{}' }).then((x) => x.json());
      if (r && r.path) {
        wsPath.value = r.path;
        note('已选择 ' + leafOf(r.path));
      }
    } catch (e) {
      note('选择目录失败：' + e.message);
    }
  }

  async function openCostReport() {
    closeUsage();
    const ok = await submit('/cost', true);
    if (ok) note('已让 CodeBuddy 汇报 /cost');
  }

  // ---------------- 事件处理 ----------------
  function handleEvent(type, data) {
    // 新会话还没拿到 id 时，先吸附到第一条事件的会话上，避免事件被过滤掉
    if (!S.activeId && data.sessionId) {
      S.activeId = data.sessionId;
    }
    if (type === 'done') {
      const reason = data.stopReason || 'end_turn';
      if (reason === 'refusal') {
        addError('模型拒绝了这次请求（refusal）。常见原因：CodeBuddy 未登录，或当前账号无权调用该模型。');
      } else if (reason !== 'end_turn' && reason !== 'max_tokens' && reason !== 'cancelled' && !S.turnHasContent) {
        addError(`这一轮没有返回内容（stopReason=${reason}）。若反复出现，先确认 CodeBuddy 已登录。`);
      }
      setRunning(false);
      addTurnCredit();
      S.textEl = null;
      S.thoughtEl = null;
      S.turnHasContent = false;
      refreshSessions();
      setTimeout(loadUsage, 400);
      return;
    }
    if (data.sessionId && S.activeId && data.sessionId !== S.activeId) return;
    switch (type) {
      case 'user': addUser(data.text || '', data); break;
      case 'text': addText(data.text || ''); break;
      case 'thought': addThought(data.text || ''); break;
      case 'tool': upsertTool(data); S.textEl = null; S.thoughtEl = null; break;
      case 'tool_update': upsertTool(data); break;
      case 'plan': addPlan(data.entries); break;
      case 'permission': addPermission(data); break;
      case 'permission_resolved': resolvePermission(data); break;
      case 'usage': {
        updateUsage(data.used, data.size);
        const actual = Number(data.credit !== undefined ? data.credit : ((data.cost && data.cost.amount) || 0));
        let nominal = Number(data.originalCredit !== undefined ? data.originalCredit : actual);
        if (!nominal) nominal = actual;
        if (nominal || actual) S.turnCredit = { nominal, actual };
        if (data.quota && data.quota.percent !== undefined) {
          S.quota = data.quota;
          updateQuotaBadge(data.quota);
        }
        if (!S.running) addTurnCredit();
        break;
      }
      case 'commands': absorbCommands(data.commands); break;
      case 'config': {
        const opts = data.options || [];
        const mode = opts.find((o) => o && o.id === 'mode');
        if (mode) applyModeConfig(mode.options, mode.currentValue);
        const model = opts.find((o) => o && o.id === 'model');
        if (model) applyModelConfig(model.options, model.currentValue);
        break;
      }
      case 'models':
        if (Array.isArray(data.models) && data.models.length) {
          applyModelConfig(
            data.models.map((m) => ({ value: m.modelId || m.id, name: m.name, description: (m._meta && m._meta.credits) || m.description })),
            data.currentId
          );
        }
        break;
      case 'mode':
        if (data.mode) {
          S.mode = data.mode;
          if (modeSelect.querySelector(`option[value="${CSS.escape(data.mode)}"]`)) modeSelect.value = data.mode;
        }
        break;
      case 'error': addError(data.message || '出错了'); setRunning(false); break;
      case 'auth_required': addError(data.message || '需要登录', 'auth'); setRunning(false); break;
      default: break;
    }
  }

  // 长轮询事件流：客户端自己维护游标，重连不会重放或丢事件
  async function pollLoop() {
    while (true) {
      try {
        const r = await fetch(`/api/events?from=${S.lastSeq}&wait=10000`);
        const txt = await r.text();
        if (!txt) {
          plog('poll empty status=' + r.status + ' from=' + S.lastSeq);
          await new Promise((res) => setTimeout(res, 300));
          continue;
        }
        const j = JSON.parse(txt);
        plog(`poll ok n=${(j.events || []).length} lastSeq=${j.lastSeq} cur=${S.lastSeq}`);
        if (typeof j.lastSeq === 'number' && j.lastSeq < S.lastSeq) {
          S.lastSeq = 0;  // 后端重启，序号归零
        }
        for (const ev of j.events || []) {
          if (ev.seq <= S.lastSeq) continue;
          S.lastSeq = ev.seq;
          handleEvent(ev.type, ev.data || {});
        }
      } catch (e) {
        plog('poll error ' + e.message);
        await new Promise((res) => setTimeout(res, 1200));
      }
    }
  }

  // ---------------- 会话 ----------------
  function renderSessions() {
    listEl.innerHTML = '';
    for (const s of S.sessions) {
      const el = document.createElement('div');
      el.className = 'session-item' + (s.id === S.activeId ? ' active' : '');
      el.innerHTML = `<div class="t">${esc(s.title || '新会话')}</div><div class="m"><span>${relTime(s.updatedAt)}</span></div>`;
      el.addEventListener('click', () => loadSession(s.id));
      listEl.appendChild(el);
    }
  }

  async function refreshSessions() {
    const r = await fetch('/api/bootstrap').then((x) => x.json());
    S.sessions = r.sessions || [];
    sortSessions();
    renderSessions();
    // 顶栏标题跟随落盘标题，否则会出现「侧栏一个名字、顶栏另一个名字」
    const cur = S.sessions.find((s) => s.id === S.activeId);
    if (cur && cur.title) $('chat-title').textContent = cur.title;
  }

  function sortSessions() {
    // 最近动过的排前面；没有 updatedAt 的兜底排最后
    S.sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async function loadSession(id) {
    saveDraft();
    S.activeId = id;
    const detail = await fetch(`/api/sessions/${id}`).then((r) => r.json());
    clearMessages();
    clearComposerExtras();
    $('chat-title').textContent = detail.title || '新会话';
    $('empty-state')?.remove();
    let hasUser = false;
    S.replaying = true;
    S.history = [];
    for (const ev of detail.events || []) {
      if (ev.type === 'user') {
        hasUser = true;
        if (ev.data && ev.data.text) S.history.push(ev.data.text);
      }
      handleEvent(ev.type, ev.data || {});
    }
    S.histIndex = -1;
    S.replaying = false;
    if (detail.model) {
      S.model = detail.model;
      renderModelSelect();
    }
    if (detail.mode && modeSelect.querySelector(`option[value="${CSS.escape(detail.mode)}"]`)) {
      S.mode = detail.mode;
      modeSelect.value = detail.mode;
    }
    setRunning(false);
    if (!hasUser) showEmpty();
    restoreDraft();
    renderSessions();
    scrollDown(true);
  }

  function newSession() {
    // 惰性创建：这里只清界面，等真发出第一条消息时后端再落盘，
    // 否则点几次「新会话」就在列表里留几个空会话
    saveDraft();
    S.activeId = null;
    S.history = [];
    S.histIndex = -1;
    clearMessages();
    clearComposerExtras();
    showEmpty();
    restoreDraft();
    renderSessions();
    $('chat-title').textContent = '新会话';
    inputEl.focus();
  }

  function showEmpty() {
    messagesEl.innerHTML = `
      <div class="empty" id="empty-state">
        <h2>说点什么，让它动手</h2>
        <p>这个壳只做三件事：把话递给 CodeBuddy、把工具调用画清楚、把权限交回你手里。</p>
        <div class="suggestions">
          <button class="sugg">看看当前目录有什么，列个清单</button>
          <button class="sugg">把 README 里的 TODO 整理成一份计划</button>
          <button class="sugg">找出这个项目里最大的三个文件</button>
        </div>
      </div>`;
    bindSuggestions();
  }

  function bindSuggestions() {
    messagesEl.querySelectorAll('.sugg').forEach((b) => {
      b.addEventListener('click', () => {
        inputEl.value = b.textContent.trim();
        autoGrow();
        updateInputCount();
        updateSendState();
        send();
      });
    });
  }

  // ---------------- 技能 / 连接器 / 插件市场 ----------------
  const FOOT_DEFAULT = 'Enter 发送 · / 技能 · @ 连接器';
  let noteTimer = 0;

  function note(msg) {
    $('foot-detail').textContent = msg;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { $('foot-detail').textContent = FOOT_DEFAULT; }, 2800);
  }

  // ACP 下发的命令是权威来源（含插件 Skill），本地 skills 目录做兜底
  function skillList() {
    const map = new Map();
    for (const s of S.catalog.skills || []) {
      map.set(s.name, {
        name: s.name,
        description: s.description || '',
        hint: s.hint || '',
        source: s.source === 'project' ? '项目' : '用户',
        path: s.path || '',
      });
    }
    for (const c of S.acpCommands) {
      const prev = map.get(c.name) || {};
      map.set(c.name, { ...prev, ...c, source: c.source || 'CodeBuddy' });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function absorbCommands(list) {
    if (!Array.isArray(list)) return;
    S.acpCommands = list
      .map((c) => ({
        name: String(c && c.name || ''),
        description: String(c && c.description || ''),
        hint: String((c && c.input && c.input.hint) || (c && c.argumentHint) || ''),
        source: 'CodeBuddy',
      }))
      .filter((c) => c.name);
    if (S.palette.open && S.palette.mode === 'skill') updatePalette();
  }

  function connectorList() {
    return (S.catalog.connectors || []).slice();
  }

  // stdio 连接器光看 command（npx / python.exe）没法判断它连的是什么，把 args 一起带上
  function connectorCmd(c) {
    const args = Array.isArray(c.args) ? c.args : [];
    return [c.target || ''].concat(args).filter(Boolean).join(' ');
  }

  function filterBy(items, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return items;
    const hits = items.filter((x) => (x.name + ' ' + (x.description || '')).toLowerCase().includes(q));
    // 名字前缀命中的排前面，输入 @ci 时别被描述里的偶然命中挤下去
    hits.sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name);
    });
    return hits;
  }

  // 只在行首或空白后面识别 `/` 与 `@`，避免把路径里的斜杠当成命令
  function paletteContext() {
    const pos = inputEl.selectionStart;
    if (pos == null || pos !== inputEl.selectionEnd) return null;
    const before = inputEl.value.slice(0, pos);
    const m = before.match(/(^|[\s\u3000])([/@])([^\s/@]*)$/);
    if (!m) return null;
    return {
      mode: m[2] === '/' ? 'skill' : 'connector',
      query: m[3],
      start: pos - m[2].length - m[3].length,
      end: pos,
    };
  }

  function updatePalette() {
    const ctx = paletteContext();
    if (!ctx) { closePalette(); return; }
    const items = ctx.mode === 'skill'
      ? filterBy(skillList(), ctx.query)
      : filterBy(connectorList(), ctx.query);
    S.palette = { open: true, mode: ctx.mode, items, index: 0, start: ctx.start, end: ctx.end };
    renderPalette();
  }

  function renderPalette() {
    if (!S.palette.open) { paletteEl.classList.add('hidden'); return; }
    const mode = S.palette.mode;
    const items = S.palette.items;
    paletteEl.classList.remove('hidden');

    const head = mode === 'skill'
      ? '技能 / 命令 · ↑↓ 选择 · Enter 插入 · Esc 关闭'
      : '连接器（MCP） · ↑↓ 选择 · Enter 引用';
    let list = '';
    if (!items.length) {
      list = `<div class="palette-empty">没有匹配的${mode === 'skill' ? '技能或命令' : '连接器'}</div>`;
    } else {
      list = items.map((it, i) => {
        const icon = mode === 'skill' ? '/' : '⌁';
        const meta = mode === 'skill'
          ? `<span class="hint">${esc(it.source || '')}${it.hint ? ' · ' + esc(it.hint) : ''}</span>`
          : `<span class="hint">${esc(it.disabled ? '已停用' : (it.type || 'stdio'))}${it.scope ? ' · ' + esc(it.scope) : ''}</span>`;
        return `<div class="palette-item${i === S.palette.index ? ' active' : ''}" data-i="${i}">
          <div class="pi-icon">${icon}</div>
          <div class="pi-main">
            <div class="pi-name">${esc(it.name)}${meta}</div>
            <div class="pi-desc">${esc(it.description || connectorCmd(it) || '')}</div>
          </div>
        </div>`;
      }).join('');
    }
    paletteEl.innerHTML = `<div class="palette-head">${esc(head)}</div><div class="palette-list">${list}</div>`;

    paletteEl.querySelectorAll('.palette-item').forEach((el) => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();  // 保住输入框的焦点与光标
        pickPalette(Number(el.dataset.i));
      });
    });
    const active = paletteEl.querySelector('.palette-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function closePalette() {
    if (S.palette.open) {
      S.palette.open = false;
      paletteEl.classList.add('hidden');
    }
  }

  function movePalette(delta) {
    const n = S.palette.items.length;
    if (!n) return;
    S.palette.index = (S.palette.index + delta + n) % n;
    renderPalette();
  }

  function replaceRange(start, end, text) {
    const v = inputEl.value;
    inputEl.value = v.slice(0, start) + text + v.slice(end);
    const caret = start + text.length;
    inputEl.setSelectionRange(caret, caret);
    autoGrow();
  }

  function pickPalette(i) {
    const it = S.palette.items[i];
    if (!it) return;
    const { mode, start, end } = S.palette;
    if (mode === 'skill') {
      replaceRange(start, end, '/' + it.name + ' ');
      closePalette();
      inputEl.focus();
      return;
    }
    replaceRange(start, end, '');
    addConnectorRef(it.name);
    closePalette();
    inputEl.focus();
  }

  function insertAtCaret(text) {
    inputEl.focus();
    const start = inputEl.selectionStart == null ? inputEl.value.length : inputEl.selectionStart;
    const end = inputEl.selectionEnd == null ? start : inputEl.selectionEnd;
    const lead = start > 0 && !/[\s\u3000]/.test(inputEl.value[start - 1]) ? ' ' : '';
    replaceRange(start, end, lead + text);
  }

  function addConnectorRef(name) {
    if (!name) return;
    if (S.connectorRefs.includes(name)) { note('已经在引用 ' + name); return; }
    S.connectorRefs.push(name);
    renderAttachments();
    note('已引用连接器 ' + name);
  }

  function toggleConnector(name) {
    const i = S.connectorRefs.indexOf(name);
    if (i >= 0) S.connectorRefs.splice(i, 1);
    else S.connectorRefs.push(name);
    renderAttachments();
  }

  // ---- 图片 ----
  const MAX_IMAGES = 4;
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

  function addImageFiles(files) {
    for (const f of files) {
      if (!f || !/^image\//.test(f.type || '')) continue;
      if (S.attachments.length >= MAX_IMAGES) { note('最多同时带 ' + MAX_IMAGES + ' 张图片'); break; }
      if (f.size > MAX_IMAGE_BYTES) { note('单张图片不能超过 8MB'); continue; }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        const comma = dataUrl.indexOf(',');
        if (comma < 0) return;
        S.attachments.push({
          name: f.name || '粘贴的图片',
          mime: f.type || 'image/png',
          dataUrl,
          data: dataUrl.slice(comma + 1),
        });
        renderAttachments();
      };
      reader.readAsDataURL(f);
    }
  }

  function renderAttachments() {
    const has = S.attachments.length || S.connectorRefs.length;
    attachStrip.classList.toggle('hidden', !has);
    attachStrip.innerHTML = '';

    S.attachments.forEach((a, i) => {
      const item = document.createElement('div');
      item.className = 'attach-item';
      item.title = a.name;
      item.innerHTML = `<img src="${a.dataUrl}" alt="${esc(a.name)}" /><button class="x" title="移除">×</button>`;
      item.querySelector('.x').addEventListener('click', () => {
        S.attachments.splice(i, 1);
        renderAttachments();
      });
      attachStrip.appendChild(item);
    });

    S.connectorRefs.forEach((name) => {
      const chip = document.createElement('div');
      chip.className = 'connector-chip';
      chip.innerHTML = `<span class="n">⌁ ${esc(name)}</span><button title="取消引用">×</button>`;
      chip.querySelector('button').addEventListener('click', () => toggleConnector(name));
      attachStrip.appendChild(chip);
    });
    updateSendState();
  }

  function clearComposerExtras() {
    S.attachments = [];
    S.connectorRefs = [];
    renderAttachments();
    closePalette();
  }

  // ---- 目录（技能 / 连接器 / 插件市场） ----
  async function loadCatalog() {
    try {
      const r = await fetch('/api/catalog').then((x) => x.json());
      S.catalog = {
        skills: r.skills || [],
        connectors: r.connectors || [],
        plugins: r.plugins || [],
        marketplaces: r.marketplaces || [],
        codebuddyDir: r.codebuddyDir || '',
      };
      updateCatalogCounts();
      if (!modalEl.classList.contains('hidden')) renderMarket();
      if (S.palette.open) updatePalette();
    } catch (e) {
      plog('catalog error ' + e.message);
    }
  }

  function updateCatalogCounts() {
    $('tab-skills-n').textContent = String(skillList().length);
    $('tab-connectors-n').textContent = String(connectorList().length);
    $('tab-plugins-n').textContent = String((S.catalog.plugins || []).length);
  }

  function openMarket(tab) {
    if (tab) S.modalTab = tab;
    modalEl.classList.remove('hidden');
    setMarketTab(S.modalTab);
    renderMarket();
    loadCatalog();
  }

  function closeMarket() {
    modalEl.classList.add('hidden');
  }

  function setMarketTab(tab) {
    S.modalTab = tab;
    document.querySelectorAll('#market-modal .tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
  }

  function badges(list) {
    return list.filter(Boolean).map((b) => `<span class="badge ${b.cls || ''}">${esc(b.text)}</span>`).join('');
  }

  function renderMarket() {
    const q = catalogFilter.value;
    const tab = S.modalTab;
    let html = '';
    let count = 0;

    if (tab === 'skills') {
      const items = filterBy(skillList(), q);
      count = items.length;
      html = items.map((s) => `<div class="catalog-row">
        <div class="cr-icon">/</div>
        <div class="cr-main">
          <div class="cr-name">${esc(s.name)}${badges([{ text: s.source || '技能', cls: 'off' }])}</div>
          <div class="cr-desc">${esc(s.description || '（没有写描述）')}</div>
          ${s.hint ? `<div class="cr-meta">参数：${esc(s.hint)}</div>` : ''}
        </div>
        <div class="cr-actions"><button class="row-btn primary" data-act="skill" data-name="${esc(s.name)}">插入</button></div>
      </div>`).join('') || `<div class="palette-empty">还没有发现技能。项目或用户目录下的 SKILL.md 会被识别。</div>`;
    } else if (tab === 'connectors') {
      const items = filterBy(connectorList(), q);
      count = items.length;
      html = items.map((c) => `<div class="catalog-row">
        <div class="cr-icon">⌁</div>
        <div class="cr-main">
          <div class="cr-name">${esc(c.name)}${badges([
            { text: c.type || 'stdio', cls: 'off' },
            { text: c.scope || 'user', cls: 'off' },
            c.disabled ? { text: '已停用', cls: 'off' } : { text: '可用', cls: 'ok' },
          ])}</div>
          <div class="cr-desc">${esc(connectorCmd(c))}</div>
          <div class="cr-meta">${esc(c.configPath || '')}</div>
        </div>
        <div class="cr-actions">
          <button class="row-btn primary" data-act="connector" data-name="${esc(c.name)}" ${c.disabled ? 'disabled' : ''}>引用</button>
        </div>
      </div>`).join('') || `<div class="palette-empty">还没有连接器。在 .codebuddy/mcp.json 或项目 .mcp.json 里配置 mcpServers 后刷新。</div>`;
    } else {
      const plugins = (S.catalog.plugins || []).filter((p) => {
        if (!q.trim()) return true;
        const s = (p.name + ' ' + (p.description || '') + ' ' + (p.marketplace || '')).toLowerCase();
        return s.includes(q.trim().toLowerCase());
      });
      count = plugins.length;
      const groups = new Map();
      for (const p of plugins) {
        const k = p.marketplace || '未归类';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(p);
      }
      const mName = new Map((S.catalog.marketplaces || []).map((m) => [m.name, m]));
      for (const [mk, list] of groups) {
        const meta = mName.get(mk);
        html += `<div class="group-title">${esc((meta && meta.description) || mk)} · ${list.length} 个</div>`;
        html += list.map((p) => `<div class="catalog-row">
          <div class="cr-icon">▦</div>
          <div class="cr-main">
            <div class="cr-name">${esc(p.name)}${badges([
              p.installed ? { text: '已安装', cls: 'ok' } : null,
              p.enabled ? { text: '已启用', cls: 'ok' } : null,
              p.version ? { text: 'v' + p.version, cls: 'off' } : null,
              p.category ? { text: p.category, cls: 'off' } : null,
            ])}</div>
            <div class="cr-desc">${esc(p.description || '（市场里没写描述）')}</div>
            <div class="cr-meta">${esc(p.key || '')}${p.author ? ' · ' + esc(p.author) : ''}</div>
          </div>
          <div class="cr-actions">${
            !p.installed
              ? `<button class="row-btn primary" data-act="install" data-key="${esc(p.key)}">安装</button>`
              : (!p.enabled ? `<button class="row-btn" data-act="enable" data-key="${esc(p.key)}">启用</button>`
                            : `<span class="badge ok">使用中</span>`)
          }</div>
        </div>`).join('');
      }
      if (!html) html = `<div class="palette-empty">没有找到插件。</div>`;
    }

    marketBody.innerHTML = html;
    marketFoot.innerHTML = `<span>配置目录</span><span class="path">${esc(S.catalog.codebuddyDir || '—')}</span>
      <span class="foot-spacer"></span><span>${count} 项 · 安装/启用会以斜杠命令发给 CodeBuddy</span>`;
  }

  async function runPluginCommand(cmd) {
    closeMarket();
    const ok = await submit(cmd, true);
    if (ok) {
      note('已发送：' + cmd);
      setTimeout(loadCatalog, 3000);
    }
  }


  // ---------------- 发送 ----------------
  async function submit(text, bare) {
    const body = String(text || '').replace(/\s+$/, '');
    const useImages = !bare;
    const images = useImages ? S.attachments.map((a) => ({ mime: a.mime, data: a.data, name: a.name })) : [];
    const connectors = useImages ? S.connectorRefs.slice() : [];
    if (S.running) return false;
    if (!body.trim() && !images.length) return false;

    pushHistory(body);
    if (!bare) {
      inputEl.value = '';
      autoGrow();
      updateInputCount();
      clearDraft();
    }
    $('empty-state')?.remove();
    setRunning(true);
    S.turnHasContent = false;
    S.turnCredit = null;
    S.turnCreditShown = false;
    S.textEl = null;
    S.thoughtEl = null;
    try {
      const prevId = S.activeId;
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: S.activeId || '',
          text: body,
          mode: S.mode,
          model: S.model,
          images,
          connectors,
        }),
      });
      const raw = await resp.text();
      plog(`chat status=${resp.status} len=${raw.length} images=${images.length}`);
      const r = JSON.parse(raw);
      if (r.sessionId && r.sessionId !== S.activeId) {
        S.activeId = r.sessionId;
      }
      if (!bare) {
        S.attachments = [];
        S.connectorRefs = [];
        renderAttachments();
      }
      // 标题以后端截断结果为准，前端别再自己截一遍（两边规则不一致就会打架）
      if (r.sessionId && r.sessionId !== prevId) await refreshSessions();
      setTimeout(refreshSessions, 600);
      return true;
    } catch (e) {
      addError('发送失败：' + e.message);
      setRunning(false);
      if (!bare) {
        inputEl.value = body;
        autoGrow();
        updateInputCount();
        updateSendState();
      }
      return false;
    }
  }

  function send() {
    return submit(inputEl.value, false);
  }

  async function stop() {
    if (!S.running) return;
    await fetch('/api/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: S.activeId }),
    });
    setRunning(false);
  }

  function autoGrow() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(220, inputEl.scrollHeight) + 'px';
  }

  // ---------------- 启动 ----------------
  async function boot() {
    const r = await fetch('/api/bootstrap').then((x) => x.json());
    S.demo = !!r.demo;
    S.cwd = r.cwd;
    S.workspace = r.workspace || leafOf(r.cwd);
    S.agentReady = !!r.agentReady;
    S.lastSeq = r.lastSeq || 0;
    S.sessions = r.sessions || [];
    S.quota = r.quota || null;
    S.credits = Number(r.credits || 0);
    sortSessions();
    S.mode = prefs.mode || 'fullAccess';
    S.modeTouched = !!prefs.mode;
    S.model = prefs.model || r.model || '';
    S.modelTouched = !!prefs.model;

    updateCwdChip();
    $('model-name').textContent = r.model || '—';
    if (modeSelect.querySelector(`option[value="${CSS.escape(S.mode)}"]`)) modeSelect.value = S.mode;
    renderModelSelect();
    updateCreditChip(S.credits);
    updateQuotaBadge(S.quota);
    if (S.demo) $('demo-chip').classList.remove('hidden');
    setAgentStatus(r);
    renderSessions();
    pollLoop();
    bindSuggestions();
    loadCatalog();
    loadModels();
    loadUsage();
    renderAttachments();
    updateInputCount();

    if (r.lastSessionId && !r.fresh) {
      await loadSession(r.lastSessionId);
    } else {
      showEmpty();
      restoreDraft();
    }

    // 状态轮询：Agent 可能是后起来的
    setInterval(async () => {
      try {
        const s = await fetch('/api/bootstrap').then((x) => x.json());
        S.agentReady = !!s.agentReady;
        setAgentStatus(s);
      } catch { }
    }, 5000);
  }

  function setAgentStatus(r) {
    const dot = $('status-dot');
    const txt = $('status-text');
    if (r.demo) {
      dot.className = 'dot busy';
      txt.textContent = '演示模式（未接真实模型）';
      return;
    }
    if (r.agentReady) {
      dot.className = 'dot ok';
      txt.textContent = 'CodeBuddy 已就绪';
    } else {
      dot.className = 'dot bad';
      txt.textContent = r.agentError ? 'Agent 未就绪' : '正在启动 Agent…';
      txt.title = r.agentError || '';
    }
  }

  // ---------------- 输入框状态 / 草稿 / 历史 ----------------
  function hasPayload() {
    return !!inputEl.value.trim() || S.attachments.length > 0;
  }

  function updateSendState() {
    if (S.running) {
      sendBtn.disabled = false;
      sendBtn.title = '停止';
      return;
    }
    sendBtn.disabled = !hasPayload();
    sendBtn.title = hasPayload() ? '发送' : '输入内容后发送';
  }

  function updateInputCount() {
    const n = [...inputEl.value].length;
    $('input-count').textContent = n ? n + ' 字' : '0 字';
  }

  function draftKey() {
    return S.activeId || ('new:' + (S.cwd || ''));
  }

  function saveDraft() {
    const k = draftKey();
    const v = inputEl.value;
    if (v.trim()) drafts[k] = v;
    else delete drafts[k];
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); } catch { }
  }

  function restoreDraft() {
    inputEl.value = drafts[draftKey()] || '';
    autoGrow();
    updateInputCount();
    updateSendState();
  }

  function clearDraft() {
    delete drafts[draftKey()];
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); } catch { }
  }

  function pushHistory(text) {
    if (!text) return;
    if (S.history[S.history.length - 1] !== text) S.history.push(text);
    if (S.history.length > 50) S.history.shift();
    S.histIndex = -1;
  }

  sendBtn.addEventListener('click', () => (S.running ? stop() : send()));
  $('new-session').addEventListener('click', newSession);
  $('market-btn').addEventListener('click', () => openMarket('skills'));
  $('catalog-btn').addEventListener('click', () => openMarket('skills'));

  inputEl.addEventListener('input', () => {
    autoGrow();
    updatePalette();
    updateInputCount();
    updateSendState();
    S.histIndex = -1;
    saveDraft();
  });
  inputEl.addEventListener('click', updatePalette);
  inputEl.addEventListener('compositionstart', () => { S.composing = true; });
  inputEl.addEventListener('compositionend', () => {
    S.composing = false;
    updateInputCount();
    updatePalette();
    saveDraft();
  });
  inputEl.addEventListener('keydown', (e) => {
    // 中文输入法组词期间不要抢 Enter / 方向键
    if (S.composing || e.isComposing || e.keyCode === 229) return;
    if (S.palette.open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickPalette(S.palette.index); return; }
      if (e.key === 'Escape') { e.preventDefault(); closePalette(); return; }
    }
    if (e.key === 'ArrowUp' && !inputEl.value.trim() && S.history.length) {
      e.preventDefault();
      S.histIndex = S.histIndex < 0 ? S.history.length - 1 : Math.max(0, S.histIndex - 1);
      inputEl.value = S.history[S.histIndex] || '';
      autoGrow();
      updateInputCount();
      updateSendState();
      inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
      return;
    }
    if (e.key === 'ArrowDown' && S.histIndex >= 0) {
      e.preventDefault();
      S.histIndex += 1;
      if (S.histIndex >= S.history.length) {
        S.histIndex = -1;
        inputEl.value = '';
      } else {
        inputEl.value = S.history[S.histIndex] || '';
      }
      autoGrow();
      updateInputCount();
      updateSendState();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
      return;
    }
    if (e.key === 'Escape') closePalette();
  });
  inputEl.addEventListener('blur', () => setTimeout(closePalette, 120));

  // 粘贴图片：只拦图片，文本照常进输入框
  inputEl.addEventListener('paste', (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const files = [];
    for (const it of items) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f && /^image\//.test(f.type || '')) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      addImageFiles(files);
    }
  });

  $('attach-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    addImageFiles([...fileInput.files]);
    fileInput.value = '';
  });

  composerEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    composerEl.classList.add('dragover');
  });
  composerEl.addEventListener('dragleave', () => composerEl.classList.remove('dragover'));
  composerEl.addEventListener('drop', (e) => {
    e.preventDefault();
    composerEl.classList.remove('dragover');
    const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
    if (files.length) addImageFiles(files);
  });

  // 目录弹窗
  document.querySelectorAll('#market-modal .tab').forEach((b) => {
    b.addEventListener('click', () => {
      setMarketTab(b.dataset.tab);
      renderMarket();
    });
  });
  $('market-close').addEventListener('click', closeMarket);
  $('catalog-refresh').addEventListener('click', loadCatalog);
  catalogFilter.addEventListener('input', renderMarket);
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeMarket();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalEl.classList.contains('hidden')) closeMarket();
  });
  marketBody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'skill') {
      insertAtCaret('/' + btn.dataset.name + ' ');
      closeMarket();
    } else if (act === 'connector') {
      addConnectorRef(btn.dataset.name);
      closeMarket();
    } else if (act === 'install') {
      runPluginCommand('/plugin install ' + btn.dataset.key);
    } else if (act === 'enable') {
      runPluginCommand('/plugin enable ' + btn.dataset.key);
    }
  });

  modelSelect.addEventListener('change', (e) => changeModel(e.target.value));
  modeSelect.addEventListener('change', (e) => {
    S.mode = e.target.value;
    S.modeTouched = true;
    savePrefs();
    note('权限模式：' + e.target.selectedOptions[0].textContent);
  });

  creditBtn.addEventListener('click', openUsage);
  $('usage-close').addEventListener('click', closeUsage);
  $('usage-refresh').addEventListener('click', loadUsage);
  usageModal.addEventListener('click', (e) => {
    if (e.target === usageModal) closeUsage();
  });
  usageBody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cost') openCostReport();
    else if (btn.dataset.act === 'refresh') loadUsage();
  });

  $('cwd-chip').addEventListener('click', openWorkspaces);
  $('ws-close').addEventListener('click', closeWorkspaces);
  $('ws-refresh').addEventListener('click', loadWorkspaces);
  $('ws-pick').addEventListener('click', pickWorkspace);
  $('ws-open').addEventListener('click', () => openWorkspaceWindow(wsPath.value.trim() || S.cwd));
  wsModal.addEventListener('click', (e) => {
    if (e.target === wsModal) closeWorkspaces();
  });
  wsList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const path = btn.dataset.path;
    if (btn.dataset.act === 'use') useWorkspace(path);
    else if (btn.dataset.act === 'open') openWorkspaceWindow(path);
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      inputEl.focus();
    }
    if (e.key === 'Escape') {
      if (!usageModal.classList.contains('hidden')) closeUsage();
      if (!wsModal.classList.contains('hidden')) closeWorkspaces();
    }
  });

  boot();
})();
