import { Link, useNavigate } from 'react-router-dom';
import { reasonLabel, waiting } from '../lib/format.js';
import { RiskChip } from './Stamp.jsx';

/** Shared by the officer queue and the compliance sign-off queue. HIGH risk rows are already sorted first by the API. */
export default function QueueTable({ rows, base, withMaker }) {
  const navigate = useNavigate();
  return (
    <div className="panel tight table-wrap">
      <table className="ledger">
        <thead>
          <tr>
            <th>Application</th>
            <th>Applicant</th>
            <th>Why it is here</th>
            <th>Risk</th>
            {withMaker && <th>Officer said</th>}
            <th className="num">Waiting</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="link" onClick={() => navigate(`${base}/${r.id}`)}>
              <td><Link className="row-link mono" to={`${base}/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.id}</Link></td>
              <td>
                <strong>{r.full_name}</strong>
                <div className="mono small muted">{r.pan_masked}</div>
              </td>
              <td>
                <div className="chips">
                  {r.reason_codes.length === 0 && <span className="muted">No rule triggered</span>}
                  {r.reason_codes.slice(0, 3).map((c) => <span key={c} className="chip orange">{reasonLabel(c)}</span>)}
                  {r.reason_codes.length > 3 && <span className="chip">+{r.reason_codes.length - 3}</span>}
                </div>
              </td>
              <td><RiskChip risk={r.risk_category} /></td>
              {withMaker && (
                <td>
                  <span className={`chip ${r.maker_recommendation === 'APPROVE' ? 'mint' : r.maker_recommendation === 'REJECT' ? 'coral' : 'violet'}`}>
                    {r.maker_recommendation ? r.maker_recommendation.replace(/_/g, ' ').toLowerCase() : 'auto: high risk'}
                  </span>
                  {r.maker_name && <div className="small muted">{r.maker_name}</div>}
                </td>
              )}
              <td className="num">{waiting(r.hours_waiting ?? r.waiting_hours)}{r.sla_overdue && <div><span className="chip coral">Overdue</span></div>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
