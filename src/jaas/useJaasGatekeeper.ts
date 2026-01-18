import { useEffect, useMemo, useRef, useState } from 'react'
import { signInAnonymously } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { getFirebaseAuth, getFirebaseDatabase, getFirebaseFunctions, isFirebaseEnabled } from '../signal/firebase'
import { onValue, ref } from 'firebase/database'
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

  // Reset hasStartedRef when key parameters change so new token can be fetched
  const paramsKey = `${ops}|${displayName}|${params.requestedRole}`
  const lastParamsKeyRef = useRef<string>('')
  useEffect(() => {
    if (lastParamsKeyRef.current !== paramsKey) {
      lastParamsKeyRef.current = paramsKey
      hasStartedRef.current = false
    }
  }, [paramsKey])

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
    const db = getFirebaseDatabase()
    const functions = getFirebaseFunctions()
    if (!auth || !db || !functions) {
      setRes((r) => ({ ...r, status: 'error', error: 'Firebase 初始化失敗。' }))
      return
    }

    // Mark as started to prevent double execution
    hasStartedRef.current = true
    inFlightRef.current = true

    // Keep track of DB listener
    let dbUnsub: (() => void) | undefined

    const run = async () => {
      setRes({ status: 'auth', error: null, token: null, slotId: null, counts: null })

      try {
        if (!auth.currentUser) {
          await signInAnonymously(auth)
        }
        const currentUserUid = auth.currentUser?.uid

        const scheduleRefresh = () => {
          if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current)
          refreshTimerRef.current = window.setTimeout(async () => {
            // Cleanup old listener before refreshing
            if (dbUnsub) { dbUnsub(); dbUnsub = undefined }
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

            console.log('[JaasGatekeeper] Token received, setting status to ready')
            setRes({ status: 'ready', error: null, token, slotId: slotId || null, counts })
            scheduleRefresh()

            // Heartbeat
            if (heartbeatTimerRef.current === null) {
              heartbeatTimerRef.current = window.setInterval(async () => {
                try {
                  const hb = httpsCallable(functions, 'heartbeatJaas')
                  await hb({ ops })
                } catch { }
              }, 20_000)
            }

            // KICK DETECTION: Listen to my slot
            if (slotId && currentUserUid) {
              if (dbUnsub) dbUnsub() // Clear previous if any
              const slotRef = ref(db, `liveops/v2/jaas/rooms/${ops}/state/allocations/${slotId}`)
              dbUnsub = onValue(slotRef, (snap) => {
                const val = snap.val()
                // If slot is gone, OR occupied by someone else (shouldn't happen if slotId unique, but check UID)
                if (!val || val.uid !== currentUserUid) {
                  console.warn('[JaasGatekeeper] Slot lost (kick or expire).')
                  setRes({ status: 'error', error: '您已被移出會議室（釋放或逾時）。', token: null, slotId: null, counts: null })
                  if (dbUnsub) { dbUnsub(); dbUnsub = undefined }
                  if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current)
                  if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
                }
              })
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

    // Cleanup function for this effect
    return () => {
      if (dbUnsub) dbUnsub()
    }
  }, [displayName, ops, params.enabled, params.requestedRole])

  return res
}
