import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from './auth.tsx'
import type { AgentMode, AgentSessionRecord, ExecutionMode } from './agent-session.ts'
import { ExceptionDecisionCard } from './ExceptionDecisionCard.tsx'
import { fetchSpaces, switchActiveTeam, type SpaceSummary } from './project-context.ts'
import { newSession, readSessions, sessionScope, writeSessions } from './session-store.ts'
import { useAgentSession } from './useAgentSession.ts'
import { AgentMarkdown } from './AgentMarkdown.tsx'
import { ArtifactCards } from './ArtifactCards.tsx'
import { GenerationIdActions } from './GenerationIdActions.tsx'
import { ComposerAttachBar, ComposerParamBar } from './GenerationComposer.tsx'
import {
  defaultGenerationContext,
  fallbackGenerationConfig,
  fetchGenerationConfig,
  type GenerationConfig,
} from './generation.ts'
import { MediaLibraryPicker } from './MediaLibraryPicker.tsx'
import type { MediaLibraryItem } from './media-library.ts'
import {
  CreativeSessionNotFoundError,
  fetchCreativeSessionDetail,
  fetchServerSessions,
  mergeSessionIndex,
  projectCreativeTimeline,
  saveServerSession,
  uploadLocalUserPrompts,
} from './server-session-index.ts'
import { WorkflowPanel } from './WorkflowPanel.tsx'
import { ThemeToggle } from './ThemeToggle.tsx'
import { AgentScrollArea } from './AgentScrollArea.tsx'
import { useGenerationLifecyclePoll } from './useGenerationLifecyclePoll.ts'
import { artifactsForMessage, resolvedGenerationRefs } from './message-artifacts.ts'

