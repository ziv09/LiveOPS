import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { JitsiPlayer } from '../components/JitsiPlayer'
import { setAllParticipantVolume } from '../jitsi/jitsiHelpers'
import { useSignal } from '../signal/useSignal'
import { parseCollectorToken } from '../utils/token'
import { ensureRoleName } from '../utils/roleName'
import { buildJaasIFrameRoomName } from '../jaas/jaasConfig'
import { useJaasGatekeeper } from '../jaas/useJaasGatekeeper'

export function Collector() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const token = searchParams.get('token')
  const parsed = useMemo(() => (token ? parseCollectorToken(token) : null), [token])

  const opsId = (parsed?.opsId ?? '').trim().toLowerCase()
  const nameFromQuery = (searchParams.get('name') ?? '').trim()
  const displayName = ensureRoleName('src.', nameFromQuery || parsed?.name || '', '來源')
  const join = (searchParams.get('join') ?? '').trim() === '1'
  const [nameDraft, setNameDraft] = useState(() => {
    const raw = String(nameFromQuery || parsed?.name || '').trim()
    return raw.replace(/^(src\.|mon\.|crew\.|crew_)/i, '')
  })

  const wakeLockRef = useRef<any | null>(null)
  useEffect(() => {
    let canceled = false
    async function lock() {
      try {
        const wl = await (navigator as any).wakeLock?.request?.('screen')
        if (canceled) return
        wakeLockRef.current = wl
      } catch {
        // noop
      }
    }
    lock()
    return () => {
      canceled = true
      try {
        wakeLockRef.current?.release?.()
      } catch {
        // noop
      }
      wakeLockRef.current = null
    }
  }, [])

  if (!token || !opsId) {
    return (
      <div className="grid min-h-full place-items-center bg-neutral-950 p-6 text-neutral-100">
        <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/30 p-5">
          <div className="text-lg font-semibold">訊號採集（Collector）</div>
          <div className="mt-2 text-sm text-neutral-300">
            請使用控制端「啟動會議」後產生的採集連結或 QR Code 進入。
          </div>
          <div className="mt-4 flex gap-2">
            <button
              className="h-10 flex-1 rounded-lg bg-neutral-100 px-3 text-sm font-semibold text-neutral-950 hover:bg-white"
              onClick={() => navigate('/')}
            >
              返回首頁
            </button>
            <button
              className="h-10 rounded-lg border border-neutral-700 bg-neutral-900/30 px-3 text-sm font-semibold hover:border-neutral-500"
              onClick={() => navigate('/')}
            >
              返回
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!join) {
    return (
      <div className="grid min-h-full place-items-center bg-neutral-950 p-6 text-neutral-100">
        <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/30 p-5">
          <div className="text-lg font-semibold">訊號採集（Collector）</div>
          <div className="mt-2 text-sm text-neutral-300">先設定來源名稱與影像來源，確認後才會加入會議室。</div>

          <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950/30 p-3">
            <div className="text-xs text-neutral-500">
              會議碼：<span className="font-mono text-neutral-200">{opsId}</span>
            </div>

            <label className="mt-3 grid gap-2">
              <div className="text-sm text-neutral-200">來源名稱（必填）</div>
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                className="h-11 rounded-lg border border-neutral-700 bg-neutral-950/50 px-3 outline-none ring-0 focus:border-neutral-500"
                placeholder="例如：OBS 主畫面 / 手機 A / Camera 1"
              />
            </label>

            <div className="mt-2 text-xs text-neutral-500">
              下一步會進入 Jitsi 原生的「加入前設定」頁面，請在那裡選擇要使用的攝影機來源（例如 OBS Virtual Camera）。
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              className="h-10 flex-1 rounded-lg bg-neutral-100 px-3 text-sm font-semibold text-neutral-950 hover:bg-white disabled:opacity-50"
              disabled={!nameDraft.trim()}
              onClick={() => {
                const n = nameDraft.trim()
                if (!n) return
                const next: Record<string, string> = { token, name: ensureRoleName('src.', n, '來源'), join: '1' }
                setSearchParams(next)
              }}
            >
              開始採集
            </button>
            <button
              className="h-10 rounded-lg border border-neutral-700 bg-neutral-900/30 px-3 text-sm font-semibold hover:border-neutral-500"
              onClick={() => navigate('/')}
            >
              取消
            </button>
          </div>
        </div>
      </div>
    )
  }

  return <CollectorLive opsId={opsId} displayName={displayName} onBack={() => navigate('/')} />
}

