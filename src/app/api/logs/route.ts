/**
 * GET /api/logs
 * SSE 实时推送服务端日志
 */
import { NextRequest } from 'next/server';
import { subscribe, getBuffer } from '@/lib/logger';

// 确保 logger 已加载
import '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // 先推送历史缓冲
      const history = getBuffer();
      for (const entry of history) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`));
      }

      // 订阅实时日志
      const unsub = subscribe((entry) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`));
        } catch {
          unsub();
        }
      });

      // 客户端断开时取消订阅
      _request.signal?.addEventListener('abort', unsub, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