export function AgentWorkspace({ mode }: { mode: AgentMode }) {
  const { token, user, logout, applyUser } = useAuth()
  const scope = useMemo(() => sessionScope(user?.id ?? 0, user?.active_team_id, mode), [mode, user])
  const [sessions, setSessions] = useState<AgentSessionRecord[]>(() => readSessions(localStorage, scope))
  const [activeId, setActiveId] = useState(() => sessions[0]?.sessionId ?? '')
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('manual')
  const [draft, setDraft] = useState('')
  const [spaces, setSpaces] = useState<SpaceSummary[]>([])
  const [spaceId, setSpaceId] = useState<string>()
  const [generationConfig, setGenerationConfig] = useState<GenerationConfig>(fallbackGenerationConfig)
  const [generationContext, setGenerationContext] = useState(() => defaultGenerationContext(mode))
  const [referenceItems, setReferenceItems] = useState<MediaLibraryItem[]>([])
  const [referencePickerOpen, setReferencePickerOpen] = useState(false)
  const [historySyncWarning, setHistorySyncWarning] = useState<string>()
  const [historyReady, setHistoryReady] = useState(false)
  const session = sessions.find(item => item.sessionId === activeId) ?? sessions[0] ?? newSession(mode)
  const selectedSpace = spaces.find(item => item.uuid === spaceId)
  const projectId =
    spaceId === undefined || selectedSpace?.firstProjectUuid == null
      ? undefined
      : selectedSpace.firstProjectUuid

  useEffect(() => {
    const cached = readSessions(localStorage, scope)
    if (token === null) {
      const next = cached.length > 0 ? cached : [newSession(mode)]
      writeSessions(localStorage, scope, next)
      setSessions(next)
      setActiveId(next[0]?.sessionId ?? '')
      setHistoryReady(true)
      return
    }
    const controller = new AbortController()
    setHistoryReady(false)
    void fetchServerSessions(token, mode, controller.signal)
      .then((remote) => {
        if (controller.signal.aborted) return
        const merged = mergeSessionIndex(readSessions(localStorage, scope), remote, mode)
        const next = merged.length > 0 ? merged : [newSession(mode)]
        writeSessions(localStorage, scope, next)
        setSessions(next)
        setActiveId(current => next.some(item => item.sessionId === current) ? current : next[0]?.sessionId ?? '')
        setHistorySyncWarning(undefined)
        setHistoryReady(true)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        const next = cached.length > 0 ? cached : [newSession(mode)]
        writeSessions(localStorage, scope, next)
        setSessions(next)
        setActiveId(next[0]?.sessionId ?? '')
        setHistorySyncWarning('创作记录未能同步')
        setHistoryReady(true)
      })
    return () => {
      controller.abort()
    }
  }, [mode, scope, token])
  useEffect(() => {
    if (token === null || !historyReady || activeId === '') return
    const local = readSessions(localStorage, scope).find(item => item.sessionId === activeId)
    if (local?.activeRun !== undefined) return
    const controller = new AbortController()
    void fetchCreativeSessionDetail(token, activeId, mode, controller.signal)
      .then(async (detail) => {
        if (controller.signal.aborted) return
        const previous = readSessions(localStorage, scope).find(item => item.sessionId === activeId)
        const projected = projectCreativeTimeline(mode, detail, detail.entries, previous)
        const updated = [projected, ...readSessions(localStorage, scope).filter(item => item.sessionId !== projected.sessionId)]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        writeSessions(localStorage, scope, updated)
        setSessions(updated)
        if (detail.entries.length === 0 && previous !== undefined && previous.messages.some(message => message.role === 'user')) {
          try {
            await uploadLocalUserPrompts(token, previous, controller.signal)
          } catch {
            if (!controller.signal.aborted) setHistorySyncWarning('创作记录未能同步')
          }
        } else {
          setHistorySyncWarning(undefined)
        }
      })
      .catch(async (error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof CreativeSessionNotFoundError) {
          const draft = readSessions(localStorage, scope).find(item => item.sessionId === activeId)
          if (draft === undefined) return
          try {
            const saved = await saveServerSession(token, draft, controller.signal, {
              ...(spaceId === undefined ? {} : { spaceId }),
              ...(projectId === undefined ? {} : { projectId }),
            })
            if (saved !== undefined) {
              const next = {
                ...draft,
                serverRevision: saved.revision,
                title: saved.title,
                updatedAt: saved.updatedAt,
                coverUrl: saved.coverUrl,
              }
              const updated = [next, ...readSessions(localStorage, scope).filter(item => item.sessionId !== next.sessionId)]
              writeSessions(localStorage, scope, updated)
              setSessions(updated)
            }
          } catch {
            if (!controller.signal.aborted) setHistorySyncWarning('创作记录未能同步')
          }
          return
        }
        setHistorySyncWarning('创作记录未能同步')
      })
    return () => {
      controller.abort()
    }
  }, [activeId, historyReady, mode, scope, token])
  useEffect(() => {
    if (token === null) return
    const controller = new AbortController()
    void fetchSpaces(token)
      .then(setSpaces)
      .catch(() => {
        setSpaces([])
      })
    return () => {
      controller.abort()
    }
  }, [token, user?.active_team_id])
  useEffect(() => {
    setGenerationContext(defaultGenerationContext(mode, generationConfig))
    setReferenceItems([])
  }, [mode, generationConfig])
  useEffect(() => {
    if (token === null) return
    const controller = new AbortController()
    void fetchGenerationConfig(token, controller.signal)
      .then(setGenerationConfig)
      .catch(() => {
        setGenerationConfig(fallbackGenerationConfig)
      })
    return () => {
      controller.abort()
    }
  }, [token])

  function updateSession(next: AgentSessionRecord) {
    const updated = [next, ...readSessions(localStorage, scope).filter(item => item.sessionId !== next.sessionId)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    // Synchronous storage is an admission boundary for manual approval, not a later React effect.
    writeSessions(localStorage, scope, updated)
    setSessions(updated)
  }
  const agent = useAgentSession({
    session,
    executionMode,
    ...(spaceId === undefined ? {} : { spaceId }),
    ...(projectId === undefined ? {} : { projectId }),
    onSessionChange: updateSession,
  })
  useGenerationLifecyclePoll({
    token,
    session,
    mode,
    ...(spaceId === undefined ? {} : { spaceId }),
    ...(projectId === undefined ? {} : { projectId }),
    onSessionChange: updateSession,
  })

  async function startNew() {
    const next = newSession(mode)
    writeSessions(localStorage, scope, [next, ...readSessions(localStorage, scope)])
    setSessions(current => [next, ...current])
    setActiveId(next.sessionId)
    if (token === null) return
    try {
      const saved = await saveServerSession(token, next, undefined, {
        ...(spaceId === undefined ? {} : { spaceId }),
        ...(projectId === undefined ? {} : { projectId }),
      })
      if (saved !== undefined) {
        updateSession({
          ...next,
          serverRevision: saved.revision,
          title: saved.title,
          updatedAt: saved.updatedAt,
          coverUrl: saved.coverUrl,
        })
      }
    } catch {
      setHistorySyncWarning('创作记录未能同步')
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (
      await agent.send(
        draft,
        generationContext,
        referenceItems.map(item => item.id),
      )
    ) {
      setDraft('')
      setReferenceItems([])
      setGenerationContext(current =>
        current.kind === 'image' ? { ...current, parameters: { ...current.parameters, referenceAssets: [] } } : current,
      )
    }
  }
  async function changeAccount(value: string) {
    if (token === null) return
    const next = await switchActiveTeam(token, value === 'personal' ? null : Number(value))
    applyUser(next)
    setSpaceId(undefined)
  }

  return (
    <main className="workspace-shell">
      <aside className="session-sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">S</span>
          <strong>ShotGo Agent</strong>
        </div>
        <button className="new-session" type="button" onClick={startNew}>
          ＋ 新建创作
        </button>
        <nav aria-label="历史会话">
          {sessions.map(item => (
            <button
              key={item.sessionId}
              type="button"
              className={item.sessionId === session.sessionId ? 'session active' : 'session'}
              onClick={() => {
                setActiveId(item.sessionId)
              }}
            >
              <strong>{item.title}</strong>
              <span>{new Date(item.updatedAt).toLocaleString('zh-CN')}</span>
              {item.coverUrl ? <img alt="" className="session-cover" src={item.coverUrl} /> : null}
            </button>
          ))}
        </nav>
      </aside>
      <section className="agent-main">
        <header>
          <div className="mode-tabs">
            <a className={mode === 'image' ? 'active' : ''} href="/ai-tool/image-generator">
              图片生成
            </a>
            <a className={mode === 'video' ? 'active' : ''} href="/ai-tool/video-generator">
              视频生成
            </a>
          </div>
          <div className="account">
            <ThemeToggle />
            <span>
              {user?.team?.name ?? '个人空间'} · {user?.name}
            </span>
            <button type="button" onClick={() => void logout()}>
              退出
            </button>
          </div>
        </header>
        <div className="context-bar">
          <div className="context-selectors">
            {user?.team === null || user?.team === undefined ? null : (
              <label>
                账户
                <select
                  aria-label="账户上下文"
                  value={
                    user.active_team_id === null || user.active_team_id === undefined
                      ? 'personal'
                      : String(user.active_team_id)
                  }
                  onChange={event => void changeAccount(event.target.value)}
                >
                  <option value="personal">个人空间</option>
                  <option value={user.team.id}>{user.team.name}</option>
                </select>
              </label>
            )}
            <label>
              项目
              <select
                value={spaceId ?? ''}
                onChange={(event) => {
                  setSpaceId(event.target.value || undefined)
                }}
              >
                <option value="">不绑定项目</option>
                {spaces.map(space => (
                  <option key={space.uuid} value={space.uuid}>
                    {space.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="execution-switch" aria-label="执行模式">
            <button
              type="button"
              className={executionMode === 'automatic' ? 'active' : ''}
              onClick={() => {
                setExecutionMode('automatic')
              }}
            >
              自动模式
            </button>
            <button
              type="button"
              className={executionMode === 'manual' ? 'active' : ''}
              onClick={() => {
                setExecutionMode('manual')
              }}
            >
              手动模式
            </button>
          </div>
        </div>
        <AgentScrollArea>
          <div className="agent-status-area">
            {historySyncWarning === undefined ? null : (
              <p className="history-sync-warning" role="status">
                {historySyncWarning}
              </p>
            )}
            <WorkflowPanel workflow={session.workflow} {...(session.revision ? { revision: session.revision } : {})} />
          </div>
          <section className="conversation" aria-live="polite">
            {session.messages.length === 0 ? (
              <div className="empty">
                <h1>{mode === 'image' ? '想生成什么图片？' : '想制作什么视频？'}</h1>
                <p>参考素材放在输入框上方。发送后会在开始生成前确认一次。</p>
              </div>
            ) : (
              session.messages.map((message) => {
                const refs = resolvedGenerationRefs(message)
                const displayArtifacts = artifactsForMessage(message, mode)
                return (
                  <article key={message.id} className={`message ${message.role}`}>
                    <span>{message.role === 'user' ? '你' : 'Agent'}</span>
                    <div>
                      <AgentMarkdown>{message.text || (message.status === 'streaming' ? '正在思考…' : '')}</AgentMarkdown>
                      {message.generationContext ? (
                        <small>
                          {message.generationContext.modelId} · {message.generationContext.parameters.aspectRatioId} ·{' '}
                          {message.generationContext.parameters.resolutionId}
                        </small>
                      ) : null}
                      {displayArtifacts.length > 0 ? (
                        <ArtifactCards
                          artifacts={displayArtifacts}
                          {...(refs.length > 0 ? { generationRefs: refs } : {})}
                        />
                      ) : null}
                      {message.role === 'assistant' && displayArtifacts.length === 0 ? (
                        <GenerationIdActions
                          text={message.text}
                          {...(message.artifacts ? { artifacts: message.artifacts } : {})}
                          {...(refs.length > 0 ? { generationRefs: refs } : {})}
                        />
                      ) : null}
                    </div>
                  </article>
                )
              })
            )}
            {agent.pendingRunStart === undefined ? null : (
              <article className="run-start-card">
                <div>
                  <strong>开始本次生成</strong>
                  <p>手动模式本轮只确认这一次。后续报价、重试和恢复不会再打断。</p>
                </div>
                <div>
                  <button
                    type="button"
                    disabled={agent.runStartResponding}
                    onClick={() => void agent.confirmRunStart('rejected')}
                  >
                    取消
                  </button>
                  <button
                    className="primary"
                    type="button"
                    disabled={agent.runStartResponding}
                    onClick={() => void agent.confirmRunStart('allowed-once')}
                  >
                    {agent.runStartResponding ? '提交中…' : '开始执行'}
                  </button>
                </div>
              </article>
            )}
            {Object.values(agent.decisions).map(decision => (
              <ExceptionDecisionCard
                key={decision.decisionId}
                decision={decision}
                client={agent.decisionClient}
                onChange={(next) => {
                  agent.setDecisions(current => ({ ...current, [next.decisionId]: next }))
                }}
              />
            ))}
          </section>
        </AgentScrollArea>
        <div className="agent-controls">
          {agent.phase === 'error' && session.activeRun ? <button type="button" onClick={agent.reconnect}>恢复原任务连接（不重新提交）</button> : null}
          {agent.error === undefined ? null : (
            <p className="run-error" role="alert">
              {agent.error}
            </p>
          )}
          <form className="composer" onSubmit={event => void submit(event)}>
            <ComposerAttachBar
              referenceItems={referenceItems}
              onOpenReferences={() => {
                setReferencePickerOpen(true)
              }}
              onRemoveReference={(id) => {
                setReferenceItems(items => items.filter(item => item.id !== id))
                setGenerationContext(current => ({
                  ...current,
                  parameters: {
                    ...current.parameters,
                    referenceAssets: (current.parameters.referenceAssets ?? []).filter(
                      item => item.mediaLibraryItemId !== id,
                    ),
                  },
                }))
              }}
            />
            <textarea
              aria-label="创作要求"
              maxLength={20_000}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
              }}
              placeholder={mode === 'image' ? '描述图片内容、风格和用途…' : '描述视频脚本、画面、时长和用途…'}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey) return
                event.preventDefault()
                if (['authorizing', 'running', 'cancelling'].includes(agent.phase)) return
                if (draft.trim().length === 0) return
                event.currentTarget.form?.requestSubmit()
              }}
            />
            <ComposerParamBar
              context={generationContext}
              config={generationConfig}
              onChange={(next) => {
                setGenerationContext(next)
              }}
            />
            <div className="composer-footer">
              <span>
                {executionMode === 'automatic'
                  ? '自动模式：例外动作才会暂停'
                  : '手动模式：每轮开始前确认一次'}
              </span>
              <div className="composer-footer__actions">
                <em>Enter 发送 · Shift+Enter 换行</em>
                {agent.phase === 'running' || agent.phase === 'cancelling' ? (
                  <button type="button" onClick={() => void agent.cancel()}>
                    {agent.phase === 'cancelling' ? '取消中…' : '停止'}
                  </button>
                ) : (
                  <button
                    className="primary"
                    type="submit"
                    disabled={agent.phase === 'authorizing' || draft.trim().length === 0}
                  >
                    {agent.phase === 'authorizing' ? '正在连接…' : '发送'}
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      </section>
      {token === null ? null : (
        <MediaLibraryPicker
          open={referencePickerOpen}
          token={token}
          isTeam={user?.active_team_id != null}
          initialIds={referenceItems.map(item => item.id)}
          maxSelection={9}
          onClose={() => {
            setReferencePickerOpen(false)
          }}
          onConfirm={(items) => {
            const merged = new Map(referenceItems.map(item => [item.id, item]))
            for (const item of items) merged.set(item.id, item)
            const selected = [...merged.values()].slice(0, 9)
            setReferenceItems(selected)
            setGenerationContext(current => ({
              ...current,
              parameters: {
                ...current.parameters,
                referenceAssets: selected.map(item => ({ mediaLibraryItemId: item.id })),
              },
            }))
          }}
        />
      )}
    </main>
  )
}
