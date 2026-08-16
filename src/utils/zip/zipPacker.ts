// 纯 TypeScript 零依赖极速 ZIP 打包引擎 (ZIP File Packager)
// 遵循 PKWare ZIP 文件格式规范 (PK0304 / PK0102 / PK0506)
// 支持将 Markdown 文本与多张远程/本地图片文件直接打包为跨平台兼容的标准 .zip 归档文件

export interface ZipFileEntry {
  path: string; // 例如: "document.md" 或 "images/img_1.png"
  data: Uint8Array | string;
}

// CRC32 快速查找表
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c;
}

/** 计算二进制数据的 CRC32 校验和 */
export function calculateCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 将当前时间转化为 MS-DOS 格式的日期和时间 */
function getDosDateTime(date = new Date()): { dosTime: number; dosDate: number } {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

/** 将 Uint8Array 数组合并为一个完整的 Uint8Array */
function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, a) => acc + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * 将传入的文件列表打包为标准 ZIP Blob
 */
export function createZipArchive(files: ZipFileEntry[]): Blob {
  const encoder = new TextEncoder();
  const { dosTime, dosDate } = getDosDateTime();

  const localFileChunks: Uint8Array[] = [];
  const centralDirChunks: Uint8Array[] = [];

  // 确保所有父级目录 (如 "images/") 都有显式的 ZIP 目录条目
  const processedFiles: ZipFileEntry[] = [];
  const addedDirs = new Set<string>();

  for (const file of files) {
    const cleanPath = file.path.replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = cleanPath.split('/');
    if (parts.length > 1) {
      let currentDir = '';
      for (let i = 0; i < parts.length - 1; i++) {
        currentDir += `${parts[i]}/`;
        if (!addedDirs.has(currentDir)) {
          addedDirs.add(currentDir);
          processedFiles.push({
            path: currentDir,
            data: new Uint8Array(0),
          });
        }
      }
    }
    processedFiles.push({ ...file, path: cleanPath });
  }

  let offset = 0;

  for (const file of processedFiles) {
    const isDirectory = file.path.endsWith('/');
    const filenameBytes = encoder.encode(file.path);
    const fileDataBytes = isDirectory
      ? new Uint8Array(0)
      : typeof file.data === 'string'
      ? encoder.encode(file.data)
      : file.data;

    const crc = isDirectory ? 0 : calculateCrc32(fileDataBytes);
    const uncompressedSize = fileDataBytes.length;
    const compressedSize = uncompressedSize; // 存储模式 (Store)

    // 1. Local File Header (30 字节 + 文件名长度)
    const localHeader = new Uint8Array(30 + filenameBytes.length);
    const localView = new DataView(localHeader.buffer);

    localView.setUint32(0, 0x04034b50, true); // Local header signature: PK\x03\x04
    localView.setUint16(4, 20, true); // Version needed: 2.0
    localView.setUint16(6, 0x0800, true); // General purpose flag: bit 11 (UTF-8)
    localView.setUint16(8, 0, true); // Compression method: 0 (Store)
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, compressedSize, true);
    localView.setUint32(22, uncompressedSize, true);
    localView.setUint16(26, filenameBytes.length, true);
    localView.setUint16(28, 0, true); // Extra field length

    localHeader.set(filenameBytes, 30);

    localFileChunks.push(localHeader);
    if (fileDataBytes.length > 0) {
      localFileChunks.push(fileDataBytes);
    }

    // 2. Central Directory Header (46 字节 + 文件名长度)
    const centralHeader = new Uint8Array(46 + filenameBytes.length);
    const centralView = new DataView(centralHeader.buffer);

    // 外部属性: 目录为 0x41ed0010 (drwxr-xr-x + 目录位), 普通文件为 0x81a40020 (-rw-r--r-- + 归档位)
    const externalAttributes = isDirectory ? 0x41ed0010 : 0x81a40020;

    centralView.setUint32(0, 0x02014b50, true); // Central header signature: PK\x01\x02
    centralView.setUint16(4, 0x0314, true); // Version made by: 3.20 (Unix 3 + Spec 2.0)
    centralView.setUint16(6, 20, true); // Version needed: 2.0
    centralView.setUint16(8, 0x0800, true); // UTF-8
    centralView.setUint16(10, 0, true); // Store
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, compressedSize, true);
    centralView.setUint32(24, uncompressedSize, true);
    centralView.setUint16(28, filenameBytes.length, true);
    centralView.setUint16(30, 0, true); // Extra field
    centralView.setUint16(32, 0, true); // Comment length
    centralView.setUint16(34, 0, true); // Disk number start
    centralView.setUint16(36, 0, true); // Internal attributes
    centralView.setUint32(38, externalAttributes, true); // External attributes
    centralView.setUint32(42, offset, true); // Relative offset of local header

    centralHeader.set(filenameBytes, 46);
    centralDirChunks.push(centralHeader);

    offset += localHeader.length + fileDataBytes.length;
  }

  const centralDirBytes = concatUint8Arrays(centralDirChunks);
  const centralDirSize = centralDirBytes.length;
  const centralDirOffset = offset;

  // 3. End of Central Directory Record (22 字节)
  const eocdHeader = new Uint8Array(22);
  const eocdView = new DataView(eocdHeader.buffer);

  eocdView.setUint32(0, 0x06054b50, true); // EOCD signature: PK\x05\x06
  eocdView.setUint16(4, 0, true); // Number of this disk
  eocdView.setUint16(6, 0, true); // Disk where central directory starts
  eocdView.setUint16(8, processedFiles.length, true); // Entries on this disk
  eocdView.setUint16(10, processedFiles.length, true); // Total entries
  eocdView.setUint32(12, centralDirSize, true); // Size of central directory
  eocdView.setUint32(16, centralDirOffset, true); // Offset of central directory
  eocdView.setUint16(20, 0, true); // Comment length

  const allChunks = [...localFileChunks, centralDirBytes, eocdHeader];
  return new Blob(allChunks as any[], { type: 'application/zip' });
}
