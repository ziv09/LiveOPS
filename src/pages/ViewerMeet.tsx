import dayjs from 'dayjs'
import { useEffect, useMemo, useRef, useState } from 'react'
import Split from 'react-split'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { clearAuth, isAuthed } from '../auth/auth'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useLibJitsiConference } from '../jitsi/useLibJitsiConference'
import { useSignal } from '../signal/useSignal'
import { normalizeOpsId } from '../utils/ops'
import { ensureRoleName } from '../utils/roleName'
import { buildJaasSdkRoomName } from '../jaas/jaasConfig'
import { useJaasGatekeeper } from '../jaas/useJaasGatekeeper'

function makeGutter(direction: 'horizontal' | 'vertical') {
  const gutter = document.createElement('div')
  gutter.className = `gutter gutter-${direction}`
  return gutter
}

function PageDots(props: { count: number; active: number; onSelect: (i: number) => void }) {
  const dots = Array.from({ length: props.count }, (_, i) => i)
  return (
    <div className="flex items-center justify-center gap-2 py-2">
      {dots.map((i) => (
        <button
          key={i}
          className={
            i === props.active
              ? 'h-2.5 w-2.5 rounded-full bg-neutral-200'
              : 'h-2.5 w-2.5 rounded-full bg-neutral-700 hover:bg-neutral-500'
          }
          onClick={() => props.onSelect(i)}
          aria-label={`第 ${i + 1} 頁`}
        />
      ))}
    </div>
  )
}

function TrackVideo(props: { track: any | null; className?: string }) {
  const ref = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const el = ref.current
    const track = props.track
    if (!el || !track?.attach) return
    try {
      track.attach(el)
    } catch {
      // noop
    }
    return () => {
      try {
        track.detach?.(el)
      } catch {
        // noop
      }
    }
  }, [props.track])

  return <video ref={ref} className={props.className ?? 'h-full w-full object-cover'} autoPlay playsInline muted />
}

function TrackAudio(props: { track: any | null; enabled: boolean }) {
  const ref = useRef<HTMLAudioElement | null>(null)
  useEffect(() => {
    const el = ref.current
    const track = props.track
    if (!el || !track?.attach) return
    try {
      track.attach(el)
    } catch {
      // noop
    }
    return () => {
      try {
        track.detach?.(el)
      } catch {
        // noop
      }
    }
  }, [props.track])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.volume = props.enabled ? 1 : 0
  }, [props.enabled])

  return <audio ref={ref} autoPlay />
}

function VideoTile(props: {
  title: string
  track: any | null
  fullscreen: boolean
  onFullscreen: () => void
}) {
  return (
    <div className={props.fullscreen ? 'fixed inset-0 z-50 bg-neutral-950' : 'relative h-full w-full bg-neutral-950'}>
      {props.track ? (
        <TrackVideo track={props.track} />
      ) : (
        <div className="grid h-full w-full place-items-center text-sm text-neutral-600">（未指派）</div>
      )}

      <button className="absolute inset-0 z-10" onClick={props.onFullscreen} aria-label="放大顯示" />

      <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-xl border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-200 backdrop-blur">
        <div className="font-semibold">{props.title}</div>
      </div>
    </div>
  )
}

