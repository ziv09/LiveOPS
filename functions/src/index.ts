import { setGlobalOptions } from 'firebase-functions/v2'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret } from 'firebase-functions/params'
import admin from 'firebase-admin'
import jwt from 'jsonwebtoken'

setGlobalOptions({ region: 'asia-southeast1' })

const JAAS_PRIVATE_KEY = defineSecret('JAAS_PRIVATE_KEY')
const JAAS_KID = defineSecret('JAAS_KID')
const JAAS_TENANT_ID = defineSecret('JAAS_TENANT_ID')

if (!admin.apps.length) admin.initializeApp()

type RoleGroup = 'collector' | 'monitor' | 'crew'

type Allocation = {
  uid: string
  role: RoleGroup
  displayName: string
  slotId: string
  lastSeen: number
}

type RoomState = {
  updatedAt: number
  allocations: Record<string, Allocation>
}

const TTL_MS = 60_000

function normalizeOps(ops: string): string {
  return String(ops ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
}

function getRoleGroupFromDisplayName(displayName: string): RoleGroup {
  const n = String(displayName ?? '').trim().toLowerCase()
  if (n.startsWith('src.')) return 'collector'
  if (n.startsWith('mon.')) return 'monitor'
  return 'crew'
}

function buildSlots() {
  const slots: Array<{ slotId: string; role: RoleGroup }> = []
  for (let i = 1; i <= 16; i += 1) slots.push({ slotId: `collector_${String(i).padStart(2, '0')}`, role: 'collector' })
  for (let i = 1; i <= 4; i += 1) slots.push({ slotId: `monitor_${String(i).padStart(2, '0')}`, role: 'monitor' })
  for (let i = 1; i <= 5; i += 1) slots.push({ slotId: `crew_${String(i).padStart(2, '0')}`, role: 'crew' })
  return slots
}

const SLOTS = buildSlots()

function compactState(input: RoomState | null | undefined, now: number): RoomState {
  const state: RoomState = input?.allocations ? input : { updatedAt: 0, allocations: {} }
  const nextAlloc: Record<string, Allocation> = {}
  for (const [slotId, a] of Object.entries(state.allocations ?? {})) {
    if (!a?.uid || !a?.lastSeen) continue
    if (now - Number(a.lastSeen) > TTL_MS) continue
    nextAlloc[slotId] = { ...a, slotId }
  }
  return { updatedAt: now, allocations: nextAlloc }
}

function countsOf(state: RoomState) {
  const counts = { total: 0, collector: 0, monitor: 0, crew: 0 }
  for (const a of Object.values(state.allocations)) {
    counts.total += 1
    counts[a.role] += 1
  }
  return counts
}

function pickSlotForUid(state: RoomState, uid: string): Allocation | null {
  for (const a of Object.values(state.allocations)) {
    if (a.uid === uid) return a
  }
  return null
}

function pickFreeSlot(state: RoomState, role: RoleGroup): { slotId: string } | null {
  const tryPick = (r: RoleGroup) => {
    for (const s of SLOTS) {
      if (s.role !== r) continue
      if (!state.allocations[s.slotId]) return { slotId: s.slotId }
    }
    return null
  }

  const direct = tryPick(role)
  if (direct) return direct

  // Flex policy: if Crew quota is full but Collector slots are still available,
  // allow Crew to borrow a free Collector slot while keeping the total hard limit at 25.
  if (role === 'crew') {
    const borrowed = tryPick('collector')
    if (borrowed) return borrowed
  }
  return null
}

function signJaasJwt(params: {
  tenantId: string
  kid: string
  privateKeyPem: string
  room: string
  userId: string
  displayName: string
  moderator: boolean
}) {
  const nowSec = Math.floor(Date.now() / 1000)
  const payload = {
    aud: 'jitsi',
    iss: 'chat',
    iat: nowSec,
    nbf: nowSec - 10,
    exp: nowSec + 60 * 60,
    sub: params.tenantId,
    room: params.room,
    context: {
      user: {
        moderator: params.moderator,
        name: params.displayName,
        id: params.userId,
        email: `${params.userId}@${params.tenantId}.com`,
        avatar: '',
      },
      features: {
        livestreaming: params.moderator,
        recording: params.moderator,
        transcription: params.moderator,
        'outbound-call': params.moderator,
      },
    },
  }
  return jwt.sign(payload, params.privateKeyPem, {
    algorithm: 'RS256',
    keyid: params.kid,
    header: { kid: params.kid, typ: 'JWT', alg: 'RS256' },
  })
}

export const issueJaasToken = onCall(
  { secrets: [JAAS_PRIVATE_KEY, JAAS_KID, JAAS_TENANT_ID] },
  async (req) => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', '需要先登入（Firebase Auth）。')

    const ops = normalizeOps((req.data as any)?.ops)
    const displayName = String((req.data as any)?.displayName ?? '').trim()
    const requestedRole = String((req.data as any)?.role ?? '').trim().toLowerCase()

    if (!ops) throw new HttpsError('invalid-argument', '缺少 ops。')
    if (!displayName) throw new HttpsError('invalid-argument', '缺少 displayName。')

    const role = getRoleGroupFromDisplayName(displayName)
    const uid = req.auth.uid

    const privateKeyPem = JAAS_PRIVATE_KEY.value().trim()
    const kid = JAAS_KID.value().trim()
    const tenantId = JAAS_TENANT_ID.value().trim()

    if (!privateKeyPem || !privateKeyPem.includes('BEGIN')) {
      throw new HttpsError(
        'failed-precondition',
        'Cloud Functions 尚未設定 JAAS_PRIVATE_KEY（必須是 PEM 私鑰內容）。',
      )
    }
    if (!kid) throw new HttpsError('failed-precondition', 'Cloud Functions 尚未設定 JAAS_KID。')
    if (!tenantId) throw new HttpsError('failed-precondition', 'Cloud Functions 尚未設定 JAAS_TENANT_ID。')

    const roomRef = admin.database().ref(`liveops/v2/jaas/rooms/${ops}/state`)
    const now = Date.now()

    const result = await roomRef.transaction((current) => {
      const cleaned = compactState(current as any, now)

      const existing = pickSlotForUid(cleaned, uid)
      if (existing) {
        cleaned.allocations[existing.slotId] = { ...existing, displayName, lastSeen: now }
        return cleaned
      }

      const counts = countsOf(cleaned)
      if (counts.total >= 25) return

      const free = pickFreeSlot(cleaned, role)
      if (!free) return

      const slotId = free.slotId
      cleaned.allocations[slotId] = { uid, role, displayName, slotId, lastSeen: now }
      return cleaned
    })

    if (!result.committed || !result.snapshot.exists()) {
      throw new HttpsError('resource-exhausted', '系統滿載（名額已滿）。')
    }

    const finalState = compactState(result.snapshot.val() as any, now)
    const alloc = pickSlotForUid(finalState, uid)
    if (!alloc) throw new HttpsError('resource-exhausted', '系統滿載（名額已滿）。')

    // Prototype: allow moderator only for explicit "admin" role requested.
    // This is NOT a security boundary; it assumes your app-level password gate is trusted.
    const moderator = requestedRole === 'admin'

    const token = signJaasJwt({
      tenantId,
      kid,
      privateKeyPem,
      room: ops,
      userId: alloc.slotId,
      displayName,
      moderator,
    })

    return {
      ops,
      role: alloc.role,
      slotId: alloc.slotId,
      token,
      counts: countsOf(finalState),
    }
  },
)

