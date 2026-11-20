import './style.css';
import SHELL from './shell.html?raw';
import { EASE, D, clamp01, seg, keys, enter, w, show, stream } from './motion.js';

/* =============================================================
   时间轴（秒）
   00 片头 0-3 | 01 空态 3-10 | 02 流式 10-18 | 03 工具 18-27
   04 右栏 27-35 | 05 市场 35-43 | 06 团队 43-50
   07 微交互 50-57 | 08 令牌 57-62
   ============================================================= */
const DURATION = 62;

const CHAPTERS = [
  [0, 3, '00', '片头', 'MOTION SPEC v1 · 8 章 · 62s'],
  [3, 10, '01', '启动与空态', '进入 320ms · cubic-bezier(.16,1,.3,1) · 位移 8px'],
  [10, 18, '02', '会话流式', '段落 120ms 淡入 · caret 1s 线性 · 不做逐字位移'],
  [18, 27, '03', '工具调用', '插入 200ms · 展开 220ms · 状态点脉冲 2s'],
  [27, 35, '04', '右栏与任务', '面板 320ms · 指示器 200ms · 进度条 800ms'],
  [35, 43, '05', '插件市场', '弹窗 180ms · 遮罩 200ms · toast 200/160ms'],
  [43, 50, '06', '团队频道', '头像 stagger 40ms · 输入点 1.2s 循环'],
  [50, 57, '07', '微交互', 'hover 90 · press 90 · focus 120 · 展开 200'],
  [57, 62, '08', '动效令牌', '4 档时长 · 4 条曲线 · 位移 ≤ 8px · 可降级'],
];

const TEXT1 = '先看会话区和输入区的实现，确认动效接点，再动手改样式。';
const TEXT2 = '这次只调整过渡与节奏，不改信息层级。';

