import { NextRequest, NextResponse } from 'next/server';
import { getProvider } from '@/lib/providers';
import { getLastPlatformResults } from '@/lib/providers/impl/official';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const q = searchParams.get('q');
  const providerName = searchParams.get('provider');

  if (!q) {
    return NextResponse.json({ error: 'Missing query' }, { status: 400 });
  }

  const resolvedProviderName =
    providerName && providerName !== 'all' ? providerName : 'official';
  const provider = getProvider(resolvedProviderName);
  const items = await provider.search(q);

  // 官方聚合搜索附带分平台结果，供前端标签页切换
  const byPlatform = resolvedProviderName === 'official' ? getLastPlatformResults() : undefined;

  return NextResponse.json({ items, byPlatform });
}
