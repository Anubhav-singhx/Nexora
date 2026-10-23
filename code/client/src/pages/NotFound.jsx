import { Link } from 'react-router-dom';
import { Empty } from '../components/ui.jsx';

export default function NotFound() {
  return (
    <Empty icon="search" title="Nothing here" action={<Link to="/" className="btn btn-primary">Back to my home</Link>}>
      This page does not exist, or you do not have access to it.
    </Empty>
  );
}
