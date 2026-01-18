export type RoleNamePrefix = 'src.' | 'mon.' | 'crew.' | 'crew_'

const KNOWN_PREFIX_RE = /^(src\.|mon\.|crew\.|crew_)/i

export function ensureRoleName(prefix: RoleNamePrefix, raw: string, fallbackBaseName: string): string {
  const trimmed = String(raw ?? '').trim()
  const baseFallback = String(fallbackBaseName ?? '').trim() || '一般'
  if (!trimmed) return `${prefix}${baseFallback}`

  const lowerPrefix = prefix.toLowerCase()
  const lowerTrimmed = trimmed.toLowerCase()
  if (lowerTrimmed.startsWith(lowerPrefix)) return `${prefix}${trimmed.slice(prefix.length)}`

  const stripped = trimmed.replace(KNOWN_PREFIX_RE, '')
  return `${prefix}${stripped || baseFallback}`
}

export function getRolePrefixFromDisplayName(displayName: string): RoleNamePrefix | null {
  const n = String(displayName ?? '').trim().toLowerCase()
  if (n.startsWith('src.')) return 'src.'
  if (n.startsWith('mon.')) return 'mon.'
  if (n.startsWith('crew.')) return 'crew.'
  if (n.startsWith('crew_')) return 'crew_'
  return null
}

