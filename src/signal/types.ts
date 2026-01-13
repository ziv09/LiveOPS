export type OpsSessionV1 = {
  v: 1
  opsId: string
  room: string
}

export type RoutingSourceV1 =
  | { type: 'none' }
  // 新版：以參與者顯示名稱作為來源（來源重連後仍可匹配）
  | { type: 'participantName'; name: string }

export type RoutingSlotV1 = {
  title: string
  source: RoutingSourceV1
}

export type RoutingTableV2 = {
  v: 2
  opsId: string
  mtv: RoutingSlotV1[]
  source: RoutingSlotV1[]
}

export type SignalStateV1 = {
  v: 1
  updatedAt: number
  session: OpsSessionV1
  routing: RoutingTableV2
  marquee: { text: string; updatedAt: number }
  collector: { token: string | null; updatedAt: number }
  conference: {
    started: boolean
    startedAt: number | null
    startedBy: string | null
  }
}

export const DEFAULT_SLOTS = {
  mtv: 2,
  source: 8,
} as const

export function getDefaultRoom(opsId: string) {
  const raw = String(opsId ?? '').trim().toLowerCase()
  const safe = raw.replace(/[^a-z0-9_-]/g, '')
  return safe || 'ops01'
}

export function createDefaultSignalState(opsId: string): SignalStateV1 {
  const now = Date.now()
  const session: OpsSessionV1 = { v: 1, opsId, room: getDefaultRoom(opsId) }
  const routing: RoutingTableV2 = {
    v: 2,
    opsId,
    mtv: Array.from({ length: DEFAULT_SLOTS.mtv }, (_, i) => ({
      title: `MTV ${i + 1}`,
      source: { type: 'none' },
    })),
    source: Array.from({ length: DEFAULT_SLOTS.source }, (_, i) => ({
      title: `來源 ${i + 1}`,
      source: { type: 'none' },
    })),
  }

  return {
    v: 1,
    updatedAt: now,
    session,
    routing,
    marquee: { text: '', updatedAt: now },
    collector: { token: null, updatedAt: now },
    conference: {
      started: false,
      startedAt: null,
      startedBy: null,
    },
  }
}

function isRoutingSourceV1(x: any): x is RoutingSourceV1 {
  if (!x || typeof x !== 'object') return false
  if (x.type === 'none') return true
  if (x.type === 'participantName') return typeof x.name === 'string' && x.name.trim().length > 0
  return false
}

function normalizeRoutingV2(opsId: string, routing: any): RoutingTableV2 {
  const base = createDefaultSignalState(opsId).routing
  if (!routing || routing.v !== 2) return base
  if (typeof routing.opsId !== 'string' || routing.opsId !== opsId) return base
  const mtv = Array.isArray(routing.mtv) ? routing.mtv : base.mtv
  const source = Array.isArray(routing.source) ? routing.source : base.source

  const normalizeSlots = (slots: any[], fallback: RoutingSlotV1[]) =>
    slots.map((s, idx) => {
      const fb = fallback[idx] ?? { title: `來源 ${idx + 1}`, source: { type: 'none' as const } }
      const title = typeof s?.title === 'string' && s.title.trim() ? s.title : fb.title
      const src = isRoutingSourceV1(s?.source) ? s.source : fb.source
      return { title, source: src }
    })

  return {
    v: 2,
    opsId,
    mtv: normalizeSlots(mtv, base.mtv),
    source: normalizeSlots(source, base.source),
  }
}

function upgradeRoutingFromV1(opsId: string, _routingV1: any): RoutingTableV2 {
  // 舊版 routing（mtvPages/sourcePages）是以 participantId 為鍵，
  // 新版已全面改為 displayName 指派，無法可靠自動轉換，故直接回退為預設未指派。
  return createDefaultSignalState(opsId).routing
}

export function normalizeSignalState(opsId: string, state: any): SignalStateV1 {
  const base = createDefaultSignalState(opsId)
  if (!state || state.v !== 1) return base

  const updatedAt = typeof state.updatedAt === 'number' ? state.updatedAt : base.updatedAt

  const session = (() => {
    const s = state.session
    if (s?.v === 1 && typeof s.opsId === 'string') {
      const normalizedOps = getDefaultRoom(opsId)
      const fallbackRoom = getDefaultRoom(opsId)
      const normalizedRoom =
        (typeof s.room === 'string' && s.room ? getDefaultRoom(s.room) : '') || fallbackRoom
      return {
        v: 1,
        opsId: normalizedOps,
        room:
          normalizedRoom,
      } satisfies OpsSessionV1
    }
    return base.session
  })()

  const routing =
    state.routing?.v === 2 ? normalizeRoutingV2(opsId, state.routing) : upgradeRoutingFromV1(opsId, state.routing)

  const marquee =
    typeof state.marquee?.text === 'string' && typeof state.marquee?.updatedAt === 'number'
      ? state.marquee
      : base.marquee

  const collector =
    (typeof state.collector?.token === 'string' || state.collector?.token === null) &&
    typeof state.collector?.updatedAt === 'number'
      ? state.collector
      : base.collector

  const conference =
    typeof state.conference?.started === 'boolean'
      ? {
          started: state.conference.started,
          startedAt:
            typeof state.conference.startedAt === 'number' || state.conference.startedAt === null
              ? state.conference.startedAt
              : base.conference.startedAt,
          startedBy:
            typeof state.conference.startedBy === 'string' || state.conference.startedBy === null
              ? state.conference.startedBy
              : base.conference.startedBy,
        }
      : base.conference

  return { v: 1, updatedAt, session, routing, marquee, collector, conference }
}
