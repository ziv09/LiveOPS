import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { QRCodeCanvas } from 'qrcode.react'
import { clearAuth, isAuthed } from '../auth/auth'
import { getFirebaseDatabase, getFirebaseFunctions } from '../signal/firebase'
import { onValue, ref } from 'firebase/database'
import { httpsCallable } from 'firebase/functions'
import { useLibJitsiConference } from '../jitsi/useLibJitsiConference'
import { useSignal } from '../signal/useSignal'
import type { RoutingSlotV1, RoutingSourceV1 } from '../signal/types'
import { normalizeOpsId } from '../utils/ops'
import { createCollectorToken } from '../utils/token'
import { getRolePrefixFromDisplayName } from '../utils/roleName'
import { buildJaasSdkRoomName, getJaasAppId, getJaasDomain } from '../jaas/jaasConfig'
import { useJaasGatekeeper } from '../jaas/useJaasGatekeeper'

function getNextOpsId() {
  const key = 'liveops.ops.counter'
  const n = Math.max(1, Number.parseInt(localStorage.getItem(key) ?? '1', 10) || 1)
  const next = `ops${String(n).padStart(2, '0')}`
  return { next, commit: () => localStorage.setItem(key, String(n + 1)) }
}

function encodeSource(source: RoutingSourceV1): string {
  if (source.type === 'none') return 'none'
  if (source.type === 'participantName') return `name:${encodeURIComponent(source.name)}`
  return 'none'
}

function decodeSource(value: string): RoutingSourceV1 {
  if (!value || value === 'none') return { type: 'none' }
  if (value.startsWith('name:')) return { type: 'participantName', name: decodeURIComponent(value.slice(5)) }
  return { type: 'none' }
}

function updateSlot(slots: RoutingSlotV1[], index: number, patch: Partial<RoutingSlotV1>) {
  const next = [...slots]
  next[index] = { ...next[index], ...patch }
  return next
}

