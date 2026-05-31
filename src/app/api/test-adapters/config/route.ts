/**
 * GET /api/test-adapters/config
 * 返回已保存的适配器排序和死名单
 */
import { NextResponse } from 'next/server';
import { loadPriorityConfig, loadDeadList } from '@/lib/playlist/adapter-config';

export const dynamic = 'force-dynamic';

export async function GET() {
  const order = loadPriorityConfig();
  const dead = loadDeadList();
  return NextResponse.json({ ...order, _dead: dead });
}
