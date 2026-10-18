import {
  Monitor,
  Radio,
  Command,
  Settings,
  Share2,
  BookOpen,
} from 'lucide-react'
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
      title: '管理与安全',
      items: [
        {
          title: '系统管理',
          url: '/management',
          icon: Settings,
          matchChildren: true,
        },
      ],
    },
    {
      title: '帮助中心',
      items: [
        {
          title: '使用指南',
          url: '/guide',
          icon: BookOpen,
          matchChildren: true,
        },
      ],
    },
  ],
}
