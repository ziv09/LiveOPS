type GoogleUser = {
  email: string
  name?: string
  picture?: string
  sub?: string
  idToken: string
}

const STORAGE_KEY = 'liveops.google.v1'
const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'

function decodeJwtPayload(token: string): any | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  const base64 = parts[1].replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  try {
    const json = decodeURIComponent(
      Array.prototype.map
        .call(atob(padded), (c: string) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(''),
    )
    return JSON.parse(json)
  } catch {
    return null
  }
}

export function getGoogleClientId() {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? ''
}

export function loadGoogleScript(): Promise<void> {
  const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`) as HTMLScriptElement | null
  if (existing?.dataset.loaded === 'true') return Promise.resolve()
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('載入 Google Sign-In 失敗')), { once: true })
    })
  }

  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.addEventListener('load', () => {
      s.dataset.loaded = 'true'
      resolve()
    })
    s.addEventListener('error', () => reject(new Error('載入 Google Sign-In 失敗')))
    document.head.appendChild(s)
  })
}

export function readGoogleUser(): GoogleUser | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GoogleUser
    if (!parsed?.idToken || typeof parsed.idToken !== 'string') return null
    if (!parsed?.email || typeof parsed.email !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function writeGoogleUser(user: GoogleUser) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user))
}

export function clearGoogleUser() {
  sessionStorage.removeItem(STORAGE_KEY)
  try {
    // @ts-expect-error - google identity global
    window.google?.accounts?.id?.disableAutoSelect?.()
  } catch {
    // noop
  }
}

export function googleUserFromIdToken(idToken: string): GoogleUser | null {
  const payload = decodeJwtPayload(idToken)
  const email = payload?.email
  if (!email || typeof email !== 'string') return null
  return {
    idToken,
    email,
    name: typeof payload?.name === 'string' ? payload.name : undefined,
    picture: typeof payload?.picture === 'string' ? payload.picture : undefined,
    sub: typeof payload?.sub === 'string' ? payload.sub : undefined,
  }
}

