import { useEffect, useMemo, useRef, useState } from 'react'
import { loadLibJitsiMeet } from './libJitsiMeetLoader'
import { getJitsiDomain } from './jitsiDefaults'

export type LibJitsiRemote = {
  id: string
  name: string
  videoTrack: any | null
  audioTrack: any | null
}

export type LibJitsiState = {
  status: 'idle' | 'connecting' | 'joined' | 'error'
  error: string | null
  remotes: LibJitsiRemote[]
  micMuted: boolean
  lobby: { status: 'off' | 'joining' | 'waiting' | 'approved' | 'denied'; message?: string | null }
  lobbyPending: Array<{ id: string; displayName: string }>
}

function pickBestVideoTrack(tracks: any[]): any | null {
  const videos = tracks.filter((t) => t && t.getType?.() === 'video')
  if (videos.length === 0) return null
  const camera = videos.find((t) => t.getVideoType?.() === 'camera')
  return camera ?? videos[0]
}

export function useLibJitsiConference(params: {
  room: string
  displayName: string
  enabled: boolean
  mode?: 'viewer' | 'host'
  enableLocalAudio?: boolean
  retry?: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number }
  lobby?: {
    enabled?: boolean
    autoApprove?: boolean
    allowNames?: string[]
  }
}) {
  const [state, setState] = useState<LibJitsiState>({
    status: 'idle',
    error: null,
    remotes: [],
    micMuted: true,
    lobby: { status: 'off', message: null },
    lobbyPending: [],
  })

  const domain = useMemo(() => getJitsiDomain(), [])
  const connectionRef = useRef<any | null>(null)
  const conferenceRef = useRef<any | null>(null)
  const localAudioRef = useRef<any | null>(null)
  const retryTimerRef = useRef<number | null>(null)
  const attemptRef = useRef(0)
  const [restartSeq, setRestartSeq] = useState(0)

  const participantNameRef = useRef<Map<string, string>>(new Map())
  const remoteTracksRef = useRef<Map<string, any[]>>(new Map())
  const receiverHintRef = useRef<{ high: string[]; visible: string[] }>({ high: [], visible: [] })
  const lobbyPendingRef = useRef<Map<string, string>>(new Map())

  const shouldEnableLocalAudio = params.enableLocalAudio ?? (params.mode === 'host' ? false : true)

  const rebuildRemotes = () => {
    const ids = new Set<string>([
      ...Array.from(participantNameRef.current.keys()),
      ...Array.from(remoteTracksRef.current.keys()),
    ])
    const remotes: LibJitsiRemote[] = []
    for (const id of ids) {
      const name = participantNameRef.current.get(id) ?? id
      const tracks = remoteTracksRef.current.get(id) ?? []
      const videoTrack = pickBestVideoTrack(tracks)
      const audioTrack = tracks.find((t) => t && t.getType?.() === 'audio') ?? null
      remotes.push({ id, name, videoTrack, audioTrack })
    }
    remotes.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
    setState((prev) => ({
      ...prev,
      remotes,
      lobbyPending: Array.from(lobbyPendingRef.current.entries()).map(([id, displayName]) => ({ id, displayName })),
    }))
  }

  const normalizedRoom = useMemo(() => {
    const raw = String(params.room ?? '').trim()
    const lower = raw.toLowerCase()
    const safe = lower.replace(/[^a-z0-9_-]/g, '')
    return safe || 'liveops'
  }, [params.room])

  const applyReceiverConstraints = () => {
    const conf = conferenceRef.current
    if (!conf) return

    const visible = Array.from(new Set(receiverHintRef.current.visible.filter(Boolean)))
    const high = Array.from(new Set(receiverHintRef.current.high.filter(Boolean)))

    // 尚未拿到 endpoint id（例如剛入房或尚未完成名稱映射）時，不要把 lastN 設成 0，
    // 否則會導致完全收不到遠端影像/軌道而無法建立映射。
    if (visible.length === 0 && high.length === 0) return

    try {
      conf.setLastN?.(Math.max(0, visible.length))
    } catch {
      // noop
    }

    const constraints = {
      lastN: Math.max(0, visible.length),
      selectedEndpoints: visible,
      defaultConstraints: { maxHeight: 360 },
      constraints: Object.fromEntries(high.map((id) => [id, { maxHeight: 1080 }])),
    }

    try {
      conf.setReceiverConstraints?.(constraints)
    } catch {
      // noop
    }

    try {
      conf.selectParticipants?.(high)
    } catch {
      // noop
    }
  }

  const setLobbyStatus = (status: LibJitsiState['lobby']['status'], message?: string | null) => {
    setState((s) => ({ ...s, lobby: { status, message: message ?? null } }))
  }

  const enableLobbyOnConference = async () => {
    const conf = conferenceRef.current
    if (!conf) return
    try {
      if (typeof conf.enableLobby === 'function') {
        await conf.enableLobby()
        return
      }
    } catch {
      // noop
    }
    try {
      if (conf.lobby && typeof conf.lobby.enable === 'function') {
        await conf.lobby.enable()
      }
    } catch {
      // noop
    }
  }

  const approveLobbyAccess = async (id: string) => {
    const conf = conferenceRef.current
    if (!conf || !id) return
    try {
      if (conf.lobby && typeof conf.lobby.approveAccess === 'function') {
        await conf.lobby.approveAccess(id)
        return
      }
    } catch {
      // noop
    }
    try {
      if (typeof conf.approveLobbyAccess === 'function') {
        await conf.approveLobbyAccess(id)
        return
      }
    } catch {
      // noop
    }
    try {
      if (typeof conf.lobbyApproveAccess === 'function') {
        await conf.lobbyApproveAccess(id)
      }
    } catch {
      // noop
    }
  }

  // meet.jit.si 對 SDK 的 lobby/membersOnly 規則會依房間狀態變動；
  // 此處以「membersOnly => 等待主持人就位後自動重連」策略處理，避免依賴 joinLobby API。

  useEffect(() => {
    if (!params.enabled) return
    if (!params.room) return

    let disposed = false
    setState((s) => ({ ...s, status: 'connecting', error: null }))

    const stop = async () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      try {
        localAudioRef.current?.dispose?.()
      } catch {
        // noop
      }
      localAudioRef.current = null

      try {
        conferenceRef.current?.leave?.()
      } catch {
        // noop
      }
      conferenceRef.current = null

      try {
        connectionRef.current?.disconnect?.()
      } catch {
        // noop
      }
      connectionRef.current = null

      participantNameRef.current.clear()
      remoteTracksRef.current.clear()
    }

    const scheduleRestart = (reason: string, delayMs?: number) => {
      if (disposed) return
      const defaults = params.retry ?? {}
      const maxAttempts =
        typeof defaults.maxAttempts === 'number'
          ? defaults.maxAttempts
          : params.mode === 'host'
            ? 0
            : 12
      const baseDelay = typeof defaults.baseDelayMs === 'number' ? defaults.baseDelayMs : 1200
      const maxDelay = typeof defaults.maxDelayMs === 'number' ? defaults.maxDelayMs : 15000

      attemptRef.current += 1
      if (maxAttempts > 0 && attemptRef.current > maxAttempts) {
        setState((s) => ({ ...s, status: 'error', error: `連線失敗（已達最大重試次數）：${reason}` }))
        return
      }

      const computedDelay =
        typeof delayMs === 'number'
          ? delayMs
          : Math.min(maxDelay, baseDelay * Math.pow(1.4, Math.max(0, attemptRef.current - 1)))

      setState((s) => ({
        ...s,
        status: 'connecting',
        error: `連線不穩定，重試中（${attemptRef.current}${maxAttempts > 0 ? `/${maxAttempts}` : ''}）：${reason}`,
      }))

      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = window.setTimeout(() => {
        if (disposed) return
        setRestartSeq((n) => n + 1)
      }, computedDelay)
    }

    ;(async () => {
      const JitsiMeetJS = await loadLibJitsiMeet(domain)
      if (disposed) return

      const safeDomain = domain
      const hosts = {
        domain: safeDomain,
        anonymousdomain: `guest.${safeDomain}`,
        muc: `conference.${safeDomain}`,
        focus: `focus.${safeDomain}`,
      }
      // 新版 lib-jitsi-meet 已不支援 bosh/websocket 選項，請改用 serviceUrl（對齊 meet.jit.si config.js）
      const serviceUrl = `wss://${safeDomain}/xmpp-websocket`

      const connection = new JitsiMeetJS.JitsiConnection(null, null, {
        hosts,
        serviceUrl,
        clientNode: 'http://jitsi.org/jitsimeet',
      })
      connectionRef.current = connection

      const onConnFailed = (e: any) => {
        if (disposed) return
        scheduleRestart(String(e?.message ?? e ?? '連線失敗（Jitsi）'))
      }
      const onConnDisconnected = () => {
        if (disposed) return
        scheduleRestart('連線中斷（Jitsi）')
      }
      const onConnSuccess = () => {
        if (disposed) return

        let conf: any
        try {
          conf = connection.initJitsiConference(normalizedRoom, {
            openBridgeChannel: true,
          })
        } catch (e: any) {
          scheduleRestart(`會議室初始化失敗：${String(e?.message ?? e ?? '')}`)
          return
        }
        conferenceRef.current = conf

        const confEvents = JitsiMeetJS.events?.conference
        const trackEvents = JitsiMeetJS.events?.track

        const onConferenceFailed = (e: any) => {
          if (disposed) return
          const err = String(e?.error ?? e?.message ?? e ?? '')
          if (err.includes('membersOnly')) {
            setLobbyStatus('waiting', '導播確認身分中...（等待主持人就位）')
            scheduleRestart('membersOnly（等待主持人就位）', 1500)
            return
          }
          scheduleRestart(`加入會議失敗：${String(e?.message ?? e?.error ?? e ?? '')}`)
        }

        const onUserJoined = (id: string, user: any) => {
          const n = user?.getDisplayName?.() ?? user?.getName?.() ?? ''
          if (typeof n === 'string' && n.trim()) participantNameRef.current.set(id, n.trim())
          rebuildRemotes()
        }
        const onUserLeft = (id: string) => {
          participantNameRef.current.delete(id)
          remoteTracksRef.current.delete(id)
          rebuildRemotes()
        }
        const onDisplayNameChanged = (id: string, displayName: string) => {
          if (typeof displayName === 'string' && displayName.trim()) {
            participantNameRef.current.set(id, displayName.trim())
            rebuildRemotes()
          }
        }

        const onTrackAdded = (track: any) => {
          if (!track || track.isLocal?.()) return
          const pid = track.getParticipantId?.()
          if (!pid) return
          try {
            const p = conf.getParticipantById?.(pid)
            const n = p?.getDisplayName?.() ?? p?.getName?.() ?? ''
            if (typeof n === 'string' && n.trim()) participantNameRef.current.set(pid, n.trim())
          } catch {
            // noop
          }
          const list = remoteTracksRef.current.get(pid) ?? []
          remoteTracksRef.current.set(pid, [...list, track])
          rebuildRemotes()
        }
        const onTrackRemoved = (track: any) => {
          if (!track || track.isLocal?.()) return
          const pid = track.getParticipantId?.()
          if (!pid) return
          const list = remoteTracksRef.current.get(pid) ?? []
          remoteTracksRef.current.set(
            pid,
            list.filter((t) => t !== track),
          )
          rebuildRemotes()
        }

        conf.on?.(confEvents?.USER_JOINED ?? 'conference.userJoined', onUserJoined)
        conf.on?.(confEvents?.USER_LEFT ?? 'conference.userLeft', onUserLeft)
        conf.on?.(confEvents?.DISPLAY_NAME_CHANGED ?? 'conference.displayNameChanged', onDisplayNameChanged)
        conf.on?.(confEvents?.TRACK_ADDED ?? 'conference.trackAdded', onTrackAdded)
        conf.on?.(confEvents?.TRACK_REMOVED ?? 'conference.trackRemoved', onTrackRemoved)
        conf.on?.(confEvents?.CONFERENCE_FAILED ?? 'conference.failed', onConferenceFailed)

        // Lobby (best-effort)
        const lobbyUserJoinedEvt = confEvents?.LOBBY_USER_JOINED ?? 'conference.lobbyUserJoined'
        const lobbyUserLeftEvt = confEvents?.LOBBY_USER_LEFT ?? 'conference.lobbyUserLeft'
        const lobbyAccessGrantedEvt = confEvents?.LOBBY_ACCESS_GRANTED ?? 'conference.lobbyAccessGranted'
        const lobbyAccessDeniedEvt = confEvents?.LOBBY_ACCESS_DENIED ?? 'conference.lobbyAccessDenied'

        const shouldApprove = (displayName: string) => {
          if (!params.lobby?.allowNames || params.lobby.allowNames.length === 0) return true
          return params.lobby.allowNames.includes(displayName)
        }

        const onLobbyUserJoined = (e: any) => {
          const id = String(e?.id ?? e?.participantId ?? '')
          const dn = String(e?.displayName ?? e?.name ?? '').trim() || id
          if (!id) return
          lobbyPendingRef.current.set(id, dn)
          rebuildRemotes()
          if (params.mode === 'host' && params.lobby?.autoApprove !== false) {
            if (shouldApprove(dn)) void approveLobbyAccess(id)
          }
        }
        const onLobbyUserLeft = (e: any) => {
          const id = String(e?.id ?? e?.participantId ?? '')
          if (!id) return
          lobbyPendingRef.current.delete(id)
          rebuildRemotes()
        }
        const onLobbyGranted = () => {
          setLobbyStatus('approved', null)
        }
        const onLobbyDenied = () => {
          setLobbyStatus('denied', '導播拒絕加入')
        }

        conf.on?.(lobbyUserJoinedEvt, onLobbyUserJoined)
        conf.on?.(lobbyUserLeftEvt, onLobbyUserLeft)
        conf.on?.(lobbyAccessGrantedEvt, onLobbyGranted)
        conf.on?.(lobbyAccessDeniedEvt, onLobbyDenied)

        conf.on?.(confEvents?.CONFERENCE_JOINED ?? 'conference.joined', () => {
          if (disposed) return
          setState((s) => ({ ...s, status: 'joined', error: null }))
          setLobbyStatus('off', null)
          attemptRef.current = 0
          try {
            conf.setDisplayName?.(params.displayName)
          } catch {
            // noop
          }
          applyReceiverConstraints()

          if (params.mode === 'host' && params.lobby?.enabled) {
            void enableLobbyOnConference()
          }
        })

        conf.join?.()

        // local audio for intercom
        if (shouldEnableLocalAudio) {
          try {
            Promise.resolve(
              JitsiMeetJS.createLocalTracks?.({ devices: ['audio'], audio: true, video: false }),
            )
              .then((tracks: any[]) => {
                if (disposed) return
                const audioTrack = tracks?.find?.((t: any) => t?.getType?.() === 'audio') ?? null
                if (!audioTrack) return
                localAudioRef.current = audioTrack
                try {
                  audioTrack.mute?.()
                } catch {
                  // noop
                }
                setState((s) => ({ ...s, micMuted: true }))
                try {
                  conf.addTrack?.(audioTrack)
                } catch {
                  // noop
                }

                const onMuteChanged = (e: any) => {
                  const muted = !!e?.muted
                  setState((s) => ({ ...s, micMuted: muted }))
                }
                audioTrack.on?.(trackEvents?.TRACK_MUTE_CHANGED ?? 'track.trackMuteChanged', onMuteChanged)
              })
              .catch(() => {})
          } catch {
            // noop
          }
        }
      }

      const connectionEvents = JitsiMeetJS.events?.connection
      connection.addEventListener?.(connectionEvents?.CONNECTION_ESTABLISHED ?? 'connection.connectionEstablished', onConnSuccess)
      connection.addEventListener?.(connectionEvents?.CONNECTION_FAILED ?? 'connection.connectionFailed', onConnFailed)
      connection.addEventListener?.(connectionEvents?.CONNECTION_DISCONNECTED ?? 'connection.connectionDisconnected', onConnDisconnected)

      connection.connect?.()
    })().catch((e) => {
      if (!disposed) setState((s) => ({ ...s, status: 'error', error: e instanceof Error ? e.message : String(e) }))
    })

    return () => {
      disposed = true
      void stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.enabled, params.room, params.displayName, params.enableLocalAudio, params.mode, domain, restartSeq])

  const api = useMemo(() => {
    return {
      toggleMic: () => {
        const t = localAudioRef.current
        if (!t) return
        try {
          if (t.isMuted?.()) t.unmute?.()
          else t.mute?.()
        } catch {
          // noop
        }
      },
      setMicMuted: (muted: boolean) => {
        const t = localAudioRef.current
        if (!t) return
        try {
          if (muted) t.mute?.()
          else t.unmute?.()
        } catch {
          // noop
        }
      },
      setReceiverHints: (highEndpointIds: string[], visibleEndpointIds: string[]) => {
        receiverHintRef.current = { high: highEndpointIds ?? [], visible: visibleEndpointIds ?? [] }
        applyReceiverConstraints()
      },
      enableLobby: () => enableLobbyOnConference(),
      approveLobbyAccess: (id: string) => approveLobbyAccess(id),
    }
  }, [])

  return { state, conferenceRef, api }
}
