import { z } from 'zod';

import profiles from './quality-profiles.json';

export const qualityProfiles = profiles;
export type Quality = keyof typeof qualityProfiles;
export const qualitySchema = z.enum(['ultrafast', 'smooth', 'responsive', 'balanced', 'sharp']);
export const deviceStatsSchema = z.object({
  cpu: z.number().min(0).max(100), memoryUsed: z.number().nonnegative(), memoryTotal: z.number().positive(),
  diskUsed: z.number().nonnegative(), diskTotal: z.number().positive(), uptime: z.number().nonnegative(),
  platform: z.string().max(160), version: z.string().max(40), encoder: z.string().max(80),
});
export type DeviceStats = z.infer<typeof deviceStatsSchema> & { sampledAt: number };
export const agentFeaturesSchema = z.object({ terminal: z.boolean(), files: z.boolean(), clipboard: z.boolean(), audio: z.boolean(), remoteSharing: z.boolean().optional() });
export const hostMetadataSchema = z.object({ group: z.string().trim().max(60), note: z.string().trim().max(500) });
export const authSchema = z.discriminatedUnion('role', [
  z.object({ type: z.literal('auth'), role: z.literal('host'), token: z.string().max(256), name: z.string().min(1).max(64), kind: z.enum(['browser', 'linux-x11', 'windows']).default('browser'), deviceId: z.string().uuid().optional(), resumeHostId: z.string().min(1).max(128).optional(), features: agentFeaturesSchema.optional() }),
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
export type TokenStatus = 'active' | 'revoked' | 'expired' | 'deleted';
export interface AccessToken {
  id: string; name: string; scope: 'host' | 'control'; suffix: string;
  source: 'deployment' | 'created'; revealable: boolean; status: Exclude<TokenStatus, 'deleted'>;
  createdAt: number; expiresAt: number | null; revokedAt: number | null; lastUsedAt: number | null;
  hosts: { id: string; name: string; online: boolean; lastSeenAt?: number; reportedName?: string; displayName?: string }[];
}
export interface Host { id: string; name: string; reportedName?: string; displayName?: string; online: boolean; busy: boolean; kind: 'browser' | 'linux-x11' | 'windows'; capabilities: { video: true; systemInput: boolean; textInput?: 'ascii' | 'unicode' | 'test'; maxFps?: number; terminal?: boolean; files?: boolean; clipboard?: boolean; audio?: boolean; remoteSharing?: boolean }; group?: string; note?: string; lastConnectedAt?: number; firstSeenAt?: number; lastSeenAt?: number; lastOfflineAt?: number; accessToken?: { id: string; name: string; status: TokenStatus }; stats?: DeviceStats }
export interface Session { id: string; hostId: string; quality: Quality; expiresAt: number; mode?: 'desktop' | 'tools'; tools?: boolean; audio?: boolean; readOnly?: boolean }
export interface IceServer { urls: string | string[]; username?: string; credential?: string }
export type ServerMessage = Signal
  | { type: 'ready'; hostId?: string; protocol?: number }
  | { type: 'session'; session: Session; iceServers: IceServer[] }
  | { type: 'ended'; reason: string; sessionId?: string }
  | { type: 'error'; message: string };

// Motion may be dropped. Button/key transitions must use the reliable channel.
export const inputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  z.object({ type: z.literal('button'), button: z.enum(['left', 'right']), down: z.boolean(), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  z.object({ type: z.literal('wheel'), dx: z.number().min(-2000).max(2000), dy: z.number().min(-2000).max(2000) }),
  z.object({ type: z.literal('key'), code: z.string().min(1).max(64), down: z.boolean() }),
  z.object({ type: z.literal('text'), text: z.string().max(2048) }),
  z.object({ type: z.literal('release-all') }),
  z.object({ type: z.literal('feedback'), rtt: z.number().min(0).max(10000), fps: z.number().min(0).max(240) }),
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
