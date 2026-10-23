import { DecisionChip, RiskChip } from '../../components/Stamp.jsx';
import { fmtDate, reasonLabel, score } from '../../lib/format.js';

function Watchlist({ title, data }) {
  if (!data) return null;
  const tone = data.status === 'MATCH' ? 'coral' : data.status === 'POSSIBLE' ? 'orange' : 'mint';
  return (
    <div>
      <div className="row-between"><h3>{title}</h3><span className={`chip ${tone}`}>{data.status === 'CLEAR' ? 'Clear' : data.status === 'MATCH' ? 'Match' : 'Possible match'}</span></div>
      {data.hits?.length > 0 && (
        <ul className="rule-list" style={{ marginTop: 10 }}>
          {data.hits.map((h) => (
            <li key={h.entry_id} className={`rule ${h.status === 'MATCH' ? 'reject' : 'review'}`} style={{ gridTemplateColumns: '1fr' }}>
              <div>
                <strong>{h.name}</strong> <span className="mono small muted">{h.entry_id}</span>
                <p className="small">
                  Similarity <span className="mono">{score(h.score)}</span> via {h.matched_on}.{' '}
                  {h.dob_status === 'EQUAL' && 'Date of birth is the same.'}
                  {h.dob_status === 'DIFFERENT' && <>Date of birth differs (list has {fmtDate(h.list_dob)}).</>}
                  {h.dob_status === 'MISSING' && 'The list entry has no date of birth.'}
                  {h.position ? ` ${h.position}.` : ''}{h.program ? ` Programme: ${h.program}.` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function VerdictPanel({ app }) {
  const ev = app.evaluation;
  if (!ev) return <p className="muted">The rules have not run for this application yet.</p>;
  const triggered = ev.rules.filter((r) => r.status === 'TRIGGERED');
  const rest = ev.rules.filter((r) => r.status !== 'TRIGGERED');
  return (
    <div className="stack-s" style={{ gap: 20 }}>
      <div className="row-between">
        <div className="chips">
          <DecisionChip decision={ev.decision} />
          <RiskChip risk={ev.risk_category} />
          {ev.rekyc_due_date && <span className="chip">Re-KYC {fmtDate(ev.rekyc_due_date)}</span>}
        </div>
        <span className="small muted">Engine {ev.engine_version}</span>
      </div>

      {ev.risk_basis?.length > 0 && <p className="small"><strong>Risk because:</strong> {ev.risk_basis.join('; ')}.</p>}

      {ev.name_scores?.length > 0 && (
        <div>
          <h3 style={{ marginBottom: 8 }}>Name match</h3>
          <div className="compare">
            <div>
              <div className="small muted">Lowest score</div>
              <div className="score-big">{score(ev.name_match_score)}</div>
              <div className="small muted">Entered: {app.full_name}</div>
            </div>
            <div className="stack-s" style={{ gap: 6 }}>
              {ev.name_scores.map((n) => (
                <div key={n.doc_id} className="small">
                  <strong>{n.source}</strong> reads <span className="mono">{n.name}</span> <span className="muted">({score(n.score)})</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div>
        <h3 style={{ marginBottom: 10 }}>{triggered.length ? `${triggered.length} rule${triggered.length > 1 ? 's' : ''} triggered` : 'No rule triggered'}</h3>
        {triggered.length > 0 && (
          <ul className="rule-list">
            {triggered.map((r) => (
              <li key={r.rule} className={`rule ${r.outcome === 'REJECT' ? 'reject' : 'review'}`}>
                <span className="rid">{r.rule}</span>
                <div>
                  <strong>{reasonLabel(r.code)}</strong>
                  <p>{r.detail}</p>
                  <span className="code">{r.code} / {r.outcome.toLowerCase()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <details className="rule-passed">
          <summary>{rest.length} rules passed or not applicable</summary>
          <ul>
            {rest.map((r) => (
              <li key={r.rule}><span className="mono">{r.rule}</span><span>{r.title}{r.status === 'NOT_EVALUATED' && r.detail ? ` (skipped: ${r.detail})` : ''}</span></li>
            ))}
          </ul>
        </details>
      </div>

      <Watchlist title="Sanctions screening" data={ev.watchlist?.sanctions} />
      <Watchlist title="PEP screening" data={ev.watchlist?.pep} />
    </div>
  );
}
