import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';

export function PageHead({ title, children, actions }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Back({ to, children }) {
  return (
    <Link to={to} className="back">
      <Icon name="back" /> {children}
    </Link>
  );
}

export function Empty({ icon = 'inbox', title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-art"><Icon name={icon} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ children = 'Loading' }) {
  return <p className="center-note" role="status">{children}...</p>;
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <div className="row-between">
        <span>{error}</span>
        {onRetry && <button className="btn btn-sm" onClick={onRetry}>Retry</button>}
      </div>
    </div>
  );
}

/** Extraction confidence as a small bar; below the 0.80 threshold it turns red so the officer's eye lands on it. */
export function Conf({ value, min = 0.8 }) {
  const v = Number(value);
  const cls = v >= min ? '' : v >= min - 0.15 ? 'mid' : 'low';
  return (
    <div className="conf" title={`Confidence ${v.toFixed(2)} (threshold ${min.toFixed(2)})`}>
      <div className={`conf-bar ${cls}`}><i style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} /></div>
      <span className="mono">{v.toFixed(2)}</span>
    </div>
  );
}
