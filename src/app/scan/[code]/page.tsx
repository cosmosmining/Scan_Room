import { ScanCodeLoader } from '@/components/scan/ScanCodeLoader';

/**
 * `/scan/B7K4M2` — the link the iPad shows and the person opens.
 *
 * Typing the code is the fallback; a link that lands here directly is the fast
 * path, and it is the same route either way so there is only one thing to keep
 * working.
 */
export default async function ScanCodePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <ScanCodeLoader code={code} />;
}
