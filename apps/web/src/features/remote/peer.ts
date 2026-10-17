import {
  inputSchema,
  qualityProfiles,
  type IceServer,
  type InputEvent,
  type Quality,
  type Signal,
} from '@remote/protocol'
import { ToolClient } from './tool-client'

export interface Telemetry {
  fps?: number
  mbps?: number
  rttMs?: number
  width?: number
  height?: number
  transport?: string
  dropped?: number
}
export interface PeerOptions {
  role: 'host' | 'controller'
  iceServers: IceServer[]
  quality: Quality
  mode?: 'desktop' | 'tools'
  tools?: boolean
  audio?: boolean
  onTools?: (client: ToolClient) => void
  stream?: MediaStream
  signal: (message: Signal) => void
  onStream?: (stream: MediaStream) => void
  onState: (state: string) => void
  onInput?: (event: InputEvent) => void
  onStats?: (stats: Telemetry) => void
}

// Media and input never pass through the HTTP service. Native hosts implement the same contract.
export class RemotePeer {
  readonly pc: RTCPeerConnection
  tools?: ToolClient
  private feedbackAt = 0
  private mediaStream?: MediaStream
  private reliable?: RTCDataChannel
  private motion?: RTCDataChannel
  private pendingIce: RTCIceCandidateInit[] = []
  private timer: ReturnType<typeof setInterval>
  private last?: { timestamp: number; bytes: number }
  private closed = false
  private queue = Promise.resolve()

