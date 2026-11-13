import { buildChartOption, buildMapOption } from './widgetOptions'
import { getWorldGeoJson, resolveGeoJson } from './worldMap'
import type { FormField, VisualTheme, WidgetSpec } from './types'

function scriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function esc(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function safeFileName(title: string | undefined, ext: string) {
  const base = (title || 'intelligent-ui').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 48) || 'intelligent-ui'
  return `${base}.${ext}`
}

export function downloadText(filename: string, content: string, mime = 'text/html;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadDataUrl(filename: string, dataUrl: string) {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export function downloadWidgetJson(spec: WidgetSpec) {
  downloadText(safeFileName(spec.title, 'json'), JSON.stringify(spec, null, 2), 'application/json;charset=utf-8')
}

async function echartsUmd() {
  const res = await fetch('/vendor/echarts.min.js')
  if (!res.ok) throw new Error('找不到本地 ECharts 运行文件')
  return res.text()
}

async function worldGeoJson() {
  return getWorldGeoJson()
}

function shell(title: string, subtitle: string, theme: VisualTheme, body: string, script = '') {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root { --primary:${theme.primary}; --accent:${theme.accent}; --bg:${theme.background}; --fg:${theme.foreground}; --muted:${theme.muted}; --radius:${theme.radius}px; }
  * { box-sizing: border-box; }
  body { margin:0; background:#f3f4f6; color:var(--fg); font-family:${JSON.stringify(theme.fontFamily)}; }
  .iui-wrap { max-width: 980px; margin: 0 auto; padding: 28px 20px 40px; }
  .iui-head { margin-bottom: 16px; }
  .iui-head h1 { margin: 0; font-size: 22px; letter-spacing: -.02em; }
  .iui-head p { margin: 6px 0 0; color:#6b7280; font-size: 13px; }
  .iui-card { background:var(--bg); border:1px solid #e5e7eb; border-radius:var(--radius); box-shadow:0 8px 30px rgba(16,24,40,.08); padding:20px; }
  .iui-foot { margin-top: 14px; text-align: right; color:#9ca3af; font-size: 11px; }
  .iui-chart { width:100%; height:520px; }
  .iui-form { display:grid; gap:14px; }
  .iui-field label { display:block; font-size:12px; font-weight:600; margin-bottom:5px; }
  .iui-field input[type=text], .iui-field input[type=number], .iui-field input[type=date], .iui-field textarea, .iui-field select {
    width:100%; border:1px solid #d1d5db; border-radius:9px; padding:9px 11px; font:inherit; font-size:13px; background:#fff; color:var(--fg); outline:none;
  }
  .iui-field textarea { min-height:96px; resize:vertical; }
  .iui-field input:focus, .iui-field textarea:focus, .iui-field select:focus { border-color:var(--primary); box-shadow:0 0 0 3px color-mix(in srgb, var(--primary) 15%, transparent); }
  .iui-help { margin-top:4px; color:#9ca3af; font-size:11px; }
  .iui-options { display:flex; flex-wrap:wrap; gap:8px 16px; padding-top:2px; }
  .iui-options label { display:flex; align-items:center; gap:6px; font-weight:400; font-size:13px; margin:0; }
  .iui-submit { margin-top:6px; border:0; border-radius:10px; background:var(--primary); color:#fff; padding:10px 18px; font:inherit; font-size:13px; font-weight:600; cursor:pointer; }
  .iui-result { margin-top:8px; background:var(--muted); border-radius:10px; padding:12px; font:12px/1.6 ui-monospace,Consolas,monospace; white-space:pre-wrap; color:#4b5563; }
  .iui-article { line-height:1.8; font-size:14px; }
  .iui-article h1,.iui-article h2,.iui-article h3 { line-height:1.35; margin:1.4em 0 .6em; }
  .iui-article h1 { font-size:24px; } .iui-article h2 { font-size:19px; } .iui-article h3 { font-size:16px; }
  .iui-article p { margin:.8em 0; } .iui-article ul,.iui-article ol { padding-left:1.5em; }
  .iui-article blockquote { margin:1em 0; padding:8px 14px; border-left:3px solid var(--primary); background:var(--muted); color:#4b5563; }
  .iui-article code { background:var(--muted); padding:2px 5px; border-radius:5px; font-size:12px; }
  .iui-article pre { background:#f8fafc; border:1px solid #e5e7eb; border-radius:10px; padding:12px; overflow:auto; }
  .iui-article table { border-collapse:collapse; width:100%; font-size:13px; }
  .iui-article th,.iui-article td { border:1px solid #e5e7eb; padding:6px 9px; text-align:left; }
  .iui-cover { width:100%; max-height:320px; object-fit:cover; border-radius:12px; margin-bottom:16px; display:block; }
  .iui-tags { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px; }
  .iui-tag { background:var(--muted); color:#4b5563; border-radius:999px; padding:3px 9px; font-size:11px; }
</style>
</head>
<body>
<div class="iui-wrap">
  ${title || subtitle ? `<div class="iui-head"><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>` : ''}
  <div class="iui-card">${body}</div>
  <div class="iui-foot">WorkBuddy Lite · Intelligent UI</div>
</div>
${script}
</body>
</html>`
}

async function chartHtml(spec: WidgetSpec, theme: VisualTheme) {
  if (!spec.chart) throw new Error('缺少图表配置')
  const option = buildChartOption(spec.chart, theme)
  const umd = await echartsUmd()
  return shell(
    spec.title || '图表',
    spec.subtitle || '',
    theme,
    '<div id="iui-chart" class="iui-chart"></div>',
    `<script>${umd.replace(/<\/script/gi, '<\\/script')}</script>
<script>
  const chart = echarts.init(document.getElementById('iui-chart'));
  chart.setOption(${scriptJson(option)});
  window.addEventListener('resize', () => chart.resize());
</script>`,
  )
}

async function mapHtml(spec: WidgetSpec, theme: VisualTheme) {
  if (!spec.map) throw new Error('缺少地图配置')
  const custom = spec.map.geojson ? await resolveGeoJson(spec.map.geojson) : null
  const mapName = custom ? 'iui-custom' : 'world'
  const [umd, geo] = await Promise.all([echartsUmd(), custom ? Promise.resolve(custom) : worldGeoJson()])
  const option = buildMapOption(spec.map, theme, mapName)
  return shell(
    spec.title || '地图',
    spec.subtitle || '',
    theme,
    '<div id="iui-chart" class="iui-chart"></div>',
    `<script>${umd.replace(/<\/script/gi, '<\\/script')}</script>
<script>
  echarts.registerMap('${mapName}', ${scriptJson(geo)});
  const chart = echarts.init(document.getElementById('iui-chart'));
  chart.setOption(${scriptJson(option)});
  window.addEventListener('resize', () => chart.resize());
</script>`,
  )
}

function fieldHtml(field: FormField) {
  const id = esc(field.id)
  const label = `${esc(field.label)}${field.required ? ' *' : ''}`
  const required = field.required ? ' required' : ''
  const value = field.defaultValue
  let control = ''
  if (field.type === 'textarea') {
    control = `<textarea id="${id}" name="${id}" placeholder="${esc(field.placeholder || '')}"${required}>${esc(value ?? '')}</textarea>`
  } else if (field.type === 'select') {
    control = `<select id="${id}" name="${id}"${required}>${(field.options || [])
      .map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(value) ? ' selected' : ''}>${esc(o.label)}</option>`)
      .join('')}</select>`
  } else if (field.type === 'radio') {
    control = `<div class="iui-options">${(field.options || [])
      .map(
        (o) =>
          `<label><input type="radio" name="${id}" value="${esc(o.value)}"${String(o.value) === String(value) ? ' checked' : ''}${required} /> ${esc(o.label)}</label>`,
      )
      .join('')}</div>`
  } else if (field.type === 'checkbox') {
    control = `<label class="iui-checkbox"><input type="checkbox" id="${id}" name="${id}"${value ? ' checked' : ''} /> ${esc(field.placeholder || '是')}</label>`
  } else {
    control = `<input type="${field.type}" id="${id}" name="${id}" placeholder="${esc(field.placeholder || '')}" value="${esc(value ?? '')}"${required} />`
  }
  return `<div class="iui-field"><label for="${id}">${label}</label>${control}${field.help ? `<div class="iui-help">${esc(field.help)}</div>` : ''}</div>`
}

async function formHtml(spec: WidgetSpec, theme: VisualTheme) {
  if (!spec.form) throw new Error('缺少表单配置')
  const fields = spec.form.fields || []
  const body = `<form id="iui-form" class="iui-form">
    ${fields.map(fieldHtml).join('')}
    <button class="iui-submit" type="submit">${esc(spec.form.submitLabel || '提交')}</button>
    <div id="iui-result" class="iui-result" hidden></div>
  </form>`
  return shell(
    spec.title || '表单',
    spec.subtitle || '',
    theme,
    body,
    `<script>
  const fields = ${scriptJson(fields)};
  const form = document.getElementById('iui-form');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    const out = {};
    fields.forEach(function (field) {
      if (field.type === 'checkbox') {
        const el = form.elements[field.id];
        out[field.id] = !!(el && el.checked);
      } else if (field.type === 'radio') {
        const el = form.querySelector('input[name="' + field.id + '"]:checked');
        out[field.id] = el ? el.value : '';
      } else {
        const el = form.elements[field.id];
        out[field.id] = el ? el.value : '';
      }
    });
    const result = document.getElementById('iui-result');
    result.hidden = false;
    result.textContent = ${JSON.stringify(spec.form.successMessage || '已提交')} + '\\n\\n' + JSON.stringify(out, null, 2);
  });
</script>`,
  )
}

async function articleHtml(spec: WidgetSpec, theme: VisualTheme) {
  if (!spec.article) throw new Error('缺少文章配置')
  const [{ marked }, purify] = await Promise.all([import('marked'), import('dompurify')])
  const DOMPurify = purify.default
  const raw = await marked.parse(spec.article.markdown || '', { gfm: true, breaks: false })
  const html = DOMPurify.sanitize(raw)
  const cover = spec.article.cover
    ? `<img class="iui-cover" src="${esc(spec.article.cover)}" alt="" />`
    : ''
  const tags = spec.article.tags?.length
    ? `<div class="iui-tags">${spec.article.tags.map((tag) => `<span class="iui-tag">${esc(tag)}</span>`).join('')}</div>`
    : ''
  const meta = spec.article.author
    ? `<p style="color:#6b7280;font-size:12px;margin:0 0 12px">${esc(spec.article.author)}</p>`
    : ''
  return shell(
    spec.title || '文章',
    spec.subtitle || '',
    theme,
    `<article class="iui-article">${cover}${tags}${meta}${html}</article>`,
  )
}

export async function buildWidgetPage(spec: WidgetSpec, theme: VisualTheme) {
  if (spec.type === 'chart') return chartHtml(spec, theme)
  if (spec.type === 'map') return mapHtml(spec, theme)
  if (spec.type === 'form') return formHtml(spec, theme)
  if (spec.type === 'article') return articleHtml(spec, theme)
  throw new Error('未知交互组件类型')
}

export async function exportWidgetPage(spec: WidgetSpec, theme: VisualTheme) {
  const html = await buildWidgetPage(spec, theme)
  downloadText(safeFileName(spec.title, 'html'), html)
}
