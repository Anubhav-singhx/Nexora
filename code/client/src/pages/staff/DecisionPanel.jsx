import { useState } from 'react';
import { useToast } from '../../components/Toast.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { fmtDateTime } from '../../lib/format.js';
import { decide, errorInfo, openAccount, recommend } from '../../services/api.js';

const MAKER = [
  ['APPROVE', 'Recommend approval', 'The documents check out. Compliance gives the final sign-off.'],
  ['REJECT', 'Recommend rejection', 'Compliance gives the final sign-off.'],
  ['REQUEST_RESUBMISSION', 'Ask for new documents', 'The customer gets 7 days to upload corrected files.'],
];
const CHECKER = [
  ['APPROVE', 'Approve and open account', 'Creates the savings account in core banking.'],
  ['REJECT', 'Reject', 'Final. The customer is told it was not approved.'],
  ['SEND_BACK', 'Send back to KYC officer', 'Back to the review queue for another look.'],
];

function Choice({ options, value, onChange }) {
  return (
    <div className="radio-cards" role="radiogroup">
      {options.map(([v, label, help]) => (
        <label key={v} className="radio-card">
          <input type="radio" name="choice" checked={value === v} onChange={() => onChange(v)} />
          <div><strong>{label}</strong><span>{help}</span></div>
        </label>
      ))}
    </div>
  );
}

export default function DecisionPanel({ app, mode, onChanged, onStale }) {
  const { user } = useAuth();
  const toast = useToast();
  const [choice, setChoice] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const maker = mode === 'maker';
  const open = maker ? app.status === 'IN_REVIEW' : app.status === 'PENDING_CHECKER';
  const isOwnCase = !maker && app.maker_id && app.maker_id === user.id;
  const needsComment = maker ? true : choice !== 'APPROVE';

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const updated = maker
        ? await recommend(app.id, { recommendation: choice, comment, version: app.version })
        : await decide(app.id, { decision: choice, comment, version: app.version });
      toast(maker ? 'Recommendation sent.' : choice === 'APPROVE' ? 'Approved. Account opened.' : choice === 'REJECT' ? 'Rejected.' : 'Sent back to the officer.');
      setChoice('');
      setComment('');
      onChanged(updated);
    } catch (err) {
      const info = errorInfo(err);
      setError(info.details.length ? info.details.map((d) => d.message).join(' ') : info.message);
      if (info.code === 'VERSION_CONFLICT' || info.code === 'INVALID_TRANSITION' || info.code === 'INVALID_STATE') onStale();
      if (info.code === 'CORE_BANKING_UNAVAILABLE') setError(`${info.message} Nothing was changed. Confirm again to retry.`);
    } finally {
      setBusy(false);
    }
  }

  async function retryAccount() {
    setBusy(true);
    try {
      onChanged(await openAccount(app.id));
      toast('Account opened.');
    } catch (err) {
      setError(errorInfo(err).message);
    } finally {
      setBusy(false);
    }
  }

  const needsAccount = !maker && ['APPROVED', 'AUTO_APPROVED'].includes(app.status) && !app.core_account_id;

  if (needsAccount) {
    return (
      <section className="panel decision-panel">
        <h2>Account not opened yet</h2>
        <p className="section-note" style={{ color: 'var(--ink)' }}>The application is approved but core banking did not return an account. Retrying is safe: it never creates a second account.</p>
        {error && <div className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
        <button className="btn btn-primary" onClick={retryAccount} disabled={busy}>{busy ? 'Opening' : 'Retry account opening'}</button>
      </section>
    );
  }

  if (!open) {
    return (
      <section className="panel">
        <h2>Outcome</h2>
        <dl className="kv">
          <div><dt>Status</dt><dd>{app.status_label}</dd></div>
          {app.core_account_id && <div><dt>Account</dt><dd className="mono">{app.core_account_id}</dd></div>}
          {app.maker_recommendation && <div><dt>KYC officer</dt><dd>{app.maker_recommendation.replace(/_/g, ' ').toLowerCase()}, {fmtDateTime(app.maker_at)}</dd></div>}
          {app.maker_comment && <div className="wide"><dt>Officer comment</dt><dd>{app.maker_comment}</dd></div>}
          {app.checker_decision && <div><dt>Compliance</dt><dd>{app.checker_decision.replace(/_/g, ' ').toLowerCase()}, {fmtDateTime(app.checker_at)}</dd></div>}
          {app.checker_comment && <div className="wide"><dt>Compliance comment</dt><dd>{app.checker_comment}</dd></div>}
        </dl>
        <p className="small muted" style={{ marginTop: 14 }}>
          {maker ? 'You can recommend while a case is in review.' : 'Final decisions are made while a case is waiting for sign-off.'}
        </p>
      </section>
    );
  }

  return (
    <form className="panel decision-panel" onSubmit={submit}>
      <h2>{maker ? 'Your recommendation' : 'Your decision'}</h2>
      {!maker && (
        <div className="maker-note">
          <span className="small muted">{app.maker_id ? `KYC officer recommends ${app.maker_recommendation?.replace(/_/g, ' ').toLowerCase()}` : 'Approved by the rules, high risk, so it needs a person'}</span>
          {app.maker_comment && <p>{app.maker_comment}</p>}
        </div>
      )}
      {isOwnCase ? (
        <div className="alert alert-warn">You made the recommendation on this case, so a different compliance officer has to decide it.</div>
      ) : (
        <>
          <Choice options={maker ? MAKER : CHECKER} value={choice} onChange={setChoice} />
          <label className="field" style={{ marginTop: 14 }}>
            <span>Comment{needsComment ? '' : ' (optional)'}</span>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={maker ? 'What did you check, and why?' : 'Why this decision?'} />
            {needsComment && <small className="hint">At least 10 characters. It goes in the audit trail.</small>}
          </label>
          {error && <div className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="btn-row">
            <button className="btn btn-primary" disabled={busy || !choice || (needsComment && comment.trim().length < 10)}>
              {busy ? 'Saving' : maker ? 'Send recommendation' : 'Confirm decision'}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
