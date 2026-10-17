import { createFileRoute } from '@tanstack/react-router'
import { ScreenShares } from '@/features/shares'

export const Route = createFileRoute('/_authenticated/shares')({
  component: ScreenShares,
})
