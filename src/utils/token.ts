type CollectorTokenV1 = {
  v: 1
  room: string
  name?: string
  issuedAt: number
}

type CollectorTokenV2 = {
  v: 2
  opsId: string
  name?: string
  issuedAt: number
}

function base64UrlEncode(input: string): string {
  return btoa(unescape(encodeURIComponent(input)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function base64UrlDecode(input: string): string {
  const padded = input.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(input.length / 4) * 4, '=')
  return decodeURIComponent(escape(atob(padded)))
}

export function createCollectorToken(params: { opsId: string; name?: string }): string {
  const payload: CollectorTokenV2 = {
    v: 2,
    opsId: params.opsId,
    name: params.name,
    issuedAt: Date.now(),
  }
  return base64UrlEncode(JSON.stringify(payload))
}

export function parseCollectorToken(token: string): { opsId: string; name?: string } | null {
  try {
    const decoded = base64UrlDecode(token)
    const json = JSON.parse(decoded) as CollectorTokenV1 | CollectorTokenV2
    if (json?.v === 1) {
      if (!json?.room || typeof json.room !== 'string') return null
      if (json.name != null && typeof json.name !== 'string') return null
      return { opsId: json.room, name: json.name }
    }
    if (json?.v === 2) {
      if (!json?.opsId || typeof json.opsId !== 'string') return null
      if (json.name != null && typeof json.name !== 'string') return null
      return { opsId: json.opsId, name: json.name }
    }
    return null
  } catch {
    return null
  }
}
