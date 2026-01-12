import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { JitsiPlayer } from '../components/JitsiPlayer'
import { setAllParticipantVolume } from '../jitsi/jitsiHelpers'
import { useSignal } from '../signal/useSignal'
import { parseCollectorToken } from '../utils/token'

export function Collector() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const token = searchParams.get('token')
  const parsed = useMemo(() => (token ? parseCollectorToken(token) : null), [token])

  const opsFromQuery = (searchParams.get('ops') ?? '').trim().toUpperCase()
  const opsId = (parsed?.opsId ?? opsFromQuery).trim().toUpperCase()
  const nameFromQuery = (searchParams.get('name') ?? '').trim()
  const displayName = (parsed?.name ?? nameFromQuery ?? '').trim() || 'Collector'

  const { state } = useSignal()
  const apiRef = useRef<any | null>(null)

  const [connected, setConnected] = useState(false)
  const [opsDraft, setOpsDraft] = useState(opsId || '')
  const [nameDraft, setNameDraft] = useState(displayName === 'Collector' ? '' : displayName)

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

  if (!opsId) {
    return (
      <div className="grid min-h-full place-items-center bg-neutral-950 p-6 text-neutral-100">
        <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/30 p-5">
          <div className="text-lg font-semibold">訊號採集（Collector）</div>
          <div className="mt-2 text-sm text-neutral-300">請輸入控制端提供的會議碼（OPSxx）後進入採集會議室。</div>
          <label className="mt-4 grid gap-2">
            <div className="text-sm text-neutral-200">會議碼</div>
            <input
              value={opsDraft}
              onChange={(e) => setOpsDraft(e.target.value.toUpperCase())}
              className="h-11 rounded-lg border border-neutral-700 bg-neutral-950/50 px-3 uppercase outline-none ring-0 focus:border-neutral-500"
              placeholder="OPS01"
            />
          </label>
          <label className="mt-3 grid gap-2">
            <div className="text-sm text-neutral-200">名稱（選填）</div>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              className="h-11 rounded-lg border border-neutral-700 bg-neutral-950/50 px-3 outline-none ring-0 focus:border-neutral-500"
              placeholder="例如：手機 A"
            />
          </label>
          <div className="mt-4 flex gap-2">
            <button
              className="h-10 flex-1 rounded-lg bg-neutral-100 px-3 text-sm font-semibold text-neutral-950 hover:bg-white"
              onClick={() => {
                const trimmed = opsDraft.trim().toUpperCase()
                if (!trimmed) return
                const next: Record<string, string> = { ops: trimmed }
                if (nameDraft.trim()) next.name = nameDraft.trim()
                setSearchParams(next)
              }}
            >
              進入採集
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

  return (
    <div className="relative h-full w-full bg-neutral-950 text-neutral-100">
      <JitsiPlayer
        room={state.session.room}
        displayName={displayName}
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
          prejoinPageEnabled: false,
          disableDeepLinking: true,
          startConferenceOnEnter: true,
          requireDisplayName: false,
          prejoinConfig: { enabled: false },
        }}
        interfaceConfigOverwrite={{
          TOOLBAR_BUTTONS: [],
        }}
      />

      <div className="pointer-events-none absolute inset-0 p-4">
        <div className="flex items-center justify-between">
          <button
            className="pointer-events-auto h-10 rounded-xl border border-neutral-700 bg-neutral-950/60 px-3 text-sm font-semibold text-neutral-100 backdrop-blur hover:border-neutral-500"
            onClick={() => navigate('/')}
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
          會議碼：<span className="font-mono">{opsId}</span> / 名稱：
          <span className="font-mono"> {displayName}</span>
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
