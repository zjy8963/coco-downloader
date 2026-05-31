import { NextRequest, NextResponse } from 'next/server';
import { parsePlaylist } from '@/lib/playlist';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  try {
    const result = await parsePlaylist(url);
    return NextResponse.json(result);
  } catch (err) {
    console.error('Playlist parse error:', err);
    return NextResponse.json(
      { error: (err as Error).message || '歌单解析失败' },
      { status: 500 }
    );
  }
}
