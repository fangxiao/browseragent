// 飞书/网页长文档离线图片自动抓取与 ZIP 打包引擎 (Offline Doc & Images Packager)
// 1. 嗅探 Markdown 中的所有远程图片 URL
// 2. 自动下载图片并命名为 images/img_1.png ...
// 3. 将 Markdown 内的远程图片链接改写为本地相对路径 images/img_1.png
// 4. 将 .md 文档与 images/ 文件夹打包为标准 .zip 文件供用户离线永久归档

import { createZipArchive, type ZipFileEntry } from '../zip/zipPacker';

export interface ImagePackProgress {
  current: number;
  total: number;
  status: 'scanning' | 'downloading' | 'packaging' | 'done' | 'error';
  errorMessage?: string;
}

/** 智能推导图片文件后缀 */
function getExtensionFromMimeOrUrl(mimeType: string, url: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  if (mimeType.includes('svg')) return 'svg';

  const cleanUrl = url.split('?')[0] || '';
  const match = cleanUrl.match(/\.(png|jpe?g|webp|gif|svg|bmp)$/i);
  if (match && match[1]) {
    return match[1].toLowerCase();
  }
  return 'png';
}

/**
 * 将 Base64 Data URL 转换为 Uint8Array 二进制字节数组
 */
function dataUrlToBytes(dataUrl: string): { data: Uint8Array; ext: string } | null {
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match || !match[2]) return null;
  const rawType = (match[1] || 'png').toLowerCase();
  const ext = rawType.includes('jpeg') || rawType.includes('jpg') ? 'jpg' : rawType.includes('svg') ? 'svg' : rawType.includes('webp') ? 'webp' : rawType.includes('gif') ? 'gif' : 'png';
  const binStr = atob(match[2]);
  const len = binStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return { data: bytes, ext };
}

/**
 * 将图片 URL 转为 ArrayBuffer 二进制数据 (自动利用插件 Bridge 携带 Cookie 凭据抓取)
 */
async function fetchImageBuffer(url: string): Promise<{ data: Uint8Array; ext: string } | null> {
  // 1. 如果本身就是 Base64 Data URL 直接解码
  if (url.startsWith('data:image/')) {
    return dataUrlToBytes(url);
  }

  // 2. 优先通过 Background / Tab 网页上下文 Bridge 进行安全抓取 (100% 携带当前飞书 Cookie 与 Canvas 缓存)
  try {
    if (typeof browser !== 'undefined' && browser.runtime?.sendMessage) {
      const resp = (await browser.runtime.sendMessage({
        type: 'FETCH_IMAGE_BINARY',
        url,
      })) as { ok?: boolean; dataUrl?: string; contentType?: string; error?: string } | undefined;

      if (resp && resp.ok && resp.dataUrl) {
        const decoded = dataUrlToBytes(resp.dataUrl);
        if (decoded) {
          return decoded;
        }
      }
    }
  } catch {
    /* 降级走直接 fetch */
  }

  // 3. 降级方案: 本地直接 fetch
  try {
    const resp = await fetch(url, { credentials: 'include', mode: 'cors' });
    if (!resp.ok) {
      return null;
    }
    const contentType = resp.headers.get('content-type') || '';
    const ext = getExtensionFromMimeOrUrl(contentType, url);
    const arrayBuffer = await resp.arrayBuffer();
    return { data: new Uint8Array(arrayBuffer), ext };
  } catch {
    return null;
  }
}

/**
 * 提取 Markdown 源码中的所有图片信息 (支持 Markdown ![]() 语法与 HTML <img> 标签)
 */
export function extractMarkdownImages(markdown: string): Array<{ raw: string; alt: string; url: string }> {
  const images: Array<{ raw: string; alt: string; url: string }> = [];
  const seenUrls = new Set<string>();

  // 1. 匹配 Markdown 格式: ![alt](url)
  const mdRegex = /!\[(.*?)\]\((.*?)\)/g;
  let match: RegExpExecArray | null;

  while ((match = mdRegex.exec(markdown)) !== null) {
    const raw = match[0]!;
    const alt = (match[1] || 'image').trim();
    const url = (match[2] || '').trim();
    if (url && !seenUrls.has(url)) {
      seenUrls.add(url);
      images.push({ raw, alt, url });
    }
  }

  // 2. 匹配 HTML 格式: <img ... src="..." ... />
  const htmlRegex = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let htmlMatch: RegExpExecArray | null;
  while ((htmlMatch = htmlRegex.exec(markdown)) !== null) {
    const raw = htmlMatch[0]!;
    const url = (htmlMatch[1] || '').trim();
    const altMatch = raw.match(/alt=["']([^"']*)["']/i);
    const alt = (altMatch?.[1] || 'image').trim();
    if (url && !seenUrls.has(url)) {
      seenUrls.add(url);
      images.push({ raw, alt, url });
    }
  }

  return images;
}

export interface AttachmentItem {
  raw: string;
  name: string;
  url: string;
}

