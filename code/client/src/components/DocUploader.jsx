import { useRef, useState } from 'react';
import Icon from './Icon.jsx';

export const DOC_TYPES = [
  ['PAN_CARD', 'PAN card'],
  ['AADHAAR_CARD', 'Aadhaar card (masked)'],
  ['ELECTRICITY_BILL', 'Electricity bill (address)'],
  ['BANK_STATEMENT', 'Bank statement (address)'],
  ['DRIVING_LICENCE', 'Driving licence (address)'],
];
export const ADDRESS_TYPES = ['ELECTRICITY_BILL', 'BANK_STATEMENT', 'DRIVING_LICENCE'];
const MAX_FILE = 1024 * 1024;

export function guessType(name) {
  const n = name.toLowerCase();
  if (n.includes('pan')) return 'PAN_CARD';
  if (n.includes('aadhaar') || n.includes('aadhar')) return 'AADHAAR_CARD';
  if (n.includes('licen')) return 'DRIVING_LICENCE';
  if (n.includes('bill') || n.includes('electric')) return 'ELECTRICITY_BILL';
  if (n.includes('statement')) return 'BANK_STATEMENT';
  return '';
}

/** Looks at the first lines of the file when the file name says nothing (names like D3000001.txt are just ids). */
export function guessTypeFromText(text) {
  const t = String(text || '').toUpperCase();
  if (t.includes('PERMANENT ACCOUNT NUMBER') || t.includes('INCOME TAX')) return 'PAN_CARD';
  if (t.includes('AADHAAR') || t.includes('UNIQUE IDENTIFICATION')) return 'AADHAAR_CARD';
  if (t.includes('ELECTRICITY')) return 'ELECTRICITY_BILL';
  if (t.includes('STATEMENT OF ACCOUNT') || t.includes('BANK STATEMENT')) return 'BANK_STATEMENT';
  if (t.includes('DRIVING') || t.includes('LICENCE')) return 'DRIVING_LICENCE';
  return '';
}

/** Quick client checks; the server repeats all of them. Returns { 0: 'msg', general: 'msg' } (empty = fine). */
export function validateFiles(files, min) {
  const fe = {};
  files.forEach((f, i) => {
    if (!/\.txt$/i.test(f.file.name)) fe[i] = 'Only .txt files are accepted';
    else if (f.file.size === 0) fe[i] = 'File is empty';
    else if (f.file.size > MAX_FILE) fe[i] = 'File is larger than 1 MB';
    else if (!f.type) fe[i] = 'Choose the document type';
    else if (!/^[A-Za-z0-9_-]{1,64}$/.test(f.docId.trim())) fe[i] = 'Document id: letters, digits, _ or - only';
  });
  if (files.length < min) fe.general = min >= 3 ? 'Upload at least 3 documents: PAN, Aadhaar and one address proof.' : 'Add at least one document.';
  return fe;
}

export function appendFiles(data, files) {
  files.forEach((f) => {
    data.append('document_types', f.type);
    data.append('doc_ids', f.docId.trim());
    data.append('documents', f.file, f.file.name);
  });
}

let nextKey = 1;

export default function DocUploader({ files, setFiles, errors, setErrors, busy, hint }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);

  function add(list) {
    const incoming = Array.from(list).map((file) => ({
      key: nextKey++,
      file,
      docId: file.name.replace(/\.txt$/i, ''),
      type: guessType(file.name),
    }));
    setFiles((cur) => [...cur, ...incoming]);
    setErrors({});
    incoming.filter((f) => !f.type).forEach((f) => {
      f.file.slice(0, 2000).text().then((t) => {
        const guess = guessTypeFromText(t);
        if (guess) setFiles((cur) => cur.map((x) => (x.key === f.key && !x.type ? { ...x, type: guess } : x)));
      }).catch(() => {});
    });
    if (input.current) input.current.value = '';
  }
  const update = (key, patch) => {
    setFiles((cur) => cur.map((f) => (f.key === key ? { ...f, ...patch } : f)));
    setErrors({});
  };
  const remove = (key) => {
    setFiles((cur) => cur.filter((f) => f.key !== key));
    setErrors({});
  };

  return (
    <div>
      <input ref={input} type="file" accept=".txt,text/plain" multiple hidden onChange={(e) => add(e.target.files)} />
      <div
        className={`dropzone${over ? ' over' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => !busy && input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !busy && (e.preventDefault(), input.current?.click())}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) add(e.dataTransfer.files); }}
      >
        <span className="empty-art"><Icon name="upload" /></span>
        <strong>Drop .txt files here or click to browse</strong>
        <span className="hint">{hint || 'Max 1 MB each. The type is suggested from the file; check it.'}</span>
      </div>
      {errors.general && <span className="field-error block">{errors.general}</span>}
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((f, i) => (
            <li key={f.key} className={errors[i] ? 'file-row has-error' : 'file-row'}>
              <div className="file-name" title={f.file.name}>
                {f.file.name} <span className="muted small">{Math.max(1, Math.round(f.file.size / 1024))} KB</span>
              </div>
              <select value={f.type} onChange={(e) => update(f.key, { type: e.target.value })} disabled={busy} aria-label="Document type">
                <option value="">Select type</option>
                {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <input className="mono" value={f.docId} onChange={(e) => update(f.key, { docId: e.target.value })} disabled={busy} aria-label="Document id" placeholder="Document id" />
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => remove(f.key)} disabled={busy} aria-label={`Remove ${f.file.name}`}>
                <Icon name="x" />
              </button>
              {errors[i] && <span className="field-error file-error">{errors[i]}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
