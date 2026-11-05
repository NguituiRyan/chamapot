'use client';

import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { ErrorState } from '@/components/states';
import { buttonClass } from '@/components/ui';

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <div className="mx-auto max-w-xl space-y-4 py-10">
      <ErrorState title="Something went wrong on this page" message={error.message} />
      <button type="button" onClick={() => retry()} className={buttonClass('secondary')}>
        <RefreshCw className="size-4" aria-hidden />
        Try again
      </button>
    </div>
  );
}
