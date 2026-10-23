import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DocUploader, { ADDRESS_TYPES, appendFiles, validateFiles } from '../../components/DocUploader.jsx';
import Icon from '../../components/Icon.jsx';
import { Back, PageHead } from '../../components/ui.jsx';
import { createApplication, errorInfo, listOccupations } from '../../services/api.js';

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY = {
  full_name: '', dob: '', gender: '', pan_number: '', aadhaar_last4: '', mobile: '', email: '',
  address: '', city: '', state: '', pincode: '', occupation_code: '', annual_income: '', consent: false,
};

// Quick feedback only. The server re-validates everything and is the source of truth.
const RULES = {
  full_name: (v) => (v.trim().length < 2 ? 'Enter your full name' : /^[\p{L}][\p{L} .'-]*$/u.test(v.trim()) ? '' : 'Letters, spaces, dots, hyphens and apostrophes only'),
  dob: (v) => (!/^\d{4}-\d{2}-\d{2}$/.test(v) ? 'Enter your date of birth' : v > today() ? 'Date of birth cannot be in the future' : ''),
  gender: (v) => (['MALE', 'FEMALE', 'OTHER'].includes(v) ? '' : 'Choose one'),
  pan_number: (v) => (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.trim().toUpperCase()) ? '' : 'Format: ABCDE1234F'),
  aadhaar_last4: (v) => (/^\d{12}$/.test(v.trim()) ? 'Enter only the last 4 digits of your Aadhaar' : /^\d{4}$/.test(v.trim()) ? '' : 'Exactly 4 digits'),
  address: (v) => (v.trim().length < 10 ? 'Enter your full address (at least 10 characters)' : ''),
  pincode: (v) => (/^[1-9][0-9]{5}$/.test(v.trim()) ? '' : '6 digits, not starting with 0'),
  mobile: (v) => (/^[6-9][0-9]{9}$/.test(v.trim()) ? '' : '10 digits starting with 6, 7, 8 or 9'),
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : 'Enter a valid email address'),
  city: (v) => (v.trim().length < 2 ? 'Enter your city' : ''),
  state: (v) => (v.trim().length < 2 ? 'Enter your state' : ''),
  occupation_code: (v) => (v ? '' : 'Choose your occupation'),
  annual_income: (v) => (/^\d{1,12}(\.\d{1,2})?$/.test(v.trim()) ? '' : 'Enter a number, e.g. 1200000'),
  consent: (v) => (v ? '' : 'Consent is required to submit'),
};

