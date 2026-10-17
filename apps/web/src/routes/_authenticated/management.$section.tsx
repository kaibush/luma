import { createFileRoute, redirect } from '@tanstack/react-router'
import { ManagementPage } from '@/features/access/management'

export const Route = createFileRoute('/_authenticated/management/$section')({
  beforeLoad: ({ params }) => {
    if (!['tokens', 'sessions', 'account', 'audit'].includes(params.section))
      throw redirect({ to: '/management' })
  },
  component: Page,
})
function Page() {
  const { section } = Route.useParams()
  return <ManagementPage section={section} />
}
