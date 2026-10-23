import { useCallback, useEffect, useState } from 'react';
import QueueTable from '../../components/QueueTable.jsx';
import { Empty, ErrorBox, Loading, PageHead } from '../../components/ui.jsx';
import { errorInfo, pendingQueue } from '../../services/api.js';

export default function PendingApprovals() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    pendingQueue().then(setData).catch((e) => setError(errorInfo(e).message));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="stack">
      <PageHead title="Final sign-off">Every approval that involved a person or a high-risk profile needs your decision before the account opens.</PageHead>
      <ErrorBox error={error} onRetry={load} />
      {!data && !error && <Loading />}
      {data && data.count === 0 && (
        <div className="panel"><Empty title="Nothing waiting for you">Cases appear here after a KYC officer recommends them, or when the rules approve a high-risk profile.</Empty></div>
      )}
      {data && data.overdue_count > 0 && <div className="alert alert-error" role="status">{data.overdue_count} {data.overdue_count === 1 ? 'case has' : 'cases have'} waited longer than the {data.sla_hours} hour target.</div>}
      {data && data.count > 0 && <QueueTable rows={data.applications} base="/compliance/cases" withMaker />}
    </div>
  );
}
