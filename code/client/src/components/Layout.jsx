import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ROLES, landingPath, useAuth } from '../context/AuthContext.jsx';
import Icon from './Icon.jsx';
import { Link } from 'react-router-dom';

const NAV = {
  [ROLES.APPLICANT]: [
    { to: '/applications', label: 'My applications', end: true },
    { to: '/applications/new', label: 'New application' },
  ],
  [ROLES.KYC_OFFICER]: [{ to: '/review', label: 'Review queue' }],
  [ROLES.COMPLIANCE_OFFICER]: [
    { to: '/compliance', label: 'Sign-off queue', end: true },
    { to: '/review', label: 'Review queue' },
    { to: '/compliance/dashboard', label: 'Dashboard' },
    { to: '/compliance/audit', label: 'Audit trail' },
    { to: '/compliance/settings', label: 'Rules & lists' },
  ],
};

const ROLE_LABEL = {
  [ROLES.APPLICANT]: 'Applicant',
  [ROLES.KYC_OFFICER]: 'KYC officer',
  [ROLES.COMPLIANCE_OFFICER]: 'Compliance',
};

export function Brand({ to = '/' }) {
  return (
    <Link to={to} className="brand">
      <span className="brand-mark"><Icon name="logo" /></span>
      onboardiq
    </Link>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Brand to={landingPath(user?.role)} />
          <nav className="nav" aria-label="Main">
            {(NAV[user?.role] || []).map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-user">
            <span className="user-name">{user?.name}</span>
            <span className="role-chip">{ROLE_LABEL[user?.role]}</span>
            <button
              className="btn btn-quiet"
              onClick={() => {
                logout();
                navigate('/login');
              }}
              aria-label="Sign out"
              title="Sign out"
            >
              <Icon name="out" />
            </button>
          </div>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
