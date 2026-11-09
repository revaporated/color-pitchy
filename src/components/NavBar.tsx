import { NavLink } from 'react-router-dom';
import { FiMonitor, FiMoon, FiSun } from 'react-icons/fi';
import { useTheme, type ThemePreference } from '../theme';

const NEXT: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' };

export function NavBar({ title }: { title?: string }) {
  const { preference, setPreference } = useTheme();
  const Icon = preference === 'system' ? FiMonitor : preference === 'light' ? FiSun : FiMoon;
  return (
    <header className="card nav-header">
      <nav>
        <NavLink to="/" end>
          Live
        </NavLink>
        <NavLink to="/library">Library</NavLink>
      </nav>
      {title && <span className="nav-title">{title}</span>}
      <button
        type="button"
        className="icon-button btn-ghost theme-toggle"
        onClick={() => setPreference(NEXT[preference])}
        aria-label={`Theme: ${LABEL[preference]}. Switch to ${LABEL[NEXT[preference]]}`}
        title={`Theme: ${LABEL[preference]} (click for ${LABEL[NEXT[preference]]})`}
      >
        <Icon />
      </button>
    </header>
  );
}
