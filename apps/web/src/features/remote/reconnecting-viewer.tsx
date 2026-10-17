import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from 'react'
import type { IceServer, Session } from '@remote/protocol'
import { api } from './api'
import { Viewer } from './viewer'

export function ReconnectingViewer(props: ComponentProps<typeof Viewer>) {
  const [recoveryHint, setRecoveryHint] = useState('')
  const [active, setActive] = useState({
    session: props.session,
    iceServers: props.iceServers,
  })
  const activeRef = useRef(active)
  activeRef.current = active
  const disposed = useRef(false),
    recovering = useRef(false),
    attempts = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    disposed.current = false
    return () => {
      disposed.current = true
      clearTimeout(timer.current)
    }
  }, [])
  const recover = useCallback(() => {
    if (recovering.current || disposed.current || attempts.current >= 8) return
    recovering.current = true
    const attempt = async () => {
      if (disposed.current) return
      attempts.current++
      setRecoveryHint(`正在恢复连接（${attempts.current}/8）…`)
      const old = activeRef.current.session
      try {
        await api(`/sessions/${old.id}`, props.token, { method: 'DELETE' })
        const next = await api<{ session: Session; iceServers: IceServer[] }>(
          '/sessions',
          props.token,
          {
            method: 'POST',
            body: JSON.stringify({
              hostId: props.host.id,
              quality: old.quality,
              audio: old.audio,
            }),
          }
        )
        if (disposed.current) {
          await api(`/sessions/${next.session.id}`, props.token, {
            method: 'DELETE',
          })
          return
        }
        recovering.current = false
        setRecoveryHint('')
        setActive(next)
      } catch {
        if (!disposed.current && attempts.current < 8)
          timer.current = setTimeout(
            () => void attempt(),
            Math.min(15000, 1000 * 2 ** attempts.current)
          )
        else {
          recovering.current = false
          if (!disposed.current)
            setRecoveryHint('自动恢复未成功，请返回主机列表重试')
        }
      }
    }
    timer.current = setTimeout(() => void attempt(), 1000)
  }, [props.host.id, props.token])
  return (
    <Viewer
      {...props}
      {...active}
      key={active.session.id}
      onRecover={recover}
      recoveryHint={recoveryHint}
      onExit={() => {
        disposed.current = true
        clearTimeout(timer.current)
        props.onExit()
      }}
    />
  )
}
