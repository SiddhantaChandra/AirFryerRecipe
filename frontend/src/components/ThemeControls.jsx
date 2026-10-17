import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from '../app/theme'
import { useAuth } from '../app/auth'

const choices = [['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]]

export function ThemeControls() {
  const { theme, setTheme } = useTheme()
  const auth = useAuth()
  return <div className="theme-preference"><div className="theme-controls" role="group" aria-label="Theme selector">
    {choices.map(([value, label, Icon]) => <button key={value} type="button"
      data-testid={`theme-btn-${value}`} aria-label={`${label} theme`} aria-pressed={theme === value}
      onClick={() => (auth?.setPreference || setTheme)(value)}><Icon size={18} aria-hidden="true" /><span>{label}</span></button>)}
  </div>{auth?.themeSave === 'failed' && <p role="alert">Theme is not saved to your account. <button onClick={auth.retryTheme}>Retry theme save</button></p>}
    {auth?.themeSave === 'saving' && <span className="sr-only" role="status">Saving theme…</span>}
  </div>
}
