import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/Toast.jsx';
import { Empty, ErrorBox, Loading, PageHead } from '../../components/ui.jsx';
import { DOC_TYPE_LABEL, fmtDate, reasonLabel } from '../../lib/format.js';
import { createWatchEntry, deleteWatchEntry, errorInfo, getConfig, listWatchlist, patchConfig, rescreen } from '../../services/api.js';

// Plain-language names and explanations for the engine's thresholds. Order = reading order.
const META = [
  ['min_field_confidence', 'Minimum field confidence', 'A field or document type read below this is not usable and the case goes to review (R3).', 'number'],
  ['name_match_threshold', 'Name similarity to pass', 'Names at least this alike pass. Between the reject level and this, the case goes to review (R11).', 'number'],
  ['name_reject_threshold', 'Reject below name similarity', 'Names less alike than this are rejected (R9).', 'number'],
  ['watchlist_match_threshold', 'Watchlist match similarity', 'At or above this a name is a sanctions or PEP match (or a possible match when the birth dates differ).', 'number'],
  ['watchlist_possible_threshold', 'Watchlist possible-match similarity', 'From here up to the match level a name is only a possible sanctions match.', 'number'],
  ['min_age', 'Minimum age', 'Applicants younger than this are rejected (R4).', 'int'],
  ['pan_holder_char', 'PAN holder letter', 'The 4th PAN character that marks an individual (R5).', 'text'],
  ['address_proof_max_age_days', 'Address proof age limit (days)', 'Electricity bills and bank statements older than this are stale (R13). Exactly this many days is fine.', 'int'],
  ['medium_income_threshold', 'Medium-risk income (₹)', 'Annual income at or above this makes a customer medium risk.', 'int'],
  ['unknown_occupation_risk', 'Risk for unknown occupations', 'Used when the occupation code is not in the occupation list.', ['LOW', 'MEDIUM', 'HIGH']],
  ['resubmission_window_days', 'Resubmission window (days)', 'How long a customer has to upload corrected documents.', 'int'],
  ['checker_sla_hours', 'Checker SLA (hours)', 'Cases waiting for final approval longer than this are flagged overdue.', 'int'],
  ['rekyc_years', 'Years until the next KYC', 'By risk category.', 'rekyc'],
  ['required_fields', 'Fields required per document', 'Comma separated field names. A missing or low-confidence required field sends the case to review (R3).', 'fields'],
  ['name_title_tokens', 'Titles ignored in names', 'Comma separated, e.g. MR, DR. Removed before comparing names.', 'list'],
];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const toDraft = (kind, v) => (kind === 'list' ? v.join(', ') : kind === 'fields' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.join(', ')])) : v);
const csv = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
function fromDraft(kind, d) {
  if (kind === 'list') return csv(d).map((x) => x.toUpperCase());
  if (kind === 'fields') return Object.fromEntries(Object.entries(d).map(([k, x]) => [k, csv(x)]));
  if (kind === 'text') return String(d).trim().toUpperCase();
  if (kind === 'number') return Number(d);
  if (kind === 'int') return Number(d);
  return d;
}

