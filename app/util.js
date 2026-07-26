/* DiskMate v2 — 基础工具 */
const { ipcRenderer } = require('electron');
const cp = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const PROGRAM_DATA = process.env.ProgramData || 'C:\\ProgramData';
const DM_DIR = path.join(PROGRAM_DATA, 'DiskMate');
const MOVES_FILE = path.join(DM_DIR, 'moves.json');
const CONFIG_FILE = path.join(DM_DIR, 'config.json');
const WIN_DIR = process.env.SystemRoot || 'C:\\Windows';
const SYS_DRIVE = (process.env.SystemDrive || 'C:') + '\\';
const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

function fmt(b) {
  if (b == null || b < 0) return '…';
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024) return Math.round(b / 1024) + ' KB';
  return b + ' B';
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function psq(s) { return String(s).replace(/'/g, "''"); }
function sanitize(name) { return name.replace(/[\\/:*?"<>|]/g, '_').trim(); }

/** cmd 命令，永不 reject，返回 {code,out} */
function execCmd(cmd) {
  return new Promise(resolve => {
    cp.exec(cmd, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout, stderr) => {
        const out = Buffer.concat([stdout || Buffer.alloc(0), stderr || Buffer.alloc(0)]).toString('utf8');
        resolve({ code: err ? (err.code ?? 1) : 0, out });
      });
  });
}

/** PowerShell 脚本（EncodedCommand，UTF-8 输出），返回 {code,out,stdout,stderr} */
function psRun(script) {
  const full = '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' + script;
  const b64 = Buffer.from(full, 'utf16le').toString('base64');
  return new Promise(resolve => {
    cp.execFile('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64],
      { windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout, stderr) => {
        const so = (stdout || Buffer.alloc(0)).toString('utf8');
        const se = (stderr || Buffer.alloc(0)).toString('utf8');
        resolve({ code: err ? (err.code ?? 1) : 0, out: so + se, stdout: so, stderr: se });
      });
  });
}

function parseJsonArray(text) {
  try {
    let t = String(text || '').trim();
    const a = t.indexOf('['), b = t.lastIndexOf(']');
    const o = t.indexOf('{'), c = t.lastIndexOf('}');
    if (a >= 0 && b > a && (o < 0 || a < o)) t = t.slice(a, b + 1);
    else if (o >= 0 && c > o) t = t.slice(o, c + 1);
    const j = JSON.parse(t);
    return Array.isArray(j) ? j : (j ? [j] : []);
  } catch { return []; }
}

function isJunction(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}

/** 递归目录大小（跳过联接），state={files,stop} */
async function dirSize(root, state) {
  let total = 0;
  const stack = [root];
  while (stack.length) {
    if (state && state.stop) throw new Error('cancelled');
    const dir = stack.pop();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    const files = [];
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) files.push(p);
    }
    for (let i = 0; i < files.length; i += 32) {
      const chunk = files.slice(i, i + 32);
      const stats = await Promise.all(chunk.map(f => fsp.stat(f).catch(() => null)));
      for (const s of stats) if (s) total += s.size;
      if (state) state.files += chunk.length;
    }
  }
  return total;
}

/** 通用文件遍历：onFile(path, stat)，state={files,stop} */
async function walkFiles(root, state, onFile) {
  const stack = [root];
  while (stack.length) {
    if (state.stop) throw new Error('cancelled');
    const dir = stack.pop();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    const files = [];
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) files.push(p);
    }
    for (let i = 0; i < files.length; i += 32) {
      if (state.stop) throw new Error('cancelled');
      const chunk = files.slice(i, i + 32);
      const stats = await Promise.all(chunk.map(f => fsp.stat(f).catch(() => null)));
      for (let k = 0; k < chunk.length; k++) if (stats[k]) onFile(chunk[k], stats[k]);
      state.files += chunk.length;
    }
  }
}

/** 尽力删除目录内容 res={freed,failed} */
async function deleteContents(dir, res) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { res.failed++; return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) {
      try { await fsp.unlink(p); } catch { try { await fsp.rmdir(p); } catch { res.failed++; } }
      continue;
    }
    if (e.isDirectory()) {
      await deleteContents(p, res);
      try { await fsp.rmdir(p); } catch { }
    } else {
      try {
        const s = await fsp.stat(p);
        try { await fsp.unlink(p); }
        catch { await fsp.chmod(p, 0o666); await fsp.unlink(p); }
        res.freed += s.size;
      } catch { res.failed++; }
    }
  }
}
async function deleteDirectory(dir, res) {
  await deleteContents(dir, res);
  try { await fsp.rmdir(dir); } catch { res.failed++; }
}

/** 批量删除文件到回收站，返回 {ok,fail} */
async function recycleFiles(paths) {
  let ok = 0, fail = 0;
  for (let i = 0; i < paths.length; i += 60) {
    const chunk = paths.slice(i, i + 60);
    const list = chunk.map(p => `'${psq(p)}'`).join(',');
    const r = await psRun(`
Add-Type -AssemblyName Microsoft.VisualBasic;
$ok=0;$fail=0;
foreach($p in @(${list})){
 try{[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin');$ok++}
 catch{$fail++}
};
Write-Output "$ok $fail"`);
    const m = (r.stdout || '').trim().match(/(\d+)\s+(\d+)\s*$/);
    if (m) { ok += +m[1]; fail += +m[2]; } else fail += chunk.length;
  }
  return { ok, fail };
}

/** 逐字节比较两个文件内容是否完全一致 */
async function filesEqual(a, b) {
  let fa, fb;
  try {
    const sa = await fsp.stat(a), sb = await fsp.stat(b);
    if (sa.size !== sb.size) return false;
    fa = await fsp.open(a, 'r'); fb = await fsp.open(b, 'r');
    const CH = 1 << 20;
    const ba = Buffer.alloc(CH), bb = Buffer.alloc(CH);
    let pos = 0;
    while (pos < sa.size) {
      const len = Math.min(CH, sa.size - pos);
      await fa.read(ba, 0, len, pos);
      await fb.read(bb, 0, len, pos);
      if (Buffer.compare(ba.subarray(0, len), bb.subarray(0, len)) !== 0) return false;
      pos += len;
    }
    return true;
  } catch { return false; }
  finally { try { await fa?.close(); } catch { } try { await fb?.close(); } catch { } }
}

/** 配置读写 */
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}
function saveConfig(cfg) {
  try { fs.mkdirSync(DM_DIR, { recursive: true }); fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); } catch { }
}
