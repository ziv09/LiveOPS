export function focusParticipant(api: any, participantId: string | null | undefined) {
  if (!api || !participantId) return
  try {
    api.executeCommand('setLargeVideoParticipant', participantId)
    return
  } catch {
    // fallthrough
  }
  try {
    api.executeCommand('pinParticipant', participantId)
  } catch {
    // noop
  }
}

export function setAllParticipantVolume(api: any, volume: number) {
  if (!api) return
  const safeVolume = Math.max(0, Math.min(1, volume))
  const setVolume = (participantId: string) => {
    try {
      api.executeCommand('setParticipantVolume', participantId, safeVolume)
    } catch {
      // noop
    }
  }

  Promise.resolve(api.getParticipantsInfo?.())
    .then((list: Array<{ participantId: string }>) => {
      if (!Array.isArray(list)) return
      for (const p of list) setVolume(p.participantId)
    })
    .catch(() => {})

  const onJoin = (e: any) => setVolume(e?.id ?? e?.participantId)
  try {
    api.addListener?.('participantJoined', onJoin)
  } catch {
    // noop
  }
  return () => {
    try {
      api.removeListener?.('participantJoined', onJoin)
    } catch {
      // noop
    }
  }
}

