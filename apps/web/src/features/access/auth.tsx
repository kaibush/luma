import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { Navigate, useLocation } from '@tanstack/react-router'
import { getWorkspaceName } from '@/config/branding'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export interface ConnectionSettings {
  workspaceName: string
  defaultQuality: 'responsive' | 'balanced' | 'sharp'
  sessionMinutes: number
  stunUrl: string
  turnUrl: string
  turnSecretSet?: boolean
  turnConfigured?: boolean
}
export interface AuthState {
  initialized: boolean
  user: { username: string } | null
  workspaceName: string
}
export async function request<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST'
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      'X-Remote-Request': '1',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const value = response.status === 204 ? {} : await response.json()
  if (response.status === 401 && path.startsWith('/manage/'))
    window.dispatchEvent(new Event('remote-auth-expired'))
  if (!response.ok)
    throw new Error(value.error || `请求失败 (${response.status})`)
  return value
}
const Context = createContext<{
  state: AuthState
  refresh: () => Promise<void>
  logout: () => Promise<void>
} | null>(null)
export function useRemoteAuth() {
  const context = useContext(Context)
  if (!context) throw new Error('Missing RemoteAuth')
  return context
}
export function AuthRoot({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null),
    [error, setError] = useState('')
  const pathname = useLocation({ select: (l) => l.pathname })
  const refresh = async () => {
    try {
      setState(await request<AuthState>('/auth/me'))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    let mounted = true
    const load = () => {
      void request<AuthState>('/auth/me')
        .then((s) => {
          if (mounted) {
            setState(s)
            setError('')
          }
        })
        .catch((e) => {
          if (mounted) setError(e.message)
        })
    }
    load()
    const timer = setInterval(load, 60000)
    window.addEventListener('remote-auth-expired', load)
    return () => {
      mounted = false
      clearInterval(timer)
      window.removeEventListener('remote-auth-expired', load)
    }
  }, [])
  const logout = async () => {
    await request('/auth/logout', {})
    await refresh()
  }
  if (!state)
    return (
      <main className='mx-auto flex max-w-md flex-col gap-4 p-8'>
        {error ? (
          <>
            <Alert variant='destructive'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button onClick={() => void refresh()}>重新连接</Button>
          </>
        ) : (
          <>
            <p>正在连接控制台…</p>
            <Skeleton className='h-48 w-full' />
          </>
        )}
      </main>
    )
  let content = children
  if (
    pathname !== '/host' &&
    pathname !== '/guide' &&
    !pathname.startsWith('/guide/') &&
    !pathname.startsWith('/share/')
  ) {
    if (!state.initialized && pathname !== '/setup')
      content = <Navigate to='/setup' replace />
    else if (state.initialized && !state.user && pathname !== '/login')
      content = <Navigate to='/login' replace />
    else if (state.user && ['/setup', '/login', '/sign-in'].includes(pathname))
      content = <Navigate to='/' replace />
  }
  return (
    <Context.Provider
      value={{
        state: {
          ...state,
          workspaceName: getWorkspaceName(state.workspaceName),
        },
        refresh,
        logout,
      }}
    >
      {content}
    </Context.Provider>
  )
}
