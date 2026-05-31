import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { Readable } from "stream";
import { getProvider } from "@/lib/providers";
import { embedMetadata, TrackMeta } from "@/lib/metadata";

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
    
    const safeFilename = filename 
      ? encodeURIComponent(filename).replace(/%20/g, '+')
      : `music-${id}.mp3`;
      
    headers.set("Content-Disposition", `attachment; filename="${safeFilename}"; filename*=UTF-8''${safeFilename}`);

    return new NextResponse(stream, {
      status: 200,
      headers,
    });

  } catch (error) {
    console.error("Download error:", error);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}

/** POST: 带元数据嵌入的下载 */
export async function POST(request: NextRequest) {
  let body: {
    id: string;
    provider?: string;
    filename?: string;
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

  const { id, provider: providerName, filename, meta } = body;
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

    // 2. 下载完整音频到 Buffer
    const audioBuffer = await requestAudioBuffer(playUrl);

    // 3. 构造元数据
    const trackMeta: TrackMeta = {
      title: meta?.title || "未知歌曲",
      artist: meta?.artist || "未知歌手",
      album: meta?.album,
      lyric: meta?.lyric,
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
    const safeFilename = encodeURIComponent(baseName + ext).replace(/%20/g, "+");

    return new NextResponse(new Uint8Array(taggedBuffer), {
      status: 200,
      headers: {
        "Content-Type": playType === "flac" ? "audio/flac" : "audio/mpeg",
        "Content-Length": String(taggedBuffer.length),
        "Content-Disposition": `attachment; filename="${safeFilename}"; filename*=UTF-8''${safeFilename}`,
      },
    });

  } catch (error) {
    console.error("Download error:", error);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
