import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

type HeaderProps = React.HTMLAttributes<HTMLElement> & {
  fixed?: boolean
  ref?: React.Ref<HTMLElement>
}

export function Header({ className, fixed, children, ...props }: HeaderProps) {
  return (
    <header
      className={cn(
        'z-50 h-14 border-b bg-background',
        fixed && 'header-fixed peer/header sticky top-0 w-[inherit]',
        className
      )}
      {...props}
    >
      <div className='relative flex h-full items-center gap-3 px-4 sm:gap-4'>
        <SidebarTrigger className='size-11 md:size-8' />
        <Separator orientation='vertical' className='h-5' />
        {children}
      </div>
    </header>
  )
}
