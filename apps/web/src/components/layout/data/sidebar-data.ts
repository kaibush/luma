import {
  BookOpen,
  Command,
  Monitor,
  Radio,
  Settings,
  Share2,
  ShieldCheck,
} from 'lucide-react'
import { guides } from '@/features/guide/content'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: { name: 'Remote Console', email: '私人工作空间', avatar: '' },
  teams: [{ name: 'Remote Console', logo: Command, plan: '个人远程工作空间' }],
  navGroups: [
    {
      title: '工作空间',
      items: [
        { title: '我的主机', url: '/', icon: Monitor },
        { title: '接入此电脑', url: '/connect', icon: Radio },
        { title: '屏幕共享', url: '/shares', icon: Share2 },
      ],
    },
    {
      title: '系统管理',
      items: [
        {
          title: '连接与凭据',
          icon: Settings,
          items: [
            { title: '连接设置', url: '/management' },
            { title: 'Token 管理', url: '/management/tokens' },
            { title: '活动连接', url: '/management/sessions' },
          ],
        },
        {
          title: '安全与记录',
          icon: ShieldCheck,
          items: [
            { title: '账号安全', url: '/management/account' },
            { title: '操作记录', url: '/management/audit' },
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
            { title: '快速开始', url: '/guide' },
            ...guides.map((guide) => ({
              title: guide.title,
              url: `/guide/${guide.id}`,
            })),
          ],
        },
      ],
    },
  ],
}
