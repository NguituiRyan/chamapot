// /dashboard/studio/treasurer/spike - development checkpoint for the Claude Treasurer (see
// spike-studio.tsx). Absent from production builds' reachable pages.
import { notFound } from 'next/navigation';
import { SpikeStudio } from './spike-studio';

export const metadata = { title: 'Treasurer checkpoint' };

export default async function TreasurerSpikePage({ searchParams }: PageProps<'/dashboard/studio/treasurer/spike'>) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { mock } = await searchParams;
  return (
    <main id="main" className="flex-1">
      <SpikeStudio mock={mock === '1'} />
    </main>
  );
}
