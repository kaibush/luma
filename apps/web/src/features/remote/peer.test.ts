import { afterEach, expect, test, vi } from 'vitest'
import { RemotePeer } from './peer'

const peers: RemotePeer[] = []
afterEach(() => {
  peers.splice(0).forEach((peer) => peer.close())
  vi.restoreAllMocks()
})

test('sends the offer before candidates gathered during setLocalDescription', async () => {
  const signal = vi.fn()
  const peer = new RemotePeer({
    role: 'controller',
    readOnly: true,
    iceServers: [],
    quality: 'balanced',
    signal,
    onState: vi.fn(),
  })
  peers.push(peer)
  vi.spyOn(peer.pc, 'setLocalDescription').mockImplementation(async () => {
    peer.pc.onicecandidate?.call(peer.pc, {
      candidate: {
        toJSON: () => ({ candidate: 'candidate:early', sdpMid: '0' }),
      },
    } as unknown as RTCPeerConnectionIceEvent)
    expect(signal).not.toHaveBeenCalled()
  })
  await peer.offer()
  expect(signal.mock.calls.map(([message]) => message.type)).toEqual([
    'offer',
    'ice',
  ])
})

test('unsupported quality parameters still produce an answer', async () => {
  const canvas = document.createElement('canvas')
  const stream = canvas.captureStream(1)
  const signal = vi.fn(),
    onState = vi.fn()
  const host = new RemotePeer({
    role: 'host',
    stream,
    iceServers: [],
    quality: 'balanced',
    signal,
    onState,
  })
  const viewer = new RemotePeer({
    role: 'controller',
    readOnly: true,
    iceServers: [],
    quality: 'balanced',
    signal: vi.fn(),
    onState: vi.fn(),
  })
  peers.push(host, viewer)
  try {
    const sender = host.pc.getSenders()[0]
    vi.spyOn(sender, 'setParameters').mockRejectedValue(
      new Error('Unsupported')
    )
    const offer = await viewer.pc.createOffer()
    await host.handle({ type: 'offer', sdp: offer.sdp! })
    expect(sender.setParameters).toHaveBeenCalled()
    expect(
      signal.mock.calls.some(([message]) => message.type === 'answer')
    ).toBe(true)
    expect(onState).not.toHaveBeenCalledWith('failed')
  } finally {
    stream.getTracks().forEach((track) => track.stop())
  }
})
