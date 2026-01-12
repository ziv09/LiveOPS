export type OpsSessionV1 = {
  v: 1
  opsId: string
  room: string
}

export type RoutingSourceV1 =
  | { type: 'none' }
  | { type: 'localDevice'; deviceId: string }
  | { type: 'collectorParticipant'; participantId: string }

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
  conference: { started: boolean; startedAt: number | null; startedBy: string | null }
  host: { boundGoogleEmail: string | null; updatedAt: number }
}

export const DEFAULT_SLOTS = {
  mtv: 2,
  source: 8,
} as const

export function getDefaultRoom(opsId: string) {
  return opsId.trim() || 'OPS01'
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
    conference: { started: false, startedAt: null, startedBy: null },
    host: { boundGoogleEmail: null, updatedAt: now },
  }
}

function isRoutingSourceV1(x: any): x is RoutingSourceV1 {
  if (!x || typeof x !== 'object') return false
  if (x.type === 'none') return true
  if (x.type === 'localDevice') return typeof x.deviceId === 'string' && x.deviceId.length > 0
  if (x.type === 'collectorParticipant') return typeof x.participantId === 'string' && x.participantId.length > 0
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

function upgradeRoutingFromV1(opsId: string, routingV1: any): RoutingTableV2 {
  const base = createDefaultSignalState(opsId).routing
  const mtvPages: Array<string | null> = Array.isArray(routingV1?.mtvPages) ? routingV1.mtvPages : []
  const sourcePages: Array<string | null> = Array.isArray(routingV1?.sourcePages) ? routingV1.sourcePages : []

  const toSlot = (title: string, id: string | null): RoutingSlotV1 => {
    if (typeof id === 'string' && id) return { title, source: { type: 'collectorParticipant', participantId: id } }
    return { title, source: { type: 'none' } }
  }

  return {
    v: 2,
    opsId,
    mtv: base.mtv.map((fb, i) => toSlot(fb.title, mtvPages[i] ?? null)),
    source: base.source.map((fb, i) => toSlot(fb.title, sourcePages[i] ?? null)),
  }
}

export function normalizeSignalState(opsId: string, state: any): SignalStateV1 {
  const base = createDefaultSignalState(opsId)
  if (!state || state.v !== 1) return base

  const updatedAt = typeof state.updatedAt === 'number' ? state.updatedAt : base.updatedAt

  const session = (() => {
    const s = state.session
    if (s?.v === 1 && typeof s.opsId === 'string') {
      const fallbackRoom = getDefaultRoom(opsId)
      return {
        v: 1,
        opsId,
        room:
          (typeof s.room === 'string' && s.room) ||
          fallbackRoom,
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
    typeof state.conference?.started === 'boolean' &&
    (typeof state.conference?.startedAt === 'number' || state.conference?.startedAt === null) &&
    (typeof state.conference?.startedBy === 'string' || state.conference?.startedBy === null)
      ? state.conference
      : base.conference

  const host =
    (typeof state.host?.boundGoogleEmail === 'string' || state.host?.boundGoogleEmail === null) &&
    typeof state.host?.updatedAt === 'number'
      ? state.host
      : base.host

  return { v: 1, updatedAt, session, routing, marquee, collector, conference, host }
}
