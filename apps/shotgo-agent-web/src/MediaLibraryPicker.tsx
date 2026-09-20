import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchMediaLibrary,
  MAX_LIBRARY_UPLOAD_BYTES,
  mediaTypeFromFile,
  REFERENCE_UPLOAD_ACCEPT,
  resolveMediaUrl,
  uploadMediaLibraryFile,
  type LibraryScope,
  type MediaLibraryItem,
  type ReferenceMediaKind,
} from './media-library.ts'

function TilePreview({ item }: { item: MediaLibraryItem }) {
  const src = resolveMediaUrl(item.thumbPath ?? item.path)
  if (item.mediaType === 'video') {
    return (
      <>
        {src ? <video src={src} muted playsInline preload="metadata" /> : <span>无预览</span>}
        <em className="media-tile__kind">视频</em>
      </>
    )
  }
  return src ? <img src={src} alt={item.originalName ?? `素材 ${item.id}`} /> : <span>无预览</span>
}

export function MediaLibraryPicker({
  open,
  token,
  isTeam,
  initialIds,
  maxSelection,
  defaultKind = 'image',
  onClose,
  onConfirm,
}: {
  open: boolean
  token: string
  isTeam: boolean
  initialIds: number[]
  maxSelection: number
  defaultKind?: ReferenceMediaKind
  onClose: () => void
  onConfirm: (items: MediaLibraryItem[]) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [scope, setScope] = useState<LibraryScope>('personal')
  const [kind, setKind] = useState<ReferenceMediaKind>(defaultKind)
  const [page, setPage] = useState(1)
  const [reload, setReload] = useState(0)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<MediaLibraryItem[]>([])
  const [selected, setSelected] = useState<Map<number, MediaLibraryItem>>(new Map())
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string>()
  const initialKey = useMemo(() => initialIds.join(','), [initialIds])

  useEffect(() => {
    if (!open) return
    setScope('personal')
    setKind(defaultKind)
    setPage(1)
    setSelected(new Map())
    setError(undefined)
  }, [defaultKind, initialKey, open])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    setError(undefined)
    void fetchMediaLibrary({ token, scope, page, type: kind, signal: controller.signal }).then((result) => {
      setItems(result.list)
      setLastPage(Math.max(1, result.pagination.last_page))
      setTotal(result.pagination.total)
      setSelected((current) => {
        const next = new Map(current)
        for (const item of result.list) if (initialIds.includes(item.id) || next.has(item.id)) next.set(item.id, item)
        return next
      })
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '加载素材库失败')
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => {
      controller.abort()
    }
  }, [initialKey, kind, open, page, reload, scope, token])
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('keydown', close)
    }
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
  async function uploadFiles(files: FileList | File[]) {
    if (scope !== 'personal') {
      setError('请先切到个人库再上传')
      return
    }
    const queue = [...files]
    if (queue.length === 0) return
    setUploading(true)
    setError(undefined)
    try {
      let remaining = maxSelection - selected.size
      for (const file of queue) {
        if (remaining <= 0) break
        if (file.size > MAX_LIBRARY_UPLOAD_BYTES) throw new Error('请上传小于 30MB 的文件')
        if (mediaTypeFromFile(file) === undefined) throw new Error('仅支持图片或视频（jpg/png/webp/gif、mp4/webm/mov）')
        const item = await uploadMediaLibraryFile({ token, file })
        const nextKind = item.mediaType === 'video' ? 'video' : 'image'
        setKind(nextKind)
        setPage(1)
        setReload(value => value + 1)
        setSelected((current) => {
          if (current.has(item.id) || current.size >= maxSelection) return current
          const next = new Map(current)
          next.set(item.id, item)
          return next
        })
        remaining -= 1
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '上传失败')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  const emptyLabel = kind === 'video' ? '当前范围暂无视频素材' : '当前范围暂无图片素材'
  return (
    <div className="media-picker-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="media-picker" role="dialog" aria-modal="true" aria-labelledby="media-picker-title">
        <header>
          <div>
            <h2 id="media-picker-title">选择参考素材</h2>
            <p>已选 {selected.size}/{maxSelection} · 共 {total} 项 · 单文件不超过 30MB</p>
          </div>
          <div className="media-picker-actions">
            <input
              ref={fileRef}
              type="file"
              accept={REFERENCE_UPLOAD_ACCEPT}
              multiple
              hidden
              aria-label="上传图片或视频"
              onChange={(event) => {
                void uploadFiles(event.target.files ?? [])
              }}
            />
            <button
              type="button"
              disabled={uploading || scope !== 'personal' || selected.size >= maxSelection}
              onClick={() => {
                fileRef.current?.click()
              }}
            >
              {uploading ? '上传中…' : '上传图片/视频'}
            </button>
            <button type="button" aria-label="关闭素材库" onClick={onClose}>×</button>
          </div>
        </header>
        <nav aria-label="素材类型">
          {(['image', 'video'] as const).map(value => (
            <button
              key={value}
              type="button"
              className={kind === value ? 'active' : ''}
              onClick={() => {
                setKind(value)
                setPage(1)
              }}
            >
              {value === 'image' ? '图片库' : '视频库'}
            </button>
          ))}
        </nav>
        {isTeam ? (
          <nav aria-label="素材范围">
            {(['personal', 'group', 'team'] as const).map(value => (
              <button
                key={value}
                type="button"
                className={scope === value ? 'active' : ''}
                onClick={() => {
                  setScope(value)
                  setPage(1)
                }}
              >
                {value === 'personal' ? '个人' : value === 'group' ? '组' : '团队'}
              </button>
            ))}
          </nav>
        ) : null}
        {error ? <p className="media-picker-error" role="alert">{error}</p> : null}
        <div
          className="media-picker-grid"
          onDragOver={(event) => {
            event.preventDefault()
          }}
          onDrop={(event) => {
            event.preventDefault()
            void uploadFiles(event.dataTransfer.files)
          }}
        >
          {loading ? <p>正在加载素材…</p> : items.length === 0 ? <p>{emptyLabel}</p> : items.map((item) => {
            const checked = selected.has(item.id)
            return (
              <button
                type="button"
                key={item.id}
                className={checked ? 'media-tile selected' : 'media-tile'}
                aria-pressed={checked}
                onClick={() => {
                  toggle(item)
                }}
              >
                <TilePreview item={item} />
                <strong>{item.originalName ?? `素材 ${item.id}`}</strong>
                <i>{checked ? '✓' : ''}</i>
              </button>
            )
          })}
        </div>
        <footer>
          <div>
            <button type="button" disabled={page <= 1} onClick={() => {
              setPage(value => value - 1)
            }}>上一页</button>
            <span>{page}/{lastPage}</span>
            <button type="button" disabled={page >= lastPage} onClick={() => {
              setPage(value => value + 1)
            }}>下一页</button>
          </div>
          <div>
            <button type="button" onClick={onClose}>取消</button>
            <button
              className="primary"
              type="button"
              disabled={selected.size === 0}
              onClick={() => {
                onConfirm([...selected.values()])
                onClose()
              }}
            >
              使用 {selected.size} 项
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
