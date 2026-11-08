import { NavLink } from 'react-router-dom';

export function NavBar() {
  return (
    <header className="card nav-header">
      <nav>
        <NavLink to="/" end>
          Live
        </NavLink>
        <NavLink to="/studio">Studio</NavLink>
      </nav>
    </header>
  );
}
