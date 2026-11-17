import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, NavLink, Route, Routes, useLocation, Link } from 'react-router-dom';
import './styles.css';
import { ToastHost } from './components/common';
import Home from './pages/Home';
import Live from './pages/Live';
import Library from './pages/Library';
import Portrait from './pages/Portrait';
import Settings from './pages/Settings';
import About from './pages/About';
import { sensing } from './cv/sensing';

// test/diagnostic hook (read-only use in automated tests)
(window as unknown as { __clayloop: unknown }).__clayloop = { sensing };

const Exhibition = lazy(() => import('./pages/Exhibition'));
const Compare = lazy(() => import('./pages/Compare'));

function Shell() {
  const loc = useLocation();
  if (loc.pathname.startsWith('/exhibition')) {
    return <Suspense fallback={null}><Exhibition /></Suspense>;
  }
  const stage = loc.pathname.startsWith('/live');
  return (
    <div className={`shell ${stage ? 'stage' : ''}`}>
      <header className="topbar">
        <Link to="/" className="brand">ClayLoop <span>material mirror</span></Link>
        <nav className="nav">
          <NavLink to="/live">Live practice</NavLink>
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/settings">Calibration</NavLink>
          <NavLink to="/about">Method</NavLink>
        </nav>
        <Link to="/exhibition" className="btn">Exhibition mode</Link>
      </header>
      <Suspense fallback={<div className="page muted">Loading…</div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/live" element={<Live />} />
          <Route path="/library" element={<Library />} />
          <Route path="/session/:id" element={<Portrait />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<div className="page"><h1>Not found</h1><Link to="/">Home</Link></div>} />
        </Routes>
      </Suspense>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Shell />
      <ToastHost />
    </HashRouter>
  </StrictMode>,
);
