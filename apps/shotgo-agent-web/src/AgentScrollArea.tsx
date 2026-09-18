import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

type ScrollMetrics = { viewport: number; content: number; top: number }

export function AgentScrollArea({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const dragOffset = useRef<number | null>(null)
  const [metrics, setMetrics] = useState<ScrollMetrics>({ viewport: 0, content: 0, top: 0 })

  const measure = useCallback(() => {
    const scroll = scrollRef.current
    if (scroll === null) return
    const next = { viewport: scroll.clientHeight, content: scroll.scrollHeight, top: scroll.scrollTop }
    setMetrics(current => current.viewport === next.viewport && current.content === next.content && current.top === next.top
      ? current : next)
  }, [])

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (scroll === null) return
    measure()
    scroll.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 140
      measure()
      if (nearBottom) scroll.scrollTop = scroll.scrollHeight
    })
    observer?.observe(scroll)
    if (contentRef.current !== null) observer?.observe(contentRef.current)
    return () => {
      scroll.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [measure])

  const maxScroll = Math.max(0, metrics.content - metrics.viewport)
  const thumbHeight = metrics.viewport === 0 ? 0 : Math.min(metrics.viewport,
    Math.max(40, metrics.viewport * metrics.viewport / Math.max(metrics.content, 1)))
  const thumbTop = maxScroll === 0 ? 0 : metrics.top / maxScroll * (metrics.viewport - thumbHeight)

  function scrollFromPointer(event: PointerEvent<HTMLDivElement>) {
    const scroll = scrollRef.current
    if (scroll === null || maxScroll === 0) return
    const trackTop = event.currentTarget.getBoundingClientRect().top
    const offset = dragOffset.current ?? thumbHeight / 2
    const fraction = (event.clientY - trackTop - offset) / Math.max(1, metrics.viewport - thumbHeight)
    scroll.scrollTop = Math.min(1, Math.max(0, fraction)) * maxScroll
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (maxScroll === 0) return
    const trackTop = event.currentTarget.getBoundingClientRect().top
    const position = event.clientY - trackTop
    dragOffset.current = position >= thumbTop && position <= thumbTop + thumbHeight
      ? position - thumbTop : thumbHeight / 2
    event.currentTarget.setPointerCapture(event.pointerId)
    scrollFromPointer(event)
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    const scroll = scrollRef.current
    if (scroll === null) return
    const step = Math.max(60, scroll.clientHeight * .8)
    switch (event.key) {
      case 'ArrowUp': scroll.scrollBy({ top: -60 }); break
      case 'ArrowDown': scroll.scrollBy({ top: 60 }); break
      case 'PageUp': scroll.scrollBy({ top: -step }); break
      case 'PageDown': scroll.scrollBy({ top: step }); break
      case 'Home': scroll.scrollTop = 0; break
      case 'End': scroll.scrollTop = maxScroll; break
      default: return
    }
    event.preventDefault()
  }

  return (
    <div className="agent-scroll-region">
      <div className="agent-scroll" id="agent-scroll-content" ref={scrollRef}>
        <div ref={contentRef}>{children}</div>
      </div>
      <div
        className="agent-scrollbar"
        role="scrollbar"
        aria-label="对话内容滚动条"
        aria-controls="agent-scroll-content"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={Math.round(maxScroll)}
        aria-valuenow={Math.round(metrics.top)}
        tabIndex={0}
        onPointerDown={startDrag}
        onPointerMove={(event) => { if (dragOffset.current !== null) scrollFromPointer(event) }}
        onPointerUp={(event) => {
          dragOffset.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => { dragOffset.current = null }}
        onKeyDown={handleKey}
      >
        <span className="agent-scrollbar__thumb" style={{ height: thumbHeight, transform: `translateY(${thumbTop}px)` }} />
      </div>
    </div>
  )
}
