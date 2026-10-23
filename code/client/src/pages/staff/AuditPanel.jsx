import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { ErrorBox, Loading } from '../../components/ui.jsx';
import { eventLabel, fmtDateTime } from '../../lib/format.js';
import { applicationAudit, downloadAuditCsv, errorInfo } from '../../services/api.js';

export function AuditList({ events, showApp }) {
  return (
    <ul className="audit-list">
      {events.map((e) => (
        <li key={e.id} className="audit-item">
          <time>{fmtDateTime(e.at)}</time>
          <div>
            <strong>{eventLabel(e.event_type)}</strong>{' '}
            <span className="muted small">{e.actor.name ? `by ${e.actor.name} (${e.actor.role.toLowerCase().replace(/_/g, ' ')})` : e.actor.role && e.actor.role !== 'SYSTEM' ? `by ${e.actor.role.toLowerCase().replace(/_/g, ' ')}` : 'by the system'}</span>
            {showApp && e.application_id && <Link className="chip violet" style={{ marginLeft: 8, textDecoration: 'none' }} to={`/compliance/cases/${e.application_id}`}>{e.application_id}</Link>}
            {e.document_id && <span className="chip" style={{ marginLeft: 8 }}>{e.document_id}</span>}
            {(e.old_value || e.new_value || e.details) && (
              <details>
                <summary>Details</summary>
                <pre>{JSON.stringify({ old: e.old_value, new: e.new_value, details: e.details }, (k, v) => (v === null ? undefined : v), 2)}</pre>
              </details>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function AuditPanel({ appId, canExport, refreshKey }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    applicationAudit(appId).then(setEvents).catch((e) => setError(errorInfo(e).message));
  }, [appId, refreshKey]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Audit trail</h2>
        {canExport && <button className="btn btn-sm" onClick={() => downloadAuditCsv(appId)}><Icon name="download" /> Export CSV</button>}
      </div>
      <ErrorBox error={error} />
      {!events && !error && <Loading />}
      {events && <AuditList events={[...events].reverse()} />}
    </section>
  );
}
