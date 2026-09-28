import { useState, type FormEvent } from 'react'
import type { AuthUser } from './auth.tsx'
import { useAuth } from './auth.tsx'
import { canvasAppUrl } from './canvas-app-links.ts'
import { canvasBaseUrl } from './canvas-login-redirect.ts'
import { switchActiveTeam } from './project-context.ts'
import { createTeam } from './team-api.ts'
import { useTheme } from './ThemeContext.tsx'

type IconProps = { className?: string; size?: number }

function iconProps({ className, size = 16 }: IconProps) {
  return {
    className,
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }
}

function UserIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function PlusIcon(props: IconProps) {
  return (
    <svg {...iconProps({ ...props, size: props.size ?? 14 })}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  )
}

function UsersIcon(props: IconProps) {
  return (
    <svg {...iconProps({ ...props, size: props.size ?? 14 })}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function ContrastIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a10 10 0 0 1 0 20z" />
    </svg>
  )
}

function SunIcon(props: IconProps) {
  return (
    <svg {...iconProps({ ...props, size: props.size ?? 14 })}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  )
}

function MoonIcon(props: IconProps) {
  return (
    <svg {...iconProps({ ...props, size: props.size ?? 14 })}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  )
}

function LogOutIcon(props: IconProps) {
  return (
    <svg {...iconProps({ ...props, size: props.size ?? 14 })}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  )
}

function CloseIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

function teamMenuFlags(user: AuthUser | null) {
  const accountKind = user?.account_kind ?? 'normal'
  const hasTeam = Boolean(user?.team)
  const inActiveTeam = Boolean(user?.active_team_id)
  const isManager =
    user?.team_role === 'owner' ||
    user?.team_role === 'admin' ||
    user?.team_role === 'group_admin'
  const isNormal = accountKind === 'normal'

  return {
    showCreate: isNormal && !hasTeam,
    showEnter: isNormal && hasTeam && !inActiveTeam,
    showSwitchPersonal: isNormal && hasTeam && inActiveTeam,
    showManage: hasTeam && inActiveTeam && isManager,
    showView: hasTeam && inActiveTeam && !isManager,
  }
}

export interface UserMenuProps {
  user?: AuthUser | null
  onApplyUser?: (user: AuthUser) => void
  onLogout?: () => Promise<void>
  canvasBase?: string
  theme?: 'light' | 'dark'
  setTheme?: (theme: 'light' | 'dark') => void
  token?: string | null
}

