import { Logo } from '@/assets/logo'
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
  const { collapsible } = useLayout()
  const { state } = useRemoteAuth()
  return (
    <Sidebar collapsible={collapsible} variant='sidebar'>
      <SidebarHeader className='px-3 pt-3 pb-1 group-data-[collapsible=icon]:px-1'>
        <a
          href='/'
          aria-label={state.workspaceName}
          className='group/brand flex h-8 items-center gap-2 overflow-hidden rounded-lg px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 hover:bg-muted'
        >
          <Logo
            alt=''
            className='motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover/brand:-rotate-6'
          />
          <span className='min-w-0 truncate text-sm font-medium group-data-[collapsible=icon]:hidden'>
            {state.workspaceName}
          </span>
        </a>
      </SidebarHeader>
      <SidebarContent>
        {sidebarData.navGroups.map((props) => (
          <NavGroup key={props.title} {...props} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <p className='px-4 py-2 text-[11px] text-muted-foreground/80 group-data-[collapsible=icon]:hidden'>
          画面与键鼠走加密连接
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
