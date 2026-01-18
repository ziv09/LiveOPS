import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { QRCodeCanvas } from 'qrcode.react'
import { onAuthStateChanged } from 'firebase/auth'
import { clearAuth, isAuthed } from '../auth/auth'
import { getFirebaseAuth, getFirebaseDatabase, getFirebaseFunctions } from '../signal/firebase'
import { onValue, ref, set } from 'firebase/database'
import { httpsCallable } from 'firebase/functions'
import { useSignal } from '../signal/useSignal'
import type { RoutingSlotV1, RoutingSourceV1 } from '../signal/types'
import { normalizeOpsId } from '../utils/ops'
import { createCollectorToken } from '../utils/token'
import { buildJaasSdkRoomName, getJaasAppId, getJaasDomain } from '../jaas/jaasConfig'

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

const ALL_SLOTS = [
  ...Array.from({ length: 16 }, (_, i) => ({ id: `collector_${String(i + 1).padStart(2, '0')}`, role: 'collector' })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `monitor_${String(i + 1).padStart(2, '0')}`, role: 'monitor' })),
  ...Array.from({ length: 5 }, (_, i) => ({ id: `crew_${String(i + 1).padStart(2, '0')}`, role: 'crew' })),
]

function PersonnelStatusPanel(props: { opsId: string; allocations: Record<string, any>; now: number; error: string | null }) {


  const functions = useMemo(() => {
    try {
      return getFirebaseFunctions()
    } catch {
      return null
    }
  }, [])

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

  // Merge Data
  const rows = useMemo(() => {
    return ALL_SLOTS.map((slot) => {
      const alloc = props.allocations[slot.id]

      let status = 'empty'
      let lastSeenTime = 0

      if (alloc) {
        lastSeenTime = Number(alloc.lastSeen || 0)
        // 40s tolerance for heartbeat
        if (props.now - lastSeenTime < 40000) status = 'online'
        else status = 'offline'
      }

      return {
        ...slot,
        alloc,
        status, // 'online' | 'offline' | 'empty'
        displayName: alloc?.displayName || '-',
        lastSeen: lastSeenTime ? new Date(lastSeenTime).toLocaleTimeString() : null,
      }
    })
  }, [props.allocations, props.now])

  const stats = useMemo(() => {
    return {
      total: Object.keys(props.allocations).length,
      online: rows.filter(r => r.status === 'online').length,
    }
  }, [props.allocations, rows])

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 overflow-hidden">
      <div className="w-full flex items-center justify-between p-4 bg-neutral-900/50">
        <div className="flex flex-col items-start gap-1">
          <div className="text-sm font-semibold text-neutral-200">
            人員狀態列表
            {props.error && <span className="ml-2 text-rose-400 text-xs">⚠️ {props.error}</span>}
          </div>
          <div className="text-xs text-neutral-400">
            配額：<span className={stats.total >= 25 ? 'text-rose-400' : 'text-emerald-400'}>{stats.total}</span> / 25
            <span className="mx-2">·</span>
            線上：<span className="text-emerald-400">{stats.online}</span> 人
          </div>
        </div>
      </div>

      <div className="border-t border-neutral-800 bg-neutral-950/40">
        <div className="max-h-[600px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-neutral-900 text-neutral-400 z-10">
              <tr>
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">身份</th>
                <th className="px-3 py-2 font-medium">使用者（系統偵測/配額）</th>
                <th className="px-3 py-2 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800 text-neutral-300">
              {rows.map((row) => (
                <tr key={row.id} className={row.status === 'online' ? 'bg-emerald-950/10' : ''}>
                  <td className="px-3 py-2 font-mono text-neutral-500">{row.id}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold
                      ${row.role === 'collector' ? 'bg-blue-950/40 text-blue-300' :
                        row.role === 'monitor' ? 'bg-purple-950/40 text-purple-300' :
                          'bg-orange-950/40 text-orange-300'}`}>
                      {row.role}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {row.status === 'online' && <span className="text-emerald-400 text-[10px]">●</span>}
                      {row.status === 'offline' && <span className="text-amber-400 text-[10px]">●</span>}
                      {row.status === 'empty' && <span className="text-neutral-700 text-[10px]">○</span>}

                      <span className={row.status === 'empty' ? 'text-neutral-600' : 'text-neutral-200'}>
                        {row.displayName}
                      </span>

                      {row.status === 'offline' && (
                        <span className="text-[10px] text-amber-500/80">
                          (已佔用但未連線, {row.lastSeen})
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.alloc && (
                      <button
                        className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-[10px] hover:bg-neutral-700 hover:text-white"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleKick(row.id)
                        }}
                      >
                        釋放
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
  const shareBaseUrl = window.location.origin
  useEffect(() => setMarqueeText(state.marquee.text), [state.marquee.text])

  // --- Active Tab State ---
  const [activeTab, setActiveTab] = useState<'routing' | 'marquee' | 'personnel' | 'time'>('routing')

  // --- DB Allocations (Zero-MAU Presence) ---
  const [allocations, setAllocations] = useState<Record<string, any>>({})
  const [timeControl, setTimeControl] = useState<{ mode: 'auto' | 'manual'; base?: number; display?: number }>({ mode: 'auto' })
  const [manualInput, setManualInput] = useState(() => {
    const d = new Date()
    return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() }
  })

  // Helper for Time Control
  const applyTimeControl = async (mode: 'auto' | 'manual') => {
    const db = getFirebaseDatabase()
    if (!db || !opsId) return
    const refPath = `liveops/v2/jaas/rooms/${opsId}/state/timeControl`

    if (mode === 'auto') {
      await set(ref(db, refPath), { mode: 'auto' })
    } else {
      const displaySeconds = (manualInput.h * 3600) + (manualInput.m * 60) + manualInput.s
      await set(ref(db, refPath), {
        mode: 'manual',
        base: Date.now(),
        display: displaySeconds
      })
    }
  }

  const [now, setNow] = useState(Date.now())
  const [dbError, setDbError] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 2000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    const auth = getFirebaseAuth()
    const db = getFirebaseDatabase()
    if (!auth || !db || !opsId || !authed) return

    let dbUnsub: (() => void) | undefined

    const setupListener = () => {
      if (dbUnsub) return
      setDbError(null)
      const roomRef = ref(db, `liveops/v2/jaas/rooms/${opsId}/state`)
      dbUnsub = onValue(roomRef, (snap) => {
        const val = snap.val()
        setAllocations(val?.allocations ?? {})
        setTimeControl(val?.timeControl ?? { mode: 'auto' }) // NEW: Sync timeControl
        setDbError(null)
      }, (err) => {
        console.error('[Admin] Allocations permission/network error:', err)
        setDbError(err.message)
      })
    }

    if (auth.currentUser) setupListener()
    const authUnsub = onAuthStateChanged(auth, (user) => {
      if (user) setupListener()
    })

    return () => {
      authUnsub()
      if (dbUnsub) dbUnsub()
    }
  }, [opsId, authed])

  // --- Native Room Modal Logic ---
  const [nativeModalOpen, setNativeModalOpen] = useState(false)
  const [nativeLoading, setNativeLoading] = useState(false)
  const [nativeError, setNativeError] = useState<string | null>(null)
  const [nativeUrl, setNativeUrl] = useState<string | null>(null)

  const meetingCode = opsId || normalizeOpsId(state.session.opsId)
  const opsRoom = useMemo(() => normalizeOpsId(state.session.room || meetingCode), [meetingCode, state.session.room])
  const room = useMemo(() => buildJaasSdkRoomName(opsRoom), [opsRoom])

  const startNativeRoomFlow = async () => {
    if (!opsId) {
      window.alert('錯誤：找不到會議碼')
      return
    }

    // 1. Open Modal
    setNativeModalOpen(true)
    setNativeLoading(true)
    setNativeError(null)
    setNativeUrl(null)

    // 2. Ensure Collector Token exists (background)
    if (!state.collector.token) {
      setCollectorToken(createCollectorToken({ opsId: meetingCode }))
    }

    try {
      const functions = getFirebaseFunctions()
      if (!functions) throw new Error('Firebase Functions Client Missing')

      const fn = httpsCallable(functions, 'issueJaasToken')
      console.log('[Admin] Requesting token...')

      // Use 'admin' role to get moderator power
      const out = await fn({ ops: opsId, displayName: 'mon.Admin', role: 'admin' })
      const data: any = out.data
      const token = String(data?.token ?? '')

      if (!token) throw new Error('API returned empty token')

      const domain = getJaasDomain()
      const appId = getJaasAppId()
      const base = appId ? `https://${domain}/${appId}/${encodeURIComponent(opsRoom || 'ops01')}` : `https://${domain}/${encodeURIComponent(room)}`
      const fullUrl = `${base}?jwt=${encodeURIComponent(token)}`

      setNativeUrl(fullUrl)
      setNativeLoading(false)

    } catch (e: any) {
      console.error(e)
      setNativeError(e.message || String(e))
      setNativeLoading(false)
    }
  }

  // --- End Native Modal ---

  const collectorQrUrl = useMemo(() => {
    const token = state.collector.token
    if (!token) return null
    return `${shareBaseUrl}/collector?token=${token}`
  }, [shareBaseUrl, state.collector.token])

  // Filter candidates from DB allocations (role=collector, recent heartbeat)
  const sourceCandidates = useMemo(() => {
    return Object.values(allocations)
      .filter((a: any) => {
        // Must be collector role
        if (a.role !== 'collector') return false

        // Must be "online" (heartbeat within 40s)
        const lastSeen = Number(a.lastSeen || 0)
        return now - lastSeen < 40000
      })
      .map((a: any) => ({
        participantId: a.slotId, // Use slot ID (e.g. collector_01) as unique ID
        displayName: (a.displayName ?? '').trim(),
        role: a.role as string
      }))
  }, [allocations, now])

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
              <div className="text-sm text-neutral-300">先建立會議室（OPSxx）、再進入設定畫面。</div>
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

  const TabButton = ({ id, label }: { id: typeof activeTab, label: string }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors
        ${activeTab === id
          ? 'border-emerald-500 text-emerald-400'
          : 'border-transparent text-neutral-400 hover:text-neutral-200 hover:border-neutral-800'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="min-h-full bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl p-4 md:p-6">
        {/* Top Header */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xl font-semibold">戰情室控制台（Admin）</div>
            <div className="text-sm text-neutral-300">
              會議碼：<span className="font-mono">{meetingCode}</span>
              <span className="mx-2 text-neutral-600">|</span>
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
              className="h-9 rounded-lg border border-neutral-800 bg-neutral-900/30 px-3 text-xs hover:border-neutral-600"
              onClick={() => navigate('/')}
            >
              返回首頁
            </button>
            <button
              className="h-9 rounded-lg border border-neutral-800 bg-neutral-900/30 px-3 text-xs hover:border-neutral-600"
              onClick={() => {
                clearAuth()
                navigate('/', { replace: true })
              }}
            >
              登出
            </button>
          </div>
        </div>

        {/* 1. Streaming Status (Fixed Top) */}
        <div className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4">
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
                  「開始串流」只控制 LiveOPS 的節目輸出，不再綁主持人判斷。
                  請在下方「人員狀態」分頁監控連線；必要時可用右側「開啟原生會議室」除錯。
                </div>
              ) : null}
              <div className="mt-2 text-[11px] text-neutral-500">
                Sync：{sync.mode}
                <span className="ml-2 text-emerald-400">● Zero-MAU Mode (資料庫直連)</span>
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
                    setConferenceStarted(true, 'Admin')
                    return
                  }
                  setConferenceStarted(false)
                }}
              >
                {state.conference.started ? '停止串流（停止廣播）' : '開始串流'}
              </button>
              <button
                className="h-10 rounded-lg border border-neutral-700 bg-neutral-900/30 px-4 text-sm font-semibold text-neutral-100 hover:border-neutral-500"
                onClick={startNativeRoomFlow}
                title="開啟原生 8x8.vc 房間"
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

          {state.conference.started ? (
            <div className="mt-4">
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

        {/* 2. Tab Navigation */}
        <div className="mb-4 flex border-b border-neutral-800">
          <TabButton id="routing" label="路由指派" />
          <TabButton id="marquee" label="跑馬燈控制" />
          <TabButton id="personnel" label="人員狀態" />
          <TabButton id="time" label="時間控制" />
        </div>

        {/* 3. Tab Contents */}
        <div className="min-h-[400px]">
          {/* Tab: Routing */}
          {activeTab === 'routing' && (
            <div className="animate-in fade-in duration-200">
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
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-3">
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
            </div>
          )}

          {/* Tab: Marquee */}
          {activeTab === 'marquee' && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4 animate-in fade-in duration-200">
              <div className="mb-2 text-sm font-semibold">跑馬燈控制</div>
              <div className="text-xs text-neutral-400 mb-3">設定所有監看端同步顯示的跑馬燈文字。</div>
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
          )}

          {/* Tab: Personnel */}
          {activeTab === 'personnel' && (
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4 animate-in fade-in duration-200">
              <div className="mb-2 text-sm font-semibold">人員狀態（配額與連線）</div>
              <div className="text-xs text-neutral-400 mb-3">
                顯示目前系統 25 個固定名額的使用狀況，以及實際連線到會議室的人員。
              </div>
              <PersonnelStatusPanel
                opsId={opsRoom}
                allocations={allocations}
                now={now}
                error={dbError}
              />
            </div>
          )}

          {/* Tab: Time Control */}
          {activeTab === 'time' && (
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4 animate-in fade-in duration-200">
              <div className="mb-2 text-sm font-semibold">時間控制</div>
              <div className="text-xs text-neutral-400 mb-4">
                設定 Viewer 監看端顯示的時間。可切換為自動（網路時間）或自訂（指定的跳轉時間）。
                當前模式：<span className={timeControl.mode === 'auto' ? 'text-emerald-400' : 'text-amber-400'}>
                  {timeControl.mode === 'auto' ? '自動 (網路標準)' : '自訂 (手動控制)'}
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {/* Auto Mode */}
                <div className={`rounded-xl border p-4 transition-colors ${timeControl.mode === 'auto' ? 'border-emerald-500/50 bg-emerald-950/20' : 'border-neutral-800 bg-neutral-950/30'}`}>
                  <div className="mb-2 font-semibold text-emerald-100">自動設定時間</div>
                  <div className="mb-4 text-xs text-neutral-400">
                    讓 Viewer 監看端自動顯示當地網路標準時間。
                  </div>
                  <button
                    onClick={() => applyTimeControl('auto')}
                    className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                  >
                    回復標準時間
                  </button>
                </div>

                {/* Manual Mode */}
                <div className={`rounded-xl border p-4 transition-colors ${timeControl.mode === 'manual' ? 'border-amber-500/50 bg-amber-950/20' : 'border-neutral-800 bg-neutral-950/30'}`}>
                  <div className="mb-2 font-semibold text-amber-100">自訂時間</div>
                  <div className="mb-4 text-xs text-neutral-400">
                    設定起始時間並開始讀秒（秒數會自動遞增）。
                  </div>
                  <div className="mb-4 flex items-center justify-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={String(manualInput.h).padStart(2, '0')}
                      onChange={(e) => setManualInput({ ...manualInput, h: Math.min(23, Math.max(0, Number(e.target.value))) })}
                      className="h-12 w-16 rounded-lg border border-neutral-700 bg-neutral-900 text-center text-xl font-mono text-white outline-none focus:border-neutral-500"
                    />
                    <span className="text-neutral-500">:</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={String(manualInput.m).padStart(2, '0')}
                      onChange={(e) => setManualInput({ ...manualInput, m: Math.min(59, Math.max(0, Number(e.target.value))) })}
                      className="h-12 w-16 rounded-lg border border-neutral-700 bg-neutral-900 text-center text-xl font-mono text-white outline-none focus:border-neutral-500"
                    />
                    <span className="text-neutral-500">:</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={String(manualInput.s).padStart(2, '0')}
                      onChange={(e) => setManualInput({ ...manualInput, s: Math.min(59, Math.max(0, Number(e.target.value))) })}
                      className="h-12 w-16 rounded-lg border border-neutral-700 bg-neutral-900 text-center text-xl font-mono text-white outline-none focus:border-neutral-500"
                    />
                  </div>
                  <button
                    onClick={() => applyTimeControl('manual')}
                    className="w-full rounded-lg bg-amber-600 py-2 text-sm font-semibold text-white hover:bg-amber-500"
                  >
                    開始 (設定並自動讀秒)
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div >

      {/* Legacy Code for Native Modal */}
      {nativeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-6">
            <h3 className="text-xl font-bold text-white mb-4">開啟原生會議室</h3>

            {nativeLoading && (
              <div className="flex flex-col items-center py-8 gap-3">
                <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                <div className="text-neutral-400">正在檢查權限並獲取 Token...</div>
              </div>
            )}

            {nativeError && (
              <div className="bg-rose-950/30 border border-rose-900/50 rounded-lg p-4 mb-4">
                <div className="text-rose-400 font-bold mb-1">發生錯誤</div>
                <div className="text-rose-300 text-sm">{nativeError}</div>
                <div className="text-neutral-500 text-xs mt-2">請檢查網路連線或稍後再試。</div>
              </div>
            )}

            {!nativeLoading && !nativeError && nativeUrl && (
              <div className="flex flex-col gap-4">
                <div className="bg-emerald-950/30 border border-emerald-900/50 rounded-lg p-4">
                  <div className="text-emerald-400 font-bold mb-1">準備就緒</div>
                  <div className="text-emerald-300 text-sm">您的 Admin 身份憑證已生成。</div>
                </div>
                <a
                  href={nativeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-lg rounded-xl transition-all shadow-lg shadow-emerald-900/20"
                  onClick={() => setNativeModalOpen(false)}
                >
                  進入會議室 (開啟新分頁) ➜
                </a>
                <div className="text-center text-xs text-neutral-500">
                  點擊後系統將開啟 8x8.vc 視窗，請允許瀏覽器跳轉。
                </div>
              </div>
            )}

            <button
              onClick={() => setNativeModalOpen(false)}
              className="mt-4 w-full py-2 text-neutral-400 hover:text-white text-sm"
            >
              取消
            </button>
          </div>
        </div>
      )}

    </div >
  )
}
