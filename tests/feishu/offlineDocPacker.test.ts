import { describe, expect, it } from 'vitest';
import { calculateCrc32, createZipArchive } from '../../src/utils/zip/zipPacker';
import {
  extractMarkdownImages,
  extractMarkdownAttachments,
  packageDocWithImagesAsZip,
} from '../../src/utils/feishu/offlineDocPacker';

describe('zipPacker(零依赖标准 ZIP 打包引擎)', () => {
  it('calculateCrc32: 能够正确计算数据的 CRC32 校验和', () => {
    const encoder = new TextEncoder();
    const data = encoder.encode('Hello World');
    const crc = calculateCrc32(data);
    expect(typeof crc).toBe('number');
    expect(crc).toBeGreaterThan(0);
  });

  it('createZipArchive: 成功生成包含文本与二进制文件的 ZIP Blob', () => {
    const encoder = new TextEncoder();
    const mockFiles = [
      { path: 'README.md', data: '# Title\nHello from ZIP' },
      { path: 'images/img_1.png', data: encoder.encode('fake-png-binary-content') },
    ];

    const blob = createZipArchive(mockFiles);
    expect(blob).toBeDefined();
    expect(blob.type).toBe('application/zip');
    expect(blob.size).toBeGreaterThan(50);
  });
});

describe('offlineDocPacker(Markdown 与图片离线打包引擎)', () => {
  it('extractMarkdownImages: 能够准确提取 Markdown 中的所有图片链接与 alt', () => {
    const md = `
# 测试文档
这里有一张架构图：
![系统拓扑图](https://p3-feishu.byteimg.com/tos-cn-i-abc/architecture.png)

还有一张数据流图：
![数据流图](https://p3-feishu.byteimg.com/flow.jpg)
`;

    const images = extractMarkdownImages(md);
    expect(images.length).toBe(2);
    expect(images[0]?.alt).toBe('系统拓扑图');
    expect(images[0]?.url).toBe('https://p3-feishu.byteimg.com/tos-cn-i-abc/architecture.png');
    expect(images[1]?.alt).toBe('数据流图');
  });

  it('extractMarkdownAttachments: 能够准确提取 Markdown 中的附件信息与下载链接', () => {
    const md = `
# 包含附件的文档
📎 **附件**：[进件接口规范.xlsx (2.4 MB)](https://haiercash.feishu.cn/space/api/box/stream/download/abc)
还有一份需求说明书：
[需求说明书.pdf](https://haiercash.feishu.cn/file/def)
`;

    const attachments = extractMarkdownAttachments(md);
    expect(attachments.length).toBe(2);
    expect(attachments[0]?.name).toBe('进件接口规范.xlsx (2.4 MB)');
    expect(attachments[0]?.url).toBe('https://haiercash.feishu.cn/space/api/box/stream/download/abc');
    expect(attachments[1]?.name).toBe('需求说明书.pdf');
  });

  it('packageDocWithImagesAsZip: 能够成功抓取并打包 Base64 图片到 images/ 目录', async () => {
    // 1x1 透明 PNG base64
    const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const md = `# 带图文档\n\n这是插图：\n![透明像素](${sampleBase64})\n\n结束`;

    const res = await packageDocWithImagesAsZip(md, 'Base64测试');
    expect(res.totalImages).toBe(1);
    expect(res.successImages).toBe(1);
    expect(res.zipBlob).toBeDefined();
    expect(res.zipBlob.size).toBeGreaterThan(100);
  });
});
