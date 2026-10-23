// Every route is registered here once.
//   applicant : /applications, /applications/new, /applications/:id
//   KYC officer (maker)       : /review, /review/:id
//   Compliance officer (checker): /compliance, /compliance/cases/:id, /compliance/dashboard, /compliance/audit, /compliance/settings
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import { ROLES, landingPath, useAuth } from './context/AuthContext.jsx';
import Login from './pages/Login.jsx';
import NotFound from './pages/NotFound.jsx';
import Register from './pages/Register.jsx';
import ApplicationDetail from './pages/applicant/ApplicationDetail.jsx';
import ApplicationForm from './pages/applicant/ApplicationForm.jsx';
import MyApplications from './pages/applicant/MyApplications.jsx';
import ReviewQueue from './pages/officer/ReviewQueue.jsx';
import CaseView from './pages/staff/CaseView.jsx';
import Audit from './pages/compliance/Audit.jsx';
import Dashboard from './pages/compliance/Dashboard.jsx';
import PendingApprovals from './pages/compliance/PendingApprovals.jsx';
import Settings from './pages/compliance/Settings.jsx';

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <p className="center-note">Loading...</p>;
  return <Navigate to={user ? landingPath(user.role) : '/login'} replace />;
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="center-note">Loading...</p>;
  return user ? <Navigate to={landingPath(user.role)} replace /> : children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />

      <Route element={<Layout />}>
        <Route element={<ProtectedRoute roles={[ROLES.APPLICANT]} />}>
          <Route path="/applications" element={<MyApplications />} />
          <Route path="/applications/new" element={<ApplicationForm />} />
          <Route path="/applications/:id" element={<ApplicationDetail />} />
        </Route>

        <Route element={<ProtectedRoute roles={[ROLES.KYC_OFFICER, ROLES.COMPLIANCE_OFFICER]} />}>
          <Route path="/review" element={<ReviewQueue />} />
          <Route path="/review/:id" element={<CaseView mode="maker" />} />
        </Route>

        <Route element={<ProtectedRoute roles={[ROLES.COMPLIANCE_OFFICER]} />}>
          <Route path="/compliance" element={<PendingApprovals />} />
          <Route path="/compliance/cases/:id" element={<CaseView mode="checker" />} />
          <Route path="/compliance/dashboard" element={<Dashboard />} />
          <Route path="/compliance/audit" element={<Audit />} />
          <Route path="/compliance/settings" element={<Settings />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
