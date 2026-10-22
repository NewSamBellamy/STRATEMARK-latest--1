import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <div className="font-display text-6xl font-bold text-primary">404</div>
      <h1 className="mt-3 font-display text-xl text-content">Page not found</h1>
      <p className="mt-2 text-sm text-muted">
        The view you were looking for doesn’t exist or has moved.
      </p>
      <Link to="/history" className="btn-primary mt-6 inline-flex">
        Back to all decks
      </Link>
    </div>
  );
}
