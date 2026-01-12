import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { QRCodeCanvas } from 'qrcode.react'
import { clearAuth, isAuthed } from '../auth/auth'
import { clearGoogleUser, readGoogleUser } from '../auth/googleAuth'
import { JitsiPlayer } from '../components/JitsiPlayer'
import { GoogleSignInButton } from '../components/GoogleSignInButton'
import { setAllParticipantVolume } from '../jitsi/jitsiHelpers'
import { useSignal } from '../signal/useSignal'
import type { RoutingSlotV1, RoutingSourceV1 } from '../signal/types'
import { createCollectorToken } from '../utils/token'

type ParticipantInfo = { participantId: string; displayName?: string }
type VideoDevice = { deviceId: string; label: string }

function getNextOpsId() {
  const key = 'liveops.ops.counter'
  const n = Math.max(1, Number.parseInt(localStorage.getItem(key) ?? '1', 10) || 1)
  const next = `OPS${String(n).padStart(2, '0')}`
  return { next, commit: () => localStorage.setItem(key, String(n + 1)) }
}

function encodeSource(source: RoutingSourceV1): string {
  if (source.type === 'none') return 'none'
  if (source.type === 'localDevice') return `dev:${source.deviceId}`
  if (source.type === 'collectorParticipant') return `pid:${source.participantId}`
  return 'none'
}

function decodeSource(value: string): RoutingSourceV1 {
  if (!value || value === 'none') return { type: 'none' }
  if (value.startsWith('dev:')) return { type: 'localDevice', deviceId: value.slice(4) }
  if (value.startsWith('pid:')) return { type: 'collectorParticipant', participantId: value.slice(4) }
  return { type: 'none' }
}

function updateSlot(slots: RoutingSlotV1[], index: number, patch: Partial<RoutingSlotV1>) {
  const next = [...slots]
  next[index] = { ...next[index], ...patch }
  return next
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr))
}

function isViewerClientName(name: string) {
  return name.includes('-Intercom') || name.includes('-MTV') || name.includes('-SRC-') || name.includes('-Roster')
}

function LocalDeviceCollectors(props: {
  enabled: boolean
  room: string
  devices: VideoDevice[]
  selectedDeviceIds: string[]
}) {
  const list = useMemo(() => {
    const devicesById = new Map(props.devices.map((d) => [d.deviceId, d]))
    return uniq(props.selectedDeviceIds)
      .filter((id) => id)
      .map((id) => ({ deviceId: id, label: devicesById.get(id)?.label ?? '' }))
  }, [props.devices, props.selectedDeviceIds])

  if (!props.enabled) return null
  if (list.length === 0) return null

  return (
    <div className="fixed left-0 top-0 h-px w-px overflow-hidden opacity-0">
      {list.map((d) => (
        <JitsiPlayer
          key={d.deviceId}
          room={props.room}
          displayName={`DEV:${d.deviceId} ${d.label || '本機來源'}`}
          hidden
          onApi={(api) => {
            if (!api) return
            setAllParticipantVolume(api, 0)
            api.setVideoInputDevice?.(d.deviceId).catch?.(() => {})
          }}
          configOverwrite={{
            startWithAudioMuted: true,
            startWithVideoMuted: false,
            prejoinPageEnabled: false,
            startConferenceOnEnter: true,
            disableDeepLinking: true,
          }}
          interfaceConfigOverwrite={{
            TOOLBAR_BUTTONS: [],
          }}
        />
      ))}
    </div>
  )
}

