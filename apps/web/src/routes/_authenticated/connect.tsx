import { createFileRoute } from '@tanstack/react-router'
import { Header } from '@/components/layout/header'
import { BrowserHost } from '@/features/remote/host'

export const Route = createFileRoute('/_authenticated/connect')({
  component: Page,
})
function Page() {
  return (
    <>
      <Header>
        <span className='text-sm font-medium'>设备管理 / 接入此电脑</span>
      </Header>
      <BrowserHost />
    </>
  )
}
