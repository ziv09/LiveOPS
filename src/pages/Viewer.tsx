import dayjs from 'dayjs'
import { useEffect, useRef, useState } from 'react'
import Split from 'react-split'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { clearAuth, isAuthed } from '../auth/auth'
import { JitsiPlayer } from '../components/JitsiPlayer'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { focusParticipant, setAllParticipantVolume } from '../jitsi/jitsiHelpers'
import { useSignal } from '../signal/useSignal'
import type { RoutingSourceV1 } from '../signal/types'

type ParticipantInfo = { participantId: string; displayName?: string }

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

function resolveSource(
  source: RoutingSourceV1,
  participants: ParticipantInfo[],
): string | null {
  if (source.type === 'none') return null
  if (source.type === 'participantName') {
    const target = source.name.trim()
    if (!target) return null
    const hit = participants.find((p) => (p.displayName ?? '').trim() === target)
    return hit?.participantId ?? null
  }
  return null
}

function VideoTile(props: {
  room: string
  clientName: string
  title: string
  targetParticipantId: string | null
  onFullscreen: () => void
  fullscreen: boolean
}) {
  const apiRef = useRef<any | null>(null)
  const latestTarget = useRef<string | null>(props.targetParticipantId)

  useEffect(() => {
    latestTarget.current = props.targetParticipantId
    focusParticipant(apiRef.current, props.targetParticipantId)
  }, [props.targetParticipantId])

  return (
    <div
      className={
        props.fullscreen
          ? 'fixed inset-0 z-50 bg-neutral-950'
          : 'relative h-full w-full bg-neutral-950'
      }
    >
      {props.targetParticipantId ? (
        <JitsiPlayer
          room={props.room}
          displayName={props.clientName}
          onApi={(api) => {
            apiRef.current = api
            if (!api) return
            setAllParticipantVolume(api, 0)
            focusParticipant(api, latestTarget.current)
          }}
          configOverwrite={{
            startWithAudioMuted: true,
            startWithVideoMuted: true,
            disableInitialGUM: true,
            constraints: { video: false, audio: false },
            disableTileView: true,
            prejoinPageEnabled: false,
            prejoinConfig: { enabled: false },
            disableDeepLinking: true,
            startConferenceOnEnter: true,
            requireDisplayName: false,
          }}
          interfaceConfigOverwrite={{
            TOOLBAR_BUTTONS: [],
            SETTINGS_SECTIONS: [],
            FILM_STRIP_MAX_HEIGHT: 0,
            VERTICAL_FILMSTRIP: false,
          }}
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-sm text-neutral-600">（未指派）</div>
      )}

      <button
        className="absolute inset-0 z-10"
        onClick={props.onFullscreen}
        aria-label="放大顯示"
      />

      <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-xl border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-200 backdrop-blur">
        <div className="font-semibold">{props.title}</div>
      </div>
    </div>
  )
}

