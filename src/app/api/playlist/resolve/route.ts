import { NextRequest, NextResponse } from 'next/server';
import { getResolver } from '@/lib/playlist/resolvers';
import { ResolveRequest, ResolveResponse, Platform } from '@/lib/playlist/types';

export async function POST(request: NextRequest) {
  let body: ResolveRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { platform, rawData } = body;
  if (!platform || !rawData || !rawData.id) {
    return NextResponse.json(
      { error: 'Missing platform or rawData.id' },
      { status: 400 }
    );
  }

  // 校验平台
  const validPlatforms: Platform[] = ['netease', 'qq', 'kugou', 'kuwo'];
  if (!validPlatforms.includes(platform)) {
    return NextResponse.json(
      { error: `Invalid platform: ${platform}` },
      { status: 400 }
    );
  }

  try {
    const resolver = getResolver(platform);
    const result = await resolver.resolve(rawData);

    const response: ResolveResponse = {
      url: result.url,
      type: result.type || 'mp3',
      cover: result.cover,
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error(`Resolve error (${platform}/${rawData.id}):`, err);
    return NextResponse.json(
      { error: `All APIs failed for this track: ${(err as Error).message}` },
      { status: 502 }
    );
  }
}
