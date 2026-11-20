// 动效令牌与时间轴工具。所有动画都是 time 的纯函数，可任意跳帧。

export const to = (v, a = 0, b = 1) => (v - a) / (b - a);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 三次贝塞尔求值（与 CSS cubic-bezier 同一数学定义） */
export function bezier(x1, y1, x2, y2) {
  const A = (a, b) => 1 - 3 * b + 3 * a;
  const B = (a, b) => 3 * b - 6 * a;
  const C = (a) => 3 * a;
  const calc = (t, a, b) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
  const slope = (t, a, b) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const s = slope(t, x1, x2);
      if (Math.abs(s) < 1e-6) break;
      const d = calc(t, x1, x2) - x;
      if (Math.abs(d) < 1e-6) break;
      t -= d / s;
    }
    return calc(t, y1, y2);
  };
}

/** 缓动表：与 HUD 上标注的一一对应 */
export const EASE = {
  out: bezier(0.16, 1, 0.3, 1),      // 进入 · expo-out
  in: bezier(0.4, 0, 1, 1),          // 退出
  inout: bezier(0.65, 0, 0.35, 1),   // 位移 / 开合
  std: bezier(0.2, 0, 0, 1),         // 通用
  linear: (x) => x,
};

/** 时长令牌（毫秒） */
export const D = {
  instant: 90,
  fast: 140,
  base: 200,
  slow: 320,
  scene: 480,
};

/** 某段时间内的进度 0→1 */
export const seg = (time, start, dur, ease = EASE.out) =>
  ease(clamp01((time - start) / (dur / 1000)));

/** 区间 [a,b] 内的插值，超出区间自动夹紧 */
export const map = (time, a, b, from = 0, toV = 1, ease = EASE.inout) =>
  from + (toV - from) * ease(clamp01(to(time, a, b)));

/** 关键帧折线：[[time, value], ...] */
export function keys(time, list, ease = EASE.inout) {
  if (time <= list[0][0]) return list[0][1];
  for (let i = 1; i < list.length; i += 1) {
    const [t1, v1] = list[i];
    if (time <= t1) {
      const [t0, v0] = list[i - 1];
      return v0 + (v1 - v0) * ease(clamp01(to(time, t0, t1)));
    }
  }
  return list[list.length - 1][1];
}

/** 淡入 + 位移 + 缩放：p 同时驱动三者 */
export function enter(el, p, opt = {}) {
  const { dy = 0, dx = 0, scale = 1, dur } = opt;
  const q = clamp01(p);
  el.style.opacity = String(q);
  el.style.transform =
    'translate3d(' + dx * (1 - q) + 'px,' + dy * (1 - q) + 'px,0) scale(' + (1 + (scale - 1) * (1 - q)) + ')';
  if (dur !== undefined) el.style.transitionDuration = '0ms';
}

/** 只在值变化时写样式，减少每帧的样式重算 */
export function w(el, prop, value) {
  const c = el.__c || (el.__c = {});
  if (c[prop] === value) return;
  c[prop] = value;
  el.style[prop] = value;
}

export function show(el, on) {
  const v = on ? '' : 'none';
  if (el.__display !== v) {
    el.__display = v;
    el.style.display = v;
  }
}

/** 逐字流式：按进度截断文本 */
export function stream(el, text, p) {
  const n = Math.round(text.length * clamp01(p));
  const s = text.slice(0, n);
  if (el.__txt !== s) {
    el.__txt = s;
    el.textContent = s;
  }
  return n;
}