export function UserMenu(props: UserMenuProps = {}) {
  const auth = useAuth()
  const themeCtx = useTheme()
  const user = props.user !== undefined ? props.user : auth.user
  const token = props.token !== undefined ? props.token : auth.token
  const applyUser = props.onApplyUser ?? auth.applyUser
  const logout = props.onLogout ?? auth.logout
  const theme = props.theme ?? themeCtx.theme
  const setTheme = props.setTheme ?? themeCtx.setTheme
  const base = props.canvasBase ?? canvasBaseUrl()

  const isTeamUser = user?.user_type === 'team'
  const cloudStorageLabel = user?.storage?.usage_label ?? '0G/0G'
  const personalUsedLabel = user?.storage?.user_usage_label ?? '0G'
  const membershipName = user?.membership?.plan_name ?? (user?.is_vip ? '会员' : '普通')
  const expiresLabel = user?.membership?.expires_at
    ? new Date(user.membership.expires_at).toLocaleDateString('zh-CN')
    : '永久'
  const isDark = theme === 'dark'
  const flags = teamMenuFlags(user)
  const hasTeamActions =
    flags.showCreate ||
    flags.showEnter ||
    flags.showSwitchPersonal ||
    flags.showManage ||
    flags.showView

  const [createOpen, setCreateOpen] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  async function handleLogout() {
    await logout()
  }

  async function handleSwitch(teamId: number | null) {
    if (token === null) return
    setActionError(null)
    setSwitching(true)
    try {
      const nextUser = await switchActiveTeam(token, teamId)
      applyUser(nextUser)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '切换失败')
    } finally {
      setSwitching(false)
    }
  }

  function openCreateModal() {
    setTeamName('')
    setCreateError(null)
    setCreateOpen(true)
  }

  function closeCreateModal() {
    if (creating) return
    setCreateOpen(false)
  }

  async function handleCreateTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (token === null) return
    const name = teamName.trim()
    if (!name) {
      setCreateError('请输入团队名称')
      return
    }

    setCreateError(null)
    setCreating(true)
    try {
      const result = await createTeam(token, name)
      applyUser(result.user)
      setCreateOpen(false)
      const teamCode = result.team.code ?? result.user.team?.code
      if (teamCode) {
        window.location.assign(canvasAppUrl(`/team/${encodeURIComponent(teamCode)}/users`, base))
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建团队失败')
    } finally {
      setCreating(false)
    }
  }

  function openCanvasPath(path: string) {
    window.location.assign(canvasAppUrl(path, base))
  }

  return (
    <>
      <div className="user-menu">
        <button type="button" className="user-menu__trigger" aria-label="用户信息">
          <span className="user-menu__avatar" aria-hidden="true">
            {user?.name?.charAt(0)?.toUpperCase() ?? 'U'}
          </span>
          <span className="user-menu__name">{user?.name ?? '用户'}</span>
          {isTeamUser ? <span className="user-menu__badge">团队</span> : null}
        </button>

        <div className="user-menu__panel">
          <div className="user-menu__card">
            <div className="user-menu__section-title">
              <UserIcon className="user-menu__section-icon" />
              <span>个人信息</span>
            </div>
            <div className="user-menu__rows">
              <div className="user-menu__row">
                <span>用户名</span>
                <strong>{user?.name ?? '-'}</strong>
              </div>
              {isTeamUser && user?.team ? (
                <div className="user-menu__row">
                  <span>所属团队</span>
                  <strong>{user.team.name}</strong>
                </div>
              ) : null}
              {!isTeamUser ? (
                <>
                  <div className="user-menu__row">
                    <span>会员</span>
                    <strong className={user?.is_vip ? 'user-menu__vip' : undefined}>{membershipName}</strong>
                  </div>
                  <div className="user-menu__row">
                    <span>到期时间</span>
                    <strong>{expiresLabel}</strong>
                  </div>
                </>
              ) : null}
              {isTeamUser ? (
                <>
                  <div className="user-menu__row">
                    <span>团队积分</span>
                    <strong className="user-menu__credits">⚡ {user?.credits ?? 0}</strong>
                  </div>
                  <div className="user-menu__row">
                    <span>团队云空间</span>
                    <strong className="user-menu__storage">{cloudStorageLabel}</strong>
                  </div>
                  <div className="user-menu__row">
                    <span>个人已用</span>
                    <strong>{personalUsedLabel}</strong>
                  </div>
                </>
              ) : (
                <>
                  <div className="user-menu__row">
                    <span>云空间</span>
                    <strong className="user-menu__storage">{cloudStorageLabel}</strong>
                  </div>
                  <button
                    type="button"
                    className="user-menu__row user-menu__row--button"
                    onClick={() => openCanvasPath('/user/credits')}
                  >
                    <span>积分</span>
                    <strong className="user-menu__credits">⚡ {user?.credits ?? 0}</strong>
                  </button>
                </>
              )}
            </div>

            {hasTeamActions ? (
              <div className="user-menu__actions">
                {flags.showCreate ? (
                  <button type="button" className="user-menu__action" onClick={openCreateModal}>
                    <PlusIcon />
                  创建团队
                  </button>
                ) : null}
                {flags.showEnter ? (
                  <button
                    type="button"
                    className="user-menu__action"
                    disabled={switching || user?.team == null}
                    onClick={() => {
                      if (user?.team == null) return
                      void handleSwitch(user.team.id)
                    }}
                  >
                    <UsersIcon />
                    {switching ? '切换中...' : '进入团队'}
                  </button>
                ) : null}
                {flags.showSwitchPersonal ? (
                  <button
                    type="button"
                    className="user-menu__action"
                    disabled={switching}
                    onClick={() => void handleSwitch(null)}
                  >
                    <UserIcon size={14} />
                    {switching ? '切换中...' : '切换个人账户'}
                  </button>
                ) : null}
                {flags.showManage && user?.team ? (
                  <button
                    type="button"
                    className="user-menu__action"
                    onClick={() => {
                      const teamCode = user.team?.code
                      if (!teamCode) return
                      openCanvasPath(`/team/${encodeURIComponent(teamCode)}/users`)
                    }}
                  >
                    <UsersIcon />
                  团队管理
                  </button>
                ) : null}
                {flags.showView && user?.team ? (
                  <button
                    type="button"
                    className="user-menu__action"
                    onClick={() => {
                      const teamCode = user.team?.code
                      if (!teamCode) return
                      openCanvasPath(`/team/${encodeURIComponent(teamCode)}/credits`)
                    }}
                  >
                    <UsersIcon />
                  查看团队
                  </button>
                ) : null}
                {actionError ? <p className="user-menu__error">{actionError}</p> : null}
              </div>
            ) : null}

            <div className="user-menu__theme">
              <span className="user-menu__theme-label">
                <ContrastIcon className="user-menu__theme-icon" />
              模式切换
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={isDark}
                aria-label={isDark ? '切换为浅色模式' : '切换为深色模式'}
                className="user-menu__theme-switch"
                onClick={() => setTheme(isDark ? 'light' : 'dark')}
              >
                <span className={!isDark ? 'is-active' : undefined}>
                  <SunIcon />
                </span>
                <span className={isDark ? 'is-active' : undefined}>
                  <MoonIcon />
                </span>
              </button>
            </div>

            <button type="button" className="user-menu__logout" onClick={() => void handleLogout()}>
              <LogOutIcon />
            退出登录
            </button>
          </div>
        </div>
      </div>

      {createOpen ? (
        <div className="user-menu-modal" onClick={closeCreateModal} role="presentation">
          <div
            className="user-menu-modal__card"
            onClick={event => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-team-title"
          >
            <div className="user-menu-modal__head">
              <h2 id="create-team-title">创建团队</h2>
              <button type="button" onClick={closeCreateModal} disabled={creating} aria-label="关闭">
                <CloseIcon />
              </button>
            </div>
            <form className="user-menu-modal__form" onSubmit={event => void handleCreateTeam(event)}>
              <label>
                <span>团队名称</span>
                <input
                  type="text"
                  value={teamName}
                  onChange={event => setTeamName(event.target.value)}
                  maxLength={255}
                  required
                  autoFocus
                  disabled={creating}
                />
              </label>
              {createError ? <p className="user-menu__error">{createError}</p> : null}
              <div className="user-menu-modal__footer">
                <button type="button" onClick={closeCreateModal} disabled={creating}>
                  取消
                </button>
                <button type="submit" disabled={creating}>
                  {creating ? '创建中...' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  )
}