export default function ({ root }) {
  root.style.cssText = 'position:absolute;inset:0;margin:0;overflow:hidden;background:#eceae5';
  root.innerHTML = SHELL;

  const $ = (s) => root.querySelector(s);
  const $$ = (s) => Array.from(root.querySelectorAll(s));

  const win = $('#win');
  const msgs = $('#msgs');
  const chat = $('#chat');
  const empty = $('#empty');
  const composer = $('#composer');
  const cText = $('#cText');
  const send = $('#send');
  const mUser = $('#mUser');
  const mAsst = $('#mAsst');
  const typing = $('#typing');
  const reason = $('#reason');
  const p1 = $('#p1');
  const p2 = $('#p2');
  const p3 = $('#p3');
  const c1 = $('#c1');
  const c2 = $('#c2');
  const bullets = ['#b1', '#b2', '#b3'].map($);
  const t1 = $('#t1'), t2 = $('#t2'), t3 = $('#t3'), t4 = $('#t4'), t5 = $('#t5');
  const tools = $('.tools');
  const diff = $('#diff');
  const plan = $('#plan');
  const usage = $('#usage');
  const rp = $('#rp');
  const rind = $('#rind');
  const barFill = $('#barFill');
  const dim = $('#dim');
  const dlg = $('#dlg');
  const toast = $('#toast');
  const channel = $('#channel');
  const live = $('#live');
  const boardMicro = $('#boardMicro');
  const boardTokens = $('#boardTokens');
  const hudIdx = $('#hudIdx');
  const hudCh = $('#hudCh');
  const hudSpec = $('#hudSpec');
  const prog = $('#prog');
  const intro = $('#intro');

  let lastChapter = -1;

  function updHud(time) {
    let idx = 0;
    for (let i = 0; i < CHAPTERS.length; i += 1) if (time >= CHAPTERS[i][0]) idx = i;
    const c = CHAPTERS[idx];
    if (idx !== lastChapter) {
      lastChapter = idx;
      hudIdx.textContent = c[2] + ' / 08';
      hudCh.textContent = c[3];
      hudSpec.textContent = c[4];
    }
    w(prog, 'width', ((time / DURATION) * 100).toFixed(2) + '%');
  }

  function updIntro(time) {
    const inP = seg(time, 0.05, 520, EASE.out);
    const outP = seg(time, 2.25, 480, EASE.in);
    enter(intro, inP * (1 - outP), { dy: 10 });
    show(intro, time < 2.85);
  }

  function updWindow(time) {
    enter(win, seg(time, 2.4, D.slow, EASE.out), { dy: 8, scale: 0.995 });
    show(win, time > 2.3);
    $$('[data-sb]').forEach((el) => {
      const i = Number(el.dataset.sb);
      const q = seg(time, 2.55 + i * 0.024, D.base, EASE.out);
      el.style.opacity = String(q);
      el.style.transform = 'translateY(' + 4 * (1 - q) + 'px)';
    });
  }

  function updChat(time) {
    msgs.style.transform = 'translateY(' + keys(time, [
      [0, 0], [9.6, 0], [12.2, -34], [16.8, -52], [18.6, -64],
      [22.4, -150], [27, -286], [35, -286],
    ]) + 'px)';

    const eIn = seg(time, 3.55, D.base, EASE.out);
    const eOut = seg(time, 7.45, D.fast, EASE.in);
    empty.style.opacity = String(eIn * (1 - eOut));
    show(empty, time > 3.5 && time < 7.7);
    ['#ec1', '#ec2', '#ec3'].forEach(function (s, i) {
      const q = seg(time, 3.75 + i * 0.04, D.base, EASE.out);
      const el = $(s);
      el.style.opacity = String(q);
      el.style.transform = 'translateY(' + 6 * (1 - q) + 'px)';
    });

    const focus = seg(time, 4.85, 120, EASE.out) * (1 - seg(time, 7.45, 200, EASE.in));
    composer.style.boxShadow = '0 0 0 3px rgba(91,91,214,' + (0.16 * focus) + ')';
    composer.style.borderColor = focus > 0.5 ? 'var(--accent)' : 'var(--hairline-strong)';

    const typed = '把这次对话整理成一份文档';
    const tp = seg(time, 5.35, 1500, EASE.linear);
    if (time >= 5.35 && time < 7.28) {
      cText.className = 'c-text';
      const s = typed.slice(0, Math.round(typed.length * tp));
      if (cText.__t !== s) { cText.__t = s; cText.textContent = s; }
    } else if (time >= 7.28) {
      cText.className = 'c-text ph';
      if (cText.__t !== 'ph') {
        cText.__t = 'ph';
        cText.textContent = '描述你要它做的事，Enter 发送';
      }
    } else {
      cText.className = 'c-text ph';
      cText.__t = 'ph';
      cText.textContent = '描述你要它做的事，Enter 发送';
    }

    const press = seg(time, 7.0, 90, EASE.out) * (1 - seg(time, 7.12, 90, EASE.out));
    send.style.transform = 'scale(' + (1 - 0.07 * press) + ')';

    enter(mUser, seg(time, 7.26, D.base, EASE.out), { dy: 6 });
    show(mUser, time > 7.24);

    const tin = seg(time, 8.1, D.base, EASE.out);
    const tout = seg(time, 9.85, D.fast, EASE.in);
    enter(typing, tin * (1 - tout), { dy: 4 });
    show(typing, time > 8.05 && time < 10.05);
    $$('#typing .td').forEach(function (d, i) {
      const ph = (time * 1.1 + i * 0.16) % 1;
      d.style.opacity = String(0.35 + 0.65 * (0.5 - 0.5 * Math.cos(ph * Math.PI * 2)));
    });
  }

  function updStream(time) {
    enter(mAsst, seg(time, 9.95, D.base, EASE.out), { dy: 6 });
    show(mAsst, time > 9.9);

    const rin = seg(time, 10.0, D.fast, EASE.out);
    reason.style.opacity = String(rin);
    reason.style.transform = 'translateY(' + 4 * (1 - rin) + 'px)';

    const s1 = seg(time, 10.35, 1350, EASE.linear);
    stream(p1.querySelector('.tx'), TEXT1, s1);
    p1.style.opacity = time > 10.3 ? '1' : '0';
    c1.style.opacity = time > 10.3 && time < 11.95 ? (time % 1 < 0.5 ? '1' : '0.1') : '0';

    const s2 = seg(time, 12.2, 1100, EASE.linear);
    stream(p2.querySelector('.tx'), TEXT2, s2);
    p2.style.opacity = time > 12.15 ? '1' : '0';
    c2.style.opacity = time > 12.15 && time < 13.5 ? (time % 1 < 0.5 ? '1' : '0.1') : '0';

    const q3 = seg(time, 13.85, D.fast, EASE.out);
    p3.style.opacity = String(q3);
    bullets.forEach(function (b, i) {
      const q = seg(time, 14.15 + i * 0.12, D.base, EASE.out);
      b.style.opacity = String(q);
      b.style.transform = 'translateY(' + 5 * (1 - q) + 'px)';
    });

    const uq = seg(time, 26.45, D.base, EASE.out);
    usage.style.opacity = String(uq);
    usage.style.transform = 'translateY(' + 4 * (1 - uq) + 'px)';
    show(usage, time > 26.4);
  }

  function updTools(time) {
    tools.style.borderTopColor = time > 17.9 ? 'var(--hairline)' : 'transparent';
    const rows = [
      [t1, 17.95, 18.95, '1.2s', true],
      [t2, 19.25, 20.15, '24 matches', true],
      [t3, 20.45, 21.25, '+12 −4', true],
      [t4, 23.8, 24.9, '退出码 1', false],
      [t5, 25.4, 26.5, '通过', true],
    ];
    rows.forEach(function (r) {
      const el = r[0];
      const pin = seg(time, r[1], D.base, EASE.out);
      el.style.display = pin > 0 ? 'flex' : 'none';
      el.style.height = 34 * pin + 'px';
      el.style.opacity = String(Math.min(1, pin * 1.8));
      const dot = el.querySelector('.dot');
      const meta = el.querySelector('.tmeta');
      if (time > r[2]) {
        dot.className = 'dot ' + (r[4] ? 'ok' : 'err');
        dot.style.opacity = '1';
        meta.innerHTML = r[4] ? r[3] : '<span class="err-t">' + r[3] + '</span>';
      } else if (pin > 0) {
        dot.className = 'dot run';
        const ph = time % 1;
        dot.style.opacity = String(0.35 + 0.65 * (0.5 - 0.5 * Math.cos(ph * Math.PI * 2)));
        if (meta.innerHTML !== '…') meta.textContent = '…';
      }
    });

    const open = seg(time, 21.45, 220, EASE.inout);
    const close = seg(time, 23.15, 180, EASE.in);
    const dh = 150 * open * (1 - close);
    diff.style.height = dh + 'px';
    diff.style.opacity = String(Math.min(1, open * 2));
    diff.style.display = dh > 0.5 ? 'block' : 'none';
    diff.style.overflow = 'hidden';
    $$('#diffB .dline').forEach(function (l, i) {
      l.style.opacity = String(seg(time, 21.55 + i * 0.02, D.fast, EASE.out) * (1 - close));
    });

    const pq = seg(time, 26.2, D.base, EASE.out);
    plan.style.opacity = String(pq);
    plan.style.transform = 'translateY(' + 6 * (1 - pq) + 'px)';
    show(plan, time > 26.15);
  }

  function updPanel(time) {
    const ring = seg(time, 27.0, 140, EASE.out) * (1 - seg(time, 27.35, 120, EASE.in));
    $('#panelRing').style.opacity = String(ring * 0.6);

    const open = seg(time, 27.15, D.slow, EASE.inout);
    const narrow = seg(time, 32.5, D.slow, EASE.inout);
    const width = 420 * open - 60 * narrow;
    w(rp, 'width', width.toFixed(1) + 'px');
    w(rp, 'borderLeftWidth', width > 1 ? '1px' : '0px');
    show(rp, width > 0.5);

    const content = seg(time, 27.5, D.base, EASE.out);
    w($('#rpTabs'), 'opacity', String(content));
    w($('#rpTasks'), 'opacity', String(content * (1 - seg(time, 29.9, D.fast, EASE.out))));
    w($('#rpPlan'), 'opacity', String(seg(time, 30.05, D.base, EASE.out)));

    const tabs = $$('#rpTabs .rtab');
    const from = tabs[5];
    const target = tabs[2];
    const move = seg(time, 29.9, D.base, EASE.inout);
    const left = from.offsetLeft + (target.offsetLeft - from.offsetLeft) * move;
    const wid = from.offsetWidth + (target.offsetWidth - from.offsetWidth) * move;
    w(rind, 'left', left.toFixed(1) + 'px');
    w(rind, 'width', wid.toFixed(1) + 'px');
    w(rind, 'opacity', String(content));
    const active = move > 0.5 ? 2 : 5;
    tabs.forEach(function (t, i) { t.className = 'rtab' + (i === active ? ' active' : ''); });

    const bar = seg(time, 28.5, 800, EASE.inout);
    w(barFill, 'width', (bar * 68).toFixed(2) + '%');
    ['#st1', '#st2', '#st3'].forEach(function (s, i) {
      const q = seg(time, 28.3 + i * 0.06, D.base, EASE.out);
      const el = $(s);
      el.style.opacity = String(q);
      el.style.transform = 'translateY(' + 4 * (1 - q) + 'px)';
    });
    const ph = time % 1;
    $('#st2 .dot').style.opacity = String(0.35 + 0.65 * (0.5 - 0.5 * Math.cos(ph * Math.PI * 2)));
    $('#wfS').textContent = time > 31.2 ? '已完成 68%' : '运行中';

    ['#ag1', '#ag2'].forEach(function (s, i) {
      const q = seg(time, 30.1 + i * 0.08, D.base, EASE.out);
      const el = $(s);
      el.style.opacity = String(q);
      el.style.transform = 'translateY(' + 4 * (1 - q) + 'px)';
    });
  }

  function updMarket(time) {
    const dimIn = seg(time, 35.0, D.base, EASE.out);
    const dimOut = seg(time, 41.0, D.fast, EASE.in);
    dim.style.opacity = String(0.32 * dimIn * (1 - dimOut));
    show(dim, time > 34.95 && time < 41.3);

    const dOpen = seg(time, 35.12, 180, EASE.out);
    const dClose = seg(time, 40.6, 160, EASE.in);
    const p = dOpen * (1 - dClose);
    enter(dlg, p, { dy: 12, scale: 0.98 });
    show(dlg, time > 35.1 && time < 40.85);

    $$('#chips .fchip').forEach(function (c, i) {
      const q = seg(time, 36.2 + i * 0.024, D.base, EASE.out);
      c.style.opacity = String(q);
      c.style.transform = 'translateY(' + 5 * (1 - q) + 'px)';
    });

    const sel = seg(time, 36.95, D.fast, EASE.out);
    $('#fcAll').className = 'fchip' + (sel < 0.5 ? ' on' : '');
    $('#fcDev').className = 'fchip' + (sel > 0.5 ? ' on' : '');

    ['#pi2', '#pi3', '#pi4'].forEach(function (s, i) {
      const el = $(s);
      const q = seg(time, 37.12 + i * 0.016, 120, EASE.in);
      if (q >= 1) { el.style.display = 'none'; return; }
      el.style.display = 'flex';
      el.style.opacity = String(1 - q);
      el.style.height = 44 * (1 - q) + 'px';
      el.style.paddingTop = 9 * (1 - q) + 'px';
      el.style.paddingBottom = 9 * (1 - q) + 'px';
      el.style.overflow = 'hidden';
    });

    $('#dlgF').textContent = time > 37.3 ? 'dev 分类 · 2 个插件' : '共 5 个插件 · 3 个已安装';
    w(dlg, 'height', (430 - 130 * seg(time, 37.1, 140, EASE.inout)).toFixed(1) + 'px');

    const pb = $('#pb1');
    if (time < 38.55) {
      pb.className = 'pbtn';
      pb.textContent = '安装';
      pb.style.opacity = '1';
      pb.style.transform = 'none';
    } else if (time < 39.5) {
      pb.className = 'pbtn';
      pb.textContent = '安装中';
      const ph = (time * 1.4) % 1;
      pb.style.opacity = String(0.55 + 0.45 * (0.5 - 0.5 * Math.cos(ph * Math.PI * 2)));
    } else {
      pb.className = 'pbtn on';
      pb.textContent = '已安装';
      pb.style.opacity = '1';
      const q = seg(time, 39.5, 180, EASE.out);
      pb.style.transform = 'scale(' + (1 + 0.04 * (1 - q)) + ')';
    }

    const tIn = seg(time, 41.05, D.base, EASE.out);
    const tOut = seg(time, 42.4, 160, EASE.in);
    enter(toast, tIn * (1 - tOut), { dy: 12 });
    show(toast, time > 41.0 && time < 42.6);
  }

  function updTeam(time) {
    const inP = seg(time, 42.9, D.base, EASE.out);
    const outP = seg(time, 49.7, D.slow, EASE.in);
    enter(channel, inP * (1 - outP), { dy: 6 });
    show(channel, time > 42.85 && time < 50.1);

    $$('#avatars .a').forEach(function (a, i) {
      const q = seg(time, 43.35 + i * 0.04, D.base, EASE.out);
      a.style.opacity = String(q);
      a.style.transform = 'scale(' + (0.9 + 0.1 * q) + ')';
    });

    ['#c1', '#c2', '#c3'].forEach(function (s, i) {
      const q = seg(time, 43.95 + i * 0.5, D.base, EASE.out);
      const el = $(s);
      el.style.opacity = String(q);
      el.style.transform = 'translateY(' + 6 * (1 - q) + 'px)';
    });

    const c4 = seg(time, 47.25, D.base, EASE.out);
    const el4 = $('#c4');
    el4.style.display = c4 > 0 ? 'flex' : 'none';
    el4.style.overflow = 'hidden';
    el4.style.height = 78 * c4 + 'px';
    el4.style.marginBottom = 14 * c4 + 'px';
    el4.style.opacity = String(c4);

    const liveIn = seg(time, 45.8, D.base, EASE.out);
    live.style.opacity = String(liveIn * (1 - seg(time, 49.5, D.fast, EASE.in)));
    live.style.transform = 'translateY(' + 6 * (1 - liveIn) + 'px)';

    $$('#liveDots i').forEach(function (d, i) {
      const ph = (time * 0.85 + i * 0.15) % 1;
      const a = 0.5 - 0.5 * Math.cos(ph * Math.PI * 2);
      d.style.opacity = String(0.25 + 0.75 * a);
      d.style.transform = 'translateY(' + (-1.5 * a) + 'px)';
    });

    $$('#reacts .react').forEach(function (r, i) {
      const q = seg(time, 48.4 + i * 0.06, 180, EASE.out);
      r.style.opacity = String(q);
      r.style.transform = 'scale(' + (0.9 + 0.1 * q) + ')';
    });
  }

  function updBoards(time) {
    if (time > 49.9) w(win, 'opacity', '0');
    const bm = seg(time, 49.95, D.scene, EASE.inout);
    const bmOut = seg(time, 56.6, D.slow, EASE.in);
    boardMicro.style.opacity = String(bm * (1 - bmOut));
    show(boardMicro, time > 49.9 && time < 57.0);

    $$('#microGrid .mcard').forEach(function (c, i) {
      const q = seg(time, 50.1 + i * 0.05, D.base, EASE.out);
      c.style.opacity = String(q);
      c.style.transform = 'translateY(' + 8 * (1 - q) + 'px)';
    });

    const t = time - 50.1;

    const h = 0.5 - 0.5 * Math.cos(((t % 2) / 2) * Math.PI * 2);
    const dm0 = $('#dm0');
    dm0.style.background = h > 0.05 ? 'var(--surface-2)' : 'transparent';
    dm0.style.borderColor = 'rgba(231,230,225,' + h + ')';
    dm0.style.transform = 'translateY(' + (-1 * h) + 'px)';

    const cyc = t % 2;
    const ps = cyc > 0.9 && cyc < 1.05 ? (cyc - 0.9) / 0.15 : cyc >= 1.05 && cyc < 1.4 ? 1 - (cyc - 1.05) / 0.35 : 0;
    $('#dm1').style.transform = 'scale(' + (1 - 0.03 * ps) + ')';

    const fp = cyc > 0.6 ? Math.min(1, (cyc - 0.6) / 0.25) : 0;
    const dm2 = $('#dm2');
    dm2.style.borderColor = fp > 0.5 ? 'var(--accent)' : 'var(--hairline-strong)';
    dm2.style.boxShadow = '0 0 0 3px rgba(91,91,214,' + (0.16 * fp) + ')';

    const cp = t % 2.4;
    const dm3 = $('#dm3');
    const cq = cp > 0.5 && cp < 0.68 ? (cp - 0.5) / 0.18
      : cp >= 0.68 && cp < 1.55 ? 1
      : cp >= 1.55 && cp < 1.72 ? 1 - (cp - 1.55) / 0.17 : 0;
    dm3.style.opacity = String(cq);
    dm3.style.transform = 'translateY(' + 8 * (1 - cq) + 'px)';

    $$('#dm4 i').forEach(function (d, i) {
      const ph = ((t % 2) + i * 0.18) % 1;
      const a = 0.5 - 0.5 * Math.cos(ph * Math.PI * 2);
      d.style.opacity = String(0.25 + 0.75 * a);
      d.style.transform = 'scale(' + (0.8 + 0.5 * a) + ')';
    });

    const ep = t % 2.4;
    const eo = ep > 0.3 && ep < 0.5 ? (ep - 0.3) / 0.2
      : ep >= 0.5 && ep < 1.6 ? 1
      : ep >= 1.6 && ep < 1.8 ? 1 - (ep - 1.6) / 0.2 : 0;
    $('#dm5').style.height = 44 * eo + 'px';
    $('#dm5c').style.transform = 'rotate(' + 90 * eo + 'deg)';

    const bt = seg(time, 57.0, D.scene, EASE.inout);
    const btOut = seg(time, 61.75, 250, EASE.in);
    boardTokens.style.opacity = String(bt * (1 - btOut));
    show(boardTokens, time > 56.95);

    const bars = [90, 140, 200, 320, 480];
    bars.forEach(function (v, i) {
      const q = seg(time, 57.35 + i * 0.05, 420, EASE.out);
      w($('#tb' + (i + 1)), 'width', ((v / 480) * 100 * q).toFixed(2) + '%');
    });

    const curves = [
      ['#cv1', 0.16, 1, 0.3, 1],
      ['#cv2', 0.4, 0, 1, 1],
      ['#cv3', 0.65, 0, 0.35, 1],
      ['#cv4', 0.2, 0, 0, 1],
    ];
    curves.forEach(function (c, i) {
      const el = $(c[0]);
      if (!el.__d) {
        el.__d = 'M0 60 C' + (c[1] * 60) + ' ' + (60 - c[2] * 60) + ' ' + (c[3] * 60) + ' ' + (60 - c[4] * 60) + ' 60 0';
        el.setAttribute('d', el.__d);
      }
      el.style.opacity = String(seg(time, 57.6 + i * 0.06, 400, EASE.out));
    });
  }

  function prepareFrame(time) {
    updHud(time);
    updIntro(time);
    updWindow(time);
    updChat(time);
    updStream(time);
    updTools(time);
    updPanel(time);
    updMarket(time);
    updTeam(time);
    updBoards(time);
  }

  prepareFrame(0);

  return {
    prepareFrame,
    dispose() {
      root.innerHTML = '';
    },
  };
}
