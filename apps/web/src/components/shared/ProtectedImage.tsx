import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface ProtectedImageProps {
  src: string;
  alt: string;
  className?: string;
}

export function ProtectedImage({ src, alt, className }: ProtectedImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let nextObjectUrl: string | null = null;
    setFailed(false);
    setObjectUrl(null);

    void apiClient
      .get<Blob>(src, { responseType: 'blob' })
      .then((response) => {
        if (!active) return;
        nextObjectUrl = URL.createObjectURL(response.data);
        setObjectUrl(nextObjectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [src]);

  if (failed) {
    return (
      <div className="flex min-h-28 items-center justify-center text-center text-xs text-text-muted">
        Saved strip image is unavailable on this server.
      </div>
    );
  }
  if (!objectUrl) {
    return (
      <div className="flex min-h-28 items-center justify-center text-xs text-text-muted">
        Loading saved strip...
      </div>
    );
  }

  return <img src={objectUrl} alt={alt} className={cn('object-contain', className)} />;
}
