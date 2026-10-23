import { useCallback, useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import DocUploader, { appendFiles, validateFiles } from '../../components/DocUploader.jsx';
import StatusStamp from '../../components/Stamp.jsx';
import { Back, ErrorBox, Loading } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { DOC_TYPE_LABEL, fmtDate, fmtDateTime, inr, timeLeft } from '../../lib/format.js';
import { errorInfo, getApplication, getDocumentContent, resubmitApplication } from '../../services/api.js';

const MOVING = ['SUBMITTED', 'EXTRACTING', 'IN_REVIEW', 'PENDING_CHECKER'];
const GOOD = ['APPROVED', 'AUTO_APPROVED'];
const BAD = ['REJECTED', 'AUTO_REJECTED'];
const HEADLINE = {
  SUBMITTED: 'Application received',
  EXTRACTING: 'Checking your documents',
  IN_REVIEW: 'A person is looking at it',
  PENDING_CHECKER: 'One last sign-off',
  RESUBMISSION_REQUESTED: 'We need new documents',
  AUTO_APPROVED: 'You are in',
  APPROVED: 'You are in',
  AUTO_REJECTED: 'We could not approve this',
  REJECTED: 'We could not approve this',
  CLOSED_EXPIRED: 'This application is closed',
};

function Timeline({ items, status }) {
  return (
    <ol className="timeline" aria-label="Application history">
      {items.map((t, i) => {
        const last = i === items.length - 1;
        const cls = last ? (GOOD.includes(t.status) ? 'final-good' : BAD.includes(t.status) ? 'final-bad' : MOVING.includes(status) || status === 'RESUBMISSION_REQUESTED' ? 'now' : '') : '';
        return (
          <li key={i} className={cls}>
            <span className="node" />
            <div>
              <strong>{t.label}</strong>
              <time>{fmtDateTime(t.at)}</time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function DocRow({ appId, doc }) {
  const [state, setState] = useState({ open: false, text: '', error: '', loading: false });
  async function toggle() {
    if (state.open) return setState((s) => ({ ...s, open: false }));
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const d = await getDocumentContent(appId, doc.doc_id);
      setState({ open: true, text: d.content, error: '', loading: false });
    } catch (e) {
      setState({ open: true, text: '', error: errorInfo(e).message, loading: false });
    }
  }
  return (
    <li className={`doc-row${doc.superseded ? ' replaced' : ''}`}>
      <div className="row-between">
        <div>
          <strong className="mono">{doc.doc_id}</strong>{' '}
          <span className="muted small">{DOC_TYPE_LABEL[doc.declared_type] || doc.declared_type}{doc.superseded ? ', replaced' : ''}</span>
        </div>
        <button className="btn btn-quiet btn-sm" onClick={toggle} disabled={state.loading}>
          {state.loading ? 'Opening' : state.open ? 'Hide' : 'View text'}
        </button>
      </div>
      {state.open && (state.error ? <div className="alert alert-error">{state.error}</div> : <pre className="doc-text">{state.text}</pre>)}
    </li>
  );
}

function ResubmitPanel({ app, onDone }) {
  const toast = useToast();
  const [files, setFiles] = useState([]);
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState('');
  const [progress, setProgress] = useState(null);
  const left = timeLeft(app.resubmission_deadline);

  async function submit(e) {
    e.preventDefault();
    setBanner('');
    const fe = validateFiles(files, 1);
    setErrors(fe);
    if (Object.keys(fe).length) return;
    const data = new FormData();
    appendFiles(data, files);
    setProgress(0);
    try {
      await resubmitApplication(app.id, data, setProgress);
      toast('New documents sent. We are checking them now.');
      setFiles([]);
      onDone();
    } catch (err) {
      const info = errorInfo(err);
      const byFile = {};
      info.details.forEach((d) => {
        const m = /^documents\[(\d+)\]$/.exec(d.field);
        if (m) byFile[m[1]] = d.message;
      });
      setErrors(byFile);
      setBanner(info.message);
    } finally {
      setProgress(null);
    }
  }

  return (
    <form className="panel pop" onSubmit={submit} noValidate>
      <div className="panel-head">
        <h2>Upload corrected documents</h2>
        <span className="countdown"><span className="mono">{left.text}</span></span>
      </div>
      <p className="section-note">Add only the documents you are replacing. A new PAN replaces the old PAN; a new address proof replaces any earlier address proof. Deadline: {fmtDateTime(app.resubmission_deadline)}.</p>
      {banner && <div className="alert alert-error" role="alert" style={{ marginBottom: 14 }}>{banner}</div>}
      <DocUploader files={files} setFiles={setFiles} errors={errors} setErrors={setErrors} busy={progress !== null} hint="Same rules as before: .txt, max 1 MB. Files you already sent are rejected as duplicates." />
      {progress !== null && (
        <div className="progress-wrap"><div className="progress"><div className="progress-bar" style={{ width: `${progress}%` }} /></div></div>
      )}
      <div className="actions">
        <button className="btn btn-primary" disabled={progress !== null || files.length === 0}>{progress !== null ? 'Sending' : 'Send documents'}</button>
      </div>
    </form>
  );
}

export default function ApplicationDetail() {
  const { id } = useParams();
  const location = useLocation();
  const [app, setApp] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    getApplication(id).then(setApp).catch((e) => setError(errorInfo(e).message));
  }, [id]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!app || !MOVING.includes(app.status)) return undefined;
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [app, load]);

  if (error) return <div className="stack"><ErrorBox error={error} /><Back to="/applications">My applications</Back></div>;
  if (!app) return <Loading />;

  const d = app.declared;
  const settled = GOOD.includes(app.status) || BAD.includes(app.status) || app.status === 'CLOSED_EXPIRED';

  return (
    <div className="stack">
      <div>
        <Back to="/applications">My applications</Back>
        <section className="panel pop">
          <div className="hero">
            <div>
              <span className="hero-id">{app.id}{location.state?.justSubmitted ? ', just submitted' : ''}</span>
              <h1>{HEADLINE[app.status] || app.status_label}</h1>
              <p className="lead">{app.account_id ? 'Your application is approved and your savings account is open.' : app.status_message}</p>
              {app.reasons.length > 0 && (
                <ul className="reason-list">{app.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              )}
              {app.account_id && (
                <div className="account-block">
                  <span className="small">Your savings account number</span>
                  <strong>{app.account_id}</strong>
                </div>
              )}
            </div>
            <StatusStamp status={app.status} big thunk={settled} />
          </div>
        </section>
      </div>

      {app.can_resubmit && <ResubmitPanel app={app} onDone={load} />}

      <div className="two-col">
        <div className="stack">
          <section className="panel">
            <h2>What you submitted</h2>
            <dl className="kv">
              <div><dt>Full name</dt><dd>{d.full_name}</dd></div>
              <div><dt>Date of birth</dt><dd>{fmtDate(d.dob)}</dd></div>
              <div><dt>PAN</dt><dd className="mono">{d.pan_number}</dd></div>
              <div><dt>Aadhaar</dt><dd className="mono">XXXX XXXX {d.aadhaar_last4}</dd></div>
              <div><dt>Gender</dt><dd>{d.gender}</dd></div>
              <div><dt>Email</dt><dd>{d.email}</dd></div>
              <div><dt>Mobile</dt><dd className="mono">{d.mobile}</dd></div>
              <div><dt>Occupation</dt><dd>{d.occupation_code}</dd></div>
              <div><dt>Annual income</dt><dd>{inr(d.annual_income)}</dd></div>
              <div><dt>City, state</dt><dd>{d.city}, {d.state}</dd></div>
              <div><dt>Pincode</dt><dd className="mono">{d.pincode}</dd></div>
              <div className="wide"><dt>Address</dt><dd>{d.address}</dd></div>
            </dl>
          </section>
          <section className="panel">
            <h2>Documents</h2>
            <ul className="doc-list">
              {app.documents.map((doc) => <DocRow key={doc.doc_id + doc.version} appId={app.id} doc={doc} />)}
              {(app.replaced_documents || []).map((doc) => <DocRow key={doc.doc_id + 'r' + doc.version} appId={app.id} doc={{ ...doc, superseded: true }} />)}
            </ul>
          </section>
        </div>
        <section className="panel">
          <h2>Progress</h2>
          <Timeline items={app.timeline || []} status={app.status} />
        </section>
      </div>
    </div>
  );
}
