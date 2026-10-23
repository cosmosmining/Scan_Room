import { ShareLoader } from '@/components/share/ShareLoader';

export default async function SharePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <ShareLoader code={code} />;
}
