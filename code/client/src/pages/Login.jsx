import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthShell from '../components/AuthShell.jsx';
import { landingPath, useAuth } from '../context/AuthContext.jsx';
import { errorInfo } from '../services/api.js';

const DEMO = [
  ['Applicant', 'applicant@demo.com'],
  ['KYC officer', 'officer@demo.com'],
  ['Compliance', 'checker@demo.com'],
  ['Compliance 2', 'checker2@demo.com'],
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e, creds) {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user = await login(creds?.email ?? email.trim(), creds?.password ?? password);
      navigate(location.state?.from || landingPath(user.role), { replace: true });
    } catch (err) {
      setError(errorInfo(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <div>
        <h2>Sign in</h2>
        <p className="muted">Pick up where you left off.</p>
      </div>
      <form onSubmit={submit} noValidate>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy || !email || !password} style={{ marginTop: 14 }}>
          {busy ? 'Signing in' : 'Sign in'}
        </button>
      </form>
      <p className="muted">
        New here? <Link to="/register">Create an account</Link>
      </p>
      <div className="demo-box">
        <p>Demo accounts, one click</p>
        <div className="demo-buttons">
          {DEMO.map(([label, mail]) => (
            <button key={mail} type="button" className="btn btn-sm" disabled={busy} onClick={() => submit(null, { email: mail, password: 'Demo@1234' })}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </AuthShell>
  );
}
