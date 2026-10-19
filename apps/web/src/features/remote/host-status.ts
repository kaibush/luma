import type { Host } from '@remote/protocol'

export function hostOfflineHint(host: Host) {
  if (host.accessToken?.status === 'revoked')
    return '主机密钥已撤销。请在系统管理的 Token 管理中恢复未过期密钥，或更换客户端密钥。'
  if (host.accessToken?.status === 'expired')
    return '主机密钥已过期。请创建新的主机密钥，并在客户端保存后连接。'
  if (host.accessToken?.status === 'deleted')
    return '主机密钥已删除。请创建新的主机密钥，并更新客户端配置。'
  return host.kind === 'browser'
    ? '浏览器共享已停止。请在原浏览器页面重新选择屏幕并上线。'
    : '请确认电脑已开机、客户端正在运行且网络可用；客户端会自动重连。'
}
