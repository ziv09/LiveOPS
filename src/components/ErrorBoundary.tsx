import React from 'react'

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null; errorInfo: React.ErrorInfo | null }
> {
  state: { error: Error | null; errorInfo: React.ErrorInfo | null } = {
    error: null,
    errorInfo: null,
  }

  static getDerivedStateFromError(error: Error) {
    return { error, errorInfo: null }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ error, errorInfo })
    // Keep a console trace for debugging on user device.
    // eslint-disable-next-line no-console
    console.error('[LiveOPS] Uncaught render error', error, errorInfo)
  }

  render() {
    const error = this.state.error
    if (!error) return this.props.children

    return (
      <div className="min-h-full bg-neutral-950 p-6 text-neutral-100">
        <div className="mx-auto max-w-3xl rounded-2xl border border-red-500/30 bg-red-950/20 p-5">
          <div className="text-lg font-semibold text-red-100">LiveOPS 發生錯誤</div>
          <div className="mt-2 text-sm text-red-200 break-words">{error.message}</div>
          <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 text-xs text-neutral-200">
            <div className="font-mono whitespace-pre-wrap">{error.stack}</div>
          </div>
          <button
            className="mt-4 h-10 rounded-lg bg-neutral-100 px-3 text-sm font-semibold text-neutral-950 hover:bg-white"
            onClick={() => window.location.reload()}
          >
            重新整理
          </button>
        </div>
      </div>
    )
  }
}
