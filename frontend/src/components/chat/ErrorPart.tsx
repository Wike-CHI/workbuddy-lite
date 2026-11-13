import type { DataMessagePartProps } from '@assistant-ui/react'
import { AlertTriangle } from 'lucide-react'

export function ErrorPart({ data }: DataMessagePartProps<{ message: string; kind?: string }>) {
  if (!data?.message) return null
  return (
    <div className="rounded-xl border border-[#f3d0d0] bg-[#fdf4f4] px-3 py-2.5 text-[12.5px] text-[#8f2d2d]">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div>
          <div>{data.message}</div>
          {data.kind === 'auth' && (
            <div className="mt-1.5 text-[11.5px] text-[#4b5158]">
              终端执行 <code className="rounded bg-card px-1 py-0.5">codebuddy</code> 后输入{' '}
              <code className="rounded bg-card px-1 py-0.5">/login</code>，再重启本应用即可。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
