import { Brand } from './Layout.jsx';


/** Split-screen frame for sign in / register: the left side is the one loud moment of the product. */
export default function AuthShell({ children }) {
  return (
    <div className="auth-split">
      <aside className="auth-art">
        <Brand />
        <div>
          <h1>Open an account without the paperwork pile.</h1>
          <p>Upload your documents once. Every decision comes with a reason, and a person signs off on anything unusual.</p>
        </div>
        <div className="stamp-pile" aria-hidden="true">
          <span className="stamp s1" style={{ color: 'var(--yellow)' }}>Verified</span>
          <span className="stamp s2">Reviewed</span>
          <span className="stamp s3">Approved</span>
        </div>
      </aside>
      <section className="auth-form-side">
        <div className="auth-card">{children}</div>
      </section>
    </div>
  );
}
