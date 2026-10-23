import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import StatusStamp from '../../components/Stamp.jsx';
import { Back, ErrorBox, Loading } from '../../components/ui.jsx';
import { fmtDate, inr } from '../../lib/format.js';
import { errorInfo, getApplication } from '../../services/api.js';
import AuditPanel from './AuditPanel.jsx';
import DecisionPanel from './DecisionPanel.jsx';
import DocumentPanel from './DocumentPanel.jsx';
import VerdictPanel from './VerdictPanel.jsx';

/** One workbench for both staff roles. mode="maker": correct fields and recommend. mode="checker": final decision. */
export default function CaseView({ mode }) {
  const { id } = useParams();
  const [app, setApp] = useState(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const back = mode === 'maker' ? '/review' : '/compliance';

  const load = useCallback(() => {
    getApplication(id).then((a) => { setApp(a); setError(''); setTick((t) => t + 1); }).catch((e) => setError(errorInfo(e).message));
  }, [id]);
  useEffect(load, [load]);

  const changed = (updated) => { setApp(updated); setTick((t) => t + 1); };

  if (error && !app) return <div className="stack"><ErrorBox error={error} onRetry={load} /><Back to={back}>Back to the queue</Back></div>;
  if (!app) return <Loading />;

  const canEdit = mode === 'maker' && app.status === 'IN_REVIEW';
  return (
    <div className="stack">
      <div>
        <Back to={back}>{mode === 'maker' ? 'Review queue' : 'Sign-off queue'}</Back>
        <div className="case-head">
          <div>
            <h1>{app.full_name}</h1>
            <div className="case-meta">
              <span className="mono">{app.id}</span>
              <span className="mono muted">PAN {app.pan_number}</span>
              {app.resubmission_count > 0 && <span className="chip violet">Resubmitted {app.resubmission_count}x</span>}
            </div>
          </div>
          <StatusStamp status={app.status} big />
        </div>
      </div>

      {error && <ErrorBox error={error} />}

      <div className="case-grid">
        <div className="case-col">
          <section className="panel">
            <h2>Entered by the customer</h2>
            <dl className="kv">
              <div><dt>Date of birth</dt><dd>{fmtDate(app.dob)}</dd></div>
              <div><dt>Gender</dt><dd>{app.gender}</dd></div>
              <div><dt>Email</dt><dd>{app.email}</dd></div>
              <div><dt>City, state</dt><dd>{app.city}, {app.state}</dd></div>
              <div><dt>Aadhaar</dt><dd className="mono">XXXX XXXX {app.aadhaar_last4}</dd></div>
              <div><dt>Occupation</dt><dd>{app.occupation_code}</dd></div>
              <div><dt>Annual income</dt><dd>{inr(app.annual_income)}</dd></div>
              <div><dt>Pincode</dt><dd className="mono">{app.pincode}</dd></div>
              <div><dt>Application date</dt><dd>{fmtDate(app.application_date)}</dd></div>
              <div className="wide"><dt>Address</dt><dd>{app.address}</dd></div>
            </dl>
          </section>
          <DecisionPanel app={app} mode={mode} onChanged={changed} onStale={load} />
        </div>

        <div className="case-col">
          <section className="panel">
            <div className="panel-head"><h2>Rule verdict</h2></div>
            <VerdictPanel app={app} />
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Documents</h2>{canEdit && <span className="small muted">Fix a value and the rules re-run at once.</span>}</div>
            <DocumentPanel key={app.id} app={app} canEdit={canEdit} onChanged={changed} onStale={load} />
          </section>
        </div>
      </div>

      <AuditPanel appId={app.id} canExport={mode === 'checker'} refreshKey={tick} />
    </div>
  );
}
