import { useEffect, useRef, useState } from 'react'
import { getGoogleClientId, googleUserFromIdToken, loadGoogleScript, writeGoogleUser } from '../auth/googleAuth'

export function GoogleSignInButton(props: {
  onSignedIn?: () => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    const clientId = getGoogleClientId()
    if (!clientId) {
      setError('尚未設定 VITE_GOOGLE_CLIENT_ID')
      return
    }

    loadGoogleScript()
      .then(() => {
        if (disposed) return
        setError(null)
        const container = containerRef.current
        if (!container) return
        container.innerHTML = ''

        // @ts-expect-error - google identity global
        const g = window.google
        if (!g?.accounts?.id) {
          setError('Google Identity 服務未載入')
          return
        }

        g.accounts.id.initialize({
          client_id: clientId,
          callback: (resp: any) => {
            const idToken = resp?.credential
            if (!idToken || typeof idToken !== 'string') return
            const user = googleUserFromIdToken(idToken)
            if (!user) {
              setError('Google 登入失敗（無法取得 email）')
              return
            }
            writeGoogleUser(user)
            props.onSignedIn?.()
          },
        })

        g.accounts.id.renderButton(container, {
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'signin_with',
          width: 260,
        })
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))

    return () => {
      disposed = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="grid gap-2">
      <div ref={containerRef} />
      {error ? <div className="text-xs text-red-200">{error}</div> : null}
    </div>
  )
}