export function Admin() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const opsId = (searchParams.get('ops') ?? '').trim().toUpperCase()
  const authed = isAuthed('admin')

  const { state, setRouting, setMarquee, setCollectorToken, setConferenceStarted, setHostBoundEmail } = useSignal()

  const [opsDraft, setOpsDraft] = useState(() => getNextOpsId().next)
  const [marqueeText, setMarqueeText] = useState(state.marquee.text)
  const [shareBaseUrl, setShareBaseUrl] = useState(() => window.location.origin)
  const [googleRefresh, setGoogleRefresh] = useState(0)
  const googleUser = useMemo(() => readGoogleUser(), [googleRefresh])
  const [hostError, setHostError] = useState<string | null>(null)
  const [hostMountKey, setHostMountKey] = useState(0)
  const [hostJoined, setHostJoined] = useState(false)
  const [hostIsModerator, setHostIsModerator] = useState<boolean | null>(null)
  const [authPopupOpen, setAuthPopupOpen] = useState(false)
  const [authHint, setAuthHint] = useState<string | null>(null)

  const [videoDevices, setVideoDevices] = useState<VideoDevice[]>([])
  const [participants, setParticipants] = useState<ParticipantInfo[]>([])

  const roomApiRef = useRef<any | null>(null)
  const hostParticipantIdRef = useRef<string | null>(null)

  useEffect(() => setMarqueeText(state.marquee.text), [state.marquee.text])
  useEffect(() => setHostError(null), [state.host.boundGoogleEmail, googleUser?.email])

  const openJitsiAuthPopup = () => {
    const domain = ((import.meta.env.VITE_JITSI_DOMAIN as string | undefined) ?? 'meet.jit.si')
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '')
    const room = encodeURIComponent(state.session.room)
    const url = `https://${domain}/${room}`

    const w = 420
    const h = 720
    const y = window.screenY + Math.max(0, (window.outerHeight - h) / 2)
    const x = window.screenX + Math.max(0, (window.outerWidth - w) / 2)
    const features = `popup=yes,width=${w},height=${h},left=${Math.round(x)},top=${Math.round(y)}`

    const win = window.open(url, 'liveops-jitsi-auth', features)
    if (!win) {
      setAuthHint('無法開啟認證視窗：請允許瀏覽器彈出視窗（popup）。')
      return
    }

    setAuthHint(null)
    setAuthPopupOpen(true)

    const timer = window.setInterval(() => {
      if (win.closed) {
        window.clearInterval(timer)
        setAuthPopupOpen(false)
        setHostJoined(false)
        setHostIsModerator(null)
        hostParticipantIdRef.current = null
        setHostMountKey((k) => k + 1)
        setAuthHint(
          '已關閉認證視窗：已嘗試重連主持人。若仍卡「等待主持人」，請在瀏覽器允許 meet.jit.si 第三方 Cookie 後再試。',
        )
      }
    }, 500)
  }

  const refreshVideoDevices = async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      const v = list
        .filter((d) => d.kind === 'videoinput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label }))
      setVideoDevices(v)
    } catch {
      setVideoDevices([])
    }
  }

  useEffect(() => {
    if (!opsId) return
    refreshVideoDevices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opsId])

  const refreshParticipants = async () => {
    const api = roomApiRef.current
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

  const meetingCode = opsId || state.session.opsId

  const collectorQrUrl = useMemo(() => {
    const token = state.collector.token
    if (!token) return null
    return `${shareBaseUrl}/collector?token=${token}`
  }, [shareBaseUrl, state.collector.token])

  const selectedLocalDeviceIds = useMemo(() => {
    const all = [...state.routing.mtv, ...state.routing.source]
      .map((s) => (s.source.type === 'localDevice' ? s.source.deviceId : ''))
      .filter(Boolean)
    return uniq(all)
  }, [state.routing.mtv, state.routing.source])

  const remoteCandidates = useMemo(() => {
    return participants.filter((p) => {
      const name = p.displayName ?? ''
      if (!name) return true
      if (name === 'OPS_MASTER') return false
      if (name.startsWith('DEV:')) return false
      if (isViewerClientName(name)) return false
      return true
    })
  }, [participants])

  if (!authed) {
    return (
      <div className="grid min-h-full place-items-center bg-neutral-950 p-6 text-neutral-100">
        <div className="max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/30 p-5">
          <div className="text-lg font-semibold">尚未登入</div>
          <div className="mt-2 text-sm text-neutral-300">請從首頁選擇「控制端」並輸入密碼後進入。</div>
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
      <div className="min-h-full bg-neutral-950 text-neutral-100">
        <div className="mx-auto max-w-3xl p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-xl font-semibold">控制端（Admin）</div>
              <div className="text-sm text-neutral-300">先建立會議室（OPSxx），再進入設定畫面。</div>
            </div>
            <button
              className="h-10 rounded-lg border border-neutral-800 bg-neutral-900/30 px-3 text-sm hover:border-neutral-600"
              onClick={() => {
                clearAuth()
                navigate('/', { replace: true })
              }}
            >
              登出
            </button>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-5">
            <label className="grid gap-2">
              <div className="text-sm text-neutral-200">會議碼（OPSxx）</div>
              <input
                value={opsDraft}
                onChange={(e) => setOpsDraft(e.target.value.toUpperCase())}
                className="h-11 rounded-lg border border-neutral-700 bg-neutral-950/50 px-3 uppercase outline-none ring-0 focus:border-neutral-500"
                placeholder="OPS01"
              />
            </label>
            <button
              className="mt-4 h-11 w-full rounded-lg bg-neutral-100 text-sm font-semibold text-neutral-950 hover:bg-white"
              onClick={() => {
                const trimmed = (opsDraft || '').trim().toUpperCase()
                if (!trimmed) return
                const counter = getNextOpsId()
                if (trimmed === counter.next) counter.commit()
                setSearchParams({ ops: trimmed })
              }}
            >
              生成並進入設定
            </button>
            <div className="mt-3 text-xs text-neutral-400">
              提示：會議碼會同時用於「一般監看」與「訊號採集」加入。
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xl font-semibold">戰情室控制台（Admin）</div>
            <div className="text-sm text-neutral-300">
              會議碼：<span className="font-mono">{meetingCode}</span>
            </div>
            <div className="text-xs text-neutral-500">
              會議室：<span className="font-mono">{state.session.room}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="h-10 rounded-lg border border-neutral-800 bg-neutral-900/30 px-3 text-sm hover:border-neutral-600"
              onClick={() => navigate('/')}
            >
              返回首頁
            </button>
            <button
              className="h-10 rounded-lg border border-neutral-800 bg-neutral-900/30 px-3 text-sm hover:border-neutral-600"
              onClick={() => {
                clearAuth()
                navigate('/', { replace: true })
              }}
            >
              登出
            </button>
          </div>
        </div>

        <div className="mb-4 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">主持人權限（Google 帳號綁定）</div>
              <div className="mt-1 text-xs text-neutral-400">
                此登入用於 LiveOPS「啟動會議」權限控管；若你使用的 Jitsi 服務也要求主持人登入，仍需在 Jitsi 端完成登入。
              </div>
            </div>
            <div className="flex items-center gap-2">
              {googleUser ? (
                <>
                  <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-xs">
                    <div className="text-neutral-400">已登入</div>
                    <div className="font-mono text-neutral-100">{googleUser.email}</div>
                  </div>
                  <button
                    className="h-10 rounded-lg border border-neutral-700 bg-neutral-900/30 px-3 text-sm font-semibold hover:border-neutral-500"
                    onClick={() => {
                      clearGoogleUser()
                      setGoogleRefresh((n) => n + 1)
                    }}
                  >
                    登出
                  </button>
                </>
              ) : (
                <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-2">
                  <GoogleSignInButton onSignedIn={() => setGoogleRefresh((n) => n + 1)} />
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="text-xs text-neutral-400">
              綁定主持人：{state.host.boundGoogleEmail ? (
                <span className="font-mono text-neutral-100">{state.host.boundGoogleEmail}</span>
              ) : (
                <span className="text-neutral-500">（尚未綁定）</span>
              )}
            </div>
            <button
              className="h-9 rounded-lg border border-neutral-700 bg-neutral-900/30 px-3 text-xs font-semibold hover:border-neutral-500 disabled:opacity-40"
              disabled={!googleUser?.email}
              onClick={() => {
                if (!googleUser?.email) return
                setHostBoundEmail(googleUser.email)
              }}
            >
              綁定目前登入帳號
            </button>
            <button
              className="h-9 rounded-lg border border-neutral-700 bg-neutral-900/30 px-3 text-xs font-semibold hover:border-neutral-500"
              onClick={() => setHostBoundEmail(null)}
            >
              解除綁定
            </button>
            {hostError ? (
              <div className="text-xs text-red-200">{hostError}</div>
            ) : null}
          </div>
        </div>

        <div className="mb-4 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">會議狀態</div>
              <div className="text-xs text-neutral-400">
                {state.conference.started
                  ? '已啟動（採集端/監看端可直接加入）'
                  : '尚未啟動（採集端/監看端會顯示「LiveOPS準備中...」）'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                className={
                  state.conference.started
                    ? 'h-10 rounded-lg border border-neutral-700 bg-neutral-900/30 px-4 text-sm font-semibold text-neutral-100 hover:border-neutral-500'
                    : 'h-10 rounded-lg bg-emerald-300 px-4 text-sm font-semibold text-neutral-950 hover:bg-emerald-200'
                }
                onClick={() => {
                  if (!state.conference.started) {
                    if (!state.host.boundGoogleEmail) {
                      setHostError('請先綁定主持人 Google 帳號後再啟動會議。')
                      return
                    }
                    if (!googleUser?.email) {
                      setHostError('請先以 Google 登入後再啟動會議。')
                      return
                    }
                    if (googleUser.email !== state.host.boundGoogleEmail) {
                      setHostError('目前登入的 Google 帳號不符合已綁定的主持人帳號。')
                      return
                    }
                    setConferenceStarted(true, 'Admin')
                    if (!state.collector.token) setCollectorToken(createCollectorToken({ opsId: meetingCode }))
                    return
                  }
                  setConferenceStarted(false)
                }}
              >
                {state.conference.started ? '結束會議（停止廣播）' : '啟動會議'}
              </button>
              <button
                className="h-10 rounded-lg border border-neutral-700 bg-neutral-900/30 px-4 text-sm font-semibold text-neutral-100 hover:border-neutral-500"
                onClick={openJitsiAuthPopup}
                title="開啟 meet.jit.si 認證視窗，登入後關閉即可回來重連主持人（可能需要允許第三方 Cookie）"
              >
                Jitsi 主持人登入（Google）
              </button>
              <button
                className="h-10 rounded-lg border border-neutral-800 bg-neutral-900/30 px-3 text-sm hover:border-neutral-600"
                onClick={() => setSearchParams({ ops: meetingCode })}
              >
                重新載入
              </button>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-neutral-300">
                主持人連線狀態：
                <span className={hostJoined ? 'ml-1 text-emerald-300' : 'ml-1 text-amber-300'}>
                  ● {hostJoined ? '已入房' : '尚未確認'}
                </span>
                {hostIsModerator === true ? (
                  <span className="ml-2 text-emerald-300">（已取得主持人權限）</span>
                ) : hostIsModerator === false ? (
                  <span className="ml-2 text-amber-300">（尚未取得主持人權限）</span>
                ) : null}
                {authPopupOpen ? <span className="ml-2 text-neutral-400">（認證視窗開啟中…）</span> : null}
              </div>
              <button
                className="h-9 rounded-lg border border-neutral-700 bg-neutral-900/30 px-3 text-xs font-semibold hover:border-neutral-500"
                onClick={() => {
                  setAuthHint('已手動重連主持人。若仍卡「等待主持人」，請先完成 Jitsi 登入或允許第三方 Cookie。')
                  setHostJoined(false)
                  setHostIsModerator(null)
                  hostParticipantIdRef.current = null
                  setHostMountKey((k) => k + 1)
                }}
              >
                重連主持人
              </button>
            </div>
            {authHint ? <div className="mt-2 text-xs text-neutral-300">{authHint}</div> : null}
          </div>

          {state.conference.started ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/30 p-3">
                <div className="mb-2 text-sm font-semibold">採集端加入方式</div>
                <div className="text-xs text-neutral-400">
                  方式 A：輸入會議碼 <span className="font-mono">{meetingCode}</span>
                  <br />
                  方式 B：掃描 QR Code 直接加入採集會議室
                </div>
                <label className="mt-3 grid gap-1">
                  <div className="text-xs text-neutral-400">分享網址（用於 QR Code）</div>
                  <input
                    value={shareBaseUrl}
                    onChange={(e) => setShareBaseUrl(e.target.value.trim())}
                    className="h-10 rounded-lg border border-neutral-700 bg-neutral-950/40 px-3 text-sm outline-none focus:border-neutral-500"
                    placeholder="例如：http://192.168.0.10:5173"
                  />
                </label>
              </div>
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/30 p-3">
                <div className="mb-2 text-sm font-semibold">QR Code</div>
                {collectorQrUrl ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <QRCodeCanvas value={collectorQrUrl} size={160} includeMargin />
                    <div className="min-w-0">
                      <div className="mb-2 text-xs text-neutral-400">連結</div>
                      <div className="break-words font-mono text-[11px] text-neutral-200">{collectorQrUrl}</div>
                      <button
                        className="mt-3 h-9 rounded-lg border border-neutral-700 bg-neutral-900/30 px-3 text-xs hover:border-neutral-500"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(collectorQrUrl)
                          } catch {
                            // noop
                          }
                        }}
                      >
                        複製連結
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-neutral-400">（尚未生成）</div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4 lg:col-span-2">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">路由指派（來源 + 名稱）</div>
                <div className="text-xs text-neutral-400">
                  每個下拉選單會列出「本機影像設備」以及「遠端採集來源」；可重複選取同一設備。
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="h-10 rounded-lg border border-neutral-700 bg-neutral-900/30 px-3 text-sm font-semibold hover:border-neutral-500"
                  onClick={async () => {
                    try {
                      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
                      for (const track of stream.getTracks()) track.stop()
                    } catch {
                      // noop
                    }
                    await refreshVideoDevices()
                  }}
                >
                  取得鏡頭授權 / 更新設備
                </button>
                <button
                  className="h-10 rounded-lg border border-neutral-700 bg-neutral-900/30 px-3 text-sm font-semibold hover:border-neutral-500"
                  onClick={refreshParticipants}
                >
                  更新來源清單
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/30 p-3">
                <div className="mb-2 text-sm font-semibold">MTV 組</div>
                <div className="grid gap-3">
                  {state.routing.mtv.map((slot, idx) => (
                    <div key={idx} className="grid gap-2 rounded-xl border border-neutral-800 bg-neutral-950/20 p-3">
                      <div className="text-xs text-neutral-400">MTV {idx + 1}</div>
                      <label className="grid gap-1">
                        <div className="text-xs text-neutral-300">名稱</div>
                        <input
                          value={slot.title}
                          onChange={(e) => {
                            setRouting({
                              ...state.routing,
                              mtv: updateSlot(state.routing.mtv, idx, { title: e.target.value }),
                            })
                          }}
                          className="h-10 rounded-lg border border-neutral-700 bg-neutral-950/40 px-3 text-sm outline-none focus:border-neutral-500"
                          placeholder="例如：MTV 組"
                        />
                      </label>
                      <label className="grid gap-1">
                        <div className="text-xs text-neutral-300">來源</div>
                        <select
                          value={encodeSource(slot.source)}
                          onChange={(e) => {
                            setRouting({
                              ...state.routing,
                              mtv: updateSlot(state.routing.mtv, idx, { source: decodeSource(e.target.value) }),
                            })
                          }}
                          className="h-10 rounded-lg border border-neutral-700 bg-neutral-950/40 px-3 text-sm outline-none focus:border-neutral-500"
                        >
                          <option value="none">（未指派）</option>
                          <optgroup label="本機影像設備">
                            {videoDevices.map((d) => (
                              <option key={d.deviceId} value={`dev:${d.deviceId}`}>
                                {d.label || d.deviceId}
                              </option>
                            ))}
                          </optgroup>
                  <optgroup label="遠端採集來源（同一會議室）">
                            {remoteCandidates.map((p) => (
                              <option key={p.participantId} value={`pid:${p.participantId}`}>
                                {p.displayName || p.participantId.slice(0, 10)}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-neutral-800 bg-neutral-950/30 p-3">
                <div className="mb-2 text-sm font-semibold">Source 組（8 格）</div>
                <div className="grid gap-3">
                  {state.routing.source.map((slot, idx) => (
                    <div key={idx} className="grid gap-2 rounded-xl border border-neutral-800 bg-neutral-950/20 p-3">
                      <div className="text-xs text-neutral-400">格 {idx + 1}</div>
                      <label className="grid gap-1">
                        <div className="text-xs text-neutral-300">名稱</div>
                        <input
                          value={slot.title}
                          onChange={(e) => {
                            setRouting({
                              ...state.routing,
                              source: updateSlot(state.routing.source, idx, { title: e.target.value }),
                            })
                          }}
                          className="h-10 rounded-lg border border-neutral-700 bg-neutral-950/40 px-3 text-sm outline-none focus:border-neutral-500"
                          placeholder="例如：Camera A"
                        />
                      </label>
                      <label className="grid gap-1">
                        <div className="text-xs text-neutral-300">來源</div>
                        <select
                          value={encodeSource(slot.source)}
                          onChange={(e) => {
                            setRouting({
                              ...state.routing,
                              source: updateSlot(state.routing.source, idx, { source: decodeSource(e.target.value) }),
                            })
                          }}
                          className="h-10 rounded-lg border border-neutral-700 bg-neutral-950/40 px-3 text-sm outline-none focus:border-neutral-500"
                        >
                          <option value="none">（未指派）</option>
                          <optgroup label="本機影像設備">
                            {videoDevices.map((d) => (
                              <option key={d.deviceId} value={`dev:${d.deviceId}`}>
                                {d.label || d.deviceId}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="遠端採集來源（同一會議室）">
                            {remoteCandidates.map((p) => (
                              <option key={p.participantId} value={`pid:${p.participantId}`}>
                                {p.displayName || p.participantId.slice(0, 10)}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950/30 p-3">
              <div className="mb-2 text-sm font-semibold">跑馬燈控制</div>
              <div className="flex flex-col gap-2 md:flex-row">
                <input
                  value={marqueeText}
                  onChange={(e) => setMarqueeText(e.target.value)}
                  className="h-10 flex-1 rounded-lg border border-neutral-700 bg-neutral-950/40 px-3 text-sm outline-none focus:border-neutral-500"
                  placeholder="輸入要同步顯示的文字"
                />
                <button
                  className="h-10 rounded-lg bg-neutral-100 px-4 text-sm font-semibold text-neutral-950 hover:bg-white"
                  onClick={() => setMarquee(marqueeText)}
                >
                  發送
                </button>
                <button
                  className="h-10 rounded-lg border border-neutral-700 bg-neutral-900/30 px-4 text-sm hover:border-neutral-500"
                  onClick={() => {
                    setMarqueeText('')
                    setMarquee('')
                  }}
                >
                  清除
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4">
            <div className="mb-2 text-sm font-semibold">參與者狀態（同一會議室）</div>
            <div className="text-xs text-neutral-400">這裡會看到已加入會議室的來源清單（含本機設備與遠端採集）。</div>
            <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950/30 p-3 text-sm">
              {participants.length === 0 ? (
                <div className="text-neutral-400">（尚未偵測到來源）</div>
              ) : (
                <ul className="space-y-1">
                  {participants.map((p) => (
                    <li key={p.participantId} className="flex items-center justify-between gap-2">
                      <span className="truncate">{p.displayName || '（未命名）'}</span>
                      <span className="shrink-0 font-mono text-[10px] text-neutral-500">
                        {p.participantId.slice(0, 10)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              className="mt-3 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-900/30 px-3 text-sm font-semibold hover:border-neutral-500 disabled:opacity-40"
              disabled={false}
              onClick={refreshParticipants}
            >
              重新整理來源
            </button>
          </div>
        </div>
      </div>

      {/* 控制端主持人（永遠先入房，避免遠端採集遇到主持人門檻） */}
      <div className="fixed left-0 top-0 h-px w-px overflow-hidden opacity-0">
        <JitsiPlayer
          key={hostMountKey}
          room={state.session.room}
          displayName="OPS_MASTER"
          hidden
          onApi={(api) => {
            roomApiRef.current = api
            hostParticipantIdRef.current = null
            if (!api) {
              setHostJoined(false)
              setHostIsModerator(null)
              return
            }
            setAllParticipantVolume(api, 0)
            const onJoined = (e: any) => {
              hostParticipantIdRef.current = (e?.id as string | undefined) ?? null
              setHostJoined(true)
              setHostIsModerator(null)
              refreshParticipants()
            }
            const onRoleChanged = (e: any) => {
              const localId = hostParticipantIdRef.current
              if (!localId) return
              if (e?.id && e.id !== localId) return
              if (typeof e?.role === 'string') setHostIsModerator(e.role === 'moderator')
            }
            const onLeft = () => {
              hostParticipantIdRef.current = null
              setHostJoined(false)
              setHostIsModerator(null)
            }

            api.addListener?.('videoConferenceJoined', onJoined)
            api.addListener?.('videoConferenceLeft', onLeft)
            api.addListener?.('participantRoleChanged', onRoleChanged)
            api.addListener?.('participantJoined', refreshParticipants)
            api.addListener?.('participantLeft', refreshParticipants)
            api.addListener?.('participantUpdated', refreshParticipants)
          }}
          configOverwrite={{
            startWithAudioMuted: true,
            startWithVideoMuted: true,
            startConferenceOnEnter: true,
            prejoinPageEnabled: false,
            requireDisplayName: false,
            disableInitialGUM: true,
          }}
          interfaceConfigOverwrite={{
            TOOLBAR_BUTTONS: [],
          }}
        />
      </div>

      {/* 本機影像設備採集器（依路由選取自動加入採集會議室） */}
      <LocalDeviceCollectors
        enabled={true}
        room={state.session.room}
        devices={videoDevices}
        selectedDeviceIds={selectedLocalDeviceIds}
      />
    </div>
  )
}
