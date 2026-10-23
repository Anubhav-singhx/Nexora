import { useCallback, useEffect, useState } from 'react';
import QueueTable from '../../components/QueueTable.jsx';
import { Empty, ErrorBox, Loading, PageHead } from '../../components/ui.jsx';
import { errorInfo, reviewQueue } from '../../services/api.js';

const TABS = [
  ['IN_REVIEW', 'Needs review'],
  ['RESUBMISSION_REQUESTED', 'Waiting for customer'],
];

export default function ReviewQueue() {
  const [status, setStatus] = useState('IN_REVIEW');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setData(null);
    reviewQueue(status).then(setData).catch((e) => setError(errorInfo(e).message));
  }, [status]);
  useEffect(load, [load]);

  return (
    <div className="stack">
      <PageHead title="Review queue">Cases the rules could not decide on their own. High-risk cases come first, then the oldest.</PageHead>
      <div className="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={status === key} className="tab" onClick={() => setStatus(key)}>
            {label}
            {status === key && data && <span className="count">{data.count}</span>}
          </button>
        ))}
      </div>
      <ErrorBox error={error} onRetry={load} />
      {!data && !error && <Loading />}
      {data && data.count === 0 && (
        <div className="panel">
          <Empty title={status === 'IN_REVIEW' ? 'Queue is clear' : 'Nobody is being waited on'}>
            {status === 'IN_REVIEW' ? 'New cases show up here as soon as the rules send them for review.' : 'Cases where you asked for new documents wait here until the customer replies or the 7 days run out.'}
          </Empty>
        </div>
      )}
      {data && data.count > 0 && <QueueTable rows={data.applications} base="/review" />}
    </div>
  );
}
