import { Copy, RotateCcw } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import type { FormField, VisualTheme, WidgetSpec } from '@/lib/types'
import type { WidgetHandle } from './handle'

type Value = string | number | boolean

function initialValues(fields: FormField[]) {
  const out: Record<string, Value> = {}
  for (const field of fields) {
    if (field.type === 'checkbox') out[field.id] = Boolean(field.defaultValue)
    else out[field.id] = field.defaultValue !== undefined ? (field.defaultValue as Value) : ''
  }
  return out
}

export const FormWidget = React.forwardRef<WidgetHandle, { spec: WidgetSpec; theme: VisualTheme }>(
  function FormWidget({ spec, theme }, ref) {
    const form = spec.form
    const fields = form?.fields || []
    const host = React.useRef<HTMLDivElement>(null)
    const [values, setValues] = React.useState<Record<string, Value>>(() => initialValues(fields))
    const [errors, setErrors] = React.useState<Record<string, string>>({})
    const [submitted, setSubmitted] = React.useState<string | null>(null)

    React.useEffect(() => {
      setValues(initialValues(fields))
      setErrors({})
      setSubmitted(null)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [spec.form])

    React.useImperativeHandle(
      ref,
      () => ({
        exportImage: async () => {
          if (!host.current) return null
          const { toPng } = await import('html-to-image')
          return toPng(host.current, { pixelRatio: 2, backgroundColor: theme.background, cacheBust: true })
        },
      }),
      [theme.background],
    )

    if (!form || !fields.length) {
      return <div className="rounded-xl border border-[#f3d0d0] bg-[#fdf4f4] p-3 text-xs text-[#8f2d2d]">缺少 form 配置</div>
    }

    const setValue = (id: string, value: Value) => {
      setValues((prev) => ({ ...prev, [id]: value }))
      setErrors((prev) => {
        if (!prev[id]) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
    }

    const submit = () => {
      const nextErrors: Record<string, string> = {}
      for (const field of fields) {
        if (!field.required) continue
        const value = values[field.id]
        if (field.type === 'checkbox' ? !value : value === undefined || value === '') {
          nextErrors[field.id] = '这一项必填'
        }
      }
      if (Object.keys(nextErrors).length) {
        setErrors(nextErrors)
        return
      }
      setSubmitted(JSON.stringify(values, null, 2))
      toast.success(form.successMessage || '表单已提交')
    }

    const inputStyle: React.CSSProperties = {
      borderColor: theme.muted,
      background: theme.background,
      color: theme.foreground,
    }
    const inputClass = 'iui-input w-full rounded-lg border px-3 py-2 text-[12.5px] outline-none transition-colors'
    const buttonStyle: React.CSSProperties = {
      background: theme.primary,
      borderRadius: Math.max(8, theme.radius / 2),
      color: '#fff',
    }

    if (submitted) {
      return (
        <div ref={host} className="space-y-3" style={{ fontFamily: theme.fontFamily, color: theme.foreground }}>
          <div
            className="rounded-xl border p-3 text-[13px]"
            style={{ borderColor: theme.primary + '33', background: theme.muted }}
          >
            {form.successMessage || '表单已提交'}
          </div>
          <pre
            className="max-h-64 overflow-auto rounded-xl border p-3 font-mono text-[11.5px] leading-5"
            style={{ borderColor: theme.muted, background: theme.background, color: theme.foreground }}
          >
            {submitted}
          </pre>
          <div className="flex gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px]"
              style={{ background: theme.primary, color: '#fff' }}
              onClick={() => {
                void navigator.clipboard.writeText(submitted)
                toast.success('已复制 JSON')
              }}
            >
              <Copy className="size-3" />
              复制 JSON
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11.5px]"
              style={{ borderColor: theme.muted, color: theme.foreground }}
              onClick={() => setSubmitted(null)}
            >
              <RotateCcw className="size-3" />
              重新填写
            </button>
          </div>
        </div>
      )
    }

    return (
      <div ref={host} className="space-y-3.5" style={{ fontFamily: theme.fontFamily, color: theme.foreground }}>
        {fields.map((field) => {
          const value = values[field.id]
          const error = errors[field.id]
          return (
            <div key={field.id}>
              <label className="mb-1 block text-[11.5px] font-medium" htmlFor={`iui-${field.id}`}>
                {field.label}
                {field.required && <span style={{ color: theme.primary }}> *</span>}
              </label>
              {field.type === 'textarea' ? (
                <textarea
                  id={`iui-${field.id}`}
                  className={inputClass}
                  style={{ ...inputStyle, minHeight: 88, resize: 'vertical' }}
                  placeholder={field.placeholder}
                  value={String(value ?? '')}
                  onChange={(event) => setValue(field.id, event.target.value)}
                />
              ) : field.type === 'select' ? (
                <select
                  id={`iui-${field.id}`}
                  className={inputClass}
                  style={inputStyle}
                  value={String(value ?? '')}
                  onChange={(event) => setValue(field.id, event.target.value)}
                >
                  <option value="">请选择</option>
                  {(field.options || []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : field.type === 'radio' ? (
                <div className="flex flex-wrap gap-3 pt-0.5">
                  {(field.options || []).map((option) => (
                    <label key={option.value} className="flex items-center gap-1.5 text-[12.5px]">
                      <input
                        type="radio"
                        name={field.id}
                        value={option.value}
                        checked={String(value) === option.value}
                        onChange={() => setValue(field.id, option.value)}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              ) : field.type === 'checkbox' ? (
                <label className="flex items-center gap-2 text-[12.5px]">
                  <input
                    id={`iui-${field.id}`}
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(event) => setValue(field.id, event.target.checked)}
                  />
                  {field.placeholder || '是'}
                </label>
              ) : (
                <input
                  id={`iui-${field.id}`}
                  type={field.type}
                  className={inputClass}
                  style={inputStyle}
                  placeholder={field.placeholder}
                  value={String(value ?? '')}
                  onChange={(event) => setValue(field.id, event.target.value)}
                />
              )}
              {field.help && !error && <div className="mt-1 text-[10.5px] text-muted-foreground">{field.help}</div>}
              {error && (
                <div className="mt-1 text-[10.5px]" style={{ color: '#d64545' }}>
                  {error}
                </div>
              )}
            </div>
          )
        })}
        <button
          type="button"
          className="mt-1 w-full rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-opacity hover:opacity-90"
          style={buttonStyle}
          onClick={submit}
        >
          {form.submitLabel || '提交'}
        </button>
      </div>
    )
  },
)
