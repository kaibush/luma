import type { ServerMessage } from '@remote/protocol'

export async function api<T>(
  path: string,
  token: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Remote-Request': '1',
    },
  })
  if (!response.ok) {
    if (response.status === 401 && !token)
      window.dispatchEvent(new Event('remote-auth-expired'))
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `请求失败 (${response.status})`)
  }
  return response.status === 204 ? (undefined as T) : response.json()
}
export function signaling(
  auth: object,
  onMessage: (message: ServerMessage) => void,
  onClose: (event: CloseEvent) => void
) {
  const ws = new WebSocket(
    `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`
  )
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', ...auth }))
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data))
    } catch {
      ws.close()
    }
  }
  ws.onclose = onClose
  return ws
}
export function sendSignal(ws: WebSocket | undefined, message: object) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
}
