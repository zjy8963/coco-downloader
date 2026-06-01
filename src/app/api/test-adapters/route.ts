/**
 * GET /api/test-adapters?platform=netease&concurrency=5&timeout=8000
 * SSE 流式返回并发适配器测试结果（含死名单、屏蔽源状态）
 */
import { NextRequest } from 'next/server';
import { testAdapters, TestOptions } from '@/lib/playlist/adapter-tester';
import { Platform } from '@/lib/playlist/types';
import { loadPriorityConfig, loadDeadListFor, loadBlockedListFor } from '@/lib/playlist/adapter-config';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const platform = (sp.get('platform') || 'netease') as Platform;
  const concurrency = Math.max(1, Math.min(10, Number(sp.get('concurrency')) || 3));
  const timeoutMs = Math.max(2000, Number(sp.get('timeout')) || 8000);

  const config = loadPriorityConfig();
  const order = config[platform] as string[] | undefined;
  const deadList = loadDeadListFor(platform);
  const blockedList = loadBlockedListFor(platform);

  const opts: TestOptions = { concurrency, timeoutMs, order };
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const { getAllAdapters } = await import('@/lib/playlist/resolvers');
        const allAdapters = getAllAdapters(platform);
        const excluded = [...new Set([...deadList, ...blockedList])];
        const liveAdapters = allAdapters.filter(a => !excluded.includes(a.name));
        const total = allAdapters.length;
        const liveTotal = liveAdapters.length;
        console.log(`[test] ${platform} adapters: ${allAdapters.length} total, ${liveTotal} live, ${deadList.length} dead, ${blockedList.length} blocked`);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'total', total, liveTotal, concurrency, timeoutMs, dead: deadList, blocked: blockedList })}\n\n`));

        let count = 0;
        for await (const result of testAdapters(platform, opts, undefined, liveAdapters)) {
          count++;
          const { index: _idx, ...rest } = result as unknown as Record<string, unknown>;
          const name = String(rest.name);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              type: 'result',
              index: count,
              liveTotal,
              dead: deadList.includes(name),
              blocked: blockedList.includes(name),
              ...rest,
            })}\n\n`)
          );
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', dead: deadList, blocked: blockedList })}\n\n`));
      } catch (err) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
