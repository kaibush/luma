import { Monitor } from 'lucide-react'
import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import { useRemoteAuth } from '@/features/access/auth'
// import { AppTitle } from './app-title'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  const { state } = useRemoteAuth()
  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <a
          href='/'
          className='flex items-center gap-3 overflow-hidden rounded-xl p-2'
        >
          <span className='flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground'>
            <Monitor className='size-5' />
          </span>
          <span className='min-w-0 group-data-[collapsible=icon]:hidden'>
            <span className='block truncate text-sm font-semibold'>
              {state.workspaceName}
            </span>
            <span className='text-xs text-muted-foreground'>远程工作空间</span>
          </span>
        </a>
      </SidebarHeader>
      <SidebarContent>
        {sidebarData.navGroups.map((props) => (
          <NavGroup key={props.title} {...props} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <p className='p-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden'>
          WebRTC · 远程控制台
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
