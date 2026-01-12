import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  getBaseConfigOverwrite,
  getBaseInterfaceConfigOverwrite,
  getJitsiDomain,
  getJitsiScriptSrc,
} from '../jitsi/jitsiDefaults'

type JitsiPlayerProps = {
  room: string
  displayName: string
  className?: string
  hidden?: boolean
  configOverwrite?: Record<string, unknown>
  interfaceConfigOverwrite?: Record<string, unknown>
  onApi?: (api: any | null) => void
}

function loadExternalApiScript(domain: string) {
  const scriptId = `jitsi-external-api:${domain}`
  const existing = document.getElementById(scriptId) as HTMLScriptElement | null
  if (existing?.dataset.loaded === 'true') return Promise.resolve()

  if (existing) {
    return new Promise<void>((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('載入 Jitsi External API 失敗')), {
        once: true,
      })
    })
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.id = scriptId
    script.src = getJitsiScriptSrc(domain)
    script.async = true
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true'
      resolve()
    })
    script.addEventListener('error', () => reject(new Error('載入 Jitsi External API 失敗')))
    document.head.appendChild(script)
  })
}

export function JitsiPlayer(props: JitsiPlayerProps) {
  const domain = useMemo(() => getJitsiDomain(), [])
  const parentRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<any | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false

    async function start() {
      setError(null)
      await loadExternalApiScript(domain)
      if (disposed) return
      if (!window.JitsiMeetExternalAPI) throw new Error('JitsiMeetExternalAPI 未載入')
      if (!parentRef.current) throw new Error('Jitsi 容器不存在')

      const api = new window.JitsiMeetExternalAPI(domain, {
        roomName: props.room,
        parentNode: parentRef.current,
        width: '100%',
        height: '100%',
        userInfo: { displayName: props.displayName },
        configOverwrite: {
          ...getBaseConfigOverwrite(),
          ...(props.configOverwrite ?? {}),
        },
        interfaceConfigOverwrite: {
          ...getBaseInterfaceConfigOverwrite(),
          ...(props.interfaceConfigOverwrite ?? {}),
        },
      })

      apiRef.current = api
      props.onApi?.(api)
    }

    start().catch((e) => {
      if (!disposed) setError(e instanceof Error ? e.message : String(e))
    })

    return () => {
      disposed = true
      props.onApi?.(null)
      try {
        apiRef.current?.dispose?.()
      } catch {
        // noop
      }
      apiRef.current = null
      if (parentRef.current) parentRef.current.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, props.room])

  return (
    <div className={clsx('relative h-full w-full bg-neutral-950', props.className)}>
      <div
        ref={parentRef}
        className={clsx(
          'h-full w-full',
          props.hidden && 'pointer-events-none opacity-0',
        )}
      />
      {error && (
        <div className="absolute inset-0 grid place-items-center bg-neutral-950/90 p-4 text-sm text-red-200">
          <div className="max-w-md rounded-lg border border-red-500/30 bg-red-950/40 p-4">
            <div className="mb-2 font-semibold">Jitsi 載入失敗</div>
            <div className="break-words">{error}</div>
          </div>
        </div>
      )}
    </div>
  )
}
