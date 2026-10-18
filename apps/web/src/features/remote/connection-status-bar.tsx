import type { Telemetry } from './peer'

/** Reserve space above the video so persistent stats never cover the desktop. */
export function ConnectionStatusBar({ stats }: { stats: Telemetry }) {
  return (
    <div
      aria-label='实时连接统计，延迟为网络往返时间 RTT'
      className='pointer-events-none flex shrink-0 items-center gap-3 border-b bg-background px-2 py-1 text-xs leading-4 text-foreground tabular-nums select-none'
    >
      <span>{stats.fps === undefined ? '—' : Math.round(stats.fps)} FPS</span>
      <span>
        延迟 {stats.rttMs === undefined ? '—' : Math.round(stats.rttMs)} ms
      </span>
    </div>
  )
}
