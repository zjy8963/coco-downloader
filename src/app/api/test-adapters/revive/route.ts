/**
 * POST /api/test-adapters/revive
 * 检测屏蔽源（死名单），若恢复则自动移除屏蔽
 * Body: { platform?: Platform }  不传则检测全部平台
 * 返回: { revived: string[], stillDead: string[], errors: string[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadDeadListFor, saveDeadList } from '@/lib/playlist/adapter-config';
import { Platform } from '@/lib/playlist/types';

export const dynamic = 'force-dynamic';

const ALL_PLATFORMS: Platform[] = ['netease', 'qq', 'kugou', 'kuwo'];

async function revivePlatform(platform: Platform): Promise<{ revived: string[]; stillDead: string[]; errors: string[] }> {
  const deadList = loadDeadListFor(platform);
  if (deadList.length === 0) return { revived: [], stillDead: [], errors: [] };

  const { getAllAdapters } = await import('@/lib/playlist/resolvers');
  const { testAdapters } = await import('@/lib/playlist/adapter-tester');
  const allAdapters = getAllAdapters(platform);
  const deadAdapters = allAdapters.filter(a => deadList.includes(a.name));

  if (deadAdapters.length === 0) {
    saveDeadList(platform, []);
    return { revived: [], stillDead: [], errors: [] };
  }

  const revived: string[] = [];
  const stillDead: string[] = [];

  // 并发检测，沿用测试页面的并发数
  for await (const result of testAdapters(platform, { concurrency: 5, timeoutMs: 8000 }, undefined, deadAdapters)) {
    if (result.status === 'success') {
      revived.push(result.name);
    } else {
      stillDead.push(result.name);
    }
  }

  // 更新死名单：移除已恢复的
  const newDead = deadList.filter(n => !revived.includes(n));
  saveDeadList(platform, newDead);

  return { revived, stillDead, errors: [] };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const platform = body.platform as Platform | undefined;

    const platforms = platform ? [platform] : ALL_PLATFORMS;
    const results: Record<string, { revived: string[]; stillDead: string[]; errors: string[] }> = {};

    for (const p of platforms) {
      results[p] = await revivePlatform(p);
    }

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
