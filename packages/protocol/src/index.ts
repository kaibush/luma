import { z } from 'zod';

export const qualityProfiles = {
  responsive: { label: '流畅', width: 1280, height: 720, fps: 60, maxBitrate: 4_000_000 },
  balanced: { label: '均衡', width: 1920, height: 1080, fps: 30, maxBitrate: 5_000_000 },
  sharp: { label: '清晰', width: 1920, height: 1080, fps: 60, maxBitrate: 10_000_000 },
} as const;
export type Quality = keyof typeof qualityProfiles;
export const qualitySchema = z.enum(['responsive', 'balanced', 'sharp']);
export const authSchema = z.discriminatedUnion('role', [
  z.object({ type: z.literal('auth'), role: z.literal('host'), token: z.string().max(256), name: z.string().min(1).max(64), kind: z.enum(['browser', 'linux-x11']).default('browser') }),
  z.object({ type: z.literal('auth'), role: z.literal('controller'), token: z.string().max(256), sessionId: z.string().uuid() }),
]);
const signalPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('offer'), sdp: z.string().min(1).max(48_000) }),
  z.object({ type: z.literal('answer'), sdp: z.string().min(1).max(48_000) }),
  z.object({ type: z.literal('ice'), candidate: z.object({ candidate: z.string().max(2048), sdpMid: z.string().nullable().optional(), sdpMLineIndex: z.number().int().min(0).nullable().optional(), usernameFragment: z.string().optional() }) }),
  z.object({ type: z.literal('end') }),
]);
export const signalSchema = signalPayloadSchema.and(z.object({ sessionId: z.string().uuid() }));
export type Signal = z.infer<typeof signalPayloadSchema>;
export interface Host { id: string; name: string; busy: boolean; kind: 'browser' | 'linux-x11'; capabilities: { video: true; systemInput: boolean; textInput?: 'ascii' | 'test'; maxFps?: number } }
export interface Session { id: string; hostId: string; quality: Quality; expiresAt: number }
export interface IceServer { urls: string | string[]; username?: string; credential?: string }
export type ServerMessage = Signal
  | { type: 'ready'; hostId?: string }
  | { type: 'session'; session: Session; iceServers: IceServer[] }
  | { type: 'ended'; reason: string }
  | { type: 'error'; message: string };

// Motion may be dropped. Button/key transitions must use the reliable channel.
export const inputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  z.object({ type: z.literal('button'), button: z.enum(['left', 'right']), down: z.boolean(), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  z.object({ type: z.literal('wheel'), dx: z.number().min(-2000).max(2000), dy: z.number().min(-2000).max(2000) }),
  z.object({ type: z.literal('key'), code: z.string().min(1).max(64), down: z.boolean() }),
  z.object({ type: z.literal('text'), text: z.string().max(2048) }),
  z.object({ type: z.literal('release-all') }),
]);
export type InputEvent = z.infer<typeof inputSchema>;

// object-fit: contain adds letterboxing; never send coordinates from black bars.
export function mapPoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, videoWidth: number, videoHeight: number) {
  if (!videoWidth || !videoHeight || !rect.width || !rect.height) return null;
  const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
  const width = videoWidth * scale, height = videoHeight * scale;
  const x = (clientX - rect.left - (rect.width - width) / 2) / width;
  const y = (clientY - rect.top - (rect.height - height) / 2) / height;
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
}
