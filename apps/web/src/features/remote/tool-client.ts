export class ToolClient {
  private pending = new Map<
    string,
    {
      resolve: (v: unknown) => void
      reject: (e: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  onEvent?: (event: { event: string; text?: string }) => void
  constructor(private channel: RTCDataChannel) {
    channel.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data.length > 60000) return
      try {
        const value = JSON.parse(e.data)
        if (value.event) {
          this.onEvent?.(value)
          return
        }
        const call = this.pending.get(value.id)
        if (!call) return
        clearTimeout(call.timer)
        this.pending.delete(value.id)
        if (value.error) call.reject(new Error(value.error))
        else call.resolve(value.result)
      } catch {
        /* Invalid messages are ignored. */
      }
    }
    channel.onclose = () => this.close()
  }
  call<T = unknown>(
    op: string,
    args: Record<string, unknown> = {}
  ): Promise<T> {
    if (
      this.channel.readyState !== 'open' ||
      this.channel.bufferedAmount > 65536 ||
      this.pending.size >= 32
    )
      return Promise.reject(new Error('工具通道尚未连接或正在忙碌'))
    const id = crypto.randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('操作超时，请重新连接'))
      }, 20000)
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject, timer })
      try {
        this.channel.send(JSON.stringify({ id, op, ...args }))
      } catch {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error('工具通道已断开'))
      }
    })
  }
  close() {
    for (const call of this.pending.values()) {
      clearTimeout(call.timer)
      call.reject(new Error('会话已断开'))
    }
    this.pending.clear()
  }
}
