import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { SignalProvider } from './signal/SignalProvider'
import { parseCollectorToken } from './utils/token'

function getRoomFromSearch(search: string): string {
  const params = new URLSearchParams(search)
  const ops = params.get('ops')
  if (ops) return ops
  const token = params.get('token')
  if (token) {
    const parsed = parseCollectorToken(token)
    if (parsed?.opsId) return parsed.opsId
  }
  return 'liveops-demo'
}

export function AppProviders(props: { children: React.ReactNode }) {
  const location = useLocation()
  const room = useMemo(() => getRoomFromSearch(location.search), [location.search])
  return <SignalProvider room={room}>{props.children}</SignalProvider>
}
