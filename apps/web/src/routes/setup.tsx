import { createFileRoute } from '@tanstack/react-router'
import { SetupPage } from '@/features/access/setup'

export const Route = createFileRoute('/setup')({ component: SetupPage })
