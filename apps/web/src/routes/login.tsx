import { createFileRoute } from '@tanstack/react-router'
import { LoginPage } from '@/features/access/login'

export const Route = createFileRoute('/login')({ component: LoginPage })
