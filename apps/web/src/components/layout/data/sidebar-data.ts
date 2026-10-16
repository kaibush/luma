import { Monitor, Radio, Command } from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: { name: 'Remote Console', email: '私人工作空间', avatar: '' },
  teams: [{ name: 'Remote Console', logo: Command, plan: '个人远程工作空间' }],
  navGroups: [
    {
      title: '工作空间',
      items: [
        { title: '我的主机', url: '/', icon: Monitor },
        { title: '接入此电脑', url: '/host', icon: Radio },
      ],
    },
  ],
}
