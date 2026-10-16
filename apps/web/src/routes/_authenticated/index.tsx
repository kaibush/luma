import { createFileRoute } from '@tanstack/react-router'
import { RemoteDashboard } from '@/features/remote'

export const Route = createFileRoute('/_authenticated/')({
  component: RemoteDashboard,
})
