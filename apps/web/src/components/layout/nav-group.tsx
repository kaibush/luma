import { useState, type ReactNode } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Badge } from '../ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
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
    <SidebarGroup className='px-3 py-2'>
      <SidebarGroupLabel className='h-8 px-2 text-sm font-medium text-muted-foreground'>
        {title}
      </SidebarGroupLabel>
      <SidebarMenu>
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
  return <Badge className='rounded-full px-1 py-0 text-xs'>{children}</Badge>
}

function SidebarMenuLink({ item, href }: { item: NavLink; href: string }) {
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={checkIsActive(href, item)}
        tooltip={item.title}
        className='group/nav h-11 rounded-lg px-3'
      >
        <Link to={item.url} onClick={() => setOpenMobile(false)}>
          {item.icon && (
            <item.icon className='text-muted-foreground group-data-[active=true]/nav:text-sidebar-accent-foreground' />
          )}
          <span>{item.title}</span>
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
  const { setOpenMobile, isMobile } = useSidebar()
  const active = checkIsActive(href, item)
  const [open, setOpen] = useState(false)
  return (
    <SidebarMenuItem>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <SidebarMenuButton
            tooltip={item.title}
            isActive={active && !open}
            className='h-11 rounded-lg px-3 data-[state=open]:bg-muted'
          >
            {item.icon && (
              <item.icon
                className={
                  active
                    ? 'text-sidebar-accent-foreground'
                    : 'text-muted-foreground'
                }
              />
            )}
            <span>{item.title}</span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
            <ChevronRight
              className={cn(
                'ms-auto text-muted-foreground transition-transform duration-200',
                open && 'rotate-90'
              )}
            />
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent
          side={isMobile ? 'bottom' : 'right'}
          align='start'
          sideOffset={10}
          className='w-60 rounded-xl p-1.5 shadow-lg'
        >
          <SubmenuList
            item={item}
            href={href}
            onNavigate={() => {
              setOpen(false)
              setOpenMobile(false)
            }}
          />
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  )
}

function SidebarMenuCollapsedDropdown({
  item,
  href,
}: {
  item: NavCollapsible
  href: string
}) {
  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            tooltip={item.title}
            isActive={checkIsActive(href, item)}
            className='h-11 rounded-lg'
          >
            {item.icon && <item.icon />}
            <span>{item.title}</span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
            <ChevronRight className='ms-auto text-muted-foreground' />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side='right'
          align='start'
          sideOffset={10}
          className='w-60 rounded-xl p-1.5 shadow-lg'
        >
          <DropdownMenuLabel className='px-3 py-1.5 text-xs font-medium text-muted-foreground'>
            {item.title}
          </DropdownMenuLabel>
          <div className='flex max-h-80 flex-col gap-0.5 overflow-y-auto'>
            {item.items.map((subItem) => {
              const active = checkIsActive(href, subItem)
              return (
                <DropdownMenuItem key={subItem.title} asChild>
                  <Link
                    to={subItem.url}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'h-11 rounded-lg px-3',
                      active &&
                        'bg-secondary font-medium text-secondary-foreground'
                    )}
                  >
                    <span className='truncate'>{subItem.title}</span>
                  </Link>
                </DropdownMenuItem>
              )
            })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

function SubmenuList({
  item,
  href,
  onNavigate,
}: {
  item: NavCollapsible
  href: string
  onNavigate?: () => void
}) {
  return (
    <div className='flex max-h-80 flex-col gap-0.5 overflow-y-auto'>
      {item.items.map((subItem) => {
        const active = checkIsActive(href, subItem)
        return (
          <Link
            key={subItem.title}
            to={subItem.url}
            aria-current={active ? 'page' : undefined}
            onClick={onNavigate}
            className={cn(
              'flex h-11 items-center rounded-lg px-3 text-sm text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
              active && 'bg-secondary font-medium text-secondary-foreground'
            )}
          >
            <span className='truncate'>{subItem.title}</span>
            {subItem.badge && (
              <span className='ms-auto text-xs'>{subItem.badge}</span>
            )}
          </Link>
        )
      })}
    </div>
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
