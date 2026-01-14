import { normalizeOpsId } from '../utils/ops'

export function getJaasDomain(): string {
  return ((import.meta.env.VITE_JITSI_DOMAIN as string | undefined) ?? '8x8.vc')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
}

export function getJaasAppId(): string {
  const appId = (import.meta.env.VITE_JAAS_APP_ID as string | undefined) ?? ''
  return appId.trim()
}

// lib-jitsi-meet uses the plain room (no tenant prefix). Tenant is configured via serviceUrl/hosts.
export function buildJaasSdkRoomName(opsId: string): string {
  return normalizeOpsId(opsId || '') || 'ops01'
}

// IFrame API requires "<AppID>/<room>" format.
export function buildJaasIFrameRoomName(opsId: string): string {
  const appId = getJaasAppId()
  const ops = normalizeOpsId(opsId || '') || 'ops01'
  return appId ? `${appId}/${ops}` : ops
}
