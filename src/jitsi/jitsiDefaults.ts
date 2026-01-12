export function getJitsiDomain(): string {
  const raw = (import.meta.env.VITE_JITSI_DOMAIN as string | undefined) ?? 'meet.jit.si'
  return raw.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

export function getJitsiScriptSrc(domain: string): string {
  return `https://${domain}/external_api.js`
}

export function getBaseConfigOverwrite(): Record<string, unknown> {
  return {
    prejoinPageEnabled: false,
    prejoinConfig: { enabled: false },
    disableDeepLinking: true,
    disableInviteFunctions: true,
    disableChat: true,
    disableRaiseHand: true,
    disableReactions: true,
    disablePolls: true,
    disableSelfView: true,
    enableWelcomePage: false,
    hideConferenceSubject: true,
    hideConferenceTimer: true,
    startConferenceOnEnter: true,
    requireDisplayName: false,
    toolbarConfig: { alwaysVisible: false },
    notifications: [],
    lobby: { enabled: false },
  }
}

export function getBaseInterfaceConfigOverwrite(): Record<string, unknown> {
  return {
    TOOLBAR_BUTTONS: [],
    SETTINGS_SECTIONS: [],
    SHOW_JITSI_WATERMARK: false,
    SHOW_WATERMARK_FOR_GUESTS: false,
    SHOW_BRAND_WATERMARK: false,
    BRAND_WATERMARK_LINK: '',
    DISPLAY_WELCOME_PAGE_CONTENT: false,
    DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
    DISABLE_VIDEO_BACKGROUND: true,
    DEFAULT_BACKGROUND: '#0a0a0a',
  }
}
