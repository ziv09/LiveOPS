export {}

declare global {
  interface Window {
    JitsiMeetExternalAPI?: new (
      domain: string,
      options: {
        roomName: string
        parentNode: HTMLElement
        width?: string | number
        height?: string | number
        userInfo?: { displayName?: string }
        configOverwrite?: Record<string, unknown>
        interfaceConfigOverwrite?: Record<string, unknown>
        jwt?: string
      },
    ) => {
      addListener: (
        event: string,
        handler: (payload?: any) => void,
      ) => void
      removeListener: (
        event: string,
        handler: (payload?: any) => void,
      ) => void
      executeCommand: (command: string, ...args: any[]) => void
      getParticipantsInfo?: () => Promise<
        Array<{ participantId: string; displayName?: string }>
      >
      getParticipants?: () => Promise<string[]>
      getVideoQuality?: () => Promise<any>
      getAvailableDevices?: () => Promise<{
        audioInput?: Array<{ deviceId: string; label: string }>
        videoInput?: Array<{ deviceId: string; label: string }>
      }>
      setAudioInputDevice?: (deviceId: string) => Promise<void>
      setVideoInputDevice?: (deviceId: string) => Promise<void>
      dispose: () => void
    }
  }
}
