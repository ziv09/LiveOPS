import { useContext } from 'react'
import { SignalContext } from './SignalProvider'

export function useSignal() {
  const ctx = useContext(SignalContext)
  if (!ctx) {
    throw new Error('useSignal 必須在 <SignalProvider> 內使用')
  }
  return ctx
}

