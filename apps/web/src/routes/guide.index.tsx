import { createFileRoute } from '@tanstack/react-router'
import { GuidePage } from '@/features/guide'

export const Route = createFileRoute('/guide/')({ component: GuidePage })
