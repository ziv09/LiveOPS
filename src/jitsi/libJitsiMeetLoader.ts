import { getJitsiDomain } from './jitsiDefaults'
import { getLibJitsiMeetScriptSrc } from './jitsiDefaults'

function loadScript(src: string, id: string): Promise<void> {
  const existing = document.getElementById(id) as HTMLScriptElement | null
  if (existing?.dataset.loaded === 'true') return Promise.resolve()
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error(`載入失敗：${src}`)), { once: true })
    })
  }

  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.id = id
    s.src = src
    s.async = true
    s.defer = true
    s.addEventListener('load', () => {
      s.dataset.loaded = 'true'
      resolve()
    })
    s.addEventListener('error', () => reject(new Error(`載入失敗：${src}`)))
    document.head.appendChild(s)
  })
}

export async function loadLibJitsiMeet(domain = getJitsiDomain()): Promise<any> {
  const safeDomain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const src = getLibJitsiMeetScriptSrc(safeDomain)
  const id = `lib-jitsi-meet:${safeDomain}`
  await loadScript(src, id)
  const JitsiMeetJS = window.JitsiMeetJS
  if (!JitsiMeetJS) throw new Error('JitsiMeetJS 未載入（lib-jitsi-meet）')

  try {
    JitsiMeetJS.setLogLevel?.(JitsiMeetJS.logLevels?.ERROR ?? 'ERROR')
  } catch {
    // noop
  }

  try {
    // init should be idempotent in practice; ignore failures on re-init
    JitsiMeetJS.init?.({ disableAudioLevels: true })
  } catch {
    // noop
  }

  return JitsiMeetJS
}
