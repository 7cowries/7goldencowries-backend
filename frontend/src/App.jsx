import React, { useEffect, useMemo, useState } from 'react';
import Profile from './pages/Profile';
import Quests from './pages/Quests';
import RefRedirect from './pages/RefRedirect';
import Subscription from './pages/Subscription';
import Theme from './pages/Theme';

const ROUTES = {
  '/': { label: 'Quests', component: <Quests /> },
  '/quests': { label: 'Quests', component: <Quests /> },
  '/profile': { label: 'Profile', component: <Profile /> },
  '/subscription': { label: 'Subscription', component: <Subscription /> },
  '/theme': { label: 'Theme', component: <Theme /> },
};

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname || '/');

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname || '/');
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (nextPath) => {
    if (nextPath === path) return;
    window.history.pushState({}, '', nextPath);
    setPath(nextPath);
  };

  const route = useMemo(() => ROUTES[path] || ROUTES['/'], [path]);

  const navItems = useMemo(() => {
    return Object.entries(ROUTES).filter(([key]) => key !== '/');
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1 className="logo">7 Golden Cowries</h1>
        <nav className="nav">
          {navItems.map(([href, { label }]) => (
            <button
              key={href}
              type="button"
              className={`nav-item ${path === href ? 'active' : ''}`}
              onClick={() => navigate(href)}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="page">{route.component}</main>
      <RefRedirect />
    </div>
  );
}
