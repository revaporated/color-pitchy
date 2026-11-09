import { NavLink } from 'react-router-dom';

export function NavBar({ title }: { title?: string }) {
  return (
    <header className="card nav-header">
      <nav>
        <NavLink to="/" end>
          Live
        </NavLink>
        <NavLink to="/library">Library</NavLink>
      </nav>
      {title && <span className="nav-title">{title}</span>}
    </header>
  );
}
