import { createFileRoute } from '@tanstack/react-router'
import { ManagementPage } from '@/features/access/management'

export const Route = createFileRoute('/_authenticated/management/')({
  component: ManagementPage,
})
