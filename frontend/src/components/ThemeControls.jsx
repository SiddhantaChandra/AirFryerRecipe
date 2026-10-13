import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from '../app/theme'

const choices = [['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]]

export function ThemeControls() {
  const { theme, setTheme } = useTheme()
  return <div className="theme-controls" role="group" aria-label="Theme selector">
    {choices.map(([value, label, Icon]) => <button key={value} type="button"
      data-testid={`theme-btn-${value}`} aria-label={`${label} theme`} aria-pressed={theme === value}
      onClick={() => setTheme(value)}><Icon size={18} aria-hidden="true" /><span>{label}</span></button>)}
  </div>
}
