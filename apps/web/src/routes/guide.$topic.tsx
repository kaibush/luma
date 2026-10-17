import { createFileRoute, redirect } from '@tanstack/react-router'
import { GuidePage } from '@/features/guide'
import { guides } from '@/features/guide/content'

export const Route = createFileRoute('/guide/$topic')({
  beforeLoad: ({ params }) => {
    if (!guides.some((g) => g.id === params.topic))
      throw redirect({ to: '/guide' })
  },
  component: Page,
})
function Page() {
  const { topic } = Route.useParams()
  return <GuidePage key={topic} topic={topic} />
}