function CollectorLive(props: { opsId: string; displayName: string; onBack: () => void }) {
  const { state } = useSignal()
  const apiRef = useRef<any | null>(null)
  const [connected, setConnected] = useState(false)

  const jaasRoom = useMemo(() => buildJaasIFrameRoomName(props.opsId), [props.opsId])

  const gate = useJaasGatekeeper({
    opsId: props.opsId,
    displayName: props.displayName,
    requestedRole: 'collector',
    enabled: true,
  })

  if (gate.status === 'auth' || gate.status === 'issuing') {
    return (
      <div className="grid min-h-full place-items-center bg-neutral-950 p-6 text-neutral-100">
        <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/30 p-5">
          <div className="text-lg font-semibold">正在取得入場憑證...</div>
          <div className="mt-2 text-sm text-neutral-300">正在向伺服器驗票並鎖定名額（25 MAU）。</div>
        </div>
      </div>
    )
  }

  if (gate.status === 'error') {
    return (
      <div className="grid min-h-full place-items-center bg-neutral-950 p-6 text-neutral-100">
        <div className="w-full max-w-md rounded-2xl border border-red-500/30 bg-red-950/30 p-5">
          <div className="text-lg font-semibold text-red-100">入場失敗</div>
          <div className="mt-2 text-sm text-red-200 break-words">{gate.error || '無法取得入場 Token。'}</div>
          <button
            className="mt-4 h-10 w-full rounded-lg bg-neutral-100 px-3 text-sm font-semibold text-neutral-950 hover:bg-white"
            onClick={props.onBack}
          >
            返回首頁
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full bg-neutral-950 text-neutral-100">
      <JitsiPlayer
        room={jaasRoom}
        displayName={props.displayName}
        jwt={gate.token}
        onApi={(api) => {
          apiRef.current = api
          if (!api) return

          setConnected(false)
          api.addListener?.('videoConferenceJoined', () => setConnected(true))
          api.addListener?.('videoConferenceLeft', () => setConnected(false))

          setAllParticipantVolume(api, 0)
        }}
        configOverwrite={{
          startWithAudioMuted: true,
          startWithVideoMuted: false,
          disableInitialGUM: false,
          disableSelfView: false,
          prejoinPageEnabled: true,
          prejoinConfig: { enabled: true },
          disableDeepLinking: true,
          startConferenceOnEnter: true,
          requireDisplayName: false,
        }}
        interfaceConfigOverwrite={{
          // 允許在 Jitsi 原生加入前設定頁面切換攝影機/麥克風
          SETTINGS_SECTIONS: ['devices'],
          TOOLBAR_BUTTONS: ['settings'],
        }}
      />

      <div className="pointer-events-none absolute inset-0 p-4">
        <div className="flex items-center justify-between">
          <button
            className="pointer-events-auto h-10 rounded-xl border border-neutral-700 bg-neutral-950/60 px-3 text-sm font-semibold text-neutral-100 backdrop-blur hover:border-neutral-500"
            onClick={props.onBack}
          >
            返回
          </button>

          <div className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-200 backdrop-blur">
            <span className={connected ? 'text-emerald-300' : 'text-neutral-400'}>
              {connected ? '● 已連線' : '● 連線中'}
            </span>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            className="pointer-events-auto h-12 rounded-2xl border border-neutral-700 bg-neutral-950/60 px-4 text-sm font-semibold text-neutral-100 backdrop-blur hover:border-neutral-500"
            onClick={() => {
              const api = apiRef.current
              if (!api) return
              try {
                api.executeCommand('toggleCamera')
              } catch {
                try {
                  api.executeCommand('switchCamera')
                } catch {
                  // noop
                }
              }
            }}
          >
            翻轉鏡頭
          </button>
        </div>

        <div className="mt-4 text-xs text-neutral-400">
          會議碼：<span className="font-mono">{props.opsId}</span> / 名稱：
          <span className="font-mono"> {props.displayName}</span>
        </div>

        {!state.conference.started ? (
          <div className="mt-2 text-xs text-amber-200">
            尚未開播：控制端未按「啟動會議」，但你已可先提供影像來源。
          </div>
        ) : null}
      </div>
    </div>
  )
}
