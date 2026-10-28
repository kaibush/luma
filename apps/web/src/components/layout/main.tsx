import { cn } from '@/lib/utils'

type MainProps = React.HTMLAttributes<HTMLElement> & {
  fixed?: boolean
  ref?: React.Ref<HTMLElement>
}

export function Main({ fixed, className, ...props }: MainProps) {
  return (
    <main
      data-layout={fixed ? 'fixed' : 'auto'}
      className={cn(
        'w-full min-w-0 page-gutter py-5',
        fixed && 'flex grow flex-col overflow-hidden',
        className
      )}
      {...props}
    />
  )
}
