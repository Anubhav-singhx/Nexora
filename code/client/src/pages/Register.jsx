import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthShell from '../components/AuthShell.jsx';
import { landingPath, useAuth } from '../context/AuthContext.jsx';
import { errorInfo } from '../services/api.js';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setErrors({});
    setBusy(true);
    try {
      const user = await register(form.name.trim(), form.email.trim(), form.password);
      navigate(landingPath(user.role), { replace: true });
    } catch (err) {
      const info = errorInfo(err);
      const byField = {};
      info.details.forEach((d) => (byField[d.field] = d.message));
      setErrors(byField);
      setError(info.details.length ? '' : info.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <div>
        <h2>Create your account</h2>
        <p className="muted">Takes a minute. You will need your PAN and three documents to apply.</p>
      </div>
      <form onSubmit={onSubmit} noValidate>
        <label className="field">
          <span>Full name</span>
          <input value={form.name} onChange={set('name')} autoComplete="name" autoFocus aria-invalid={Boolean(errors.name)} />
          {errors.name && <small className="field-error">{errors.name}</small>}
        </label>
        <label className="field">
          <span>Email</span>
          <input type="email" value={form.email} onChange={set('email')} autoComplete="email" aria-invalid={Boolean(errors.email)} />
          {errors.email && <small className="field-error">{errors.email}</small>}
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" aria-invalid={Boolean(errors.password)} />
          <small className="hint">8+ characters, with a letter and a digit.</small>
          {errors.password && <small className="field-error">{errors.password}</small>}
        </label>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy} style={{ marginTop: 14 }}>
          {busy ? 'Creating account' : 'Create account'}
        </button>
      </form>
      <p className="muted">
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </AuthShell>
  );
}