export const heartbeatJaas = onCall(async (req) => {
  if (!req.auth?.uid) throw new HttpsError('unauthenticated', '需要先登入（Firebase Auth）。')
  const ops = normalizeOps((req.data as any)?.ops)
  if (!ops) throw new HttpsError('invalid-argument', '缺少 ops。')

  const uid = req.auth.uid
  const now = Date.now()
  const roomRef = admin.database().ref(`liveops/v2/jaas/rooms/${ops}/state`)

  await roomRef.transaction((current) => {
    const cleaned = compactState(current as any, now)
    const existing = pickSlotForUid(cleaned, uid)
    if (!existing) return cleaned
    cleaned.allocations[existing.slotId] = { ...existing, lastSeen: now }
    return cleaned
  })

  return { ok: true }
})

export const cleanupJaasPresence = onSchedule('every 1 minutes', async () => {
  const root = admin.database().ref('liveops/v2/jaas/rooms')
  const snap = await root.get()
  if (!snap.exists()) return
  const now = Date.now()
  const updates: Record<string, any> = {}

  const rooms = snap.val() as Record<string, { state?: RoomState }>
  for (const [ops, room] of Object.entries(rooms ?? {})) {
    const cleaned = compactState(room?.state ?? null, now)
    updates[`liveops/v2/jaas/rooms/${ops}/state`] = cleaned
  }

  if (Object.keys(updates).length > 0) {
    await admin.database().ref().update(updates)
  }
})

export const releaseJaasSlot = onCall(async (req) => {
  if (!req.auth?.uid) throw new HttpsError('unauthenticated', '需要先登入（Firebase Auth）。')
  const ops = normalizeOps((req.data as any)?.ops)
  const slotId = String((req.data as any)?.slotId ?? '').trim()

  if (!ops) throw new HttpsError('invalid-argument', '缺少 ops。')
  if (!slotId) throw new HttpsError('invalid-argument', '缺少 slotId。')

  // Ideally verify admin role here, but purely relying on knowing the slotId is a weak but existing guard.
  // Real security would check if req.auth.token.admin is true or similar.

  const ref = admin.database().ref(`liveops/v2/jaas/rooms/${ops}/state/allocations/${slotId}`)
  await ref.remove()

  return { ok: true }
})
