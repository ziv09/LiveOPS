export function normalizeOpsId(input: string): string {
  const raw = String(input ?? '').trim().toLowerCase()
  const safe = raw.replace(/[^a-z0-9_-]/g, '')
  return safe
}