/**
 * 提取 Markdown 源码中的所有文件附件信息
 */
export function extractMarkdownAttachments(markdown: string): AttachmentItem[] {
  const attachments: AttachmentItem[] = [];
  const seenUrls = new Set<string>();

  // 1. 匹配 📎 **附件**：[name](url)
  const attachRegex = /📎\s*\*\*附件\*\*：\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = attachRegex.exec(markdown)) !== null) {
    const raw = match[0]!;
    const name = (match[1] || 'attachment').trim();
    const url = (match[2] || '').trim();
    if (url && !seenUrls.has(url)) {
      seenUrls.add(url);
      attachments.push({ raw, name, url });
    }
  }

  // 2. 匹配通用的文档附件格式 [xxx.pdf](url), [xxx.xlsx](url), [xxx.zip](url)
  const fileExtRegex = /\[([^\]]+\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|csv|txt|json|apk|ipa|dmg|pkg)(?:\s*\([^)]+\))?)\]\((https?:\/\/[^\s)]+)\)/gi;
  let extMatch: RegExpExecArray | null;
  while ((extMatch = fileExtRegex.exec(markdown)) !== null) {
    const raw = extMatch[0]!;
    const name = (extMatch[1] || 'file').trim();
    const url = (extMatch[2] || '').trim();
    if (url && !seenUrls.has(url)) {
      seenUrls.add(url);
      attachments.push({ raw, name, url });
    }
  }

  return attachments;
}

/**
 * 一键将 Markdown 文档、关联图片与附件打包为本地标准离线 ZIP 压缩包
 */
export async function packageDocWithImagesAsZip(
  markdown: string,
  docTitle: string,
  onProgress?: (progress: ImagePackProgress) => void,
): Promise<{ zipBlob: Blob; totalImages: number; successImages: number; totalAttachments: number; successAttachments: number }> {
  const images = extractMarkdownImages(markdown);
  const attachments = extractMarkdownAttachments(markdown);
  const totalItems = images.length + attachments.length;
  const cleanTitle = (docTitle || '飞书文档').replace(/[\\/:*?"<>|]/g, '_').slice(0, 35);

  onProgress?.({
    current: 0,
    total: totalItems,
    status: 'scanning',
  });

  const zipEntries: ZipFileEntry[] = [];
  let localizedMarkdown = markdown;
  let successImages = 0;
  let successAttachments = 0;

  // 1. 下载所有图片资源并替换 Markdown 中的远程路径为本地相对路径
  for (let i = 0; i < images.length; i++) {
    const img = images[i]!;
    onProgress?.({
      current: i + 1,
      total: totalItems,
      status: 'downloading',
    });

    const res = await fetchImageBuffer(img.url);
    if (res && res.data.length > 0) {
      const fileName = `img_${i + 1}.${res.ext}`;
      const localRelPath = `images/${fileName}`;

      // 压入 ZIP 目录下的 images/ 子目录
      zipEntries.push({
        path: localRelPath,
        data: res.data,
      });

      // 将 Markdown 中的网络路径替换为本地相对路径
      localizedMarkdown = localizedMarkdown.split(img.raw).join(`![${img.alt}](${localRelPath})`);
      successImages++;
    }
  }

  // 2. 下载所有文件附件并替换 Markdown 中的链接为本地相对路径
  for (let j = 0; j < attachments.length; j++) {
    const att = attachments[j]!;
    onProgress?.({
      current: images.length + j + 1,
      total: totalItems,
      status: 'downloading',
    });

    const res = await fetchImageBuffer(att.url);
    if (res && res.data.length > 0) {
      const safeName = att.name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s*\([^)]*\)$/, '').trim() || `file_${j + 1}`;
      const finalFileName = safeName.includes('.') ? safeName : `${safeName}.${res.ext}`;
      const localRelPath = `attachments/${finalFileName}`;

      zipEntries.push({
        path: localRelPath,
        data: res.data,
      });

      localizedMarkdown = localizedMarkdown.split(att.raw).join(`📎 **附件**：[${att.name}](${localRelPath})`);
      successAttachments++;
    }
  }

  // 3. 将改写后的 Markdown 文件放入 ZIP 根目录
  onProgress?.({
    current: totalItems,
    total: totalItems,
    status: 'packaging',
  });

  zipEntries.push({
    path: `${cleanTitle}.md`,
    data: localizedMarkdown,
  });

  // 4. 打包生成 ZIP
  const zipBlob = createZipArchive(zipEntries);

  onProgress?.({
    current: totalItems,
    total: totalItems,
    status: 'done',
  });

  return {
    zipBlob,
    totalImages: images.length,
    successImages,
    totalAttachments: attachments.length,
    successAttachments,
  };
}

/**
 * 触发浏览器本地直接下载生成的 ZIP 文件
 */
export function triggerZipDownload(blob: Blob, filename: string): void {
  const cleanName = (filename || 'feishu-document').replace(/[\\/:*?"<>|]/g, '_').slice(0, 35);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${cleanName}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
