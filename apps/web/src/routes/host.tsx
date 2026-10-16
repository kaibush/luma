import { createFileRoute } from '@tanstack/react-router'
import { BrowserHost } from '@/features/remote/host'

export const Route = createFileRoute('/host')({ component: BrowserHost })
