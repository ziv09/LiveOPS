import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { setAuthed, verifyAdminPassword, verifyViewerPassword } from '../auth/auth'

export function Home() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [role, setRole] = useState<'admin' | 'viewer'>('admin')
  const [password, setPassword] = useState('')
  const initialOps = useMemo(() => searchParams.get('ops') ?? '', [searchParams])
  const [opsId, setOpsId] = useState(initialOps)
  const [viewerName, setViewerName] = useState('一般')
  const [error, setError] = useState<string | null>(null)

  const go = (path: string, params: Record<string, string | undefined>) => {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') sp.set(k, v)
    }
    navigate(`${path}?${sp.toString()}`)
  }

  return (
    <div className="min-h-full bg-neutral-950 text-neutral-100">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center p-6">
        <div className="w-full rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 shadow-xl">
          <div className="mb-6">
            <div className="text-2xl font-semibold tracking-tight">LiveOPS</div>
            <div className="mt-1 text-sm text-neutral-300">
              戰術通訊與監控系統（Jitsi Meet 封裝 / External API）
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <div className="text-sm text-neutral-200">登入身分</div>
              <select
                value={role}
                onChange={(e) => {
                  setRole(e.target.value as 'admin' | 'viewer')
                  setPassword('')
                  setError(null)
                }}
                className="h-11 rounded-lg border border-neutral-700 bg-neutral-950/50 px-3 outline-none ring-0 focus:border-neutral-500"
              >
                <option value="admin">控制端（Admin）</option>
                <option value="viewer">一般監看（Viewer）</option>
              </select>
            </label>

            <label className="grid gap-2">
              <div className="text-sm text-neutral-200">密碼</div>
              <input
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError(null)
                }}
                type="password"
                className="h-11 rounded-lg border border-neutral-700 bg-neutral-950/50 px-3 outline-none ring-0 focus:border-neutral-500"
                placeholder={role === 'admin' ? '請輸入控制端密碼' : '請輸入一般監看密碼'}
              />
            </label>

            {role === 'viewer' ? (
              <label className="grid gap-2">
                <div className="text-sm text-neutral-200">會議碼（例如 OPS01）</div>
                <input
                  value={opsId}
                  onChange={(e) => {
                    setOpsId(e.target.value.toUpperCase())
                    setError(null)
                  }}
                  className="h-11 rounded-lg border border-neutral-700 bg-neutral-950/50 px-3 uppercase outline-none ring-0 focus:border-neutral-500"
                  placeholder="OPS01"
                />
              </label>
            ) : (
              <div className="hidden md:block" />
            )}

            {role === 'viewer' ? (
              <label className="grid gap-2">
                <div className="text-sm text-neutral-200">顯示名稱（選填）</div>
                <input
                  value={viewerName}
                  onChange={(e) => setViewerName(e.target.value)}
                  className="h-11 rounded-lg border border-neutral-700 bg-neutral-950/50 px-3 outline-none ring-0 focus:border-neutral-500"
                  placeholder="例如：一般"
                />
              </label>
            ) : (
              <div className="hidden md:block" />
            )}
          </div>

          <div className="mt-6 grid gap-3">
            <button
              className="h-11 rounded-lg bg-neutral-100 text-sm font-semibold text-neutral-950 hover:bg-white"
              onClick={() => {
                if (role === 'admin') {
                  if (!verifyAdminPassword(password)) {
                    setError('控制端密碼錯誤。')
                    return
                  }
                  setAuthed('admin')
                  navigate('/admin')
                  return
                }
                if (!verifyViewerPassword(password)) {
                  setError('一般監看密碼錯誤。')
                  return
                }
                const trimmedOps = opsId.trim().toUpperCase()
                if (!trimmedOps) {
                  setError('請輸入會議碼（例如 OPS01）。')
                  return
                }
                setAuthed('viewer')
                go('/viewer', {
                  ops: trimmedOps,
                  name: (viewerName || '一般').trim() || '一般',
                })
              }}
            >
              登入
            </button>

          </div>

          {error ? (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <div className="mt-6 text-xs leading-relaxed text-neutral-400">
            提示：採集端請一律使用控制端「啟動會議」後產生的採集連結或 QR Code 進入。
          </div>
        </div>
      </div>
    </div>
  )
}