export function Viewer() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const opsId = (searchParams.get('ops') ?? '').trim().toLowerCase()
  const rawName = (searchParams.get('name') ?? '').trim() || '一般'
  const name = rawName.endsWith('_監看') ? rawName : `${rawName}_監看`
  const authed = isAuthed('viewer')

  const isMobile = useMediaQuery('(max-width: 768px)')
  const { state } = useSignal()

  const [now, setNow] = useState(() => dayjs().format('HH:mm:ss'))
  const [micMuted, setMicMuted] = useState(true)
  const [listenEnabled, setListenEnabled] = useState(false)
  const [audioInputs, setAudioInputs] = useState<Array<{ deviceId: string; label: string }>>([])
  const [selectedAudioInput, setSelectedAudioInput] = useState<string>('')
  const [audioPanelOpen, setAudioPanelOpen] = useState(false)
  const intercomApiRef = useRef<any | null>(null)

  const [participants, setParticipants] = useState<ParticipantInfo[]>([])

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

  const refreshRoster = async () => {
    const api = intercomApiRef.current
    if (!api) return
    try {
      const list: ParticipantInfo[] =
        (await api.getParticipantsInfo?.()) ??
        ((await api.getParticipants?.()) ?? []).map((id: string) => ({ participantId: id }))
      setParticipants(Array.isArray(list) ? list : [])
    } catch {
      setParticipants([])
    }
  }

  useEffect(() => {
    const t = window.setInterval(() => refreshRoster(), 2000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!audioPanelOpen) return
    ;(async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices()
        const inputs = list
          .filter((d) => d.kind === 'audioinput')
          .map((d) => ({ deviceId: d.deviceId, label: d.label }))
        setAudioInputs(inputs)
        if (!selectedAudioInput && inputs[0]?.deviceId) setSelectedAudioInput(inputs[0].deviceId)
      } catch {
        setAudioInputs([])
      }
    })()
  }, [audioPanelOpen, selectedAudioInput])

  const totalSourcePages = Math.max(1, Math.ceil(state.routing.source.length / pageSize))
  useEffect(() => setSourcePage((p) => Math.min(p, totalSourcePages - 1)), [totalSourcePages])

  useEffect(() => setMtvPage((p) => Math.min(p, Math.max(0, state.routing.mtv.length - 1))), [
    state.routing.mtv.length,
  ])

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
          <div className="mt-2 text-sm text-neutral-300">請從首頁輸入會議碼（OPSxx）後再進入監看端。</div>
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

  const showProgram = state.conference.started

  const mtvSlot = state.routing.mtv[mtvPage] ?? state.routing.mtv[0]
  const mtvParticipantId = showProgram && mtvSlot ? resolveSource(mtvSlot.source, participants) : null

  const pageStart = sourcePage * pageSize
  const visibleSourceSlots = state.routing.source.slice(pageStart, pageStart + pageSize)
  const sourceParticipantIds = showProgram ? visibleSourceSlots.map((s) => resolveSource(s.source, participants)) : []

  return (
    <div className="relative h-full w-full bg-neutral-950 text-neutral-100">
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
      </div>

      {/* Intercom client (main room) */}
      <div className="fixed left-0 top-0 h-px w-px overflow-hidden opacity-0">
        <JitsiPlayer
          room={state.session.room}
          displayName={`${name}-Intercom`}
          hidden
          onApi={(api) => {
            intercomApiRef.current = api
            if (!api) return
            setMicMuted(true)
            setAllParticipantVolume(api, 0)
            api.addListener?.('audioMuteStatusChanged', (e: any) => setMicMuted(!!e?.muted))
            api.addListener?.('videoConferenceJoined', refreshRoster)
            api.addListener?.('participantJoined', refreshRoster)
            api.addListener?.('participantLeft', refreshRoster)
            api.addListener?.('participantUpdated', refreshRoster)
            try {
              api.executeCommand?.('toggleVideo')
            } catch {
              // noop
            }
          }}
          configOverwrite={{
            startWithAudioMuted: true,
            startWithVideoMuted: true,
            disableInitialGUM: true,
            prejoinPageEnabled: false,
            startConferenceOnEnter: true,
            requireDisplayName: false,
            prejoinConfig: { enabled: false },
          }}
          interfaceConfigOverwrite={{
            TOOLBAR_BUTTONS: [],
          }}
        />
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
              <div className="text-neutral-300">{mtvSlot?.title ?? '（未命名）'}</div>
            </div>

            {showProgram ? (
              <VideoTile
                room={state.session.room}
                clientName={`${name}-MTV`}
                title={mtvSlot?.title ?? 'MTV'}
                targetParticipantId={mtvParticipantId}
                fullscreen={fullscreenKey === 'mtv'}
                onFullscreen={() => setFullscreenKey((k) => (k ? null : 'mtv'))}
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-sm text-neutral-400">
                LiveOPS準備中...（等待控制端開播）
              </div>
            )}

            {fullscreenKey === 'mtv' ? (
              <button
                className="absolute right-4 top-4 z-50 h-10 rounded-xl border border-neutral-700 bg-neutral-950/70 px-3 text-sm font-semibold backdrop-blur hover:border-neutral-500"
                onClick={() => setFullscreenKey(null)}
              >
                關閉全螢幕
              </button>
            ) : null}
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30">
            <PageDots
              count={Math.max(1, state.routing.mtv.length)}
              active={mtvPage}
              onSelect={(i) => setMtvPage(i)}
            />
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
            <div className="text-xl font-semibold text-red-300">Source 組</div>
            <div className="mt-1 text-xs text-neutral-400">點擊任一格可放滿全螢幕</div>
          </div>

          <div className="grid flex-1 grid-cols-2 grid-rows-4 gap-2">
            {visibleSourceSlots.map((slot, i) => {
              const pid = showProgram ? sourceParticipantIds[i] ?? null : null
              const key = `src:${pageStart + i}`
              const isFs = fullscreenKey === key
              const hidden = fullscreenKey !== null && !isFs
              return (
                <div
                  key={key}
                  className={
                    hidden
                      ? 'hidden'
                      : 'relative overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/30'
                  }
                >
                  {showProgram ? (
                    <VideoTile
                      room={state.session.room}
                      clientName={`${name}-SRC-${pageStart + i}`}
                      title={slot.title || `名稱 ${pageStart + i + 1}`}
                      targetParticipantId={pid}
                      fullscreen={isFs}
                      onFullscreen={() => setFullscreenKey((k) => (k === key ? null : key))}
                    />
                  ) : (
                    <button
                      className="absolute inset-0 grid place-items-center text-sm text-neutral-600"
                      onClick={() => undefined}
                      aria-label="等待開播"
                    >
                      （待機）
                    </button>
                  )}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 border-t border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-200 backdrop-blur">
                    名稱：{slot.title || '（未命名）'}
                  </div>
                  {isFs ? (
                    <button
                      className="absolute right-4 top-4 z-50 h-10 rounded-xl border border-neutral-700 bg-neutral-950/70 px-3 text-sm font-semibold backdrop-blur hover:border-neutral-500"
                      onClick={() => setFullscreenKey(null)}
                    >
                      關閉全螢幕
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30">
            <PageDots count={totalSourcePages} active={sourcePage} onSelect={(i) => setSourcePage(i)} />
          </div>
        </div>
      </Split>

      {/* Intercom button */}
      <div className="absolute bottom-4 right-4 z-30">
        <div className="flex items-end justify-end gap-2">
          {audioPanelOpen ? (
            <div className="w-72 rounded-2xl border border-neutral-800 bg-neutral-950/80 p-3 text-sm text-neutral-100 backdrop-blur">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold">音訊控制</div>
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
                  onClick={() => {
                    setListenEnabled((v) => {
                      const next = !v
                      setAllParticipantVolume(intercomApiRef.current, next ? 1 : 0)
                      return next
                    })
                  }}
                >
                  {listenEnabled ? '收聽：開（點擊靜音）' : '收聽：關（點擊開啟）'}
                </button>

                <button
                  className="h-10 rounded-xl bg-neutral-100 px-3 font-semibold text-neutral-950 hover:bg-white"
                  onClick={() => intercomApiRef.current?.executeCommand?.('toggleAudio')}
                >
                  {micMuted ? '通話麥克風：關（點擊開啟）' : '通話麥克風：開（點擊靜音）'}
                </button>

                <button
                  className="h-10 rounded-xl border border-neutral-700 bg-neutral-900/30 px-3 font-semibold hover:border-neutral-500"
                  onClick={async () => {
                    try {
                      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
                      for (const t of stream.getTracks()) t.stop()
                    } catch {
                      // noop
                    }
                    try {
                      const list = await navigator.mediaDevices.enumerateDevices()
                      const inputs = list
                        .filter((d) => d.kind === 'audioinput')
                        .map((d) => ({ deviceId: d.deviceId, label: d.label }))
                      setAudioInputs(inputs)
                      if (!selectedAudioInput && inputs[0]?.deviceId) setSelectedAudioInput(inputs[0].deviceId)
                    } catch {
                      setAudioInputs([])
                    }
                  }}
                >
                  更新音訊裝置清單
                </button>

                <label className="grid gap-1">
                  <div className="text-xs text-neutral-300">麥克風來源</div>
                  <select
                    value={selectedAudioInput}
                    onChange={(e) => {
                      const id = e.target.value
                      setSelectedAudioInput(id)
                      intercomApiRef.current?.setAudioInputDevice?.(id).catch?.(() => {})
                    }}
                    className="h-10 rounded-lg border border-neutral-700 bg-neutral-950/40 px-3 text-sm outline-none focus:border-neutral-500"
                  >
                    {audioInputs.length === 0 ? (
                      <option value="">（尚未取得）</option>
                    ) : (
                      audioInputs.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || d.deviceId}
                        </option>
                      ))
                    )}
                  </select>
                </label>
              </div>
            </div>
          ) : null}

          <button
            className="grid h-14 w-14 place-items-center rounded-full border border-neutral-700 bg-neutral-950/70 text-sm font-semibold backdrop-blur hover:border-neutral-500"
            onClick={() => setAudioPanelOpen((v) => !v)}
            title="音訊控制"
          >
            音
          </button>
        </div>
      </div>

      {!showProgram ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 border-t border-neutral-800 bg-neutral-950/70 py-3 text-center text-sm text-neutral-200 backdrop-blur">
          LiveOPS準備中...（你已進入會議室，可先測試通話；等待控制端按「啟動會議」後顯示畫面）
        </div>
      ) : null}
    </div>
  )
}
