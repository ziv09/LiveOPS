type AuthStateV1 = {
  v: 1
  adminUntil?: number
  viewerUntil?: number
}

const STORAGE_KEY = 'liveops.auth.v1'
const SESSION_MS = 12 * 60 * 60 * 1000

const ADMIN_PASSWORD = (import.meta.env.VITE_ADMIN_PASSWORD as string | undefined) ?? 'bw20041015'
const VIEWER_PASSWORD = (import.meta.env.VITE_VIEWER_PASSWORD as string | undefined) ?? '01151015'

function readState(): AuthStateV1 {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return { v: 1 }
    const parsed = JSON.parse(raw) as AuthStateV1
    if (parsed?.v !== 1) return { v: 1 }
    return parsed
  } catch {
    return { v: 1 }
  }
}

function writeState(next: AuthStateV1) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

export function verifyAdminPassword(input: string) {
  return input === ADMIN_PASSWORD
}

export function verifyViewerPassword(input: string) {
  return input === VIEWER_PASSWORD
}

export function setAuthed(role: 'admin' | 'viewer') {
  const now = Date.now()
  const next: AuthStateV1 = { ...readState(), v: 1 }
  if (role === 'admin') next.adminUntil = now + SESSION_MS
  if (role === 'viewer') next.viewerUntil = now + SESSION_MS
  writeState(next)
}

export function isAuthed(role: 'admin' | 'viewer') {
  const now = Date.now()
  const s = readState()
  const until = role === 'admin' ? s.adminUntil : s.viewerUntil
  return typeof until === 'number' && until > now
}

export function clearAuth() {
  sessionStorage.removeItem(STORAGE_KEY)
}

