import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import {
  createDefaultSignalState,
  normalizeSignalState,
  type RoutingTableV2,
  type SignalStateV1,
} from './types'
import { getFirebaseDatabase, isFirebaseEnabled } from './firebase'
import { off, onValue, ref, set } from 'firebase/database'

const STORAGE_KEY_PREFIX = 'liveops.signal.v1:'
const CHANNEL_PREFIX = 'liveops-signal:'

type SignalContextValue = {
  state: SignalStateV1
  setRouting: (routing: RoutingTableV2) => void
  setMarquee: (text: string) => void
  setCollectorToken: (token: string | null) => void
  setConferenceStarted: (started: boolean, startedBy?: string) => void
  setHostBoundEmail: (email: string | null) => void
  sync: { mode: 'firebase' | 'ws' | 'local'; connected: boolean; error: string | null }
}

export const SignalContext = createContext<SignalContextValue | null>(null)

function readStoredState(room: string, storageKey: string): SignalStateV1 | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return normalizeSignalState(room, parsed)
  } catch {
    return null
  }
}

function writeStoredState(storageKey: string, state: SignalStateV1) {
  localStorage.setItem(storageKey, JSON.stringify(state))
}

export function SignalProvider(props: { room: string; children: React.ReactNode }) {
  const storageKey = useMemo(() => `${STORAGE_KEY_PREFIX}${props.room}`, [props.room])
  const firebaseEnabled = useMemo(() => isFirebaseEnabled(), [])
  const firebaseDb = useMemo(() => (firebaseEnabled ? getFirebaseDatabase() : null), [firebaseEnabled])
  const firebasePath = useMemo(() => `liveops/v1/rooms/${props.room}/state`, [props.room])
  const wsExplicitUrl = useMemo(() => import.meta.env.VITE_SIGNAL_WS_URL as string | undefined, [])
  const wsUrl = useMemo(() => {
    if (wsExplicitUrl) return wsExplicitUrl
    const isHttps = window.location.protocol === 'https:'
    const proto = isHttps ? 'wss' : 'ws'
    return `${proto}://${window.location.hostname}:8787`
  }, [wsExplicitUrl])

  const [state, setState] = useState<SignalStateV1>(() => {
    return readStoredState(props.room, storageKey) ?? createDefaultSignalState(props.room)
  })

  const [wsReady, setWsReady] = useState(false)
  const [firebaseReady, setFirebaseReady] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const ws = useMemo(() => {
    if (firebaseDb) return null
    // Production on Firebase Hosting doesn't have a co-located WS server by default.
    // Only try WS if user explicitly configured it, or we are on localhost.
    const host = window.location.hostname
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1'
    if (!wsExplicitUrl && !isLocalhost) return null
    try {
      return new WebSocket(wsUrl)
    } catch {
      return null
    }
  }, [firebaseDb, wsExplicitUrl, wsUrl])

  useEffect(() => {
    if (state.session.opsId === props.room) return
    setState(() => {
      const stored = readStoredState(props.room, storageKey)
      if (stored?.session?.opsId === props.room) return stored
      return createDefaultSignalState(props.room)
    })
  }, [props.room, state.session.opsId, storageKey])

  const channel = useMemo(() => {
    if (!('BroadcastChannel' in window)) return null
    return new BroadcastChannel(`${CHANNEL_PREFIX}${props.room}`)
  }, [props.room])

  useEffect(() => {
    return () => {
      try {
        channel?.close?.()
      } catch {
        // noop
      }
    }
  }, [channel])

  useEffect(() => {
    if (!ws) return

    const onOpen = () => {
      setWsReady(true)
      setSyncError(null)
      try {
        ws.send(JSON.stringify({ type: 'subscribe', room: props.room }))
      } catch {
        // noop
      }
    }
    const onClose = () => setWsReady(false)
    const onError = () => {
      setWsReady(false)
      setSyncError('WebSocket 連線失敗（跨裝置同步未啟用）')
    }
    const onMessage = (evt: MessageEvent) => {
      let msg: any
      try {
        msg = JSON.parse(String(evt.data))
      } catch {
        return
      }
      if (msg?.type !== 'state') return
      if (msg?.state === null) {
        try {
          ws.send(JSON.stringify({ type: 'set', room: props.room, state }))
        } catch {
          // noop
        }
        return
      }
      if (!msg?.state) return
      const incoming = normalizeSignalState(props.room, msg.state)
      if (incoming?.session?.opsId !== props.room) return
      setState((prev) => {
        if ((incoming.updatedAt ?? 0) <= (prev.updatedAt ?? 0)) return prev
        writeStoredState(storageKey, incoming)
        return incoming
      })
    }

    ws.addEventListener('open', onOpen)
    ws.addEventListener('close', onClose)
    ws.addEventListener('error', onError)
    ws.addEventListener('message', onMessage)
    return () => {
      ws.removeEventListener('open', onOpen)
      ws.removeEventListener('close', onClose)
      ws.removeEventListener('error', onError)
      ws.removeEventListener('message', onMessage)
      try {
        ws.close()
      } catch {
        // noop
      }
    }
  }, [props.room, state, storageKey, ws])

  useEffect(() => {
    if (!firebaseDb) return

    const dbRef = ref(firebaseDb, firebasePath)
    const unsub = onValue(
      dbRef,
      (snap) => {
        setFirebaseReady(true)
        setSyncError(null)
        const val = snap.val()
        if (!val) {
          // Seed initial state for this room if empty.
          try {
            set(dbRef, state)
          } catch {
            // noop
          }
          return
        }
        const incoming = normalizeSignalState(props.room, val)
        if (incoming?.session?.opsId !== props.room) return
        setState((prev) => {
          if ((incoming.updatedAt ?? 0) <= (prev.updatedAt ?? 0)) return prev
          writeStoredState(storageKey, incoming)
          return incoming
        })
      },
      (err) => {
        setFirebaseReady(false)
        setSyncError(`Firebase 同步失敗：${String((err as any)?.message ?? err ?? '')}`)
      },
    )

    return () => {
      try {
        unsub()
      } catch {
        // noop
      }
      try {
        off(dbRef)
      } catch {
        // noop
      }
    }
  }, [firebaseDb, firebasePath, props.room, state, storageKey])

  const commit = useCallback(
    (next: SignalStateV1) => {
      setState(next)
      writeStoredState(storageKey, next)

      if (firebaseDb) {
        try {
          set(ref(firebaseDb, firebasePath), next)
          setSyncError(null)
        } catch (e) {
          setSyncError(`Firebase 寫入失敗：${String((e as any)?.message ?? e ?? '')}`)
        }
        channel?.postMessage({ type: 'state', state: next })
        return
      }

      if (ws && wsReady) {
        try {
          ws.send(JSON.stringify({ type: 'set', room: props.room, state: next }))
        } catch {
          // noop
        }
      }
      channel?.postMessage({ type: 'state', state: next })
    },
    [channel, firebaseDb, firebasePath, props.room, storageKey, ws, wsReady],
  )

  useEffect(() => {
    const onMessage = (evt: MessageEvent) => {
      const msg = evt.data as any
      if (msg?.type !== 'state') return
      const incoming = normalizeSignalState(props.room, msg?.state)
      if (incoming?.session?.opsId !== props.room) return
      setState((prev) => {
        if ((incoming.updatedAt ?? 0) <= (prev.updatedAt ?? 0)) return prev
        writeStoredState(storageKey, incoming)
        return incoming
      })
    }
    channel?.addEventListener('message', onMessage)
    return () => channel?.removeEventListener('message', onMessage)
  }, [channel, props.room, storageKey])

  useEffect(() => {
    const onStorage = (evt: StorageEvent) => {
      if (evt.key !== storageKey) return
      const stored = readStoredState(props.room, storageKey)
      if (!stored) return
      setState((prev) => ((stored.updatedAt ?? 0) > (prev.updatedAt ?? 0) ? stored : prev))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [props.room, storageKey])

  const value = useMemo<SignalContextValue>(() => {
    const sync = (() => {
      if (firebaseDb) return { mode: 'firebase' as const, connected: firebaseReady, error: syncError }
      if (ws) return { mode: 'ws' as const, connected: wsReady, error: syncError }
      return { mode: 'local' as const, connected: true, error: syncError }
    })()
    return {
      state,
      sync,
      setRouting: (routing) => {
        commit({
          ...state,
          updatedAt: Date.now(),
          routing,
        })
      },
      setMarquee: (text) => {
        const now = Date.now()
        commit({
          ...state,
          updatedAt: now,
          marquee: { text, updatedAt: now },
        })
      },
      setCollectorToken: (token) => {
        const now = Date.now()
        commit({
          ...state,
          updatedAt: now,
          collector: { token, updatedAt: now },
        })
      },
      setConferenceStarted: (started, startedBy) => {
        const now = Date.now()
        commit({
          ...state,
          updatedAt: now,
          conference: {
            started,
            startedAt: started ? now : null,
            startedBy: started ? (startedBy ?? null) : null,
          },
        })
      },
      setHostBoundEmail: (email) => {
        const now = Date.now()
        commit({
          ...state,
          updatedAt: now,
          host: { boundGoogleEmail: email, updatedAt: now },
        })
      },
    }
  }, [commit, firebaseDb, firebaseReady, state, syncError, ws, wsReady])

  return <SignalContext.Provider value={value}>{props.children}</SignalContext.Provider>
}
