import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

function safeUrl(url: string): string {
  if (url.startsWith('/') || url.startsWith('#')) return url
  try { return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol) ? url : '' } catch { return '' }
}

export function AgentMarkdown({ children }: { children: string }) {
  return <div className="agent-markdown"><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} skipHtml urlTransform={safeUrl} components={{
    a: ({ href, children: label }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{label}</a> : <span>{label}</span>,
    img: ({ alt }) => <span>[图片：{alt || '未命名'}]</span>,
  }}>{children}</ReactMarkdown></div>
}
