import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, BookOpen, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { useRemoteAuth } from '@/features/access/auth'
import { guides } from './content'

export function GuidePage({ topic }: { topic?: string }) {
  const { state } = useRemoteAuth()
  const [search, setSearch] = useState('')
  const article = guides.find((g) => g.id === topic)
  const results = guides.filter((g) =>
    [g.title, g.description, ...g.sections.map((s) => s.title)]
      .join(' ')
      .includes(search.trim())
  )
  return (
    <>
      <Header>
        <BookOpen className='size-4' />
        <span className='text-sm font-medium'>
          使用指南{article ? ` / ${article.title}` : ''}
        </span>
      </Header>
      <Main className='mx-auto flex w-full max-w-5xl flex-col gap-6 pb-10'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h1 className='text-2xl font-semibold'>
              {article?.title || '接入与使用指南'}
            </h1>
            <p className='mt-2 text-sm text-muted-foreground'>
              {article?.description ||
                '按任务查看步骤，不必在功能页面翻找长篇说明。'}
            </p>
          </div>
          {article && (
            <Button variant='outline' asChild>
              <Link to='/guide'>全部指南</Link>
            </Button>
          )}
        </div>
        {!article ? (
          <>
            <section className='rounded-xl border bg-muted/40 p-5'>
              <h2 className='font-semibold'>第一次使用？从这里开始</h2>
              <ol className='mt-3 grid gap-3 text-sm sm:grid-cols-3'>
                <li>
                  <span className='font-medium'>1. 接入电脑</span>
                  <p className='mt-1 text-muted-foreground'>
                    在被控端安装客户端，填写主机密钥。
                  </p>
                </li>
                <li>
                  <span className='font-medium'>2. 开始操作</span>
                  <p className='mt-1 text-muted-foreground'>
                    在手机或电脑登录，连接在线主机。
                  </p>
                </li>
                <li>
                  <span className='font-medium'>3. 邀请访客</span>
                  <p className='mt-1 text-muted-foreground'>
                    创建分享链接，设置分享码和权限。
                  </p>
                </li>
              </ol>
            </section>
            <div className='flex items-center gap-2'>
              <Search className='size-4 text-muted-foreground' />
              <Input
                aria-label='搜索使用指南'
                placeholder='搜索主题，例如：安装、分享、文件'
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className='grid gap-3 sm:grid-cols-2'>
              {results.map((g) => (
                <Link
                  key={g.id}
                  to='/guide/$topic'
                  params={{ topic: g.id }}
                  className='flex items-center justify-between gap-4 rounded-xl border bg-card p-5 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring'
                >
                  <div>
                    <h2 className='font-medium'>{g.title}</h2>
                    <p className='mt-1 text-sm text-muted-foreground'>
                      {g.description}
                    </p>
                  </div>
                  <ArrowRight className='size-4 shrink-0 text-muted-foreground' />
                </Link>
              ))}
            </div>
            {!results.length && (
              <p className='py-8 text-center text-sm text-muted-foreground'>
                没有匹配主题，请试试其他关键词。
              </p>
            )}
          </>
        ) : (
          <div className='grid gap-6 lg:grid-cols-[1fr_180px]'>
            <article className='min-w-0 rounded-xl border bg-card px-5 py-2 sm:px-7'>
              {article.sections.map((section, index) => (
                <section
                  key={section.title}
                  id={`section-${index}`}
                  className='scroll-mt-20 border-b py-6 last:border-b-0'
                >
                  <h2 className='mb-3 text-lg font-semibold'>
                    {section.title}
                  </h2>
                  {section.text && (
                    <p className='mb-3 text-sm leading-7 text-muted-foreground'>
                      {section.text}
                    </p>
                  )}
                  {section.code && (
                    <pre className='mb-3 overflow-x-auto rounded-lg bg-muted p-3 text-sm'>
                      <code>{section.code}</code>
                    </pre>
                  )}
                  {section.steps && (
                    <ol className='flex list-decimal flex-col gap-3 ps-5 text-sm leading-7'>
                      {section.steps.map((step) => (
                        <li key={step} className='ps-1'>
                          {step}
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              ))}
            </article>
            <aside className='order-first lg:order-last'>
              <nav
                aria-label='本页目录'
                className='sticky top-20 rounded-xl border p-4'
              >
                <p className='mb-3 text-xs font-medium text-muted-foreground'>
                  本页内容
                </p>
                <div className='flex flex-wrap gap-2 lg:flex-col'>
                  {article.sections.map((s, i) => (
                    <a
                      key={s.title}
                      href={`#section-${i}`}
                      className='text-sm text-muted-foreground hover:text-foreground hover:underline'
                    >
                      {s.title}
                    </a>
                  ))}
                </div>
              </nav>
            </aside>
          </div>
        )}
        <div className='flex flex-wrap gap-2 border-t pt-5'>
          <Button asChild>
            <Link to={state.user ? '/connect' : '/host'}>接入电脑</Link>
          </Button>
          <Button variant='outline' asChild>
            <Link to='/shares'>管理分享</Link>
          </Button>
          <Button variant='ghost' asChild>
            <Link to='/management/$section' params={{ section: 'tokens' }}>
              管理主机密钥
            </Link>
          </Button>
        </div>
      </Main>
    </>
  )
}
