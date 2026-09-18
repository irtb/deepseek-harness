import { useEffect, useMemo, useState } from 'react'
import { fetchMediaLibrary, resolveMediaUrl, type LibraryScope, type MediaLibraryItem } from './media-library.ts'

export function MediaLibraryPicker({ open, token, isTeam, initialIds, maxSelection, onClose, onConfirm }: {
  open: boolean
  token: string
  isTeam: boolean
  initialIds: number[]
  maxSelection: number
  onClose: () => void
  onConfirm: (items: MediaLibraryItem[]) => void
}) {
  const [scope, setScope] = useState<LibraryScope>('personal')
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<MediaLibraryItem[]>([])
  const [selected, setSelected] = useState<Map<number, MediaLibraryItem>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const initialKey = useMemo(() => initialIds.join(','), [initialIds])

  useEffect(() => {
    if (!open) return
    setScope('personal'); setPage(1); setSelected(new Map()); setError(undefined)
  }, [open, initialKey])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true); setError(undefined)
    void fetchMediaLibrary({ token, scope, page, signal: controller.signal }).then((result) => {
      setItems(result.list); setLastPage(Math.max(1, result.pagination.last_page)); setTotal(result.pagination.total)
      setSelected((current) => {
        const next = new Map(current)
        for (const item of result.list) if (initialIds.includes(item.id) || next.has(item.id)) next.set(item.id, item)
        return next
      })
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '加载素材库失败') }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () =>{  controller.abort() }
  }, [initialKey, open, page, scope, token])
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () =>{  window.removeEventListener('keydown', close) }
  }, [onClose, open])

  if (!open) return null
  function toggle(item: MediaLibraryItem) {
    setSelected((current) => {
      const next = new Map(current)
      if (next.has(item.id)) next.delete(item.id)
      else if (next.size < maxSelection) next.set(item.id, item)
      return next
    })
  }
  return <div className="media-picker-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="media-picker" role="dialog" aria-modal="true" aria-labelledby="media-picker-title">
      <header><div><h2 id="media-picker-title">选择参考图片</h2><p>已选 {selected.size}/{maxSelection} · 共 {total} 项</p></div><button type="button" aria-label="关闭素材库" onClick={onClose}>×</button></header>
      {isTeam ? <nav aria-label="素材范围">{(['personal', 'group', 'team'] as const).map(value => <button key={value} type="button" className={scope === value ? 'active' : ''} onClick={() => { setScope(value); setPage(1) }}>{value === 'personal' ? '个人' : value === 'group' ? '组' : '团队'}</button>)}</nav> : null}
      {error ? <p className="media-picker-error" role="alert">{error}</p> : null}
      <div className="media-picker-grid">{loading ? <p>正在加载素材…</p> : items.length === 0 ? <p>当前范围暂无图片素材</p> : items.map((item) => {
        const src = resolveMediaUrl(item.thumbPath ?? item.path)
        const checked = selected.has(item.id)
        return <button type="button" key={item.id} className={checked ? 'media-tile selected' : 'media-tile'} aria-pressed={checked} onClick={() =>{  toggle(item) }}>{src ? <img src={src} alt={item.originalName ?? `素材 ${item.id}`} /> : <span>无预览</span>}<strong>{item.originalName ?? `素材 ${item.id}`}</strong><i>{checked ? '✓' : ''}</i></button>
      })}</div>
      <footer><div><button type="button" disabled={page <= 1} onClick={() =>{  setPage(value => value - 1) }}>上一页</button><span>{page}/{lastPage}</span><button type="button" disabled={page >= lastPage} onClick={() =>{  setPage(value => value + 1) }}>下一页</button></div><div><button type="button" onClick={onClose}>取消</button><button className="primary" type="button" disabled={selected.size === 0} onClick={() => { onConfirm([...selected.values()]); onClose() }}>使用 {selected.size} 张图片</button></div></footer>
    </section>
  </div>
}
