import { useState, type ReactNode } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  type NavCollapsible,
  type NavItem,
  type NavLink,
  type NavGroup as NavGroupProps,
} from './types'

export function NavGroup({ title, items }: NavGroupProps) {
  const { state, isMobile } = useSidebar()
  const href = useLocation({ select: (location) => location.href })
  return (
    <SidebarGroup className='px-2 py-1'>
      <SidebarGroupLabel className='h-7 px-2 text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase'>
        {title}
      </SidebarGroupLabel>
      <SidebarMenu className='gap-0.5'>
        {items.map((item) => {
          const key = `${item.title}-${item.url}`
          if (!item.items)
            return <SidebarMenuLink key={key} item={item} href={href} />
          if (state === 'collapsed' && !isMobile)
            return (
              <SidebarMenuCollapsedDropdown key={key} item={item} href={href} />
            )
          return <SidebarMenuCollapsible key={key} item={item} href={href} />
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}

function NavBadge({ children }: { children: ReactNode }) {
  return <Badge className='shrink-0 px-1 py-0 text-xs'>{children}</Badge>
}

function SidebarMenuLink({ item, href }: { item: NavLink; href: string }) {
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={checkIsActive(href, item)}
        tooltip={item.title}
      >
        <Link to={item.url} onClick={() => setOpenMobile(false)}>
          {item.icon && <item.icon className='shrink-0' />}
          <span className='min-w-0 flex-1 truncate'>{item.title}</span>
          {item.badge && <NavBadge>{item.badge}</NavBadge>}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function SidebarMenuCollapsible({
  item,
  href,
}: {
  item: NavCollapsible
  href: string
}) {
  const { setOpenMobile } = useSidebar()
  const active = checkIsActive(href, item)
  const [open, setOpen] = useState(active)
  const [seenActive, setSeenActive] = useState(active)
  if (active !== seenActive) {
    setSeenActive(active)
    if (active) setOpen(true)
  }
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className='group/collapsible'
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={item.title} isActive={active}>
            {item.icon && <item.icon className='shrink-0' />}
            <span className='min-w-0 flex-1 truncate'>{item.title}</span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
            <ChevronRight className='ms-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90' />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent className='CollapsibleContent'>
          <SidebarMenuSub>
            {item.items.map((subItem) => (
              <SidebarMenuSubItem key={subItem.title}>
                <SidebarMenuSubButton
                  asChild
                  isActive={checkIsActive(href, subItem)}
                >
                  <Link to={subItem.url} onClick={() => setOpenMobile(false)}>
                    {subItem.icon && <subItem.icon className='shrink-0' />}
                    <span className='min-w-0 flex-1 truncate'>
                      {subItem.title}
                    </span>
                    {subItem.badge && <NavBadge>{subItem.badge}</NavBadge>}
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

function SidebarMenuCollapsedDropdown({
  item,
  href,
}: {
  item: NavCollapsible
  href: string
}) {
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            tooltip={item.title}
            isActive={checkIsActive(href, item)}
          >
            {item.icon && <item.icon className='shrink-0' />}
            <span className='min-w-0 flex-1 truncate'>{item.title}</span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
            <ChevronRight className='ms-auto size-4 shrink-0 text-muted-foreground' />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side='right'
          align='start'
          sideOffset={4}
          className='min-w-48 rounded-xl'
        >
          <DropdownMenuLabel className='text-xs font-medium text-muted-foreground'>
            {item.title}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {item.items.map((subItem) => {
            const active = checkIsActive(href, subItem)
            return (
              <DropdownMenuItem key={subItem.title} asChild>
                <Link
                  to={subItem.url}
                  onClick={() => setOpenMobile(false)}
                  className={cn(active && 'bg-sidebar-accent font-medium')}
                >
                  <span className='truncate'>{subItem.title}</span>
                </Link>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

function checkIsActive(href: string, item: NavItem): boolean {
  if (item.items) return item.items.some((child) => checkIsActive(href, child))
  const clean = (url: string) => url.split(/[?#]/)[0].replace(/\/$/, '') || '/'
  const path = clean(href),
    target = clean(item.url || '')
  return (
    path === target || (!!item.matchChildren && path.startsWith(`${target}/`))
  )
}
