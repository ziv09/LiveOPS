import { useNavigate } from 'react-router-dom'
import { getJaasAppId } from '../jaas/jaasConfig'

export function Viewer() {
  const navigate = useNavigate()

  if (getJaasAppId()) {
    return (
      <div className="grid min-h-full place-items-center bg-neutral-950 p-6 text-neutral-100">
        <div className="max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/30 p-5">
          <div className="text-lg font-semibold">此模式已停用</div>
          <div className="mt-2 text-sm text-neutral-300">
            你目前已切換至 8x8 JaaS 25 MAU 架構，舊版多 IFrame 模式會造成名額暴增，已停用。
            <br /><br />
            請使用一般的 /viewer 頁面。
          </div>
          <button
            className="mt-4 h-10 w-full rounded-lg bg-neutral-100 px-3 text-sm font-semibold text-neutral-950 hover:bg-white"
            onClick={() => navigate('/viewer', { replace: true })}
          >
            前往新版監看
          </button>
        </div>
      </div>
    )
  }

  // Double lock: Explicitly require JWT (which we don't have here)
  const jwt = null

  if (!jwt) {
    return (
      <div className="grid min-h-full place-items-center bg-neutral-950 text-red-500">
        錯誤：缺少 JaaS Token，禁止匿名連線。
      </div>
    )
  }

  return null // Unreachable
}
