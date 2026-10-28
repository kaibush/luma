import { type ComponentProps } from 'react'
import { APP_NAME } from '@/config/branding'
import { cn } from '@/lib/utils'
import markUrl from './remote-console.svg'

export function Logo({ className, ...props }: ComponentProps<'img'>) {
  return (
    <img
      src={markUrl}
      alt={APP_NAME}
      width={24}
      height={24}
      className={cn('size-6 shrink-0', className)}
      {...props}
    />
  )
}
