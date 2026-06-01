import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { Readable } from "stream";
import { getProvider } from "@/lib/providers";
import { embedMetadata, TrackMeta } from "@/lib/metadata";
import { fetchLyric } from "@/lib/playlist/lyric-service";
import { searchNetease } from "@/lib/search/official-netease";
import { searchQQ } from "@/lib/search/official-qq";
import { searchKuwo } from "@/lib/search/official-kuwo";
import { searchKugou } from "@/lib/search/official-kugou";

const DOWNLOAD_TIMEOUT = 30000;
const RETRY_LIMIT = 2;
const RETRY_DELAY = 600;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown) {
  const err = error as { code?: string; message?: string };
  const code = err?.code || "";
  const message = err?.message || "";
  return (
    code === "ETIMEDOUT" ||
    code === "ECONNABORTED" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    message.toLowerCase().includes("timeout")
  );
}

async function requestAudioStream(url: string, attempt = 0) {
  try {
    const response = await axios.get(url, {
      responseType: "stream",
      timeout: DOWNLOAD_TIMEOUT,
      maxRedirects: 5,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Upstream error: ${response.status}`);
    }

    const stream = Readable.toWeb(response.data) as ReadableStream<Uint8Array>;
    return { stream, headers: response.headers as Record<string, string | undefined> };
  } catch (error) {
    if (attempt < RETRY_LIMIT && isRetryableError(error)) {
      await delay(RETRY_DELAY * (attempt + 1));
      return requestAudioStream(url, attempt + 1);
    }
    throw error;
  }
}

/** 下载完整音频到 Buffer */
async function requestAudioBuffer(url: string, attempt = 0): Promise<Buffer> {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 60000, // buffer 模式超时放宽
      maxRedirects: 5,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    return Buffer.from(response.data);
  } catch (error) {
    if (attempt < RETRY_LIMIT && isRetryableError(error)) {
      await delay(RETRY_DELAY * (attempt + 1));
      return requestAudioBuffer(url, attempt + 1);
    }
    throw error;
  }
}

/** 根据 URL 后缀判断文件类型 */
function detectFileType(url: string): string {
  const clean = url.split("?")[0];
  const parts = clean.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "mp3";
}

/** 验证音频 Buffer 是否为有效格式，返回 null 表示通过，返回错误信息表示无效 */
function validateAudioBuffer(buf: Buffer, fileType: string): string | null {
  // FLAC 魔数: 66 4C 61 43
  if (fileType === 'flac') {
    if (buf[0] !== 0x66 || buf[1] !== 0x4C || buf[2] !== 0x61 || buf[3] !== 0x43) {
      return `无效 FLAC 文件（文件头不匹配）`;
    }
    return null;
  }

  // 加密格式检测（mgg/kgm 等）
  // mgg: 文件头包含特殊标记
  const headerStr = buf.slice(0, 16).toString('ascii');
  if (headerStr.startsWith('\xa4\xa4') || headerStr.includes('kugou') || headerStr.includes('kgm')) {
    return `加密格式，无法播放`;
  }

  // MP3: ID3v2 头 (49 44 33) 或帧同步头 FF FB / FF F3 / FF FA / FF F2
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return null; // ID3v2
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return null;        // MPEG sync

  // 文件太小可能是预览片段
  if (buf.length < 500 * 1024) {
    return `文件过小 (${(buf.length / 1024).toFixed(0)}KB)，可能为预览片段`;
  }

  return `未知音频格式`;
}

// ── 音质阈值：低于此值视为异常 ──
const QUALITY_MIN_ANY = 2 * 1024 * 1024;     // 任何格式 < 2MB 触发重试
const QUALITY_THRESHOLD_MP3 = 5 * 1024 * 1024;   // MP3 < 5MB 可疑
const QUALITY_THRESHOLD_FLAC = 10 * 1024 * 1024;  // FLAC < 10MB 可疑

/** 判断下载的音频质量是否异常 */
function isQualityPoor(buf: Buffer, fileType: string): boolean {
  if (buf.length < QUALITY_MIN_ANY) return true;
  if (fileType === 'flac' && buf.length < QUALITY_THRESHOLD_FLAC) return true;
  if (fileType !== 'flac' && buf.length < QUALITY_THRESHOLD_MP3) return true;
  return false;
}

/** 跨平台逐平台搜索 + 严格匹配，找到质量达标的结果即返回，否则返回 null */
async function crossPlatformDownload(
  title: string,
  artist: string,
  excludePlatform: string,
  providerName: string,
): Promise<{ buf: Buffer; type: string } | null> {
  const query = `${artist} ${title}`.trim();
  const platforms = ['netease', 'qq', 'kuwo', 'kugou'].filter(p => p !== excludePlatform);
  const searchers: Record<string, (q: string, limit: number) => Promise<any[]>> = {
    netease: searchNetease, qq: searchQQ, kuwo: searchKuwo, kugou: searchKugou,
  };

  let bestResult: { buf: Buffer; type: string } | null = null;

  for (const p of platforms) {
    try {
      const results = await searchers[p](query, 5);
      if (!results?.length) continue;

      // 严格匹配：歌名和歌手名都需要包含匹配
      const qLower = title.toLowerCase();
      const aLower = artist.toLowerCase();
      for (const match of results) {
        const mTitle = (match.title || '').toLowerCase();
        const mArtist = (match.artist || '').toLowerCase();
        const titleMatch = mTitle.includes(qLower) || qLower.includes(mTitle);
        const artistMatch = !aLower || mArtist.includes(aLower) || aLower.includes(mArtist);
        if (!titleMatch || !artistMatch) continue;

        // 严格匹配通过，尝试下载
        const songId = `${p}:${match.id}`;
        const provider = getProvider(providerName || 'gequbao');
        const playInfo = await provider.getPlayInfo(songId, {
          title: match.title || title,
          artist: match.artist || artist,
          _lb: true,
          details: { [p]: { id: match.id, title: match.title, artist: match.artist } },
        });
        if (!playInfo?.url) continue;

        const buf = await requestAudioBuffer(playInfo.url);
        const fileType = detectFileType(playInfo.url);
        const validationErr = validateAudioBuffer(buf, fileType);
        if (validationErr) continue;

        console.log(`[cross-platform] ${p}: ${(buf.length / 1024).toFixed(0)}KB (${fileType})`);

        // 质量达标 → 立即返回，不再搜其他平台
        if (!isQualityPoor(buf, fileType)) {
          return { buf, type: fileType };
        }
        // 质量不达标 → 记下最优，继续查其他平台
        if (!bestResult || buf.length > bestResult.buf.length) {
          bestResult = { buf, type: fileType };
        }
        break; // 当前平台已找到匹配，进入下一平台
      }
    } catch {
      continue;
    }
  }

  // 全部平台查完，返回最优（可能仍不达标但已是最佳选择）
  if (bestResult) return bestResult;

  // ── 所有官方平台均失败 → jbsou 最后兜底 ──
  return await jbsouFallback(query);
}

/** jbsou 兜底：搜索 + 下载，作为所有路径的最终尝试 */
async function jbsouFallback(query: string): Promise<{ buf: Buffer; type: string } | null> {
  try {
    const provider = getProvider('jianbin-netease');
    const results = await provider.search(query);
    if (!results?.length) return null;

    // 取第一个结果
    const item = results[0];
    if (!item.id) return null;

    const playInfo = await provider.getPlayInfo(item.id);
    if (!playInfo?.url) return null;

    const buf = await requestAudioBuffer(playInfo.url);
    const fileType = detectFileType(playInfo.url);
    const err = validateAudioBuffer(buf, fileType);
    if (err) return null;

    console.log(`[jbsou] 兜底成功: ${(buf.length / 1024).toFixed(0)}KB (${fileType})`);
    return { buf, type: fileType };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const id = searchParams.get("id");
  const filename = searchParams.get("filename");
  const providerName = searchParams.get("provider") || "gequbao";

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    const provider = getProvider(providerName);
    const playInfo = await provider.getPlayInfo(id);
    if (!playInfo || !playInfo.url) {
      return NextResponse.json({ error: "Failed to get url" }, { status: 404 });
    }

    const downloadEnabled = process.env.ENABLE_DOWNLOAD !== "0";
    if (!downloadEnabled) {
      return NextResponse.json(
        { error: "Download disabled", url: playInfo.url },
        { status: 503 }
      );
    }

    const { stream, headers: upstreamHeaders } = await requestAudioStream(playInfo.url);

    const headers = new Headers();
    const contentType = upstreamHeaders["content-type"];
    headers.set("Content-Type", contentType || "audio/mpeg");

    const contentLength = upstreamHeaders["content-length"];
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }
    
    // filename 参数仅 ASCII 安全，中文只用 filename*=UTF-8'' 百分比编码
    const safeFilename = filename || `music-${id}.mp3`;
    const encodedFilename = encodeURIComponent(safeFilename);
    headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodedFilename}`);

    return new NextResponse(stream, {
      status: 200,
      headers,
    });

  } catch (error) {
    console.error("Download error:", error);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}

/** 存盘或返回浏览器 */
function respond(taggedBuffer: Buffer, fileType: string, safeFilename: string, saveToDisk: boolean) {
  if (saveToDisk && process.env.SAVE_PATH) {
    const fs = require('fs');
    const path = require('path');
    const savePath = process.env.SAVE_PATH;
    if (!fs.existsSync(savePath)) fs.mkdirSync(savePath, { recursive: true });
    const filePath = path.join(savePath, safeFilename);
    fs.writeFileSync(filePath, taggedBuffer);
    console.log(`[download] 已保存: ${filePath} (${(taggedBuffer.length / 1024 / 1024).toFixed(1)}MB)`);
    return NextResponse.json({ ok: true, path: filePath, filename: safeFilename, size: taggedBuffer.length });
  }
  return new NextResponse(new Uint8Array(taggedBuffer), {
    status: 200,
    headers: {
      'Content-Type': fileType === 'flac' ? 'audio/flac' : 'audio/mpeg',
      'Content-Length': String(taggedBuffer.length),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
    },
  });
}

/** POST: 带元数据嵌入的下载 */
export async function POST(request: NextRequest) {
  let body: {
    id: string;
    provider?: string;
    filename?: string;
    saveToDisk?: boolean;
    meta?: {
      title?: string;
      artist?: string;
      album?: string;
      coverUrl?: string;
      lyric?: string;
      _preResolvedUrl?: string;
    };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id, provider: providerName, filename, meta, saveToDisk } = body;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    // 1. 获取音频地址
    let playUrl: string;
    let playType: string;

    const preResolvedUrl = meta?._preResolvedUrl as string | undefined;
    if (preResolvedUrl) {
      // 播放时已解析过，直接复用
      playUrl = preResolvedUrl;
      playType = detectFileType(playUrl);
    } else {
      // 首次下载，走完整解析（启用 LB）
      const provider = getProvider(providerName || "gequbao");
      const extraInfo = meta ? { title: meta.title, artist: meta.artist, album: meta.album, _lb: true } : undefined;
      const playInfo = await provider.getPlayInfo(id, extraInfo);
      if (!playInfo || !playInfo.url) {
        return NextResponse.json({ error: "Failed to get url" }, { status: 404 });
      }
      playUrl = playInfo.url;
      playType = detectFileType(playUrl);
    }

    const downloadEnabled = process.env.ENABLE_DOWNLOAD !== "0";
    if (!downloadEnabled) {
      return NextResponse.json({ error: "Download disabled" }, { status: 503 });
    }

    // 2. 下载 + 验证，最多重试 3 次（LB 每次选不同适配器）
    let audioBuffer: Buffer | null = null;
    let lastValidationError = '';

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0 && preResolvedUrl) break; // 预解析 URL 不重试

      if (attempt > 0) {
        // 重试：重新走 LB 选下一个适配器
        const retryProvider = getProvider(providerName || "gequbao");
        const retryInfo = await retryProvider.getPlayInfo(id, { title: meta?.title, artist: meta?.artist, album: meta?.album, _lb: true });
        if (!retryInfo?.url) continue;
        playUrl = retryInfo.url;
        playType = detectFileType(playUrl);
      }

      const buf = await requestAudioBuffer(playUrl);
      const err = validateAudioBuffer(buf, playType);
      if (!err) {
        audioBuffer = buf;
        break;
      }
      lastValidationError = err;
      console.warn(`Download validation attempt ${attempt + 1}: ${err}`);
    }

    // 同平台全部失败 → 先切源再跨平台
    if (!audioBuffer) {
      console.warn(`[download] 同平台 3 次均失败 (${lastValidationError})，尝试切源重试`);

      // 同一平台切源 1 次
      try {
        const retryProvider = getProvider(providerName || "gequbao");
        const retryInfo = await retryProvider.getPlayInfo(id, { title: meta?.title, artist: meta?.artist, album: meta?.album, _lb: true });
        if (retryInfo?.url) {
          const retryBuf = await requestAudioBuffer(retryInfo.url);
          const retryType = detectFileType(retryInfo.url);
          const err = validateAudioBuffer(retryBuf, retryType);
          if (!err) {
            audioBuffer = retryBuf;
            playType = retryType;
            console.log(`[download] 切源成功: ${(retryBuf.length / 1024).toFixed(0)}KB (${retryType})`);
          }
        }
      } catch { /* 切源失败不阻塞 */ }

      // 切源仍失败 → 跨平台
      if (!audioBuffer) {
        const platformMatch = id.match(/^(netease|qq|kugou|kuwo):/);
        const excludePlat = platformMatch?.[1] || '';
        console.warn(`[download] 切源仍失败，尝试跨平台 (排除 ${excludePlat})`);
        try {
          const crossResult = await crossPlatformDownload(
            meta?.title || '',
            meta?.artist || '',
            excludePlat,
            providerName || 'gequbao',
          );
          if (crossResult) {
            audioBuffer = crossResult.buf;
            playType = crossResult.type;
            console.log(`[download] 跨平台成功: ${(audioBuffer.length / 1024).toFixed(0)}KB (${playType})`);
          }
        } catch { /* 跨平台失败不阻塞 */ }
      }
    }

    if (!audioBuffer) {
      return NextResponse.json({ error: `音频无效: ${lastValidationError}` }, { status: 422 });
    }

    // 2.5. 音质检测：若文件异常偏小，切源重试、跨平台搜索
    if (isQualityPoor(audioBuffer, playType)) {
      console.warn(`[quality] 音质异常: ${(audioBuffer.length / 1024).toFixed(0)}KB (${playType}), 尝试切源重试`);
      let bestBuf = audioBuffer;
      let bestType = playType;

      // 同一平台切源重试 1 次（LB 选不同适配器）
      try {
        const retryProvider = getProvider(providerName || "gequbao");
        const retryInfo = await retryProvider.getPlayInfo(id, { title: meta?.title, artist: meta?.artist, album: meta?.album, _lb: true });
        if (retryInfo?.url) {
          const retryBuf = await requestAudioBuffer(retryInfo.url);
          const retryType = detectFileType(retryInfo.url);
          const err = validateAudioBuffer(retryBuf, retryType);
          if (!err) {
            console.log(`[quality] 切源结果: ${(retryBuf.length / 1024).toFixed(0)}KB (${retryType})`);
            if (!isQualityPoor(retryBuf, retryType)) {
              // 切源后质量达标，直接用，不再跨平台
              bestBuf = retryBuf;
              bestType = retryType;
            } else if (retryBuf.length > bestBuf.length) {
              bestBuf = retryBuf;
              bestType = retryType;
            }
          }
        }
      } catch { /* 切源失败不阻塞 */ }

      // 切源后仍不达标 → 跨平台逐平台搜索，找到好的即停
      if (isQualityPoor(bestBuf, bestType)) {
        const platformMatch = id.match(/^(netease|qq|kugou|kuwo):/);
        const excludePlat = platformMatch?.[1] || '';
        console.log(`[quality] 切源后仍不达标 (${(bestBuf.length / 1024).toFixed(0)}KB)，尝试跨平台 (排除 ${excludePlat})`);

        const crossResult = await crossPlatformDownload(
          meta?.title || '',
          meta?.artist || '',
          excludePlat,
          providerName || 'gequbao',
        );

        if (crossResult) {
          console.log(`[quality] 跨平台结果: ${(crossResult.buf.length / 1024).toFixed(0)}KB (${crossResult.type})`);
          // 如果跨平台结果达标或比当前好，使用跨平台结果
          if (!isQualityPoor(crossResult.buf, crossResult.type) || crossResult.buf.length > bestBuf.length) {
            bestBuf = crossResult.buf;
            bestType = crossResult.type;
          }
        }
      }

      console.log(`[quality] 最终: ${(bestBuf.length / 1024).toFixed(0)}KB (${bestType})`);
      audioBuffer = bestBuf;
      playType = bestType;
    }

    // 3. 构造元数据
    const title = meta?.title || "未知歌曲";
    const artist = meta?.artist || "未知歌手";

    // 下载时自动获取歌词（无需播放）
    let lyric = meta?.lyric;
    if (!lyric && title !== "未知歌曲") {
      const platformMatch = id.match(/^(netease|qq|kugou|kuwo):/);
      if (platformMatch) {
        const p = platformMatch[1];
        const songId = id.split(":")[1];
        // 不阻塞下载，歌词获取失败不影响主流程
        lyric = await fetchLyric(p, songId, title, artist, meta?.album).catch(() => undefined);
      }
    }

    const trackMeta: TrackMeta = {
      title,
      artist,
      album: meta?.album,
      lyric,
    };

    // 4. 下载封面图
    if (meta?.coverUrl) {
      try {
        const coverResp = await axios.get(meta.coverUrl, {
          responseType: "arraybuffer",
          timeout: 10000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        trackMeta.coverBuffer = Buffer.from(coverResp.data);
      } catch {
        // 封面获取失败不阻塞下载
        console.warn("Cover fetch failed for:", meta.coverUrl);
      }
    }

    // 5. 嵌入元数据
    const taggedBuffer = await embedMetadata(audioBuffer, playType, trackMeta);

    // 6. 确定文件名后缀
    const ext = playType === "flac" ? ".flac" : ".mp3";
    const baseName = filename
      ? filename.replace(/\.[^.]+$/, "")
      : `music-${id}`;
    const safeFilename = `${baseName}${ext}`;

    return respond(taggedBuffer, playType, safeFilename, !!saveToDisk);

  } catch (error) {
    // 下载/解析层面异常 → 先切源再跨平台兜底
    console.error("Download error, trying fallback:", (error as Error).message);

    try {
      // 同一平台切源 1 次
      const retryProvider = getProvider(providerName || "gequbao");
      const retryInfo = await retryProvider.getPlayInfo(id, { title: meta?.title, artist: meta?.artist, album: meta?.album, _lb: true });
      if (retryInfo?.url) {
        const buf = await requestAudioBuffer(retryInfo.url);
        const fileType = detectFileType(retryInfo.url);
        const validateErr = validateAudioBuffer(buf, fileType);
        if (!validateErr) {
          const title = meta?.title || '未知歌曲';
          const artist = meta?.artist || '未知歌手';
          const trackMeta: TrackMeta = { title, artist, album: meta?.album };
          const taggedBuffer = await embedMetadata(buf, fileType, trackMeta);
          const ext = fileType === 'flac' ? '.flac' : '.mp3';
          const baseName = filename ? filename.replace(/\.[^.]+$/, '') : `music-${id}`;
          const safeFilename = `${baseName}${ext}`;
          console.log(`[download] 切源兜底成功: ${(buf.length / 1024).toFixed(0)}KB (${fileType})`);
          return respond(taggedBuffer, fileType, safeFilename, !!saveToDisk);
        }
      }
    } catch { /* 切源失败，继续跨平台 */ }

    try {
      const platformMatch = id.match(/^(netease|qq|kugou|kuwo):/);
      const excludePlat = platformMatch?.[1] || '';
      const crossResult = await crossPlatformDownload(
        meta?.title || '',
        meta?.artist || '',
        excludePlat,
        providerName || 'gequbao',
      );
      if (crossResult) {
        const title = meta?.title || '未知歌曲';
        const artist = meta?.artist || '未知歌手';
        const trackMeta: TrackMeta = { title, artist, album: meta?.album };
        const taggedBuffer = await embedMetadata(crossResult.buf, crossResult.type, trackMeta);
        const ext = crossResult.type === 'flac' ? '.flac' : '.mp3';
        const baseName = filename ? filename.replace(/\.[^.]+$/, '') : `music-${id}`;
        const safeFilename = `${baseName}${ext}`;
        console.log(`[download] 跨平台兜底成功: ${(crossResult.buf.length / 1024).toFixed(0)}KB (${crossResult.type})`);
        return respond(taggedBuffer, crossResult.type, safeFilename, !!saveToDisk);
      }
    } catch (crossErr) {
      console.error('Cross-platform fallback also failed:', crossErr);
    }

    console.error("Download error:", error);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
