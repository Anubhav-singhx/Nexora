import { Fragment, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { Conf } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { DOC_TYPES } from '../../components/DocUploader.jsx';
import { DOC_TYPE_LABEL, FIELD_LABEL } from '../../lib/format.js';
import { correctField, errorInfo, getDocumentContent } from '../../services/api.js';

const REQUIRED = {
  PAN_CARD: ['pan_number', 'name', 'dob'],
  AADHAAR_CARD: ['aadhaar_last4', 'name', 'dob'],
  ELECTRICITY_BILL: ['pincode', 'document_date'],
  BANK_STATEMENT: ['pincode', 'document_date'],
  DRIVING_LICENCE: ['pincode', 'valid_until'],
};
const MIN = 0.8;

function EditRow({ app, doc, field, current, onSaved, onCancel, colSpan }) {
  const toast = useToast();
  const [value, setValue] = useState(current ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isType = field === 'document_type';

  async function save(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const out = await correctField(app.id, doc.doc_id, field, { value, reason, version: app.version });
      const b = out.before, a = out.after;
      toast(b.decision !== a.decision ? `Saved. Decision changed: ${b.decision} to ${a.decision}.` : 'Saved. Rules re-run, decision unchanged.');
      onSaved(out.application);
    } catch (err) {
      const info = errorInfo(err);
      setError(info.details.length ? info.details.map((d) => d.message).join(' ') : info.message);
      if (info.code === 'VERSION_CONFLICT') onCancel(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="edit-row">
      <td colSpan={colSpan}>
        <form className="edit-box" onSubmit={save}>
          <div className="grid-2">
            <label className="field" style={{ margin: 0 }}>
              <span>Correct {FIELD_LABEL[field] || field}</span>
              {isType ? (
                <select value={value} onChange={(e) => setValue(e.target.value)}>
                  {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  <option value="OTHER">Unrecognised</option>
                </select>
              ) : (
                <input value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
              )}
            </label>
            <label className="field" style={{ margin: 0 }}>
              <span>Reason (audited)</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. read from the original scan" />
            </label>
          </div>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <div className="btn-row">
            <button className="btn btn-primary btn-sm" disabled={busy || !value || reason.trim().length < 5}>{busy ? 'Saving' : 'Save and re-run rules'}</button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => onCancel(false)}>Cancel</button>
          </div>
        </form>
      </td>
    </tr>
  );
}

export default function DocumentPanel({ app, canEdit, onChanged, onStale }) {
  const docs = app.documents;
  const active = docs.filter((d) => !d.superseded);
  const [sel, setSel] = useState(active[0]?.doc_id || docs[0]?.doc_id);
  const [editing, setEditing] = useState(null); // field name
  const [text, setText] = useState({});

  const doc = docs.find((d) => d.doc_id === sel && !d.superseded) || docs.find((d) => d.doc_id === sel) || docs[0];
  if (!doc) return <p className="muted">No documents.</p>;

  const effectiveType = doc.classified_type || 'OTHER';
  const required = REQUIRED[doc.declared_type] || [];
  const byField = new Map(doc.fields.map((f) => [f.field, f]));
  const names = [...new Set([...required, ...doc.fields.map((f) => f.field)])];
  const mismatch = doc.classified_type && doc.classified_type !== doc.declared_type;
  const lowType = Number(doc.classification_confidence ?? 0) < MIN;
  const selected = app.evaluation?.selected_documents ? Object.values(app.evaluation.selected_documents).includes(doc.doc_id) : false;

  async function showText() {
    if (text[doc.doc_id]) return setText((t) => ({ ...t, [doc.doc_id]: { ...t[doc.doc_id], open: !t[doc.doc_id].open } }));
    try {
      const d = await getDocumentContent(app.id, doc.doc_id);
      setText((t) => ({ ...t, [doc.doc_id]: { open: true, body: d.content } }));
    } catch (e) {
      setText((t) => ({ ...t, [doc.doc_id]: { open: true, body: errorInfo(e).message } }));
    }
  }

  const done = (updated) => { setEditing(null); onChanged(updated); };
  const cancel = (stale) => { setEditing(null); if (stale) onStale(); };

  return (
    <div>
      <div className="doc-tabs" role="tablist">
        {docs.map((d) => (
          <button
            key={d.doc_id + d.version}
            role="tab"
            aria-selected={d.doc_id === doc.doc_id && d.superseded === doc.superseded}
            className={`doc-tab${d.superseded ? ' old' : ''}`}
            onClick={() => { setSel(d.doc_id); setEditing(null); }}
          >
            <span className="mono">{d.doc_id}</span>
            <small>{DOC_TYPE_LABEL[d.declared_type]}{d.superseded ? ', replaced' : ''}</small>
          </button>
        ))}
      </div>

      <div className="row-between" style={{ marginBottom: 12 }}>
        <div className="chips">
          <span className="chip">Customer said: {DOC_TYPE_LABEL[doc.declared_type]}</span>
          <span className={`chip ${mismatch ? 'coral' : 'mint'}`}>Read as: {DOC_TYPE_LABEL[effectiveType]} {Number(doc.classification_confidence ?? 0).toFixed(2)}</span>
          {lowType && !mismatch && <span className="chip orange">Low type confidence</span>}
          {selected && <span className="chip violet">Used by the rules</span>}
        </div>
        {canEdit && !doc.superseded && (
          <button className="btn btn-sm" onClick={() => setEditing('document_type')}><Icon name="edit" /> Fix type</button>
        )}
      </div>

      <table className="field-table">
        <thead><tr><th>Field</th><th>Value</th><th>Confidence</th><th /></tr></thead>
        <tbody>
          {editing === 'document_type' && (
            <EditRow app={app} doc={doc} field="document_type" current={effectiveType} onSaved={done} onCancel={cancel} colSpan={4} />
          )}
          {names.map((name) => {
            const f = byField.get(name);
            const low = f && f.confidence < MIN;
            return (
              <Fragment key={name}>
              <tr>
                <td className="field-name">{FIELD_LABEL[name] || name}</td>
                <td>
                  {f ? <span className="mono">{f.value || '(empty)'}</span> : <span className="chip orange">Not found</span>}
                  {f?.source === 'OFFICER' && (
                    <div className="small muted">Corrected{f.original_value !== null && f.original_value !== undefined ? <> from <span className="mono">{f.original_value || 'empty'}</span></> : ''}</div>
                  )}
                </td>
                <td>{f ? <Conf value={f.confidence} /> : <span className="muted">-</span>}</td>
                <td>
                  {canEdit && !doc.superseded && (
                    <button className="btn btn-quiet btn-sm" onClick={() => setEditing(name)} aria-label={`Correct ${FIELD_LABEL[name] || name}`}>
                      <Icon name="edit" /> {low || !f ? 'Fix' : 'Edit'}
                    </button>
                  )}
                </td>
              </tr>
              {editing === name && <EditRow app={app} doc={doc} field={name} current={f?.value} onSaved={done} onCancel={cancel} colSpan={4} />}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 14 }}>
        <button className="btn btn-sm" onClick={showText}>{text[doc.doc_id]?.open ? 'Hide source text' : 'Show source text'}</button>
        <span className="small muted" style={{ marginLeft: 10 }}>Opening a document is written to the audit trail.</span>
        {text[doc.doc_id]?.open && <pre className="doc-text">{text[doc.doc_id].body}</pre>}
      </div>
    </div>
  );
}