function TokenStatusPanel(props: { opsId: string }) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [allocations, setAllocations] = useState<any[]>([])
  const [counts, setCounts] = useState({ total: 0, collector: 0, monitor: 0, crew: 0 })
  const [loading, setLoading] = useState(true)
  const functions = useMemo(() => {
    try {
      return getFirebaseFunctions()
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    const db = getFirebaseDatabase()
    if (!db || !props.opsId) return

    const roomRef = ref(db, `liveops/v2/jaas/rooms/${props.opsId}/state`)
    const unsub = onValue(roomRef, (snap) => {
      setLoading(false)
      const val = snap.val()
      const allocs = val?.allocations ?? {}
      const list = Object.values(allocs).map((a: any) => ({
        ...a,
        lastSeenDate: a.lastSeen ? new Date(a.lastSeen).toLocaleTimeString() : 'N/A',
        isStale: Date.now() - (Number(a.lastSeen) || 0) > 60_000,
      }))
      // Sort: Stale first, then by role, then by name
      list.sort((a, b) => {
        if (a.isStale !== b.isStale) return a.isStale ? -1 : 1
        if (a.role !== b.role) return a.role.localeCompare(b.role)
        return String(a.displayName ?? '').localeCompare(String(b.displayName ?? ''))
      })
      setAllocations(list)

      const c = { total: 0, collector: 0, monitor: 0, crew: 0 }
      for (const a of list) {
        c.total++
        if (a.role === 'collector') c.collector++
        if (a.role === 'monitor') c.monitor++
        if (a.role === 'crew') c.crew++
      }
      setCounts(c)
    })

    return () => unsub()
  }, [props.opsId])

  const handleKick = async (slotId: string) => {
    if (!functions) return
    if (!globalThis.confirm('確定要強制釋放此名額嗎？\n這會將該裝置踢出資料庫配額，但若它仍連線中可能會嘗試重領。')) return
    try {
      const fn = httpsCallable(functions, 'releaseJaasSlot')
      await fn({ ops: props.opsId, slotId })
    } catch (e) {
      window.alert(`釋放失敗：${e}`)
    }
  }

  if (loading) return <div className="p-4 text-sm text-neutral-400">正在載入 Token 狀態...</div>

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <div className="font-semibold text-neutral-200">
          總用量：
          <span className={counts.total >= 25 ? 'text-rose-400' : 'text-emerald-400'}>{counts.total}</span> / 25
        </div>
        <div className="text-neutral-400">
          SRC: {counts.collector}/16 · MON: {counts.monitor}/4 · CREW: {counts.crew}/5
        </div>
      </div>

      <div className="max-h-60 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950/40">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-neutral-900 text-neutral-400">
            <tr>
              <th className="px-3 py-2 font-medium">Slot ID (Role)</th>
              <th className="px-3 py-2 font-medium">Display Name</th>
              <th className="px-3 py-2 font-medium">Last Seen</th>
              <th className="px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800 text-neutral-300">
            {allocations.map((a) => (
              <tr key={a.slotId} className={a.isStale ? 'bg-rose-950/10' : ''}>
                <td className="px-3 py-2 font-mono">
                  {a.slotId}
                  <span className="ml-1 text-neutral-500">({a.role})</span>
                </td>
                <td className="px-3 py-2">{a.displayName}</td>
                <td className="px-3 py-2">
                  <div className={a.isStale ? 'text-rose-400' : 'text-emerald-400'}>
                    {a.lastSeenDate}
                  </div>
                  {a.isStale && <div className="text-[10px] text-rose-500">可能已離線 (Ghost)</div>}
                </td>
                <td className="px-3 py-2">
                  <button
                    className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-[10px] hover:bg-neutral-700 hover:text-white"
                    onClick={() => handleKick(a.slotId)}
                  >
                    釋放
                  </button>
                </td>
              </tr>
            ))}
            {allocations.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-neutral-500">
                  目前無人佔用 Token
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function Admin() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const opsId = normalizeOpsId(searchParams.get('ops') ?? '')
  const authed = isAuthed('admin')

  const { state, sync, setRouting, setMarquee, setCollectorToken, setConferenceStarted } = useSignal()

  const [opsDraft, setOpsDraft] = useState(() => getNextOpsId().next)
  const [marqueeText, setMarqueeText] = useState(state.marquee.text)
  const [shareBaseUrl, setShareBaseUrl] = useState(() => window.location.origin)
  useEffect(() => setMarqueeText(state.marquee.text), [state.marquee.text])

  // LiveOPS 目前只支援 8x8 JaaS（8x8.vc + JWT）。

  const meetingCode = opsId || normalizeOpsId(state.session.opsId)
  const opsRoom = useMemo(() => normalizeOpsId(state.session.room || meetingCode), [meetingCode, state.session.room])
  const room = useMemo(() => buildJaasSdkRoomName(opsRoom), [opsRoom])

  const adminDisplayName = 'mon.Admin'
  const gate = useJaasGatekeeper({
    opsId: opsRoom,
    displayName: adminDisplayName,
    requestedRole: 'admin',
    enabled: !!opsId && authed,
  })

  const openJitsiAuthPopup = () => {
    const domain = getJaasDomain()
    const appId = getJaasAppId()
    const base = appId ? `https://${domain}/${appId}/${encodeURIComponent(opsRoom || 'ops01')}` : `https://${domain}`
    const url = gate.token ? `${base}?jwt=${encodeURIComponent(gate.token)}` : base
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const { state: adminConfState, api: adminConfApi } = useLibJitsiConference({
    room,
    displayName: adminDisplayName,
    jwt: gate.token,
    enabled: !!opsId && authed && gate.status === 'ready',
    mode: 'host',
    enableLocalAudio: false,
    lobby: { enabled: false, autoApprove: true },
  })

  const collectorQrUrl = useMemo(() => {
    const token = state.collector.token
    if (!token) return null
    return `${shareBaseUrl}/collector?token=${token}`
  }, [shareBaseUrl, state.collector.token])

  const sourceCandidates = useMemo(() => {
    return adminConfState.remotes
      .map((r) => ({ participantId: r.id, displayName: (r.name ?? '').trim() }))
      .filter((p) => {
        const name = p.displayName ?? ''
        if (!name) return false
        return getRolePrefixFromDisplayName(name) === 'src.'
      })
  }, [adminConfState.remotes])

  const candidateNameCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of sourceCandidates) {
      const n = (p.displayName ?? '').trim()
      if (!n) continue
      m.set(n, (m.get(n) ?? 0) + 1)
    }
    return m
  }, [sourceCandidates])

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
              <div className="text-sm text-neutral-200">會議碼（opsxx）</div>
              <input
                value={opsDraft}
                onChange={(e) => setOpsDraft(normalizeOpsId(e.target.value))}
                className="h-11 rounded-lg border border-neutral-700 bg-neutral-950/50 px-3 lowercase outline-none ring-0 focus:border-neutral-500"
                placeholder="ops01"
              />
            </label>
            <button
              className="mt-4 h-11 w-full rounded-lg bg-neutral-100 text-sm font-semibold text-neutral-950 hover:bg-white"
              onClick={() => {
                const trimmed = normalizeOpsId(opsDraft || '')
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
              會議室：<span className="font-mono">{room}</span>
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              同步：
              <span className="font-mono text-neutral-200">{sync.mode}</span>
              {sync.mode !== 'local' ? (
                <span className={sync.connected ? 'ml-2 text-emerald-200' : 'ml-2 text-amber-200'}>
                  ● {sync.connected ? '已連線' : '連線中'}
                </span>
              ) : (
                <span className="ml-2 text-amber-200">● 本機模式（跨裝置不會同步）</span>
              )}
              {sync.error ? <span className="ml-2 text-amber-200">（{sync.error}）</span> : null}
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">串流狀態</div>
              <div className="text-xs text-neutral-400">
                {state.conference.started
                  ? '已啟動（採集端/監看端可直接加入）'
                  : '尚未啟動（採集端/監看端會顯示「LiveOPS準備中...」）'}
              </div>
              {!state.conference.started ? (
                <div className="mt-2 text-xs text-neutral-400">
                  「開始串流」只控制 LiveOPS 的節目輸出（Viewer 何時切到格子畫面），不再綁主持人判斷。
                  若採集端/監看端加入時被擋在等候室，請在下方「等候室」名單手動放行；必要時可用右側「開啟原生會議室」開新分頁除錯。
                </div>
              ) : null}
              <div className="mt-2 text-[11px] text-neutral-500">
                Admin SDK：{adminConfState.status}
                {adminConfState.error ? <span className="text-amber-200">（{adminConfState.error}）</span> : null}
                <span className="ml-2">
                  Gatekeeper：{gate.status}
                  {gate.error ? <span className="text-amber-200">（{gate.error}）</span> : null}
                </span>
                <span className="ml-2">
                  Sync：{sync.mode}
                  {sync.error ? <span className="text-amber-200">（{sync.error}）</span> : null}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                className={
                  state.conference.started
                    ? 'h-10 rounded-lg border border-neutral-700 bg-neutral-900/30 px-4 text-sm font-semibold text-neutral-100 hover:border-neutral-500'
                    : 'h-10 rounded-lg bg-emerald-300 px-4 text-sm font-semibold text-neutral-950 hover:bg-emerald-200'
                }
                disabled={false}
                onClick={() => {
                  if (!state.conference.started) {
                    /* if (!canStartStreaming) {
                      setAuthHint('尚未確認主持人就位：請先開啟原生會議室，成功進入後關閉視窗即可開始串流。')
                      return
                    } */
                    setConferenceStarted(true, 'Admin')
                    if (!state.collector.token) setCollectorToken(createCollectorToken({ opsId: meetingCode }))
                    return
                  }
                  setConferenceStarted(false)
                }}
              >
                {state.conference.started ? '停止串流（停止廣播）' : '開始串流'}
              </button>
              <button
                className="h-10 rounded-lg border border-neutral-700 bg-neutral-900/30 px-4 text-sm font-semibold text-neutral-100 hover:border-neutral-500"
                onClick={openJitsiAuthPopup}
                title="開啟原生 8x8.vc 房間（除錯用）"
              >
                開啟原生會議室（8x8.vc）
              </button>
              <button
                className="h-10 rounded-lg border border-neutral-800 bg-neutral-900/30 px-3 text-sm hover:border-neutral-600"
                onClick={() => setSearchParams({ ops: meetingCode })}
              >
                重新載入
              </button>
            </div>
          </div>

          {/* <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-neutral-300">
                主持人就位：
                <span className={state.conference.hostReady ? 'ml-1 text-emerald-300' : 'ml-1 text-amber-300'}>
                  ● {state.conference.hostReady ? '已確認' : '尚未確認'}
                </span>
                {authPopupOpen ? <span className="ml-2 text-neutral-400">（認證視窗開啟中…）</span> : null}
              </div>
              <button
                className="h-9 rounded-lg border border-neutral-700 bg-neutral-900/30 px-3 text-xs font-semibold hover:border-neutral-500"
                onClick={() => {
                  setAuthHint('已手動重連 SDK。若仍未取得主持人權限，請確認你是第一個入房者，或稍後重試（伺服器可能暫時性 service-unavailable）。')
                  setSdkEnabled(false)
                  window.setTimeout(() => setSdkEnabled(true), 80)
                }}
              >
                重連 SDK
              </button>
              <button
                className="h-9 rounded-lg border border-neutral-700 bg-neutral-900/30 px-3 text-xs font-semibold hover:border-neutral-500"
                onClick={() => setHostReady(false)}
                title="若你要重新開房或重做主持人設定，可重置此狀態"
              >
                重置主持人
              </button>
            </div>
            {authHint ? <div className="mt-2 text-xs text-neutral-300">{authHint}</div> : null}
          </div> */}

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
                  控制台只負責「把會議室內的來源（參與者）」指派到格子；影像來源請一律用「訊號採集端」加入會議室後再回來指派。
                </div>
                {Array.from(candidateNameCounts.values()).some((c) => c > 1) ? (
                  <div className="mt-1 text-xs text-amber-200">
                    注意：偵測到重複的來源名稱，建議每個採集端名稱保持唯一，避免指派不穩定。
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-2" />
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
                            const raw = e.target.value
                            const nextSource = decodeSource(raw)
                            setRouting({
                              ...state.routing,
                              mtv: updateSlot(state.routing.mtv, idx, { source: nextSource }),
                            })
                          }}
                          className="h-10 rounded-lg border border-neutral-700 bg-neutral-950/40 px-3 text-sm outline-none focus:border-neutral-500"
                        >
                          <option value="none">（未指派）</option>
                          <optgroup label="會議室來源（採集端加入）">
                            {sourceCandidates.map((p) => {
                              const n = (p.displayName ?? '').trim()
                              const dup = (candidateNameCounts.get(n) ?? 0) > 1
                              return (
                                <option key={p.participantId} value={`name:${encodeURIComponent(n)}`}>
                                  {dup ? `${n}（重複）` : n} · {p.participantId.slice(0, 8)}
                                </option>
                              )
                            })}
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
                            const raw = e.target.value
                            const decoded = decodeSource(raw)
                            const nextSource = decoded
                            const defaultTitle = `來源 ${idx + 1}`
                            const currentTitle = (slot.title ?? '').trim()
                            const prevAutoTitle = (() => {
                              if (slot.source.type === 'participantName') return slot.source.name.trim()
                              return ''
                            })()
                            const shouldAutoRename =
                              !currentTitle || currentTitle === defaultTitle || (prevAutoTitle && currentTitle === prevAutoTitle)
                            const nextTitle =
                              shouldAutoRename
                                ? nextSource.type === 'participantName'
                                  ? nextSource.name
                                  : slot.title
                                : slot.title
                            setRouting({
                              ...state.routing,
                              source: updateSlot(state.routing.source, idx, { source: nextSource, title: nextTitle }),
                            })
                          }}
                          className="h-10 rounded-lg border border-neutral-700 bg-neutral-950/40 px-3 text-sm outline-none focus:border-neutral-500"
                        >
                          <option value="none">（未指派）</option>
                          <optgroup label="會議室來源（採集端加入）">
                            {sourceCandidates.map((p) => {
                              const n = (p.displayName ?? '').trim()
                              const dup = (candidateNameCounts.get(n) ?? 0) > 1
                              return (
                                <option key={p.participantId} value={`name:${encodeURIComponent(n)}`}>
                                  {dup ? `${n}（重複）` : n} · {p.participantId.slice(0, 8)}
                                </option>
                              )
                            })}
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
            <div className="mb-2 text-sm font-semibold">系統 Token 狀態（配額管理）</div>
            <div className="text-xs text-neutral-400 mb-3">
              顯示目前系統已發出的 Token（含可能已斷線但未釋放的幽靈佔用）。若遇「名額已滿」問題，請在此手動釋放。
            </div>
            <TokenStatusPanel opsId={opsRoom} />
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4">
            <div className="mb-2 text-sm font-semibold">等候室名單（手動審核）</div>
            <div className="text-xs text-neutral-400">
              若採集端/監看端顯示「導播確認身分中...」，代表正在等候室等待你審核。
            </div>
            <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950/30 p-3 text-[11px] text-neutral-200">
              {adminConfState.lobbyPending.length === 0 ? (
                <div className="text-neutral-500">目前等候室 0 人</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {adminConfState.lobbyPending.map((p) => (
                    <div
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-950/40 px-2 py-1"
                    >
                      <div className="min-w-0 max-w-[260px] truncate">
                        {p.displayName} · {p.id.slice(0, 8)}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="rounded-md border border-emerald-900/60 bg-emerald-950/40 px-2 py-0.5 text-emerald-200 hover:border-emerald-700"
                          onClick={() => adminConfApi.approveLobbyAccess(p.id)}
                        >
                          同意
                        </button>
                        <button
                          className="rounded-md border border-rose-900/60 bg-rose-950/40 px-2 py-0.5 text-rose-200 hover:border-rose-700"
                          onClick={() => adminConfApi.denyLobbyAccess(p.id)}
                        >
                          拒絕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-2 text-[11px] text-neutral-500">
              Admin SDK：{adminConfState.status}
              {adminConfState.error ? <span className="text-amber-200">（{adminConfState.error}）</span> : null}
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4">
            <div className="mb-2 text-sm font-semibold">參與者狀態（SDK 即時）</div>
            <div className="text-xs text-neutral-400">來源清單來自 Admin SDK 連線，會即時更新（無需手動刷新）。</div>
            <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950/30 p-3 text-sm">
              {adminConfState.remotes.length === 0 ? (
                <div className="text-neutral-400">（尚未偵測到參與者）</div>
              ) : (
                <ul className="space-y-1">
                  {adminConfState.remotes.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{p.name || '（未命名）'}</span>
                      <span className="shrink-0 font-mono text-[10px] text-neutral-500">{p.id.slice(0, 10)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-2 text-[11px] text-neutral-500">
              Admin SDK：{adminConfState.status}
              {adminConfState.error ? <span className="text-amber-200">（{adminConfState.error}）</span> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
