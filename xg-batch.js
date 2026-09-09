"use strict";

window.ScoreMapXGBatch = (() => {
  const RICH_HEADER_SIZE = 8232;
  const SAVE_REC_SIZE = 2560;
  const ARC_REC_SIZE = 36;
  const FILE_REC_SIZE = 532;
  const RGMH = [0x52, 0x47, 0x4d, 0x48];
  const AXES = ["PC", "C", "2a", "3a", "4a", "5a"];

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function concat(parts) {
    const size = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
  }

  function cloneBytes(bytes) { return new Uint8Array(bytes); }

  function readPascalString(bytes, offset) {
    const len = bytes[offset] || 0;
    let out = "";
    for (let i = 0; i < len; i++) out += String.fromCharCode(bytes[offset + 1 + i]);
    return out;
  }

  function writePascalString(bytes, offset, value) {
    const str = String(value || "");
    const len = Math.min(255, str.length);
    bytes.fill(0, offset, offset + 256);
    bytes[offset] = len;
    for (let i = 0; i < len; i++) bytes[offset + 1 + i] = str.charCodeAt(i) & 0xff;
  }

  function writeWideString(bytes, offset, size, value) {
    bytes.fill(0, offset, offset + size);
    const str = String(value || "");
    const units = Math.min((size >> 1) - 1, str.length);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < units; i++) view.setUint16(offset + i * 2, str.charCodeAt(i), true);
  }

  async function inflateZlib(bytes) {
    if (typeof DecompressionStream === "undefined") throw new Error("このブラウザはXG展開に対応していません。");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function deflateZlib(bytes) {
    if (typeof CompressionStream === "undefined") throw new Error("このブラウザはXG圧縮に対応していません。");
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function isRichPackage(bytes) {
    return bytes.length >= RICH_HEADER_SIZE && RGMH.every((v, i) => bytes[i] === v);
  }

  async function parsePackage(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!isRichPackage(bytes)) throw new Error("XG/XGPの保存ファイルを指定してください。");
    const richView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const thumbSize = richView.getUint32(20, true);
    const prefixSize = RICH_HEADER_SIZE + thumbSize;
    if (prefixSize + ARC_REC_SIZE > bytes.length) throw new Error("XG/XGPファイルが壊れています。");

    const richPrefix = bytes.slice(0, prefixSize);
    const archive = bytes.slice(prefixSize);
    const arcOffset = archive.length - ARC_REC_SIZE;
    const arcView = new DataView(archive.buffer, archive.byteOffset + arcOffset, ARC_REC_SIZE);
    const fileCount = arcView.getInt32(4, true);
    const version = arcView.getInt32(8, true);
    const registrySize = arcView.getInt32(12, true);
    const archiveSize = arcView.getInt32(16, true);
    const compressedRegistry = !!arcView.getUint8(20);
    if (fileCount < 1 || fileCount > 128 || archiveSize < 0 || archiveSize > arcOffset) throw new Error("XG/XGPアーカイブを読み取れません。");

    const registryStored = archive.slice(archiveSize, arcOffset);
    const registry = compressedRegistry ? await inflateZlib(registryStored) : registryStored;
    if (registry.length < fileCount * FILE_REC_SIZE) throw new Error("XG/XGPレジストリを読み取れません。");

    const entries = [];
    for (let i = 0; i < fileCount; i++) {
      const base = i * FILE_REC_SIZE;
      const rv = new DataView(registry.buffer, registry.byteOffset + base, FILE_REC_SIZE);
      const name = readPascalString(registry, base);
      const path = readPascalString(registry, base + 256);
      const osize = rv.getInt32(512, true);
      const csize = rv.getInt32(516, true);
      const start = rv.getInt32(520, true);
      const status = rv.getUint8(528);
      const level = rv.getUint8(529);
      if (start < 0 || csize < 0 || start + csize > archiveSize) throw new Error("XG/XGP内ファイルを読み取れません。");
      const stored = archive.slice(start, start + csize);
      const content = status === 0 ? await inflateZlib(stored) : stored;
      if (osize >= 0 && content.length !== osize) throw new Error(`XG/XGP内ファイル ${name} のサイズが一致しません。`);
      entries.push({name, path, status, level, bytes: content});
    }

    const main = entries.find(e => e.name.toLowerCase() === "temp.xg");
    if (!main) throw new Error("XG/XGP内にtemp.xgがありません。");
    const orientation = readOrientation(main.bytes);
    return {richPrefix, entries, arcMeta:{version, compressedRegistry, registrySize}, orientation};
  }

  function readOrientation(xgBytes) {
    if (xgBytes.length % SAVE_REC_SIZE !== 0) throw new Error("XG本体のレコード形式を読み取れません。");
    for (let off = 0; off < xgBytes.length; off += SAVE_REC_SIZE) {
      const rec = xgBytes.subarray(off, off + SAVE_REC_SIZE);
      if (rec[8] !== 0) continue;
      const view = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
      const invert = view.getInt32(548, true);
      return invert < 0 ? -1 : 1;
    }
    throw new Error("XGのマッチヘッダーがありません。");
  }

  function scoreForAxis(axis) {
    if (axis === "PC" || axis === "C") return 4;
    const away = Number(axis.replace("a", ""));
    return 5 - away;
  }

  function makeVariants() {
    const out = [];
    let seq = 1;
    for (const black of AXES) {
      for (const white of AXES) {
        if ((black === "PC" && white === "C") || (black === "C" && white === "PC")) continue;
        const unlimited = black === "PC" && white === "PC";
        const dmp = black === "C" && white === "C";
        const crawford = !dmp && (black === "C" || white === "C");
        const label = unlimited ? "UNLIMITED" : dmp ? "DMP" : `B-${black}_W-${white}`;
        const filename = `${String(seq).padStart(2, "0")}_${label}.xgp`;
        out.push({seq, black, white, unlimited, dmp, crawford, label, filename});
        seq++;
      }
    }
    return out;
  }

  function setDouble(view, offset, value) { view.setFloat64(offset, Number(value), true); }
  function setFloat(view, offset, value) { view.setFloat32(offset, Number(value), true); }

  function invalidateMove(rec, view) {
    view.setInt32(120, 0, true);          // NMoveEval
    view.setInt32(124 + 64, 0, true);     // EngineStructBestMove.Nmoves
    setDouble(view, 2312, -1000);         // ErrMove
    view.setInt32(2328, -1, true);        // CompChoice
  }

  function invalidateCube(rec, view) {
    const base = 64;
    view.setInt16(base + 56, 0, true);    // FlagDouble
    for (const evalBase of [base + 60, base + 104]) {
      for (let i = 0; i < 6; i++) setFloat(view, evalBase + i * 4, 0);
      setFloat(view, evalBase + 24, -1000);
    }
    setFloat(view, base + 88, -1000);     // equB
    setFloat(view, base + 92, -1000);     // equDouble
    setFloat(view, base + 96, -1000);     // equDrop
    setDouble(view, 200, -1000);          // ErrCube
    setDouble(view, 216, -1000);          // ErrTake
    view.setInt32(224, -1, true);          // RolloutindexD
    view.setInt32(228, -1, true);          // CompChoiceD
    view.setInt32(232, 0, true);           // AnalyzeC
  }

  function patchXgStream(sourceBytes, variant, orientation) {
    const bytes = cloneBytes(sourceBytes);
    if (bytes.length % SAVE_REC_SIZE !== 0) return bytes;
    const matchLength = variant.unlimited ? 99999 : 5;
    const blackScore = variant.unlimited ? 0 : scoreForAxis(variant.black);
    const whiteScore = variant.unlimited ? 0 : scoreForAxis(variant.white);
    const score1 = orientation > 0 ? blackScore : whiteScore;
    const score2 = orientation > 0 ? whiteScore : blackScore;
    const crawfordApply = variant.crawford ? 1 : 0;
    const cubeDead = variant.crawford || variant.dmp;

    for (let off = 0; off < bytes.length; off += SAVE_REC_SIZE) {
      const rec = bytes.subarray(off, off + SAVE_REC_SIZE);
      const view = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
      const type = rec[8];
      if (type === 0) {
        view.setInt32(92, matchLength, true);
        view.setUint8(100, 1); // Crawford rule enabled; ignored by unlimited mode
      } else if (type === 1) {
        view.setInt32(12, score1, true);
        view.setInt32(16, score2, true);
        view.setUint8(20, crawfordApply);
      } else if (type === 2) {
        if (cubeDead) view.setInt32(32, 0, true); // centred cube / cube value 1
        view.setInt32(64 + 32, score1, true);
        view.setInt32(64 + 36, score2, true);
        if (cubeDead) {
          view.setInt32(64 + 40, 0, true);
          view.setInt32(64 + 44, 0, true);
        }
        view.setInt16(64 + 52, crawfordApply, true);
        invalidateCube(rec, view);
      } else if (type === 3) {
        if (cubeDead) view.setInt32(108, 0, true); // CubeA: centred 1-cube
        view.setInt32(124 + 40, score1, true);
        view.setInt32(124 + 44, score2, true);
        if (cubeDead) {
          view.setInt32(124 + 48, 0, true);
          view.setInt32(124 + 52, 0, true);
        }
        view.setInt32(124 + 56, crawfordApply, true);
        invalidateMove(rec, view);
      } else if (type === 4) {
        view.setInt32(12, score1, true);
        view.setInt32(16, score2, true);
        view.setUint8(20, crawfordApply);
      } else if (type === 5) {
        view.setInt32(12, score1, true);
        view.setInt32(16, score2, true);
      }
    }
    return bytes;
  }

  async function buildArchive(entries, arcMeta) {
    const chunks = [];
    const registry = new Uint8Array(entries.length * FILE_REC_SIZE);
    let start = 0;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const raw = entry.bytes;
      const stored = entry.status === 0 ? await deflateZlib(raw) : raw;
      chunks.push(stored);
      const base = i * FILE_REC_SIZE;
      writePascalString(registry, base, entry.name);
      writePascalString(registry, base + 256, entry.path);
      const rv = new DataView(registry.buffer, base, FILE_REC_SIZE);
      rv.setInt32(512, raw.length, true);
      rv.setInt32(516, stored.length, true);
      rv.setInt32(520, start, true);
      rv.setUint32(524, crc32(raw), true);
      rv.setUint8(528, entry.status);
      rv.setUint8(529, entry.level || 0);
      start += stored.length;
    }

    const registryStored = arcMeta.compressedRegistry ? await deflateZlib(registry) : registry;
    const body = concat([...chunks, registryStored]);
    const footer = new Uint8Array(ARC_REC_SIZE);
    const fv = new DataView(footer.buffer);
    fv.setUint32(0, crc32(body), true);
    fv.setInt32(4, entries.length, true);
    fv.setInt32(8, arcMeta.version || 1, true);
    fv.setInt32(12, registryStored.length, true);
    fv.setInt32(16, start, true);
    fv.setUint8(20, arcMeta.compressedRegistry ? 1 : 0);
    return concat([body, footer]);
  }

  async function buildVariant(parsed, variant, title) {
    const prefix = cloneBytes(parsed.richPrefix);
    const saveLabel = String(title || "SCORE MAP").trim();
    const context = variant.unlimited ? "UNLIMITED" : variant.dmp ? "DMP" : `BLACK ${variant.black} / WHITE ${variant.white}`;
    writeWideString(prefix, 2088, 2048, `${saveLabel} / ${context}`);

    const entries = parsed.entries.map(entry => {
      const lower = entry.name.toLowerCase();
      const patchable = (lower.endsWith(".xg") || lower.endsWith(".xgi")) && entry.bytes.length % SAVE_REC_SIZE === 0;
      return {...entry, bytes: patchable ? patchXgStream(entry.bytes, variant, parsed.orientation) : cloneBytes(entry.bytes)};
    });
    const archive = await buildArchive(entries, parsed.arcMeta);
    return concat([prefix, archive]);
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const dosTime = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() >> 1) & 31);
    const dosDate = (((year - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
    return {dosTime, dosDate};
  }

  function encodeUtf8(str) { return new TextEncoder().encode(str); }

  function buildZip(fileList) {
    const locals = [], centrals = [];
    let offset = 0;
    const {dosTime, dosDate} = dosDateTime();
    for (const file of fileList) {
      const name = encodeUtf8(file.name);
      const data = file.bytes;
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      local.set(name, 30);
      locals.push(local, data);

      const central = new Uint8Array(46 + name.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      central.set(name, 46);
      centrals.push(central);
      offset += local.length + data.length;
    }

    const centralData = concat(centrals);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, fileList.length, true);
    ev.setUint16(10, fileList.length, true);
    ev.setUint32(12, centralData.length, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);
    return concat([...locals, centralData, end]);
  }

  async function generateBatch(input, options = {}) {
    const parsed = await parsePackage(input);
    const variants = makeVariants();
    if (variants.length !== 34) throw new Error("34条件の生成に失敗しました。");
    const files = [];
    for (const variant of variants) {
      const bytes = await buildVariant(parsed, variant, options.title || "");
      files.push({name: variant.filename, bytes, variant});
    }
    return {zip: buildZip(files), files};
  }

  return {generateBatch, makeVariants};
})();
