import { Link } from 'react-router-dom';
import { ROUTES } from '@/constants/app';
import { Button } from '@/components/ui/Button';

/** 404 route. Default export so it can be lazy-imported by the router. */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg-base bg-gradient-mesh px-4 text-center">
      <p className="bg-gradient-brand bg-clip-text text-7xl font-bold text-transparent">404</p>
      <h1 className="mt-4 text-xl font-semibold text-text-primary">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-text-muted">
           The page you\u2019re looking for doesn\u2019t exist or may have been moved.
           The page you are looking for doesn&apos;t exist or may have been moved.
       </p>
      <Link to={ROUTES.DASHBOARD} className="mt-6">
        <Button variant="primary">Back to dashboard</Button>
      </Link>
    </div>
  );
}
