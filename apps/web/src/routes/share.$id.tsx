import { createFileRoute } from '@tanstack/react-router'
import { ShareViewer } from '@/features/shares/viewer'

export const Route = createFileRoute('/share/$id')({ component: Page })
function Page() {
  const { id } = Route.useParams()
  return <ShareViewer key={id} id={id} />
}
