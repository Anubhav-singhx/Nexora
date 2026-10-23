import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import StatusStamp from '../../components/Stamp.jsx';
import { Empty, ErrorBox, Loading, PageHead } from '../../components/ui.jsx';
import { fmtDate } from '../../lib/format.js';
import { errorInfo, listMyApplications } from '../../services/api.js';

export default function MyApplications() {
  const [apps, setApps] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    listMyApplications().then(setApps).catch((e) => setError(errorInfo(e).message));
  }, []);

  return (
    <div className="stack">
      <PageHead
        title="My applications"
        actions={<Link to="/applications/new" className="btn btn-primary"><Icon name="plus" /> New application</Link>}
      >
        Track every savings account application and see what happens next.
      </PageHead>

      <ErrorBox error={error} />
      {!apps && !error && <Loading />}

      {apps && apps.length === 0 && (
        <div className="panel">
          <Empty icon="file" title="No applications yet" action={<Link to="/applications/new" className="btn btn-primary">Start your first one</Link>}>
            You need your PAN, your Aadhaar last 4 digits and one address proof. It takes about five minutes.
          </Empty>
        </div>
      )}

      {apps && apps.length > 0 && (
        <div className="panel tight table-wrap">
          <table className="ledger">
            <thead>
              <tr><th>Application</th><th>Name</th><th>Submitted</th><th>Status</th></tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id} className="link" onClick={() => navigate(`/applications/${a.id}`)}>
                  <td><Link className="row-link mono" to={`/applications/${a.id}`} onClick={(e) => e.stopPropagation()}>{a.id}</Link></td>
                  <td>{a.declared.full_name}</td>
                  <td>{fmtDate(a.submitted_at)}</td>
                  <td><StatusStamp status={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