  constructor(private options: PeerOptions) {
    this.pc = new RTCPeerConnection({
      iceServers: options.iceServers,
      bundlePolicy: 'max-bundle',
    })
    this.pc.onicecandidate = (e) => {
      if (e.candidate)
        options.signal({
          type: 'ice',
          candidate: e.candidate.toJSON() as Extract<
            Signal,
            { type: 'ice' }
          >['candidate'],
        })
    }
    this.pc.onconnectionstatechange = () => {
      options.onState(this.pc.connectionState)
      if (
        ['disconnected', 'failed', 'closed'].includes(this.pc.connectionState)
      )
        options.onInput?.({ type: 'release-all' })
    }
    this.pc.ontrack = (e) => {
      this.mediaStream ??= new MediaStream()
      this.mediaStream.addTrack(e.track)
      options.onStream?.(this.mediaStream)
    }
    this.pc.ondatachannel = (e) => this.bind(e.channel)
    if (options.role === 'controller') {
      if (options.mode !== 'tools')
        this.pc.addTransceiver('video', { direction: 'recvonly' })
      if (options.audio)
        this.pc.addTransceiver('audio', { direction: 'recvonly' })
      if (options.tools)
        this.bind(this.pc.createDataChannel('tools', { ordered: true }))
      this.bind(this.pc.createDataChannel('input', { ordered: true }))
      this.bind(
        this.pc.createDataChannel('motion', {
          ordered: false,
          maxRetransmits: 0,
        })
      )
    } else if (options.stream) {
      for (const track of options.stream.getVideoTracks())
        this.pc.addTrack(track, options.stream)
    }
    // Prefer H.264 when both endpoints support it, retaining fallback codecs.
    const codecs = RTCRtpReceiver.getCapabilities?.('video')?.codecs
    if (codecs)
      for (const transceiver of this.pc
        .getTransceivers()
        .filter((t) => t.receiver.track.kind === 'video')) {
        transceiver.setCodecPreferences?.([
          ...codecs.filter((c) => c.mimeType.toLowerCase() === 'video/h264'),
          ...codecs.filter((c) => c.mimeType.toLowerCase() !== 'video/h264'),
        ])
      }
    this.timer = setInterval(() => {
      void this.stats().catch(() => {})
    }, 1000)
  }
  private bind(channel: RTCDataChannel) {
    if (channel.label === 'tools') {
      this.tools = new ToolClient(channel)
      channel.onopen = () => this.options.onTools?.(this.tools!)
      return
    }
    if (channel.label === 'input') this.reliable = channel
    else if (channel.label === 'motion') this.motion = channel
    else {
      channel.close()
      return
    }
    channel.onmessage = (e) => {
      if (
        typeof e.data !== 'string' ||
        e.data.length > 8192 ||
        this.options.role !== 'host'
      )
        return
      try {
        const result = inputSchema.safeParse(JSON.parse(e.data))
        if (
          result.success &&
          (channel.label !== 'motion' || result.data.type === 'move')
        )
          this.options.onInput?.(result.data)
      } catch {
        /* Ignore malformed data without affecting media. */
      }
    }
    channel.onclose = () => this.options.onInput?.({ type: 'release-all' })
  }
  sendInput(event: InputEvent) {
    const channel = event.type === 'move' ? this.motion : this.reliable
    if (channel?.readyState !== 'open') return false
    if (channel.bufferedAmount > (event.type === 'move' ? 4096 : 64 * 1024)) {
      // Reliable transitions cannot be silently dropped; terminate to release held input.
      if (event.type !== 'move') {
        this.options.onState('failed')
        this.close()
      }
      return false
    }
    channel.send(JSON.stringify(event))
    return true
  }
  async offer() {
    const offer = await this.pc.createOffer()
    if (this.closed) return
    await this.pc.setLocalDescription(offer)
    this.options.signal({ type: 'offer', sdp: offer.sdp! })
  }
  handle(signal: Signal) {
    this.queue = this.queue
      .then(async () => {
        if (this.closed) return
        if (signal.type === 'ice') {
          if (this.pc.remoteDescription)
            await this.pc.addIceCandidate(signal.candidate)
          else this.pendingIce.push(signal.candidate)
        } else if (signal.type === 'offer' || signal.type === 'answer') {
          await this.pc.setRemoteDescription({
            type: signal.type,
            sdp: signal.sdp,
          })
          for (const candidate of this.pendingIce.splice(0))
            await this.pc.addIceCandidate(candidate)
          if (signal.type === 'offer') {
            const answer = await this.pc.createAnswer()
            await this.pc.setLocalDescription(answer)
            const profile = qualityProfiles[this.options.quality]
            for (const sender of this.pc.getSenders())
              if (sender.track?.kind === 'video') {
                const params = sender.getParameters()
                if (params.encodings?.length) {
                  params.encodings[0].maxBitrate = profile.maxBitrate
                  params.encodings[0].maxFramerate = profile.fps
                  params.degradationPreference = 'maintain-framerate'
                  await sender.setParameters(params)
                }
              }
            this.options.signal({ type: 'answer', sdp: answer.sdp! })
          }
        }
      })
      .catch(() => {
        if (!this.closed) this.options.onState('failed')
      })
    return this.queue
  }
  private async stats() {
    if (this.closed || this.options.role !== 'controller') return
    const report = await this.pc.getStats(),
      value: Telemetry = {}
    report.forEach((s) => {
      if (s.type === 'inbound-rtp' && s.kind === 'video') {
        value.fps = s.framesPerSecond
        value.width = s.frameWidth
        value.height = s.frameHeight
        value.dropped = s.framesDropped
        if (this.last && s.timestamp > this.last.timestamp)
          value.mbps = Math.max(
            0,
            ((s.bytesReceived - this.last.bytes) * 8) /
              (s.timestamp - this.last.timestamp) /
              1000
          )
        this.last = { timestamp: s.timestamp, bytes: s.bytesReceived }
      }
      if (s.type === 'transport' && s.selectedCandidatePairId) {
        const pair = report.get(s.selectedCandidatePairId)
        if (pair?.currentRoundTripTime !== undefined)
          value.rttMs = pair.currentRoundTripTime * 1000
        const local = report.get(pair?.localCandidateId),
          remote = report.get(pair?.remoteCandidateId)
        value.transport =
          local?.candidateType === 'relay' || remote?.candidateType === 'relay'
            ? 'TURN 中继'
            : '直连'
      }
    })
    if (
      Date.now() - this.feedbackAt > 5000 &&
      value.fps !== undefined &&
      value.rttMs !== undefined
    ) {
      this.feedbackAt = Date.now()
      this.sendInput({
        type: 'feedback',
        fps: Math.min(240, value.fps),
        rtt: Math.min(10000, value.rttMs),
      })
    }
    this.options.onStats?.(value)
  }
  close() {
    if (this.closed) return
    this.closed = true
    if (
      this.reliable?.readyState === 'open' &&
      this.reliable.bufferedAmount < 64 * 1024
    )
      this.reliable.send(JSON.stringify({ type: 'release-all' }))
    clearInterval(this.timer)
    this.tools?.close()
    this.pc.close()
    this.options.onInput?.({ type: 'release-all' })
  }
}
