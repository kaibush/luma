import type { ServerMessage } from '@remote/protocol'

export type Share = {
  hostId: string | null
  permission: 'view' | 'control'
  id: string
  name: string
  key: string
  enabled: boolean
  online: boolean
  viewers: number
  expiresAt: number | null
  createdAt: number
}
export type ShareMessage = ServerMessage & {
  sessionId?: string
  textInput?: string
}
export function shareLink(share: Share) {
  return `${location.origin}/share/${share.id}${share.hostId ? '' : `#key=${encodeURIComponent(share.key)}`}`
}
export function shareSocket(
  auth: object,
  message: (value: ShareMessage) => void,
  close: (event: CloseEvent) => void
) {
  const ws = new WebSocket(
    `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/share-ws`
  )
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', ...auth }))
  ws.onmessage = (e) => {
    try {
      message(JSON.parse(e.data))
    } catch {
      ws.close()
    }
  }
  ws.onclose = close
  return ws
}
