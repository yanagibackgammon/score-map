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
        const filename = `${String(seq).padStart(2, "0")}_${label}.xg`;
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



  function parseXgid(value) {
    const raw = String(value || "").trim().replace(/^XGID\s*=\s*/i, "");
    const parts = raw.split(":");
    if (parts.length !== 10) throw new Error("XGIDの形式が正しくありません。");
    const [positionText,cubeText,cubePosText,turnText,diceText,playerScoreText,oppScoreText,rulesText,matchLengthText,maxCubeText] = parts;
    if (!/^[\-A-Oa-o]{26}$/.test(positionText)) throw new Error("XGIDのポジション部分を読み取れません。");
    const bottomPoints = Array.from(positionText, ch => {
      if (ch === "-") return 0;
      if (ch >= "A" && ch <= "O") return ch.charCodeAt(0) - 64;
      return -(ch.charCodeAt(0) - 96);
    });
    const cubeExp = Number(cubeText), cubePosBottom = Number(cubePosText), turn = Number(turnText);
    const scoreBottom = Number(playerScoreText), scoreTop = Number(oppScoreText), rules = Number(rulesText), matchLength = Number(matchLengthText), maxCube = Number(maxCubeText);
    if (![cubeExp,cubePosBottom,turn,scoreBottom,scoreTop,rules,matchLength,maxCube].every(Number.isFinite)) throw new Error("XGIDの数値項目を読み取れません。");
    if (![ -1, 0, 1 ].includes(cubePosBottom) || ![-1,1].includes(turn)) throw new Error("XGIDのキューブまたは手番情報が不正です。");
    if (!/^([0-6][0-6])$/.test(diceText)) throw new Error("XGIDの出目を読み取れません。現在は00または通常の出目に対応しています。");
    const dice = [Number(diceText[0]), Number(diceText[1])];
    if ((dice[0]===0)!==(dice[1]===0)) throw new Error("XGIDの出目は00または1〜6の組合せにしてください。");
    const points = turn===1 ? bottomPoints : bottomPoints.slice().reverse().map(v=>-v);
    const cubePos = cubePosBottom * turn;
    const playerScore = turn===1 ? scoreBottom : scoreTop;
    const oppScore = turn===1 ? scoreTop : scoreBottom;
    return {raw:`XGID=${raw}`,rawBody:raw,positionText,cubeExp,cubePosBottom,cubePos,turn,dice,diceText,playerScore,oppScore,rules,matchLength,maxCube};
  }

  function writePosition(bytes, offset, points) {
    for (let i=0;i<26;i++) bytes[offset+i] = points[i] & 0xff;
  }

  function cloneBoard(board){ return board.slice(); }
  function canBearOff(board){
    if (board[25] > 0) return false;
    for (let i=7;i<=24;i++) if (board[i] > 0) return false;
    return true;
  }
  function singleDieMoves(board, die){
    const moves=[];
    const sources=[];
    if (board[25] > 0) sources.push(24);
    else for (let from=23;from>=0;from--) if (board[from+1] > 0) sources.push(from);
    for (const from of sources){
      const dest=from-die;
      if (dest>=0){
        if (board[dest+1] <= -2) continue;
      } else {
        if (!canBearOff(board)) continue;
        const exact=(from+1===die);
        let oversize=false;
        if (die>from+1){
          oversize=true;
          for (let p=from+1;p<=5;p++) if (board[p+1] > 0){oversize=false;break;}
        }
        if (!exact && !oversize) continue;
      }
      const next=cloneBoard(board);
      const srcIndex=from===24?25:from+1;
      next[srcIndex]-=1;
      if (dest>=0){
        const dst=dest+1;
        if (next[dst]===-1){next[dst]=1;next[0]-=1;} else next[dst]+=1;
      }
      moves.push({from,to:dest,die,board:next});
    }
    return moves;
  }
  function legalSequence(points,dice){
    if (!dice[0] || !dice[1]) return {moves:[],board:points.slice()};
    const orders=dice[0]===dice[1] ? [[dice[0],dice[0],dice[0],dice[0]]] : [[dice[0],dice[1]],[dice[1],dice[0]]];
    const candidates=[];
    function walk(board,order,index,moves){
      if(index>=order.length){candidates.push({moves:moves.slice(),board:board.slice()});return;}
      const options=singleDieMoves(board,order[index]);
      if(!options.length){walk(board,order,index+1,moves);return;}
      for(const option of options){moves.push({from:option.from,to:option.to,die:option.die});walk(option.board,order,index+1,moves);moves.pop();}
    }
    for(const order of orders)walk(points.slice(),order,0,[]);
    if(!candidates.length)return {moves:[],board:points.slice()};
    let max=Math.max(...candidates.map(c=>c.moves.length));
    let best=candidates.filter(c=>c.moves.length===max);
    if(max===1 && dice[0]!==dice[1]){
      const hi=Math.max(...dice);const high=best.filter(c=>c.moves[0]?.die===hi);if(high.length)best=high;
    }
    return best[0];
  }

  function patchSourceMatchHeader(rec,xgid){
    const out=cloneBytes(rec),view=new DataView(out.buffer,out.byteOffset,out.byteLength);
    view.setInt32(92,xgid.matchLength||5,true);
    view.setUint8(100,1);
    if(Number.isFinite(xgid.maxCube))view.setInt32(612,xgid.maxCube,true);
    return out;
  }
  function patchSourceGameHeader(rec,xgid){
    const out=cloneBytes(rec),view=new DataView(out.buffer,out.byteOffset,out.byteLength);
    view.setInt32(12,xgid.playerScore,true);view.setInt32(16,xgid.oppScore,true);
    view.setUint8(20,(xgid.matchLength>0&&xgid.rules===1)?1:0);
    writePosition(out,21,xgid.points);view.setUint8(52,1);
    return out;
  }
  function makeSourceMove(template,xgid){
    const out=cloneBytes(template),view=new DataView(out.buffer,out.byteOffset,out.byteLength);
    out[8]=3;writePosition(out,9,xgid.points);
    const played=legalSequence(xgid.points,xgid.dice);writePosition(out,35,played.board);
    view.setInt32(64,1,true);
    for(let i=0;i<8;i++)view.setInt32(68+i*4,-1,true);
    played.moves.slice(0,4).forEach((m,i)=>{view.setInt32(68+i*8,m.from,true);view.setInt32(72+i*8,m.to,true);});
    view.setInt32(100,xgid.dice[0],true);view.setInt32(104,xgid.dice[1],true);
    view.setInt32(108,xgid.cubePos*xgid.cubeExp,true);
    writePosition(out,124,xgid.points);
    view.setInt32(124+40,xgid.playerScore,true);view.setInt32(124+44,xgid.oppScore,true);
    view.setInt32(124+48,xgid.cubeExp,true);view.setInt32(124+52,xgid.cubePos,true);
    view.setInt32(124+56,(xgid.matchLength>0&&xgid.rules===1)?1:0,true);
    invalidateMove(out,view);setDouble(view,2320,-1000);
    return out;
  }
  function makeSourceCube(template,xgid){
    const out=cloneBytes(template),view=new DataView(out.buffer,out.byteOffset,out.byteLength),dd=64;
    out[8]=2;view.setInt32(12,Number.isFinite(xgid.active)?xgid.active:1,true);view.setInt32(16,0,true);view.setInt32(20,0,true);view.setInt32(24,0,true);
    view.setInt32(32,xgid.cubePos*xgid.cubeExp,true);writePosition(out,36,xgid.points);writePosition(out,dd,xgid.points);
    view.setInt32(dd+32,xgid.playerScore,true);view.setInt32(dd+36,xgid.oppScore,true);
    view.setInt32(dd+40,xgid.cubeExp,true);view.setInt32(dd+44,xgid.cubePos,true);
    view.setInt32(dd+48,xgid.matchLength===0&&xgid.rules&1?1:0,true);view.setInt16(dd+52,(xgid.matchLength>0&&xgid.rules===1)?1:0,true);
    invalidateCube(out,view);return out;
  }

  async function parsedFromXgid(value){
    const xgid=parseXgid(value);
    let response;
    try{response=await fetch("assets/xgid-template.xgp?v=18",{cache:"no-store"});}catch{throw new Error("XGID用テンプレートを読み込めません。");}
    if(!response.ok)throw new Error("XGID用テンプレートを読み込めません。");
    const parsed=await parsePackage(await response.arrayBuffer());
    const tempXg=parsed.entries.find(e=>e.name.toLowerCase()==="temp.xg");
    const tempXgi=parsed.entries.find(e=>e.name.toLowerCase()==="temp.xgi");
    if(!tempXg||tempXg.bytes.length<3*SAVE_REC_SIZE||!tempXgi||tempXgi.bytes.length<2*SAVE_REC_SIZE)throw new Error("XGID用テンプレートが不正です。");
    const matchHeader=patchSourceMatchHeader(tempXg.bytes.slice(0,SAVE_REC_SIZE),xgid);
    const gameHeader=patchSourceGameHeader(tempXg.bytes.slice(SAVE_REC_SIZE,2*SAVE_REC_SIZE),xgid);
    const cubeTemplate=tempXg.bytes.slice(2*SAVE_REC_SIZE,3*SAVE_REC_SIZE);
    const moveTemplate=tempXgi.bytes.slice(SAVE_REC_SIZE,2*SAVE_REC_SIZE);
    const event=xgid.diceText==="00"?makeSourceCube(cubeTemplate,xgid):makeSourceMove(moveTemplate,xgid);
    parsed.entries=parsed.entries.map(entry=>{
      const lower=entry.name.toLowerCase();
      if(lower==="temp.xg")return {...entry,bytes:concat([matchHeader,gameHeader,event])};
      if(lower==="temp.xgi")return {...entry,bytes:concat([matchHeader,event])};
      return {...entry,bytes:cloneBytes(entry.bytes)};
    });
    parsed.orientation=1;
    return parsed;
  }

  function firstRecord(bytes, type) {
    if (!bytes || bytes.length % SAVE_REC_SIZE !== 0) return null;
    for (let off=0; off<bytes.length; off+=SAVE_REC_SIZE) {
      if (bytes[off+8]===type) return bytes.slice(off,off+SAVE_REC_SIZE);
    }
    return null;
  }

  async function loadFooterTemplates(){
    let response;
    try{response=await fetch("assets/xg-footer-template.bin?v=18",{cache:"no-store"});}
    catch{throw new Error("XG match用テンプレートを読み込めません。");}
    if(!response.ok)throw new Error("XG match用テンプレートを読み込めません。");
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length!==SAVE_REC_SIZE*2||bytes[8]!==4||bytes[SAVE_REC_SIZE+8]!==5)throw new Error("XG match用テンプレートが不正です。");
    return {gameFooter:bytes.slice(0,SAVE_REC_SIZE),matchFooter:bytes.slice(SAVE_REC_SIZE)};
  }

  function sourceRecords(parsed){
    const main=parsed.entries.find(e=>e.name.toLowerCase()==="temp.xg");
    if(!main)throw new Error("XG/XGP内にtemp.xgがありません。");
    const matchHeader=firstRecord(main.bytes,0);
    const gameHeader=firstRecord(main.bytes,1);
    const event=firstRecord(main.bytes,3)||firstRecord(main.bytes,2);
    if(!matchHeader||!gameHeader||!event)throw new Error("元ポジションの局面を読み取れません。XGPまたは1局面を含むXGを指定してください。");
    return {matchHeader,gameHeader,event,eventType:event[8]};
  }

  function patchedRecords(base,variant,orientation,gameNumber){
    const patched=patchXgStream(concat([base.matchHeader,base.gameHeader,base.event]),variant,orientation);
    const matchHeader=patched.slice(0,SAVE_REC_SIZE);
    const gameHeader=patched.slice(SAVE_REC_SIZE,SAVE_REC_SIZE*2);
    const event=patched.slice(SAVE_REC_SIZE*2,SAVE_REC_SIZE*3);
    const gv=new DataView(gameHeader.buffer,gameHeader.byteOffset,gameHeader.byteLength);
    gv.setInt32(48,gameNumber,true);
    gv.setUint8(52,0);
    return {matchHeader,gameHeader,event};
  }

  function makeNeutralGameFooter(template,variant,orientation){
    const out=patchXgStream(template,variant,orientation);
    const view=new DataView(out.buffer,out.byteOffset,out.byteLength);
    view.setInt32(24,0,true);      // winner
    view.setInt32(28,0,true);      // points won
    view.setInt32(32,1000,true);   // settle / neutral footer
    setDouble(view,40,-1000);
    setDouble(view,48,-1000);
    view.setInt32(112,-1,true);
    return out;
  }

  function makeNeutralMatchFooter(template){
    const out=cloneBytes(template),view=new DataView(out.buffer,out.byteOffset,out.byteLength);
    view.setInt32(12,0,true);view.setInt32(16,0,true);view.setInt32(20,0,true);
    return out;
  }

  async function buildPackageFromStream(parsed,stream,saveName,currentEvent){
    const prefix=cloneBytes(parsed.richPrefix);
    writeWideString(prefix,2088,2048,saveName);
    const entries=parsed.entries.map(entry=>{
      const lower=entry.name.toLowerCase();
      if(lower==="temp.xg")return {...entry,bytes:stream};
      if(lower==="temp.xgi")return {...entry,bytes:currentEvent||entry.bytes.slice(0,Math.min(entry.bytes.length,SAVE_REC_SIZE*2))};
      return {...entry,bytes:cloneBytes(entry.bytes)};
    });
    return concat([prefix,await buildArchive(entries,parsed.arcMeta)]);
  }

  let cubeTemplatePromise=null;
  async function loadCubeRecordTemplate(){
    if(cubeTemplatePromise)return cubeTemplatePromise;
    cubeTemplatePromise=(async()=>{
      let response;
      try{response=await fetch("assets/xgid-template.xgp?v=18",{cache:"no-store"});}
      catch{throw new Error("Cube Action用テンプレートを読み込めません。");}
      if(!response.ok)throw new Error("Cube Action用テンプレートを読み込めません。");
      const parsed=await parsePackage(await response.arrayBuffer());
      const main=parsed.entries.find(e=>e.name.toLowerCase()==="temp.xg");
      const rec=main?firstRecord(main.bytes,2):null;
      if(!rec)throw new Error("Cube Action用テンプレートが不正です。");
      return rec;
    })();
    return cubeTemplatePromise;
  }

  function sourceCubeState(base){
    const event=base.event,view=new DataView(event.buffer,event.byteOffset,event.byteLength);
    if(base.eventType===2){
      const cubeB=view.getInt32(32,true);
      return {
        points:readPosition(event,36),
        cubeExp:Math.abs(cubeB),
        cubePos:cubeB===0?0:(cubeB>0?1:-1),
        active:view.getInt32(12,true)||1
      };
    }
    if(base.eventType===3){
      const cubeA=view.getInt32(108,true);
      return {
        points:readPosition(event,9),
        cubeExp:Math.abs(cubeA),
        cubePos:cubeA===0?0:(cubeA>0?1:-1),
        active:view.getInt32(64,true)||1
      };
    }
    throw new Error("元ポジションからCube Actionを作成できません。");
  }

  async function cubeBaseRecords(parsed){
    const base=sourceRecords(parsed);
    if(base.eventType===2){
      const event=cloneBytes(base.event);
      const view=new DataView(event.buffer,event.byteOffset,event.byteLength);
      invalidateCube(event,view);
      return {...base,event,eventType:2};
    }
    const state=sourceCubeState(base);
    const template=await loadCubeRecordTemplate();
    const mhv=new DataView(base.matchHeader.buffer,base.matchHeader.byteOffset,base.matchHeader.byteLength);
    const ghv=new DataView(base.gameHeader.buffer,base.gameHeader.byteOffset,base.gameHeader.byteLength);
    const event=makeSourceCube(template,{
      ...state,
      playerScore:ghv.getInt32(12,true),
      oppScore:ghv.getInt32(16,true),
      matchLength:mhv.getInt32(92,true),
      rules:ghv.getUint8(20)?1:0
    });
    return {...base,event,eventType:2};
  }

  async function buildSingleCubePackage(parsed,templates,base,variant){
    const patched=patchedRecords(base,variant,parsed.orientation,1);
    if(patched.event[8]!==2)throw new Error(`${variant.label}: Cube Actionレコードの生成に失敗しました。`);
    const stream=concat([
      patched.matchHeader,
      patched.gameHeader,
      patched.event,
      makeNeutralGameFooter(templates.gameFooter,variant,parsed.orientation),
      makeNeutralMatchFooter(templates.matchFooter)
    ]);
    return buildPackageFromStream(parsed,stream,`SCORE MAP / ${variant.label}`,concat([patched.matchHeader,patched.event]));
  }

  async function validateCubePackage(bytes,expectedVariant){
    const parsed=await parsePackage(bytes);
    const main=parsed.entries.find(e=>e.name.toLowerCase()==="temp.xg");
    if(!main||main.bytes.length%SAVE_REC_SIZE!==0)throw new Error(`${expectedVariant.label}: XG本体を検証できません。`);
    let cubeCount=0,moveCount=0;
    for(let off=0;off<main.bytes.length;off+=SAVE_REC_SIZE){
      if(main.bytes[off+8]===2)cubeCount++;
      if(main.bytes[off+8]===3)moveCount++;
    }
    if(cubeCount!==1||moveCount!==0)throw new Error(`${expectedVariant.label}: ダブルアクション用XGとして生成できませんでした。`);
    const actual=identifyVariantFromStream(main.bytes);
    if(variantKey(actual)!==variantKey(expectedVariant))throw new Error(`${expectedVariant.label}: スコア条件の検証に失敗しました。`);
  }

  async function generateBatch(input, options = {}) {
    const parsed = typeof input === "string" ? await parsedFromXgid(input) : await parsePackage(input);
    const templates=await loadFooterTemplates();
    const base=await cubeBaseRecords(parsed);
    const variants=makeVariants();
    const files=[];
    for(const variant of variants){
      const bytes=await buildSingleCubePackage(parsed,templates,base,variant);
      await validateCubePackage(bytes,variant);
      files.push({name:variant.filename,bytes});
    }
    if(files.length!==34)throw new Error(`解析用XGの生成数が34ではありません: ${files.length}`);
    return {zip:buildZip(files),files};
  }


  function readWideString(bytes, offset, size) {
    const end = Math.min(bytes.length, offset + size);
    let out = "";
    for (let i = offset; i + 1 < end; i += 2) {
      const code = bytes[i] | (bytes[i + 1] << 8);
      if (!code) break;
      out += String.fromCharCode(code);
    }
    return out;
  }

  function i8(bytes, offset) { const v = bytes[offset]; return v > 127 ? v - 256 : v; }
  function readPosition(rec, offset) { return Array.from({length:26}, (_,i)=>i8(rec, offset+i)); }
  function readInt8Moves(rec, offset) {
    const moves=[];
    for(let i=0;i<8;i+=2){
      const from=i8(rec,offset+i); if(from===-1)break;
      const to=i8(rec,offset+i+1); moves.push({fromPoint:from,toPoint:to});
    }
    return moves;
  }
  function pointName(point){if(point<0)return "Off";if(point===24)return "Bar";return String(point+1)}
  function applyMoveSegments(moves, position){
    const board=position.slice(); const rendered=[];
    for(const move of moves){
      const from=move.fromPoint,to=move.toPoint,src=from+1;
      if(src>=1&&src<=25)board[src]-=1;
      let hit=false;
      if(to>=0){const dst=to+1;if(dst>=1&&dst<=24){hit=board[dst]===-1;if(hit){board[dst]=1;board[0]-=1}else board[dst]+=1}}
      rendered.push([from,to,hit]);
    }
    return {board,rendered};
  }
  function collapseMoves(rendered){
    if(rendered.length<2)return rendered.slice();
    const incoming=new Map(),outgoing=new Map();
    rendered.forEach(([from,to],idx)=>{if(!outgoing.has(from))outgoing.set(from,[]);outgoing.get(from).push(idx);if(to>=0){if(!incoming.has(to))incoming.set(to,[]);incoming.get(to).push(idx)}});
    const pred=new Map(),succ=new Map();
    for(const [point,ins] of incoming){const outs=outgoing.get(point)||[];if(ins.length===1&&outs.length===1&&!rendered[ins[0]][2]){succ.set(ins[0],outs[0]);pred.set(outs[0],ins[0])}}
    const result=[],visited=new Set(),starts=rendered.map((_,i)=>i).filter(i=>!pred.has(i));
    for(const start of starts){if(visited.has(start))continue;let from=rendered[start][0],cur=start,finalTo=rendered[cur][1],finalHit=rendered[cur][2];visited.add(cur);while(succ.has(cur)){const next=succ.get(cur);if(visited.has(next))break;cur=next;finalTo=rendered[cur][1];finalHit=rendered[cur][2];visited.add(cur)}result.push([from,finalTo,finalHit])}
    rendered.forEach((edge,i)=>{if(!visited.has(i))result.push(edge)}); return result;
  }
  function formatMoves(moves,position){
    if(!moves.length)return "Cannot Move";
    const rendered=collapseMoves(applyMoveSegments(moves,position).rendered);
    rendered.sort((a,b)=>(b[0]-a[0])||(b[1]-a[1]));
    const labels=rendered.map(([from,to,hit])=>`${pointName(from)}/${pointName(to)}${hit?'*':''}`);
    const grouped=[];
    for(const label of labels){const last=grouped[grouped.length-1];if(last&&last.label===label)last.count++;else grouped.push({label,count:1})}
    return grouped.map(x=>x.count>1?`${x.label}(${x.count})`:x.label).join(' ');
  }
  function round6(v){return Number(Number(v).toFixed(6))}
  const LEVEL_NAMES={0:"1-ply",1:"2-ply",2:"3-ply",12:"3-ply red",3:"4-ply",4:"5-ply",5:"6-ply",6:"7-ply",100:"Rollout",998:"Opening Book V2",999:"Opening Book V1",1000:"XGRoller",1001:"XGRoller+",1002:"XGRoller++"};

  function parseMoveAnalysis(rec){
    const view=new DataView(rec.buffer,rec.byteOffset,rec.byteLength);
    const position=readPosition(rec,9);
    const dice=[view.getInt32(100,true),view.getInt32(104,true)];
    const cubeA=view.getInt32(108,true);
    const n=view.getInt32(120,true);
    if(n<=0||n>32)return null;
    const candidates=[]; const base=124, movesBase=base+900, levelBase=base+1156, evalBase=base+1284;
    for(let i=0;i<Math.min(n,32);i++){
      const moves=readInt8Moves(rec,movesBase+i*8);
      const eo=evalBase+i*28;
      const equity=view.getFloat32(eo+24,true);
      if(!Number.isFinite(equity)||equity<=-999)continue;
      const level=view.getInt16(levelBase+i*4,true);
      candidates.push({move:formatMoves(moves,position),equity:round6(equity),level,analysisLevel:LEVEL_NAMES[level]||String(level)});
    }
    if(!candidates.length)return null;
    const bestEq=candidates[0].equity;
    candidates.forEach(c=>c.diff=round6(bestEq-c.equity));
    return {type:"move",best:candidates[0].move,equity:bestEq,candidates,position,dice,cubeA};
  }

  function parseCubeAnalysis(rec){
    const view=new DataView(rec.buffer,rec.byteOffset,rec.byteLength),dd=64;
    const position=readPosition(rec,36),cubeB=view.getInt32(32,true);
    const equNo=view.getFloat32(dd+88,true),equTake=view.getFloat32(dd+92,true),equDrop=view.getFloat32(dd+96,true);
    if([equNo,equTake,equDrop].some(v=>!Number.isFinite(v)||v<=-999))return null;
    const doubleEquity=Math.min(equTake,equDrop);
    let best,equity;
    if(doubleEquity>equNo){best=equTake<=equDrop?"Double / Take":"Double / Pass";equity=doubleEquity}else{best="No Double";equity=equNo}
    const level=view.getInt16(dd+100,true);
    return {type:"cube",best,equity:round6(equity),candidates:[
      {move:"No Double",equity:round6(equNo),diff:round6(equity-equNo),analysisLevel:LEVEL_NAMES[level]||String(level)},
      {move:"Double / Take",equity:round6(equTake),diff:round6(equity-equTake),analysisLevel:LEVEL_NAMES[level]||String(level)},
      {move:"Double / Pass",equity:round6(equDrop),diff:round6(equity-equDrop),analysisLevel:LEVEL_NAMES[level]||String(level)}
    ],position,dice:[],cubeA:cubeB};
  }

  function variantKey(variant){
    if(variant.unlimited)return "unlimited";
    if(variant.dmp)return "dmp";
    const norm=x=>x==="PC"?"pc":x==="C"?"c":x.replace("a","");
    return `${norm(variant.black)}-${norm(variant.white)}`;
  }

  function variantFromGame(matchLength,score1,score2,crawford,orientation){
    if(matchLength===99999||matchLength===0)return makeVariants().find(v=>v.unlimited);
    const blackScore=orientation>0?score1:score2;
    const whiteScore=orientation>0?score2:score1;
    if(blackScore===4&&whiteScore===4&&!crawford)return makeVariants().find(v=>v.dmp);
    const axis=(score)=>{
      if(score===4)return crawford?"C":"PC";
      const away=5-score;
      return `${away}a`;
    };
    const black=axis(blackScore),white=axis(whiteScore);
    return makeVariants().find(v=>!v.unlimited&&!v.dmp&&v.black===black&&v.white===white)||null;
  }

  function parseAnalyzedStreamMany(bytes){
    if(bytes.length%SAVE_REC_SIZE!==0)throw new Error("XG本体のレコード形式を読み取れません。");
    let matchLength=5,orientation=1,current=null;
    const results=[];
    for(let off=0;off<bytes.length;off+=SAVE_REC_SIZE){
      const rec=bytes.subarray(off,off+SAVE_REC_SIZE),type=rec[8],view=new DataView(rec.buffer,rec.byteOffset,rec.byteLength);
      if(type===0){matchLength=view.getInt32(92,true);orientation=view.getInt32(548,true)<0?-1:1;}
      else if(type===1){current={score1:view.getInt32(12,true),score2:view.getInt32(16,true),crawford:!!view.getUint8(20),gameNumber:view.getInt32(48,true)};}
      else if((type===2||type===3)&&current){
        const analysis=type===3?parseMoveAnalysis(rec):parseCubeAnalysis(rec);
        if(analysis){
          const variant=variantFromGame(matchLength,current.score1,current.score2,current.crawford,orientation);
          if(variant)results.push({variant,...analysis,matchLength,gameScore:[current.score1,current.score2],crawford:current.crawford,gameNumber:current.gameNumber});
        }
      }
    }
    if(!results.length)throw new Error("XGの解析結果が見つかりません。XG2でBatch Analyze後に保存してください。");
    return results;
  }

  function cubeDisplay(cubeA){
    const n=Number(cubeA)||0;if(n===0)return {cubeValue:1,cubeOwner:"center"};
    return {cubeValue:Math.pow(2,Math.abs(n)),cubeOwner:n>0?"black":"white"};
  }

  function identifyVariantFromStream(bytes){
    if(bytes.length%SAVE_REC_SIZE!==0)throw new Error("XG本体のレコード形式を読み取れません。");
    let matchLength=5,orientation=1,current=null;
    for(let off=0;off<bytes.length;off+=SAVE_REC_SIZE){
      const rec=bytes.subarray(off,off+SAVE_REC_SIZE),type=rec[8],view=new DataView(rec.buffer,rec.byteOffset,rec.byteLength);
      if(type===0){matchLength=view.getInt32(92,true);orientation=view.getInt32(548,true)<0?-1:1;}
      else if(type===1&&!current){current={score1:view.getInt32(12,true),score2:view.getInt32(16,true),crawford:!!view.getUint8(20)};}
      if(current)break;
    }
    if(!current)throw new Error("XGのゲーム情報を読み取れません。");
    const variant=variantFromGame(matchLength,current.score1,current.score2,current.crawford,orientation);
    if(!variant)throw new Error("XGのスコア条件を特定できません。");
    return variant;
  }

  async function parseAnalyzedPackageSingle(input){
    const parsed=await parsePackage(input);
    const main=parsed.entries.find(e=>e.name.toLowerCase()==="temp.xg");
    if(!main)throw new Error("XG内にtemp.xgがありません。");
    const variant=identifyVariantFromStream(main.bytes);
    let analyses=[];
    try{analyses=parseAnalyzedStreamMany(main.bytes);}catch(error){
      if(!/解析結果が見つかりません/.test(String(error?.message||"")))throw error;
    }
    const matching=analyses.find(a=>variantKey(a.variant)===variantKey(variant))||analyses[0]||null;
    return {parsed,variant,analysis:matching};
  }

  function cubeUnavailableResult(variant,boardSource){
    return {
      variant,
      type:"cube",
      best:"No Double",
      equity:null,
      candidates:[],
      position:boardSource?.position||null,
      dice:[],
      cubeA:0,
      synthetic:true
    };
  }

  function awayForAxis(axis){
    if(axis==="PC"||axis==="C")return 1;
    return Number(String(axis).replace("a",""));
  }

  function xgidEligibility(source,variant){
    if(variant.crawford)return {eligible:false,reason:"Crawford",automatic:false};
    if(variant.dmp)return {eligible:false,reason:"DMP",automatic:false};
    if(source.cubePos<0)return {eligible:false,reason:"相手キューブ",automatic:false};
    if(Number.isFinite(source.maxCube)&&source.maxCube>=0&&source.cubeExp>=source.maxCube)return {eligible:false,reason:"最大キューブ",automatic:false};
    let automatic=false;
    if(!variant.unlimited){
      const cubeValue=Math.pow(2,Math.max(0,source.cubeExp));
      const ownAway=awayForAxis(variant.black);
      const opponentAway=awayForAxis(variant.white);
      if(cubeValue>=ownAway)return {eligible:false,reason:"ダブル不要",automatic:false};
      // Opponent already loses the match at the current cube value, while we do not.
      // Raising the cube cannot worsen our loss but can improve our win: automatic double/redouble.
      automatic=cubeValue>=opponentAway&&cubeValue<ownAway;
    }
    return {eligible:true,reason:"",automatic};
  }

  function buildVariantXgid(source,variant){
    const blackScore=variant.unlimited?0:scoreForAxis(variant.black);
    const whiteScore=variant.unlimited?0:scoreForAxis(variant.white);
    const bottomScore=source.turn===1?blackScore:whiteScore;
    const topScore=source.turn===1?whiteScore:blackScore;
    // Unlimited: rules=0 => Jacoby OFF / Beaver OFF.
    // Match play: this field is the Crawford flag.
    const rules=variant.unlimited?0:(variant.crawford?1:0);
    const matchLength=variant.unlimited?0:5;
    const fields=[
      source.positionText,
      source.cubeExp,
      source.cubePosBottom,
      source.turn,
      "00",
      bottomScore,
      topScore,
      rules,
      matchLength,
      source.maxCube
    ];
    return `XGID=${fields.join(":")}`;
  }

  function generateScoreXgids(value){
    const source=parseXgid(value);
    const items=makeVariants().map(variant=>{
      const status=xgidEligibility(source,variant);
      return {
        variant,
        key:variantKey(variant),
        eligible:status.eligible,
        reason:status.reason,
        automatic:!!status.automatic,
        xgid:status.eligible?buildVariantXgid(source,variant):null
      };
    });
    return {
      source,
      items,
      eligibleCount:items.filter(x=>x.eligible).length,
      excludedCount:items.filter(x=>!x.eligible).length
    };
  }

  async function buildScoreMapJson(inputs,options={}){
    const plan=options.plan||null;
    const expectedItems=plan?.items||makeVariants().map(variant=>({variant,key:variantKey(variant),eligible:!(variant.crawford||variant.dmp),reason:""}));
    const activeItems=expectedItems.filter(x=>x.eligible);
    if(!Array.isArray(inputs)||inputs.length<1){
      throw new Error("解析済みXG / XGPを1ファイル以上選択してください。");
    }
    if(inputs.length>activeItems.length){
      throw new Error(`解析済みXG / XGPは最大${activeItems.length}ファイルまで選択できます。`);
    }
    const activeKeys=new Set(activeItems.map(x=>x.key));
    const found=new Map();let boardSource=null;
    for(const item of inputs){
      let parsed;
      try{parsed=await parseAnalyzedPackageSingle(item.buffer)}catch(error){throw new Error(`${item.name}: ${error.message}`)}
      const key=variantKey(parsed.variant);
      if(!activeKeys.has(key))throw new Error(`${item.name}: ①で解析対象外にしたスコア条件です (${key})。`);
      if(found.has(key))throw new Error(`同じ条件のXG/XGPが重複しています: ${key}`);
      if(!parsed.analysis)throw new Error(`${item.name}: ダブルアクションの解析結果がありません。XG2でDouble Action解析後に保存してください。`);
      if(parsed.analysis.type!=="cube")throw new Error(`${item.name}: ダブルアクションとして解析されていません。`);
      found.set(key,parsed.analysis);
      if(!boardSource)boardSource=parsed.analysis;
    }
    const sourceXgid=plan?.source||null;
    if(!boardSource&&sourceXgid){
      boardSource={position:sourceXgid.points,dice:[],cubeA:sourceXgid.cubePos*sourceXgid.cubeExp};
    }
    if(!boardSource?.position)throw new Error("公開用盤面を取得できません。");

    const results={};
    for(const item of expectedItems){
      const a=found.get(item.key);
      if(a)results[item.key]={best:a.best,equity:a.equity,candidates:a.candidates,type:"cube"};
    }

    let cube;
    if(sourceXgid){
      const value=Math.pow(2,Math.max(0,sourceXgid.cubeExp));
      cube={cubeValue:value,cubeOwner:sourceXgid.cubePos===0?"center":sourceXgid.cubePos>0?"black":"white"};
    }else{
      cube=cubeDisplay(boardSource.cubeA);
    }
    return {
      schemaVersion:1,
      id:"",
      title:String(options.title||"").trim(),
      generatedAt:new Date().toISOString(),
      source:"eXtreme Gammon 2",
      analysisTargets:activeItems.map(item=>item.key),
      automaticTargets:activeItems.filter(item=>item.automatic).map(item=>item.key),
      board:{points:boardSource.position,dice:[],cubeValue:cube.cubeValue,cubeOwner:cube.cubeOwner,maxCube:sourceXgid?.maxCube??null,matchLength:5,blackScore:0,whiteScore:0,crawford:false},
      results
    };
  }



  return {generateBatch, makeVariants, buildScoreMapJson, parseXgid, generateScoreXgids, variantKey};
})();