export default function ApplicationForm() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [files, setFiles] = useState([]);
  const [errors, setErrors] = useState({});
  const [fileErrors, setFileErrors] = useState({});
  const [banner, setBanner] = useState('');
  const [progress, setProgress] = useState(null);
  const [occupations, setOccupations] = useState([]);
  const busy = progress !== null;

  useEffect(() => {
    listOccupations().then(setOccupations).catch(() => {});
  }, []);

  const setField = (k) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: value }));
    if (errors[k]) setErrors((er) => ({ ...er, [k]: '' }));
  };

  const types = new Set(files.map((f) => f.type));
  const checklist = [
    ['Details filled in', Object.entries(RULES).every(([k, r]) => k === 'consent' || !r(form[k]))],
    ['PAN document', types.has('PAN_CARD')],
    ['Aadhaar document', types.has('AADHAAR_CARD')],
    ['Address proof', ADDRESS_TYPES.some((t) => types.has(t))],
    ['Consent given', form.consent],
  ];

  function validateAll() {
    const next = {};
    for (const [k, rule] of Object.entries(RULES)) {
      const msg = rule(form[k]);
      if (msg) next[k] = msg;
    }
    const fe = validateFiles(files, 3);
    setErrors(next);
    setFileErrors(fe);
    return Object.keys(next).length === 0 && Object.keys(fe).length === 0;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBanner('');
    if (!validateAll()) {
      setBanner('Fix the highlighted fields and submit again.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const data = new FormData();
    Object.entries(form).forEach(([k, v]) => data.append(k, typeof v === 'boolean' ? String(v) : v.trim()));
    appendFiles(data, files);

    setProgress(0);
    try {
      const app = await createApplication(data, setProgress);
      navigate(`/applications/${app.id}`, { state: { justSubmitted: true } });
    } catch (err) {
      const info = errorInfo(err);
      const byField = {};
      const byFile = {};
      info.details.forEach((d) => {
        const m = /^documents\[(\d+)\]$/.exec(d.field);
        if (m) byFile[m[1]] = d.message;
        else byField[d.field] = d.message;
      });
      setErrors(byField);
      setFileErrors(byFile);
      setBanner(info.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setProgress(null);
    }
  }

  const text = (k, label, props = {}) => (
    <label className="field">
      <span>{label}</span>
      <input value={form[k]} onChange={setField(k)} disabled={busy} aria-invalid={Boolean(errors[k])} {...props} />
      {errors[k] && <small className="field-error">{errors[k]}</small>}
    </label>
  );

  return (
    <form onSubmit={onSubmit} noValidate className="stack">
      <div>
        <Back to="/applications">My applications</Back>
        <PageHead title="Open a savings account">Enter your details exactly as they appear on your documents. Use synthetic test data only.</PageHead>
      </div>

      {banner && <div className="alert alert-error" role="alert">{banner}</div>}

      <div className="form-layout">
        <div className="form-sections">
          <section className="panel">
            <h2>About you</h2>
            <div className="grid-2">
              {text('full_name', 'Full name (as on PAN)', { autoComplete: 'name' })}
              {text('dob', 'Date of birth', { type: 'date', max: today() })}
              <label className="field">
                <span>Gender</span>
                <select value={form.gender} onChange={setField('gender')} disabled={busy} aria-invalid={Boolean(errors.gender)}>
                  <option value="">Select</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </select>
                {errors.gender && <small className="field-error">{errors.gender}</small>}
              </label>
              {text('pan_number', 'PAN', { placeholder: 'ABCPV1234F', maxLength: 10, style: { textTransform: 'uppercase' }, className: 'mono' })}
              {text('aadhaar_last4', 'Aadhaar, last 4 digits only', { inputMode: 'numeric', maxLength: 12, placeholder: '5678' })}
              {text('mobile', 'Mobile number', { inputMode: 'numeric', maxLength: 10, placeholder: '9876543210' })}
              <label className="field">
                <span>Occupation</span>
                <select value={form.occupation_code} onChange={setField('occupation_code')} disabled={busy} aria-invalid={Boolean(errors.occupation_code)}>
                  <option value="">Select</option>
                  {occupations.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
                </select>
                {errors.occupation_code && <small className="field-error">{errors.occupation_code}</small>}
              </label>
              {text('email', 'Email', { type: 'email', autoComplete: 'email', placeholder: 'name@example.org' })}
              {text('annual_income', 'Annual income (₹)', { inputMode: 'decimal', placeholder: '1200000' })}
              {text('city', 'City')}
              {text('state', 'State')}
              {text('pincode', 'Pincode', { inputMode: 'numeric', maxLength: 6, placeholder: '122001' })}
            </div>
            <label className="field">
              <span>Residential address</span>
              <textarea rows={3} value={form.address} onChange={setField('address')} disabled={busy} aria-invalid={Boolean(errors.address)} />
              {errors.address && <small className="field-error">{errors.address}</small>}
            </label>
          </section>

          <section className="panel">
            <h2>Documents</h2>
            <p className="section-note">PAN, Aadhaar and one address proof (electricity bill, bank statement or driving licence). Plain-text files only.</p>
            <DocUploader files={files} setFiles={setFiles} errors={fileErrors} setErrors={setFileErrors} busy={busy} />
          </section>
        </div>

        <aside className="panel pop sticky">
          <h2>Ready to submit?</h2>
          <ul className="checklist">
            {checklist.map(([label, done]) => (
              <li key={label} className={done ? 'done' : ''}>
                <span className="tick"><Icon name="check" /></span>
                {label}
              </li>
            ))}
          </ul>
          <hr className="divider" style={{ margin: '18px 0' }} />
          <label className="check">
            <input type="checkbox" checked={form.consent} onChange={setField('consent')} disabled={busy} />
            <span className="small">I consent to the bank verifying my identity and documents for KYC.</span>
          </label>
          {errors.consent && <span className="field-error block">{errors.consent}</span>}
          {busy && (
            <div className="progress-wrap" aria-live="polite">
              <div className="progress"><div className="progress-bar" style={{ width: `${progress}%` }} /></div>
              <span className="small muted">{progress < 100 ? `Uploading ${progress}%` : 'Verifying your documents'}</span>
            </div>
          )}
          <div className="actions">
            <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Submitting' : 'Submit application'}</button>
          </div>
        </aside>
      </div>
    </form>
  );
}
