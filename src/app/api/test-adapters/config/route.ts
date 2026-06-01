/**
 * GET /api/test-adapters/config
 * 返回已保存的适配器排序、死名单、屏蔽源、自动复活、间隔和 UI 配置
 *
 * POST /api/test-adapters/config
 * Body: { platform?, autoRevive?, autoReviveInterval?, _ui? }
 * 保存配置（各字段均可选，按需传）
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  loadPriorityConfig, loadDeadList, loadBlockedList,
  loadAutoRevive, loadAutoReviveInterval, loadUiConfig,
  saveAutoRevive, saveAutoReviveInterval, saveUiConfig,
} from '@/lib/playlist/adapter-config';

export const dynamic = 'force-dynamic';

export async function GET() {
  const order = loadPriorityConfig();
  const dead = loadDeadList();
  const blocked = loadBlockedList();
  const autoRevive = loadAutoRevive();
  const autoReviveInterval = loadAutoReviveInterval();
  const ui = loadUiConfig();
  return NextResponse.json({
    ...order,
    _dead: dead,
    _blocked: blocked,
    _autoRevive: autoRevive,
    _autoReviveInterval: autoReviveInterval,
    _ui: ui,
  });
}

export async function POST(request: NextRequest) {
  try {
    const { platform, autoRevive, autoReviveInterval, _ui } = await request.json();

    if (platform && typeof autoRevive === 'boolean') {
      saveAutoRevive(platform, autoRevive);
    }

    if (platform && autoReviveInterval && typeof autoReviveInterval.value === 'number' && autoReviveInterval.unit) {
      saveAutoReviveInterval(platform, autoReviveInterval);
    }

    // 保存 UI 设置（并发数、超时、排序模式等）
    if (_ui && typeof _ui === 'object') {
      saveUiConfig(_ui);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
