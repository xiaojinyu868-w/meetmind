// 最小 DOCX 写入器 — 清小搭讲稿附件专用
//
// 仓库无 docx/zip 依赖且不新增 npm 包，这里手写 ZIP 的最小子集：
// local file header + central directory + EOCD，stored（不压缩），CRC32 手算。
// DOCX 本质是 ZIP，只装三个固定条目即可让 Word / WPS 正常打开：
//   [Content_Types].xml / _rels/.rels / word/document.xml
// document.xml 里讲稿按行拆 <w:p><w:r><w:t> 段落，XML 转义 &<>"。

/** CRC32（IEEE 802.3，ZIP 标准多项式 0xEDB88320）查表法。 */
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string; // ASCII 文件名
  data: Buffer;
}

/** 最小 store-only ZIP。条目数 << 65535、单文件 << 4GB，不考虑 ZIP64。 */
export function buildStoreZip(entries: ZipEntry[]): Buffer {
  const bodyChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header 签名
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags：bit 11 = UTF-8 文件名
    local.writeUInt16LE(0, 8); // method：0 = stored
    local.writeUInt16LE(0, 10); // mod time（固定 0，1980-01-01）
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18); // compressed size
    local.writeUInt32LE(entry.data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    bodyChunks.push(local, nameBuf, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory 签名
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // flags
    central.writeUInt16LE(0, 10); // method
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0, 14); // mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    // 30: extra len / 32: comment len / 34: disk / 36: internal attr 均为 0
    // 38: external attr（4 字节）为 0
    central.writeUInt32LE(offset, 42); // local header 偏移
    centralChunks.push(central, nameBuf);

    offset += 30 + nameBuf.length + entry.data.length;
  }

  const centralDir = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD 签名
  // 4: disk 号 / 6: central 起始 disk 均为 0
  eocd.writeUInt16LE(entries.length, 8); // 本盘条目数
  eocd.writeUInt16LE(entries.length, 10); // 总条目数
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16); // central directory 偏移
  // 20: comment length 为 0
  return Buffer.concat([...bodyChunks, centralDir, eocd]);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

/** 讲稿正文 → 最小合法 docx（首段为加粗标题「试讲讲稿 · 生成于 <时间>」）。 */
export function buildSpeechDraftDocx(draft: string, generatedAtLabel: string): Buffer {
  const title = `试讲讲稿 · 生成于 ${generatedAtLabel}`;
  const lines = draft.split(/\r?\n/);
  const paragraphs = [
    `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(title)}</w:t></w:r></w:p>`,
    '<w:p/>',
    ...lines.map((line) =>
      line === ''
        ? '<w:p/>'
        : `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`,
    ),
  ].join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  return buildStoreZip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES_XML, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(RELS_XML, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
  ]);
}