export function ViewerMeet() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const opsId = (searchParams.get('ops') ?? '').trim().toLowerCase()
  const rawName = (searchParams.get('name') ?? '').trim() || '一般'
  // Preserve the role prefix from URL (mon. or crew.), only add mon. if no prefix exists
  const hasRolePrefix = rawName.startsWith('mon.') || rawName.startsWith('crew.') || rawName.startsWith('src.')
  const name = hasRolePrefix ? rawName : ensureRoleName('mon.', rawName, '一般')
  const authed = isAuthed('viewer')

  const isMobile = useMediaQuery('(max-width: 768px)')
  const { state, sync } = useSignal()
  const opsRoom = useMemo(() => normalizeOpsId(state.session.room || opsId), [opsId, state.session.room])
  const room = useMemo(() => buildJaasSdkRoomName(opsRoom), [opsRoom])

  const [now, setNow] = useState(() => dayjs().format('HH:mm:ss'))
  const [listenEnabled, setListenEnabled] = useState(true)
  const [audioPanelOpen, setAudioPanelOpen] = useState(false)

  const [mtvPage, setMtvPage] = useState(0)
  const pageSize = 8
  const [sourcePage, setSourcePage] = useState(0)
  const [fullscreenKey, setFullscreenKey] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setInterval(() => setNow(dayjs().format('HH:mm:ss')), 500)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreenKey(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const mtvSlot = state.routing.mtv[mtvPage] ?? state.routing.mtv[0]
  const pageStart = sourcePage * pageSize
  const visibleSourceSlots = state.routing.source.slice(pageStart, pageStart + pageSize)

  const routingSources = useMemo(() => {
    const srcs: Array<{ kind: 'name'; name: string }> = []
    if (mtvSlot?.source?.type === 'participantName') srcs.push({ kind: 'name', name: mtvSlot.source.name.trim() })
    for (const s of visibleSourceSlots) {
      if (s.source.type === 'participantName') srcs.push({ kind: 'name', name: s.source.name.trim() })
    }
    return srcs.filter((x) => !!x.name)
  }, [mtvSlot, visibleSourceSlots])

  const gate = useJaasGatekeeper({
    opsId: opsRoom,
    displayName: name,
    requestedRole: 'viewer',
    enabled: !!opsId && authed,
  })

  // Determine if conference should be enabled
  const enabled = gate.status === 'ready'

  const { state: confState, api } = useLibJitsiConference({
    room,
    displayName: name,
    jwt: gate.token,
    enabled,
    lobby: { enabled: false },
  })

  const showProgram = state.conference.started

  const nameToRemote = useMemo(() => {
    const m = new Map<string, { id: string; videoTrack: any | null; audioTrack: any | null }>()
    for (const r of confState.remotes) {
      const n = (r.name ?? '').trim()
      if (!n) continue
      if (!m.has(n)) m.set(n, { id: r.id, videoTrack: r.videoTrack, audioTrack: r.audioTrack })
    }
    return m
  }, [confState.remotes])

  const mtvRemote = useMemo(() => {
    if (!showProgram) return null
    if (mtvSlot?.source?.type === 'participantName') {
      return nameToRemote.get(mtvSlot.source.name.trim()) ?? null
    }
    return null
  }, [mtvSlot, nameToRemote, showProgram])

  const sourceRemotes = useMemo(() => {
    if (!showProgram) return []
    return visibleSourceSlots.map((s) => {
      if (s.source.type === 'participantName') return nameToRemote.get(s.source.name.trim()) ?? null
      return null
    })
  }, [nameToRemote, showProgram, visibleSourceSlots])

  const highIds = useMemo(() => {
    const ids: string[] = []
    if (mtvRemote?.id) ids.push(mtvRemote.id)
    if (fullscreenKey === 'mtv' && mtvRemote?.id) ids.push(mtvRemote.id)
    if (fullscreenKey?.startsWith('src:')) {
      const idx = Number.parseInt(fullscreenKey.slice(4), 10)
      const fs = sourceRemotes[idx]
      if (fs?.id) ids.push(fs.id)
    }
    return ids
  }, [fullscreenKey, mtvRemote?.id, sourceRemotes])

  const visibleIds = useMemo(() => {
    const ids: string[] = []
    for (const s of routingSources) {
      const r = nameToRemote.get(s.name)
      if (r?.id) ids.push(r.id)
    }
    return ids
  }, [nameToRemote, routingSources])

  useEffect(() => {
    api.setReceiverHints(highIds, visibleIds)
  }, [api, highIds, visibleIds])

  const totalSourcePages = Math.max(1, Math.ceil(state.routing.source.length / pageSize))
  useEffect(() => setSourcePage((p) => Math.min(p, totalSourcePages - 1)), [totalSourcePages])

  useEffect(() => setMtvPage((p) => Math.min(p, Math.max(0, state.routing.mtv.length - 1))), [state.routing.mtv.length])

  const allRemoteAudios = useMemo(() => confState.remotes.map((r) => ({ id: r.id, track: r.audioTrack })), [confState.remotes])

  // --- GUARDS (Conditional Returns) ---
  // Must be placed AFTER all hooks to follow React Rules of Hooks

  if (!authed) {
    return (
      <div className="grid min-h-full place-items-center bg-neutral-950 p-6 text-neutral-100">
        <div className="max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/30 p-5">
          <div className="text-lg font-semibold">尚未登入</div>
          <div className="mt-2 text-sm text-neutral-300">請從首頁選擇「一般監看」並輸入密碼後進入。</div>
          <button
            className="mt-4 h-10 rounded-lg bg-neutral-100 px-3 text-sm font-semibold text-neutral-950 hover:bg-white"
            onClick={() => navigate('/')}
          >
            返回首頁
          </button>
        </div>
      </div>
    )
  }

  if (!opsId) {
    return (
      <div className="grid min-h-full place-items-center bg-neutral-950 p-6 text-neutral-100">
        <div className="max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/30 p-5">
          <div className="text-lg font-semibold">缺少會議碼</div>
          <div className="mt-2 text-sm text-neutral-300">請從首頁輸入會議碼（OPSxx）後進入。</div>
          <button
            className="mt-4 h-10 rounded-lg bg-neutral-100 px-3 text-sm font-semibold text-neutral-950 hover:bg-white"
            onClick={() => navigate('/')}
          >
            返回首頁
          </button>
        </div>
      </div>
    )
  }

  if (gate.status === 'auth' || gate.status === 'issuing') {
    return (
      <div className="relative h-full w-full bg-neutral-950 text-neutral-100">
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/30 p-5 text-center">
            <div className="text-lg font-semibold">正在取得入場憑證...</div>
            <div className="mt-2 text-sm text-neutral-300">正在向伺服器驗票並鎖定名額（25 MAU）。</div>
          </div>
        </div>
      </div>
    )
  }

  if (gate.status === 'error') {
    return (
      <div className="relative h-full w-full bg-neutral-950 text-neutral-100">
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="max-w-md rounded-2xl border border-red-500/30 bg-red-950/30 p-5">
            <div className="text-lg font-semibold text-red-100">入場失敗</div>
            <div className="mt-2 text-sm text-red-200 break-words">{gate.error || '無法取得入場 Token。'}</div>
            <button
              className="mt-4 h-10 w-full rounded-lg bg-neutral-100 px-3 text-sm font-semibold text-neutral-950 hover:bg-white"
              onClick={() => navigate('/')}
            >
              返回首頁
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!showProgram && confState.lobby.status === 'off') {
    return (
      <div className="relative h-full w-full bg-neutral-950">
        <div className="absolute inset-0 grid place-items-center">
          <img
            src="/vite-full-white.svg"
            alt="LiveOPS"
            className="w-504 max-w-[90vw] opacity-90 md:w-72"
            draggable={false}
          />
        </div>
      </div>
    )
  }

  // --- Main Render ---

  return (
    <div className="relative h-full w-full bg-neutral-950 text-neutral-100">
      {/* Connection status */}
      <div className="pointer-events-none absolute left-3 bottom-4 z-30 hidden max-w-[560px] rounded-2xl border border-neutral-800 bg-neutral-950/70 px-3 py-2 text-[11px] text-neutral-200 backdrop-blur md:block">
        <div className="flex items-center gap-2">
          <span className="font-mono">Jitsi</span>
          <span className={confState.status === 'joined' ? 'text-emerald-200' : confState.status === 'error' ? 'text-rose-200' : 'text-amber-200'}>
            ● {confState.status}
          </span>
          <span className="mx-2 text-neutral-700">/</span>
          <span className="font-mono">{sync.mode}</span>
          {sync.mode === 'local' ? (
            <span className="text-amber-200">本機</span>
          ) : (
            <span className={sync.connected ? 'text-emerald-200' : 'text-amber-200'}>
              {sync.connected ? '已連線' : '連線中'}
            </span>
          )}
          <span className="mx-2 text-neutral-700">/</span>
          <span className="font-mono">Gate</span>
          <span className={gate.status === 'ready' ? 'text-emerald-200' : 'text-amber-200'}>
            ● {gate.status}
          </span>
        </div>
        {confState.error ? <div className="mt-1 text-neutral-300">{confState.error}</div> : null}
        {sync.error ? <div className="mt-1 text-neutral-300">{sync.error}</div> : null}
        {gate.error ? <div className="mt-1 text-neutral-300">{gate.error}</div> : null}
      </div>

      {(confState.lobby.status === 'joining' || confState.lobby.status === 'waiting') && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-neutral-950/80 backdrop-blur">
          <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 text-center">
            <div className="text-lg font-semibold">導播確認身分中...</div>
            <div className="mt-2 text-sm text-neutral-300">
              {confState.lobby.message || '你已進入等候室，請稍候導播放行。'}
            </div>
            <div className="mt-5 flex justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-200" />
            </div>
          </div>
        </div>
      )}

      {confState.lobby.status === 'denied' && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-neutral-950/80 backdrop-blur">
          <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 text-center">
            <div className="text-lg font-semibold">無法加入會議</div>
            <div className="mt-2 text-sm text-neutral-300">{confState.lobby.message || '導播拒絕加入。'}</div>
            <button
              className="mt-5 h-10 rounded-lg bg-neutral-100 px-4 text-sm font-semibold text-neutral-950 hover:bg-white"
              onClick={() => navigate('/')}
            >
              返回首頁
            </button>
          </div>
        </div>
      )}

      {/* remote audio renderers */}
      <div className="fixed left-0 top-0 h-px w-px overflow-hidden opacity-0">
        {allRemoteAudios.map((a) => (
          <TrackAudio key={a.id} track={a.track} enabled={listenEnabled} />
        ))}
      </div>

      {/* Top-left controls */}
      <div className="pointer-events-none absolute left-3 top-3 z-20 flex gap-2">
        <button
          className="pointer-events-auto h-9 rounded-xl border border-neutral-700 bg-neutral-950/60 px-3 text-xs font-semibold backdrop-blur hover:border-neutral-500"
          onClick={() => navigate('/')}
        >
          返回
        </button>
        <button
          className="pointer-events-auto h-9 rounded-xl border border-neutral-700 bg-neutral-950/60 px-3 text-xs font-semibold backdrop-blur hover:border-neutral-500"
          onClick={() => {
            clearAuth()
            navigate('/', { replace: true })
          }}
        >
          登出
        </button>
        <div className="pointer-events-none hidden items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950/60 px-3 text-[11px] text-neutral-200 backdrop-blur md:flex">
          <span className="font-mono">{sync.mode}</span>
          {sync.mode === 'local' ? (
            <span className="text-amber-200">本機</span>
          ) : (
            <span className={sync.connected ? 'text-emerald-200' : 'text-amber-200'}>
              {sync.connected ? '已連線' : '連線中'}
            </span>
          )}
        </div>
      </div>

      <Split
        className="flex h-full w-full"
        direction={isMobile ? 'vertical' : 'horizontal'}
        sizes={[55, 45]}
        minSize={160}
        gutterSize={8}
        gutter={(_index, direction) => makeGutter(direction)}
      >
        {/* Left: time + MTV + marquee */}
        <div className="flex h-full w-full flex-col gap-3 p-3">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3 text-center">
            <div className="text-xs text-neutral-400">時間區</div>
            <div className="mt-1 font-mono text-2xl font-semibold">{now}</div>
          </div>

          <div className="relative flex-1 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/30">
            <div className="absolute left-3 top-3 z-10 rounded-xl border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-200 backdrop-blur">
              <div className="font-semibold">MTV 組</div>
              <div className="text-neutral-300">{mtvSlot?.title ?? '（未指派）'}</div>
            </div>

            {showProgram ? (
              <VideoTile
                title={mtvSlot?.title ?? 'MTV'}
                track={mtvRemote?.videoTrack ?? null}
                fullscreen={fullscreenKey === 'mtv'}
                onFullscreen={() => setFullscreenKey((k) => (k ? null : 'mtv'))}
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-sm text-neutral-400">
                LiveOPS準備中...（已加入通話，可先測試）
              </div>
            )}

            {fullscreenKey === 'mtv' ? (
              <button
                className="absolute right-4 top-4 z-50 h-10 rounded-xl border border-neutral-700 bg-neutral-950/70 px-3 text-sm font-semibold backdrop-blur hover:border-neutral-500"
                onClick={() => setFullscreenKey(null)}
              >
                退出全螢幕
              </button>
            ) : null}
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30">
            <PageDots count={Math.max(1, state.routing.mtv.length)} active={mtvPage} onSelect={(i) => setMtvPage(i)} />
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
            <div className="text-center text-sm font-semibold">跑馬燈等資訊區</div>
            <div className="mt-2 h-8 overflow-hidden">
              {state.marquee.text ? (
                <div className="whitespace-nowrap text-sm text-neutral-100">
                  <div className="inline-block animate-marquee">{state.marquee.text}</div>
                </div>
              ) : (
                <div className="text-sm text-neutral-500">（無）</div>
              )}
            </div>
          </div>
        </div>

        {/* Right: source grid */}
        <div className="flex h-full w-full flex-col gap-3 p-3">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3 text-center">
            <div className="text-sm font-semibold text-rose-200">Source 組</div>
            <div className="text-xs text-neutral-400">點擊任一格可放大至全螢幕</div>
          </div>

          <div className="grid flex-1 grid-cols-2 gap-3 overflow-hidden">
            {visibleSourceSlots.map((slot, idx) => {
              const isFs = fullscreenKey === `src:${idx}`
              const remote = sourceRemotes[idx]
              return (
                <div key={idx} className={isFs ? '' : 'overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/30'}>
                  <div className="relative h-full w-full">
                    <VideoTile
                      title={slot.title || '（未命名）'}
                      track={remote?.videoTrack ?? null}
                      fullscreen={isFs}
                      onFullscreen={() => setFullscreenKey((k) => (k ? null : `src:${idx}`))}
                    />
                    {isFs ? (
                      <button
                        className="absolute right-4 top-4 z-50 h-10 rounded-xl border border-neutral-700 bg-neutral-950/70 px-3 text-sm font-semibold backdrop-blur hover:border-neutral-500"
                        onClick={() => setFullscreenKey(null)}
                      >
                        退出全螢幕
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30">
            <PageDots count={totalSourcePages} active={sourcePage} onSelect={(i) => setSourcePage(i)} />
          </div>
        </div>
      </Split>

      {/* Audio bar */}
      <div className="absolute bottom-4 right-4 z-30">
        <div className="flex items-end justify-end gap-2">
          {audioPanelOpen ? (
            <div className="w-72 rounded-2xl border border-neutral-800 bg-neutral-950/80 p-3 text-sm text-neutral-100 backdrop-blur">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold">通話控制</div>
                <button
                  className="rounded-lg border border-neutral-700 bg-neutral-900/30 px-2 py-1 text-xs hover:border-neutral-500"
                  onClick={() => setAudioPanelOpen(false)}
                >
                  收起
                </button>
              </div>

              <div className="grid gap-2">
                <button
                  className="h-10 rounded-xl border border-neutral-700 bg-neutral-900/30 px-3 font-semibold hover:border-neutral-500"
                  onClick={() => setListenEnabled((v) => !v)}
                >
                  {listenEnabled ? '收聽：開（播放所有人音訊）' : '收聽：關（全靜音）'}
                </button>

                <button
                  className="h-10 rounded-xl bg-neutral-100 px-3 font-semibold text-neutral-950 hover:bg-white"
                  onClick={() => api.toggleMic()}
                >
                  {confState.micMuted ? '麥克風：關（點我開啟）' : '麥克風：開（點我靜音）'}
                </button>

                <div className="text-xs text-neutral-400">
                  連線狀態：{confState.status === 'joined' ? '已加入' : confState.status}
                  {confState.error ? `（${confState.error}）` : ''}
                  <span className="ml-2 text-neutral-500">來源數：{confState.remotes.length}</span>
                  <div className="mt-1 text-[11px] text-neutral-500">房間：{room}</div>
                </div>
              </div>
            </div>
          ) : null}

          <button
            className="grid h-14 w-14 place-items-center rounded-full border border-neutral-700 bg-neutral-950/70 text-sm font-semibold backdrop-blur hover:border-neutral-500"
            onClick={() => setAudioPanelOpen((v) => !v)}
            title="通話控制"
          >
            音
          </button>
        </div>
      </div>
    </div>
  )
}
