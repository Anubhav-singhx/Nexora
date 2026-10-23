import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { landingPath, useAuth } from '../context/AuthContext.jsx';

/** Client-side convenience only. The server enforces every role check for real. */
export default function ProtectedRoute({ roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <p className="center-note">Loading...</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to={landingPath(user.role)} replace />;
  return <Outlet />;
}
