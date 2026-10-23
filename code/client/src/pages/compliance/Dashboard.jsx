import { useCallback, useEffect, useState } from 'react';
import { Empty, ErrorBox, Loading, PageHead } from '../../components/ui.jsx';
import { reasonLabel, pct } from '../../lib/format.js';
import { errorInfo, getDashboard } from '../../services/api.js';

const COLORS = { mint: 'var(--mint)', orange: 'var(--orange)', coral: 'var(--coral)', violet: 'var(--violet)', grey: 'var(--ink-3)', yellow: 'var(--yellow)' };

function Bars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.name} className="bar-row">
          <span className="name" title={r.name}>{r.name}</span>
          <div className="bar-track"><div className={`bar-fill ${r.tone || ''}`} style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <span className="val">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function Split({ parts }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <p className="muted">No data in this range.</p>;
  return (
    <div>
      <div className="stackbar" role="img" aria-label={parts.map((p) => `${p.name} ${p.value}`).join(', ')}>
        {parts.filter((p) => p.value > 0).map((p) => <i key={p.name} style={{ width: `${(p.value / total) * 100}%`, background: COLORS[p.tone] }} title={`${p.name}: ${p.value}`} />)}
      </div>
      <div className="legend">
        {parts.map((p) => <span key={p.name}><i style={{ background: COLORS[p.tone] }} />{p.name} <strong className="mono">{p.value}</strong></span>)}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [range, setRange] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    getDashboard({ from: range.from || undefined, to: range.to || undefined }).then(setData).catch((e) => setError(errorInfo(e).message));
  }, [range]);
  useEffect(load, [load]);

  const d = data;
  const fo = d?.final_outcomes;
  const maxDay = d ? Math.max(1, ...d.daily.map((x) => x.submitted)) : 1;

  return (
    <div className="stack">
      <PageHead title="Dashboard">Live numbers computed from stored applications. Dates are the IST day of submission.</PageHead>

      <div className="filters">
        <label className="field"><span>From</span><input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></label>
        <label className="field"><span>To</span><input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></label>
        {(range.from || range.to) && <button className="btn btn-sm" onClick={() => setRange({ from: '', to: '' })}>Clear dates</button>}
      </div>

      <ErrorBox error={error} onRetry={load} />
      {!d && !error && <Loading />}
      {d && d.total === 0 && <div className="panel"><Empty title="No applications in this range">Submit an application as the demo customer, or widen the dates.</Empty></div>}

      {d && d.total > 0 && (
        <>
          <div className="tiles">
            <div className="tile violet"><span className="lbl">Applications</span><span className="big">{d.total}</span></div>
            <div className="tile mint"><span className="lbl">Straight-through rate</span><span className="big">{pct(d.straight_through_rate)}</span></div>
            <div className="tile"><span className="lbl">Review rate</span><span className="big">{pct(d.review_rate)}</span></div>
            <div className="tile"><span className="lbl">Reject rate</span><span className="big">{pct(d.reject_rate)}</span></div>
            <div className="tile orange"><span className="lbl">In review</span><span className="big">{d.in_review}</span></div>
            <div className="tile yellow"><span className="lbl">Waiting for sign-off</span><span className="big">{d.pending_checker}</span>{d.pending_checker_overdue > 0 && <span className="small muted">{d.pending_checker_overdue} overdue</span>}</div>
            <div className="tile"><span className="lbl">Average review time</span><span className="big">{d.review_time.avg_hours === null ? '-' : d.review_time.avg_hours < 1 ? `${Math.max(1, Math.round(d.review_time.avg_hours * 60))} min` : `${d.review_time.avg_hours.toFixed(1)} h`}</span><span className="small muted">{d.review_time.completed_reviews} finished, {d.review_time.open_reviews} open</span></div>
          </div>

          <div className="two-col" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
            <section className="panel">
              <h2>Where applications ended up</h2>
              <Split parts={[
                { name: 'Approved', value: fo.approved, tone: 'mint' },
                { name: 'Rejected', value: fo.rejected, tone: 'coral' },
                { name: 'In progress', value: fo.in_progress, tone: 'orange' },
                { name: 'Expired', value: fo.closed_expired, tone: 'grey' },
              ]} />
            </section>
            <section className="panel">
              <h2>What the rules decided</h2>
              <Split parts={[
                { name: 'Approve', value: d.rule_decisions.APPROVE, tone: 'mint' },
                { name: 'Review', value: d.rule_decisions.REVIEW, tone: 'orange' },
                { name: 'Reject', value: d.rule_decisions.REJECT, tone: 'coral' },
              ]} />
              <h3 style={{ margin: '22px 0 10px' }}>Risk of approved-or-review cases</h3>
              <Split parts={[
                { name: 'Low', value: d.risk.LOW, tone: 'mint' },
                { name: 'Medium', value: d.risk.MEDIUM, tone: 'yellow' },
                { name: 'High', value: d.risk.HIGH, tone: 'coral' },
              ]} />
            </section>
          </div>

          <div className="two-col" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
            <section className="panel">
              <h2>Top reasons</h2>
              {d.top_reasons.length === 0 ? <p className="muted">No reason codes yet.</p> : <Bars rows={d.top_reasons.map((r) => ({ name: reasonLabel(r.code), value: r.n, tone: 'orange' }))} />}
            </section>
            <section className="panel">
              <h2>Submissions per day</h2>
              <div className="cols" role="img" aria-label="Submissions per day">
                {d.daily.map((x) => (
                  <div key={x.day} className="col" title={`${x.day}: ${x.submitted} submitted, ${x.approved} approved, ${x.rejected} rejected`}>
                    <div className="stackcol" style={{ height: `${Math.max(8, (x.submitted / maxDay) * 120)}px` }}>
                      <i style={{ height: `${(x.approved / x.submitted) * 100}%`, background: 'var(--mint)' }} />
                      <i style={{ height: `${(x.rejected / x.submitted) * 100}%`, background: 'var(--coral)' }} />
                      <i style={{ height: `${((x.submitted - x.approved - x.rejected) / x.submitted) * 100}%`, background: 'var(--violet)' }} />
                    </div>
                    <small>{x.day.slice(5)}</small>
                  </div>
                ))}
              </div>
              <div className="legend"><span><i style={{ background: 'var(--mint)' }} />Approved</span><span><i style={{ background: 'var(--coral)' }} />Rejected</span><span><i style={{ background: 'var(--violet)' }} />Other</span></div>
            </section>
          </div>

          <details className="panel flat">
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>How these numbers are calculated</summary>
            <dl className="kv" style={{ marginTop: 14 }}>
              {Object.entries(d.definitions).map(([k, v]) => <div key={k} className="wide"><dt className="mono">{k}</dt><dd style={{ fontWeight: 500 }}>{v}</dd></div>)}
            </dl>
          </details>
        </>
      )}
    </div>
  );
}
