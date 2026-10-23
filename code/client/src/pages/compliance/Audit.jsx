import { useCallback, useEffect, useState } from 'react';
import { Empty, ErrorBox, Loading, PageHead } from '../../components/ui.jsx';
import { EVENT_LABEL } from '../../lib/format.js';
import { errorInfo, searchAudit } from '../../services/api.js';
import { AuditList } from '../staff/AuditPanel.jsx';

const EMPTY = { application_id: '', event_type: '', actor_role: '', from: '', to: '' };

export default function Audit() {
  const [f, setF] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setData(null);
    setError('');
    const params = Object.fromEntries(Object.entries(applied).filter(([, v]) => v));
    searchAudit({ ...params, limit: 200 }).then(setData).catch((e) => setError(errorInfo(e).message));
  }, [applied]);
  useEffect(load, [load]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <div className="stack">
      <PageHead title="Audit trail">Every sign-in, document view, correction, decision and setting change. Entries can never be edited or deleted. PANs are masked here.</PageHead>

      <form className="filters panel" onSubmit={(e) => { e.preventDefault(); setApplied({ ...f, application_id: f.application_id.trim().toUpperCase() }); }}>
        <label className="field"><span>Application</span><input value={f.application_id} onChange={set('application_id')} placeholder="A3000001" className="mono" /></label>
        <label className="field"><span>Event</span>
          <select value={f.event_type} onChange={set('event_type')}>
            <option value="">Any event</option>
            {Object.entries(EVENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field"><span>Who</span>
          <select value={f.actor_role} onChange={set('actor_role')}>
            <option value="">Anyone</option>
            <option value="APPLICANT">Applicant</option>
            <option value="KYC_OFFICER">KYC officer</option>
            <option value="COMPLIANCE_OFFICER">Compliance officer</option>
            <option value="SYSTEM">System</option>
          </select>
        </label>
        <label className="field"><span>From</span><input type="date" value={f.from} onChange={set('from')} /></label>
        <label className="field"><span>To</span><input type="date" value={f.to} onChange={set('to')} /></label>
        <button className="btn btn-primary">Search</button>
        <button type="button" className="btn btn-quiet" onClick={() => { setF(EMPTY); setApplied(EMPTY); }}>Reset</button>
      </form>

      <ErrorBox error={error} onRetry={load} />
      {!data && !error && <Loading />}
      {data && data.events.length === 0 && <div className="panel"><Empty icon="search" title="No matching events">Try removing a filter.</Empty></div>}
      {data && data.events.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>{data.count}{data.count === data.limit ? '+' : ''} events</h2><span className="small muted">Newest first</span></div>
          <AuditList events={data.events} showApp />
        </section>
      )}
    </div>
  );
}
