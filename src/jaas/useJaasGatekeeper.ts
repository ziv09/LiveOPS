import { useEffect, useMemo, useRef, useState } from 'react'
import { signInAnonymously } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { getFirebaseAuth, getFirebaseFunctions, isFirebaseEnabled } from '../signal/firebase'
import { normalizeOpsId } from '../utils/ops'

type GateStatus = 'idle' | 'auth' | 'issuing' | 'ready' | 'error'

type GateResult = {
  status: GateStatus
  error: string | null
  token: string | null
  slotId: string | null
  counts: { total: number; collector: number; monitor: number; crew: number } | null
}

export function useJaasGatekeeper(params: {
  opsId: string
  displayName: string
  requestedRole: 'admin' | 'viewer' | 'collector' | 'crew'
  enabled: boolean
}): GateResult {
  const ops = useMemo(() => normalizeOpsId(params.opsId), [params.opsId])
  const displayName = useMemo(() => String(params.displayName ?? '').trim(), [params.displayName])

  const [res, setRes] = useState<GateResult>({
    status: 'idle',
    error: null,
    token: null,
    slotId: null,
    counts: null,
  })

  const heartbeatTimerRef = useRef<number | null>(null)
  const refreshTimerRef = useRef<number | null>(null)
  const inFlightRef = useRef<boolean>(false)
  const hasStartedRef = useRef<boolean>(false)

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (heartbeatTimerRef.current !== null) window.clearInterval(heartbeatTimerRef.current)
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current)
      heartbeatTimerRef.current = null
      refreshTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!params.enabled) return
    if (!ops || !displayName) return
    // Only start once per set of parameters - use a ref to prevent React 18 double-mount issues
    if (hasStartedRef.current) return
    if (inFlightRef.current) return

    if (!isFirebaseEnabled()) {
      setRes((r) => ({ ...r, status: 'error', error: '未設定 Firebase，無法向 Cloud Functions 取得 JaaS Token。' }))
      return
    }

    const auth = getFirebaseAuth()
    const functions = getFirebaseFunctions()
    if (!auth || !functions) {
      setRes((r) => ({ ...r, status: 'error', error: 'Firebase 初始化失敗。' }))
      return
    }

    // Mark as started to prevent double execution
    hasStartedRef.current = true
    inFlightRef.current = true

    const run = async () => {
      setRes({ status: 'auth', error: null, token: null, slotId: null, counts: null })

      try {
        if (!auth.currentUser) {
          await signInAnonymously(auth)
        }

        const scheduleRefresh = () => {
          if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current)
          refreshTimerRef.current = window.setTimeout(async () => {
            await fetchToken()
          }, 50 * 60 * 1000)
        }

        const fetchToken = async () => {
          setRes((r) => r.status === 'ready' ? r : ({ ...r, status: 'issuing', error: null }))

          try {
            const fn = httpsCallable(functions, 'issueJaasToken')
            const out = await fn({ ops, displayName, role: params.requestedRole })
            const data: any = out.data
            const token = String(data?.token ?? '')
            const slotId = String(data?.slotId ?? '')
            const counts = data?.counts ?? null

            if (!token) throw new Error('Token 取得失敗（空值）')

            setRes({ status: 'ready', error: null, token, slotId: slotId || null, counts })
            scheduleRefresh()

            if (heartbeatTimerRef.current === null) {
              heartbeatTimerRef.current = window.setInterval(async () => {
                try {
                  const hb = httpsCallable(functions, 'heartbeatJaas')
                  await hb({ ops })
                } catch {
                  // noop
                }
              }, 20_000)
            }
          } catch (e: any) {
            const msg = String(e?.message ?? e ?? 'Token 取得失敗')
            setRes((prev) => {
              if (prev.status === 'ready') {
                if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current)
                refreshTimerRef.current = window.setTimeout(fetchToken, 60_000)
                return prev
              }
              return { status: 'error', error: msg, token: null, slotId: null, counts: null }
            })
          }
        }

        await fetchToken()
      } catch (e: any) {
        const msg = String(e?.message ?? e ?? 'Token 取得失敗')
        setRes({ status: 'error', error: msg, token: null, slotId: null, counts: null })
      } finally {
        inFlightRef.current = false
      }
    }

    void run()
  }, [displayName, ops, params.enabled, params.requestedRole])

  return res
}
