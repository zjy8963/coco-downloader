/**
 * POST /api/test-adapters/save
 * 保存测试排序、死名单和屏蔽源到本地配置
 */
import { NextRequest, NextResponse } from 'next/server';
import { savePriorityConfig, loadPriorityConfig, saveDeadList, saveBlockedList } from '@/lib/playlist/adapter-config';
import { Platform } from '@/lib/playlist/types';

export async function POST(request: NextRequest) {
  try {
    const { platform, order, dead, blocked } = await request.json();
    if (!platform || !Array.isArray(order)) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    // 保存排序
    const config = loadPriorityConfig();
    config[platform as Platform] = order;
    savePriorityConfig(config);

    // 保存死名单
    if (Array.isArray(dead)) {
      saveDeadList(platform as Platform, dead);
    }

    // 保存屏蔽源
    if (Array.isArray(blocked)) {
      saveBlockedList(platform as Platform, blocked);
    }

    // 通知负载均衡器重建该平台的池
    try {
      const { getLoadBalancer } = await import('@/lib/adapter-lb');
      getLoadBalancer().reset(platform as Platform);
    } catch {}

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