function RulesTab() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getConfig().then((cfg) => {
      setRows(cfg);
      setDraft(Object.fromEntries(META.map(([key, , , kind]) => [key, toDraft(typeof kind === 'string' ? kind : 'enum', cfg.find((c) => c.key === key).value)])));
    }).catch((e) => setError(errorInfo(e).message));
  }, []);
  useEffect(load, [load]);

  const changes = useMemo(() => {
    if (!rows) return {};
    const out = {};
    for (const [key, , , kind] of META) {
      const k = typeof kind === 'string' ? kind : 'enum';
      const current = rows.find((c) => c.key === key).value;
      const next = fromDraft(k, draft[key]);
      if (!same(next, current)) out[key] = next;
    }
    return out;
  }, [rows, draft]);

  async function save() {
    setBusy(true);
    setError('');
    try {
      await patchConfig(changes);
      toast('Saved. The next evaluation uses the new values.');
      load();
    } catch (e) {
      const info = errorInfo(e);
      setError(info.details.length ? info.details.map((d) => `${d.field}: ${d.message}`).join(' ') : info.message);
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return error ? <ErrorBox error={error} onRetry={load} /> : <Loading />;
  const set = (key, v) => setDraft((d) => ({ ...d, [key]: v }));

  return (
    <div className="stack">
      <ErrorBox error={error} />
      <section className="panel">
        <div className="panel-head"><h2>Thresholds</h2><span className="small muted">Changes apply to new evaluations. Existing decisions are not rewritten.</span></div>
        {META.map(([key, label, explain, kind]) => {
          const row = rows.find((c) => c.key === key);
          const changed = key in changes;
          return (
            <div key={key} className={`setting${changed ? ' changed' : ''}`}>
              <div>
                <b>{label}</b>
                <div className="explain">{explain}</div>
                <span className="mono">{key}{row.version ? `, v${row.version}, ${row.updated_by || 'system'} ${fmtDate(row.updated_at)}` : ', default'}</span>
              </div>
              <div>
                {(kind === 'number' || kind === 'int') && <input type="number" step={kind === 'number' ? '0.01' : '1'} value={draft[key]} onChange={(e) => set(key, e.target.value)} aria-label={label} />}
                {Array.isArray(kind) && <select value={draft[key]} onChange={(e) => set(key, e.target.value)} aria-label={label}>{kind.map((o) => <option key={o}>{o}</option>)}</select>}
                {kind === 'rekyc' && (
                  <div className="mini-grid">
                    {['HIGH', 'MEDIUM', 'LOW'].map((r) => (
                      <label key={r}>{r[0] + r.slice(1).toLowerCase()}<input type="number" value={draft[key][r]} onChange={(e) => set(key, { ...draft[key], [r]: Number(e.target.value) })} /></label>
                    ))}
                  </div>
                )}
                {(kind === 'list' || kind === 'text') && <input value={draft[key]} onChange={(e) => set(key, e.target.value)} aria-label={label} />}
                {kind === 'fields' && (
                  <div className="stack-s" style={{ gap: 6 }}>
                    {Object.keys(draft[key]).map((t) => (
                      <label key={t} className="small" style={{ display: 'grid', gap: 2 }}>
                        <b>{DOC_TYPE_LABEL[t]}</b>
                        <input className="mono" value={draft[key][t]} onChange={(e) => set(key, { ...draft[key], [t]: e.target.value })} />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div className="actions">
          <button className="btn btn-primary" onClick={save} disabled={busy || !Object.keys(changes).length}>{busy ? 'Saving' : `Save ${Object.keys(changes).length || ''} change${Object.keys(changes).length === 1 ? '' : 's'}`}</button>
          {Object.keys(changes).length > 0 && <button className="btn btn-quiet" onClick={load}>Discard</button>}
        </div>
      </section>
    </div>
  );
}

function WatchlistsTab() {
  const toast = useToast();
  const [list, setList] = useState('sanctions');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', aliases: '', dob: '', extra1: '', extra2: '' });
  const [adding, setAdding] = useState(false);
  const [stale, setStale] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setData(null);
    listWatchlist(list, q).then(setData).catch((e) => setError(errorInfo(e).message));
  }, [list, q]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const sanctions = list === 'sanctions';

  async function add(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = { list, name: form.name, aliases: csv(form.aliases), dob: form.dob || null };
      if (sanctions) Object.assign(body, { nationality: form.extra1 || null, program: form.extra2 || null });
      else Object.assign(body, { position: form.extra1 || null, category: form.extra2 || null });
      await createWatchEntry(body);
      toast('Entry added.');
      setForm({ name: '', aliases: '', dob: '', extra1: '', extra2: '' });
      setAdding(false);
      setStale(true);
      load();
    } catch (err) {
      const info = errorInfo(err);
      setError(info.details.length ? info.details.map((d) => `${d.field}: ${d.message}`).join(' ') : info.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry) {
    if (!window.confirm(`Remove ${entry.name} from the ${list} list?`)) return;
    try {
      await deleteWatchEntry(list, entry.id);
      toast('Entry removed.');
      setStale(true);
      load();
    } catch (err) {
      setError(errorInfo(err).message);
    }
  }

  async function run() {
    setBusy(true);
    try {
      const r = await rescreen();
      setResult(r);
      setStale(false);
      toast(r.changed_count ? `${r.changed_count} case${r.changed_count > 1 ? 's' : ''} changed.` : 'Re-screen finished. Nothing changed.');
    } catch (err) {
      setError(errorInfo(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {stale && (
        <div className="alert alert-warn row-between">
          <span>The list changed. Open cases still carry their old screening result until you re-screen.</span>
          <button className="btn btn-sm btn-primary" onClick={run} disabled={busy}><Icon name="refresh" /> Re-screen open cases</button>
        </div>
      )}
      {result && (
        <section className="panel">
          <div className="panel-head"><h2>Re-screen result</h2><span className="small muted">{result.checked} open cases checked</span></div>
          {result.changed.length === 0 ? <p className="muted">No decision changed.</p> : (
            <ul className="rule-list">
              {result.changed.map((c) => (
                <li key={c.application_id} className="rule review" style={{ gridTemplateColumns: '1fr' }}>
                  <div>
                    <Link className="mono" to={`/compliance/cases/${c.application_id}`}><strong>{c.application_id}</strong></Link>{' '}
                    <span className="small">{c.before.decision} to {c.after.decision}, now {c.status.replace(/_/g, ' ').toLowerCase()}</span>
                    <div className="chips" style={{ marginTop: 6 }}>{c.after.reason_codes.map((r) => <span key={r} className="chip orange">{reasonLabel(r)}</span>)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="row-between">
        <div className="tabs" role="tablist">
          {[['sanctions', 'Sanctions'], ['pep', 'PEP']].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={list === k} className="tab" onClick={() => { setList(k); setAdding(false); }}>{l}</button>
          ))}
        </div>
        <div className="row">
          <input type="search" placeholder="Search name or alias" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} aria-label="Search the list" />
          <button className="btn btn-sm" onClick={run} disabled={busy}><Icon name="refresh" /> Re-screen</button>
          <button className="btn btn-sm btn-primary" onClick={() => setAdding((a) => !a)}><Icon name="plus" /> Add entry</button>
        </div>
      </div>

      <ErrorBox error={error} />

      {adding && (
        <form className="panel pop" onSubmit={add}>
          <h2>New {sanctions ? 'sanctions' : 'PEP'} entry</h2>
          <div className="grid-3">
            <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></label>
            <label className="field"><span>Aliases</span><input value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} placeholder="comma separated" /></label>
            <label className="field"><span>Date of birth</span><input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} /></label>
            <label className="field"><span>{sanctions ? 'Nationality' : 'Position'}</span><input value={form.extra1} onChange={(e) => setForm({ ...form, extra1: e.target.value })} /></label>
            <label className="field"><span>{sanctions ? 'Programme' : 'Category'}</span><input value={form.extra2} onChange={(e) => setForm({ ...form, extra2: e.target.value })} /></label>
          </div>
          <div className="btn-row"><button className="btn btn-primary" disabled={busy || form.name.trim().length < 2}>Add to list</button><button type="button" className="btn btn-quiet" onClick={() => setAdding(false)}>Cancel</button></div>
        </form>
      )}

      {!data && !error && <Loading />}
      {data && data.entries.length === 0 && <div className="panel"><Empty icon="search" title="No entries">Nothing matches your search.</Empty></div>}
      {data && data.entries.length > 0 && (
        <div className="panel tight table-wrap">
          <table className="ledger">
            <thead><tr><th>Id</th><th>Name</th><th>Aliases</th><th>Date of birth</th><th>{sanctions ? 'Programme' : 'Position'}</th><th /></tr></thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{e.list_id || e.pep_id}</td>
                  <td><strong>{e.name}</strong></td>
                  <td className="small">{(e.aliases || []).join(', ') || '-'}</td>
                  <td>{e.dob ? fmtDate(e.dob) : <span className="muted">not listed</span>}</td>
                  <td>{(sanctions ? e.program : e.position) || '-'}</td>
                  <td className="num"><button className="btn btn-quiet btn-sm" onClick={() => remove(e)} aria-label={`Remove ${e.name}`}><Icon name="x" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">Every change to a list or a threshold is recorded in the audit trail.</p>
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState('rules');
  return (
    <div className="stack">
      <PageHead title="Rules and lists">Tune the thresholds the engine uses and keep the sanctions and PEP lists current. Nothing needs a restart.</PageHead>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'rules'} className="tab" onClick={() => setTab('rules')}>Thresholds</button>
        <button role="tab" aria-selected={tab === 'lists'} className="tab" onClick={() => setTab('lists')}>Watchlists</button>
      </div>
      {tab === 'rules' ? <RulesTab /> : <WatchlistsTab />}
    </div>
  );
}
