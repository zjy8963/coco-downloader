/**
 * 音频元数据嵌入模块
 * MP3 → ID3v2 (node-id3)
 * FLAC → Vorbis Comment + Picture (flac-tagger)
 */
import NodeID3 from 'node-id3';
import { FlacStream, VorbisCommentBlock, PictureBlock, MetadataBlockType } from 'flac-tagger';

export interface TrackMeta {
  title: string;
  artist: string;
  album?: string;
  coverBuffer?: Buffer;   // 封面图片二进制
  lyric?: string;         // 歌词全文
}

/** 入口：根据文件类型分发到对应处理器 */
export async function embedMetadata(
  audioBuffer: Buffer,
  fileType: string,
  meta: TrackMeta,
): Promise<Buffer> {
  if (fileType === 'flac') {
    return embedFlac(audioBuffer, meta);
  }
  // 默认走 MP3，其他格式也尝试用 ID3v2
  return embedMp3(audioBuffer, meta);
}

// ── MP3: node-id3 ──

function embedMp3(buf: Buffer, meta: TrackMeta): Buffer {
  const tags: NodeID3.Tags = {
    title: meta.title,
    artist: meta.artist,
    album: meta.album || undefined,
  };

  // 封面图 → APIC 帧
  if (meta.coverBuffer) {
    tags.image = {
      mime: 'image/jpeg',
      type: { id: 3 }, // Front cover
      description: 'cover',
      imageBuffer: meta.coverBuffer,
    };
  }

  // 歌词 → USLT 帧
  if (meta.lyric) {
    tags.unsynchronisedLyrics = {
      language: 'zho',  // 中文
      text: meta.lyric,
    };
  }

  return NodeID3.write(tags, buf);
}

// ── FLAC: flac-tagger ──

function embedFlac(buf: Buffer, meta: TrackMeta): Buffer {
  const stream = FlacStream.fromBuffer(buf);

  // 构建 Vorbis Comment 列表（KEY=VALUE 格式，key 大写）
  const commentList: string[] = [];
  commentList.push(`TITLE=${meta.title}`);
  commentList.push(`ARTIST=${meta.artist}`);
  if (meta.album) commentList.push(`ALBUM=${meta.album}`);
  if (meta.lyric) commentList.push(`LYRICS=${meta.lyric}`);

  // 更新或插入 VorbisCommentBlock
  if (stream.vorbisCommentBlock) {
    stream.vorbisCommentBlock.commentList = commentList;
  } else {
    stream.metadataBlocks.push(new VorbisCommentBlock({ commentList }));
  }

  // 封面图 → PictureBlock
  if (meta.coverBuffer) {
    // 移除旧的 PictureBlock
    if (stream.pictureBlock) {
      stream.metadataBlocks = stream.metadataBlocks.filter(
        b => b !== stream.pictureBlock,
      );
    }
    stream.metadataBlocks.push(
      new PictureBlock({
        pictureBuffer: meta.coverBuffer,
        mime: 'image/jpeg',
        description: 'cover',
      }),
    );
  }

  // 移除 Padding 块（已不需要）
  stream.metadataBlocks = stream.metadataBlocks.filter(
    b => b.type !== MetadataBlockType.Padding,
  );

  return stream.toBuffer();
}
