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
}) {
  const [state, setState] = useState<LibJitsiState>({
    status: 'idle',
    error: null,
    remotes: [],
    micMuted: true,
  })

  const domain = useMemo(() => getJitsiDomain(), [])
  const connectionRef = useRef<any | null>(null)
  const conferenceRef = useRef<any | null>(null)
  const localAudioRef = useRef<any | null>(null)

  const participantNameRef = useRef<Map<string, string>>(new Map())
  const remoteTracksRef = useRef<Map<string, any[]>>(new Map())
  const receiverHintRef = useRef<{ high: string[]; visible: string[] }>({ high: [], visible: [] })

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
    setState((prev) => ({ ...prev, remotes }))
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
      defaultConstraints: { maxHeight: 180 },
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

  useEffect(() => {
    if (!params.enabled) return
    if (!params.room) return

    let disposed = false
    setState((s) => ({ ...s, status: 'connecting', error: null }))

    const stop = async () => {
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
        setState((s) => ({
          ...s,
          status: 'error',
          error: `連線失敗（Jitsi）${e?.message ? `：${String(e.message)}` : ''}`,
        }))
      }
      const onConnDisconnected = () => {
        if (disposed) return
        setState((s) => ({ ...s, status: 'error', error: '連線中斷（Jitsi）' }))
      }
      const onConnSuccess = () => {
        if (disposed) return

        let conf: any
        try {
          conf = connection.initJitsiConference(normalizedRoom, {
            openBridgeChannel: true,
          })
        } catch (e: any) {
          setState((s) => ({
            ...s,
            status: 'error',
            error: `會議室初始化失敗：${String(e?.message ?? e ?? '')}`,
          }))
          return
        }
        conferenceRef.current = conf

        const confEvents = JitsiMeetJS.events?.conference
        const trackEvents = JitsiMeetJS.events?.track

        const onConferenceFailed = (e: any) => {
          if (disposed) return
          setState((s) => ({
            ...s,
            status: 'error',
            error: `加入會議失敗：${String(e?.message ?? e?.error ?? e ?? '')}`,
          }))
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

        conf.on?.(confEvents?.CONFERENCE_JOINED ?? 'conference.joined', () => {
          if (disposed) return
          setState((s) => ({ ...s, status: 'joined', error: null }))
          try {
            conf.setDisplayName?.(params.displayName)
          } catch {
            // noop
          }
          applyReceiverConstraints()
        })

        conf.join?.()

        // local audio for intercom
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
  }, [params.enabled, params.room, params.displayName, domain])

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
    }
  }, [])

  return { state, conferenceRef, api }
}
