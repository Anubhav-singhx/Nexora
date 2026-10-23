// Decisions are rubber stamps. One component, one colour logic, used for status, engine decision and risk.
const STATUS = {
  SUBMITTED: ['Received', 'violet'],
  EXTRACTING: ['Verifying', 'violet'],
  IN_REVIEW: ['In review', 'orange'],
  PENDING_CHECKER: ['Final sign-off', 'orange'],
  RESUBMISSION_REQUESTED: ['Needs documents', 'orange'],
  AUTO_APPROVED: ['Approved', 'mint'],
  APPROVED: ['Approved', 'mint'],
  AUTO_REJECTED: ['Rejected', 'coral'],
  REJECTED: ['Rejected', 'coral'],
  CLOSED_EXPIRED: ['Expired', 'grey'],
};

export const statusLabel = (s) => STATUS[s]?.[0] || s;
export const statusTone = (s) => STATUS[s]?.[1] || 'grey';

export function Stamp({ tone = 'grey', big, thunk, children }) {
  return <span className={`stamp tone-${tone}${big ? ' big' : ''}${thunk ? ' thunk' : ''}`}>{children}</span>;
}

export default function StatusStamp({ status, big, thunk }) {
  return (
    <Stamp tone={statusTone(status)} big={big} thunk={thunk}>
      {statusLabel(status)}
    </Stamp>
  );
}

const RISK_TONE = { LOW: 'mint', MEDIUM: 'orange', HIGH: 'coral' };
export function RiskChip({ risk }) {
  if (!risk) return <span className="muted">-</span>;
  return <span className={`chip ${RISK_TONE[risk]}`}>{risk[0] + risk.slice(1).toLowerCase()} risk</span>;
}

const DECISION_TONE = { APPROVE: 'mint', REVIEW: 'orange', REJECT: 'coral' };
export function DecisionChip({ decision }) {
  if (!decision) return <span className="muted">-</span>;
  return <span className={`chip ${DECISION_TONE[decision]}`}>{decision[0] + decision.slice(1).toLowerCase()}</span>;
}
