import { useTheme } from './ThemeContext.tsx'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? '切换到亮色主题' : '切换到暗色主题'}
      aria-pressed={isDark}
      title={isDark ? '切换到亮色主题' : '切换到暗色主题'}
    >
      <span className="theme-toggle__thumb" aria-hidden="true">{isDark ? '☾' : '☀'}</span>
    </button>
  )
}
