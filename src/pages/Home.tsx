import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { setAuthed, verifyAdminPassword, verifyViewerPassword } from '../auth/auth'
import { normalizeOpsId } from '../utils/ops'
import { ensureRoleName } from '../utils/roleName'

export function Home() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [role, setRole] = useState<'admin' | 'viewer' | 'crew'>('admin')
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

  const needsOpsAndName = role === 'viewer' || role === 'crew'

  return (
    <div className="min-h-full bg-neutral-950 text-neutral-100">
      <div className="relative mx-auto flex min-h-full max-w-5xl flex-col items-center justify-center px-6 py-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.10)_0%,rgba(0,0,0,0.0)_40%,rgba(0,0,0,0.0)_100%)]" />

        <div className="relative flex w-full flex-col items-center">
          <img
            src="/vite-full-white.svg"
            alt="OPS"
            className="w-[1440px] select-none opacity-95 drop-shadow-[0_0_60px_rgba(0,0,0,0.7)]"
            draggable={false}
          />

          <div className="mt-14 w-full max-w-4xl rounded-2xl border border-neutral-800 bg-neutral-900/20 p-5 shadow-2xl backdrop-blur">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2">
                <div className="text-xs text-neutral-300">登入身分</div>
                <select
                  value={role}
                  onChange={(e) => {
                    setRole(e.target.value as 'admin' | 'viewer' | 'crew')
                    setPassword('')
                    setError(null)
                  }}
                  className="h-11 rounded-lg border border-neutral-700 bg-neutral-950/40 px-3 text-sm outline-none focus:border-neutral-500"
                >
                  <option value="admin">控制端（Admin）</option>
                  <option value="viewer">一般監看（Viewer）</option>
                  <option value="crew">來賓（Crew）</option>
                </select>
              </label>

              <label className="grid gap-2">
                <div className="text-xs text-neutral-300">密碼</div>
                <input
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError(null)
                  }}
                  type="password"
                  className="h-11 rounded-lg border border-neutral-700 bg-neutral-950/40 px-3 text-sm outline-none focus:border-neutral-500"
                  placeholder={role === 'admin' ? '請輸入控制端密碼' : '請輸入一般監看密碼'}
                />
              </label>

              {needsOpsAndName ? (
                <label className="grid gap-2">
                  <div className="text-xs text-neutral-300">會議碼（例如 ops01）</div>
                  <input
                    value={opsId}
                    onChange={(e) => {
                      setOpsId(normalizeOpsId(e.target.value))
                      setError(null)
                    }}
                    className="h-11 rounded-lg border border-neutral-700 bg-neutral-950/40 px-3 text-sm lowercase outline-none focus:border-neutral-500"
                    placeholder="ops01"
                  />
                </label>
              ) : (
                <div className="hidden md:block" />
              )}

              {needsOpsAndName ? (
                <label className="grid gap-2">
                  <div className="text-xs text-neutral-300">名稱（選填）</div>
                  <input
                    value={viewerName}
                    onChange={(e) => setViewerName(e.target.value)}
                    className="h-11 rounded-lg border border-neutral-700 bg-neutral-950/40 px-3 text-sm outline-none focus:border-neutral-500"
                    placeholder={role === 'crew' ? '例如：來賓1' : '例如：一般'}
                  />
                </label>
              ) : (
                <div className="hidden md:block" />
              )}
            </div>

            <button
              className="mt-5 h-12 w-full rounded-xl bg-neutral-100 text-sm font-semibold text-neutral-950 hover:bg-white"
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
                // viewer and crew both use viewer password
                if (!verifyViewerPassword(password)) {
                  setError('一般監看密碼錯誤。')
                  return
                }
                const trimmedOps = normalizeOpsId(opsId)
                if (!trimmedOps) {
                  setError('請輸入會議碼（例如 ops01）。')
                  return
                }
                setAuthed('viewer')
                const baseName = (viewerName || (role === 'crew' ? '來賓' : '一般')).trim() || (role === 'crew' ? '來賓' : '一般')
                const rolePrefix = role === 'crew' ? 'crew_' : 'mon.'
                const displayName = ensureRoleName(rolePrefix, baseName, role === 'crew' ? '來賓' : '一般')
                go('/viewer', {
                  ops: trimmedOps,
                  name: displayName,
                })
              }}
            >
              登入
            </button>

            {error ? (
              <div className="mt-4 rounded-xl border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            <div className="mt-5 text-center text-xs leading-relaxed text-neutral-500">
              提示：採集端請一律使用控制端產生的採集連結或 QR Code 進入。
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
