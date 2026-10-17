import {
  Monitor,
  Radio,
  Command,
  Settings,
  Share2,
  BookOpen,
  KeyRound,
  Activity,
  ShieldCheck,
  History,
  FolderOpen,
  CircleHelp,
  Plug,
  MousePointer2,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: { name: 'Remote Console', email: '私人工作空间', avatar: '' },
  teams: [{ name: 'Remote Console', logo: Command, plan: '个人远程工作空间' }],
  navGroups: [
    {
      title: '工作空间',
      items: [
        {
          title: '设备管理',
          icon: Monitor,
          items: [
            { title: '我的主机', url: '/', icon: Monitor },
            { title: '接入此电脑', url: '/connect', icon: Radio },
          ],
        },
        {
          title: '分享协作',
          icon: Share2,
          items: [
            { title: '屏幕共享', url: '/shares', icon: Share2 },
            { title: '活动连接', url: '/management/sessions', icon: Activity },
          ],
        },
      ],
    },
    {
      title: '管理与安全',
      items: [
        {
          title: '系统管理',
          icon: Settings,
          items: [
            { title: '连接设置', url: '/management', icon: Plug },
            { title: 'Token 管理', url: '/management/tokens', icon: KeyRound },
            {
              title: '账号安全',
              url: '/management/account',
              icon: ShieldCheck,
            },
            { title: '操作记录', url: '/management/audit', icon: History },
          ],
        },
      ],
    },
    {
      title: '帮助中心',
      items: [
        {
          title: '使用指南',
          icon: BookOpen,
          items: [
            { title: '快速开始', url: '/guide', icon: BookOpen },
            { title: '客户端接入', url: '/guide/install', icon: Radio },
            { title: '远程桌面', url: '/guide/desktop', icon: MousePointer2 },
            { title: '分享与权限', url: '/guide/sharing', icon: Share2 },
            { title: '终端与文件', url: '/guide/tools', icon: FolderOpen },
            {
              title: '常见问题',
              url: '/guide/troubleshooting',
              icon: CircleHelp,
            },
          ],
        },
      ],
    },
  ],
}
