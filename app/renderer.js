/* DiskMate v2.0 — 页面逻辑 */

/* ============================================================
 * 首页体检
 * ============================================================ */
const hm = { drives: [], checked: false };

async function hmLoadOverview() {
  const r = await psRun(`Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID,Size,FreeSpace,VolumeName | ConvertTo-Json -Compress`);
  hm.drives = parseJsonArray(r.stdout || r.out).filter(d => d.Size > 0);
  $('#hm-drives').innerHTML = hm.drives.map(d => {
    const used = d.Size - d.FreeSpace;
    const pct = used * 100 / d.Size;
    return `
    <div class="drive-row">
      <div class="dr-head">
        <span><b>${esc(d.DeviceID)}</b> <span class="dim">${esc(d.VolumeName || '本地磁盘')}</span></span>
        <span class="dim">已用 ${fmt(used)} / ${fmt(d.Size)}（剩余 ${fmt(d.FreeSpace)}）</span>
      </div>
      <div class="bar"><i class="${pct > 85 ? 'warn' : ''}" style="width:${pct.toFixed(1)}%"></i></div>
    </div>`;
  }).join('') || '<span class="dim">未读取到磁盘信息</span>';

  const osr = await psRun(`(Get-CimInstance Win32_OperatingSystem).Caption`);
  const cpus = os.cpus();
  const upH = Math.floor(os.uptime() / 3600), upM = Math.floor(os.uptime() % 3600 / 60);
  $('#sys-info').innerHTML =
    `系统：<b>${esc((osr.stdout || '').trim() || 'Windows')}</b><br>` +
    `处理器：<b>${esc(cpus[0] ? cpus[0].model.trim() : '-')}</b>（${cpus.length} 线程）<br>` +
    `内存：<b>${fmt(os.totalmem())}</b>（可用 ${fmt(os.freemem())}）<br>` +
    `本次开机已运行：<b>${upH} 小时 ${upM} 分钟</b>`;

  // 填充磁盘下拉框（空间分析 / 大文件共用）
  const opts = hm.drives.map(d => `<option>${esc(d.DeviceID)}\\</option>`).join('') || '<option>C:\\</option>';
  $('#sp-drive').innerHTML = opts;
  $('#bf-drive').innerHTML = opts;
}

async function hmCheck() {
  $('#hm-check').disabled = true;
  $('#score-label').textContent = '体检中…';
  $('#score-val').textContent = '…';
  const issues = [];
  let score = 100;

  // 1) 系统盘剩余空间
  const sys = hm.drives.find(d => (d.DeviceID + '\\').toLowerCase() === SYS_DRIVE.toLowerCase());
  if (sys) {
    const freePct = sys.FreeSpace * 100 / sys.Size;
    if (freePct < 10) { score -= 25; issues.push({ ico: '🔴', t: `系统盘剩余空间仅 ${freePct.toFixed(1)}%（${fmt(sys.FreeSpace)}）`, s: '强烈建议搬家大型软件并清理垃圾', go: 'mover', btn: '去搬家' }); }
    else if (freePct < 20) { score -= 12; issues.push({ ico: '🟠', t: `系统盘剩余空间偏低（${freePct.toFixed(1)}%）`, s: '建议清理垃圾或搬走大型软件', go: 'mover', btn: '去搬家' }); }
  }

  // 2) 临时文件 / 更新缓存
  $('#score-label').textContent = '正在扫描临时文件…';
  let junk = 0;
  for (const d of [os.tmpdir(), path.join(WIN_DIR, 'Temp'), path.join(WIN_DIR, 'SoftwareDistribution', 'Download')])
    junk += await dirSize(d, { files: 0 }).catch(() => 0);
  if (junk > 2 * 1073741824) { score -= 15; issues.push({ ico: '🟠', t: `临时文件与更新缓存约 ${fmt(junk)}`, s: '可安全清理', go: 'junk', btn: '去清理' }); }
  else if (junk > 500 * 1048576) { score -= 8; issues.push({ ico: '🟡', t: `临时文件与更新缓存约 ${fmt(junk)}`, s: '可安全清理', go: 'junk', btn: '去清理' }); }

  // 3) 回收站
  $('#score-label').textContent = '正在检查回收站…';
  const rb = await psRun(`$sh=New-Object -ComObject Shell.Application;$s=0;foreach($i in $sh.NameSpace(10).Items()){$s+=$i.Size};Write-Output $s`);
  const rbSize = parseInt((rb.stdout || '').trim().split(/\s+/).pop()) || 0;
  if (rbSize > 1073741824) { score -= 6; issues.push({ ico: '🟡', t: `回收站占用 ${fmt(rbSize)}`, s: '确认无需恢复后可清空', go: 'junk', btn: '去清理' }); }

  // 4) 启动项数量
  $('#score-label').textContent = '正在检查启动项…';
  const st = await psRun(`
$n=0;
foreach($p in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'){
 $k=Get-Item -Path $p -ErrorAction SilentlyContinue; if($k){$n+=$k.GetValueNames().Count}};
Write-Output $n`);
  const stCount = parseInt((st.stdout || '').trim().split(/\s+/).pop()) || 0;
  if (stCount > 10) { score -= 8; issues.push({ ico: '🟡', t: `开机自启动项较多（${stCount} 个）`, s: '禁用不常用的启动项可加快开机', go: 'startup', btn: '去管理' }); }

  // 5) 休眠文件
  try {
    if (fs.existsSync(path.join(SYS_DRIVE, 'hiberfil.sys'))) {
      issues.push({ ico: '💡', t: '存在休眠文件 hiberfil.sys（通常为内存的 40%）', s: '不用「休眠」功能可用管理员命令 powercfg /h off 释放', go: null });
    }
  } catch { }

  score = Math.max(40, Math.round(score));
  hm.checked = true;
  $('#score-val').textContent = score;
  $('#score-label').textContent = score >= 90 ? '状态极佳' : score >= 75 ? '状态良好' : score >= 60 ? '建议优化' : '亟需清理';
  $('#ring-fg').style.strokeDashoffset = String(465 * (1 - score / 100));
  $('#hm-issues').innerHTML = issues.length ? issues.map((i, k) => `
    <div class="issue-row">
      <span class="issue-ico">${i.ico}</span>
      <span class="issue-txt">${esc(i.t)}<small>${esc(i.s)}</small></span>
      ${i.go ? `<button class="mini-btn" data-go="${i.go}">${i.btn}</button>` : ''}
    </div>`).join('') : '<div class="issue-row"><span class="issue-ico">✅</span><span class="issue-txt">未发现明显问题，电脑状态很好</span></div>';
  $('#hm-issues').querySelectorAll('[data-go]').forEach(b =>
    b.addEventListener('click', () => ui.go(b.dataset.go)));
  $('#hm-check').disabled = false;
}

$('#hm-check').addEventListener('click', hmCheck);
hmLoadOverview();

/* ============================================================
 * 应用搬家 / 卸载
 * ============================================================ */
const mv = { apps: [], moved: [], sel: -1, selMoved: -1, scanId: 0, sortBySize: false };

function mvLoadMoved() {
  try { mv.moved = JSON.parse(fs.readFileSync(MOVES_FILE, 'utf8')); } catch { mv.moved = []; }
  mvRenderMoved();
}
function mvSaveMoved() {
  try { fs.mkdirSync(DM_DIR, { recursive: true }); fs.writeFileSync(MOVES_FILE, JSON.stringify(mv.moved, null, 2)); }
  catch (e) { ui.toast('保存搬家记录失败：' + esc(e.message), 'error'); }
}
function mvGuessTarget() {
  for (const L of 'DEFGH') { try { if (fs.existsSync(L + ':\\')) return L + ':\\DiskMate搬家'; } catch { } }
  return 'D:\\DiskMate搬家';
}

async function mvLoadApps() {
  const myId = ++mv.scanId;
  $('#mv-status').textContent = '正在读取已安装应用…';
  mv.apps = []; mv.sel = -1; mvRenderApps();

  const script = `
$paths='HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*';
$r=foreach($p in $paths){Get-ItemProperty $p -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -and ($_.SystemComponent -ne 1) -and ($_.InstallLocation -or $_.DisplayIcon -or $_.UninstallString)} | Select-Object DisplayName,DisplayVersion,Publisher,InstallLocation,DisplayIcon,UninstallString,QuietUninstallString};
ConvertTo-Json -InputObject @($r) -Compress -Depth 2`;
  const r = await psRun(script);
  if (myId !== mv.scanId) return;
  const rows = parseJsonArray(r.stdout || r.out);
  if (!rows.length) {
    $('#mv-status').textContent = '读取应用列表失败：' + ((r.stderr || r.stdout || '(无输出)').trim().slice(0, 300) || '(无输出)');
    return;
  }

  const onlySys = $('#mv-onlysys').checked;
  const seen = new Set();
  const list = [];
  const cleanPath = s => String(s || '').trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '');
  for (const a of rows) {
    let loc = cleanPath(a.InstallLocation);
    if (!loc) {
      const icon = String(a.DisplayIcon || '').split(',')[0].trim().replace(/^"|"$/g, '');
      if (/\.exe$/i.test(icon)) loc = path.dirname(icon);
    }
    if (!loc) {
      const us = String(a.UninstallString || '').trim();
      const m = us.match(/^"([^"]+\.exe)"/i) || us.match(/^([^\s]+\.exe)/i);
      if (m) loc = path.dirname(m[1]);
    }
    loc = cleanPath(loc);
    if (!loc || loc.length <= 3 || !/^[a-z]:\\/i.test(loc)) continue;
    const key = loc.toLowerCase();
    if ([LOCAL, APPDATA, os.homedir()].some(d => key === d.toLowerCase())) continue;
    if (seen.has(key)) continue;
    try { if (!fs.statSync(loc).isDirectory()) continue; } catch { continue; }
    if (/\\program files( \(x86\))?$/i.test(loc)) continue;
    if (key.startsWith(WIN_DIR.toLowerCase())) continue;
    if (onlySys && !key.startsWith(SYS_DRIVE.toLowerCase())) continue;
    seen.add(key);
    list.push({
      name: String(a.DisplayName).trim(),
      version: a.DisplayVersion || '',
      loc, size: -1,
      us: a.QuietUninstallString || a.UninstallString || '',
      junction: isJunction(loc),
    });
  }
  list.sort((x, y) => x.name.localeCompare(y.name, 'zh'));
  mv.apps = list;
  mvRenderApps();
  $('#mv-status').textContent = `共 ${list.length} 个应用，正在后台计算占用大小…`;

  for (const app of list) {
    if (myId !== mv.scanId) return;
    app.size = app.junction ? 0 : await dirSize(app.loc, { files: 0 }).catch(() => 0);
    mvUpdateRow(app);
  }
  if (myId === mv.scanId)
    $('#mv-status').textContent = `共 ${list.length} 个应用，大小计算完成。点击「占用」列头按大小排序。`;
}

function mvRenderApps() {
  const arr = mv.sortBySize ? [...mv.apps].sort((a, b) => (b.size ?? -1) - (a.size ?? -1)) : mv.apps;
  $('#mv-table tbody').innerHTML = arr.map(a => `
    <tr data-idx="${mv.apps.indexOf(a)}">
      <td title="${esc(a.name)}">${esc(a.name)}</td>
      <td class="dim">${esc(a.version)}</td>
      <td class="num" data-col="size">${fmt(a.size)}</td>
      <td>${a.junction ? '<span class="tag green">已搬家</span>' : ''}</td>
      <td class="dim" title="${esc(a.loc)}">${esc(a.loc)}</td>
    </tr>`).join('');
  mv.sel = -1;
}
function mvUpdateRow(app) {
  const idx = mv.apps.indexOf(app);
  const tr = $('#mv-table tbody').querySelector(`tr[data-idx="${idx}"]`);
  if (tr) tr.querySelector('[data-col=size]').textContent = fmt(app.size);
}
function mvRenderMoved() {
  $('#mv-moved tbody').innerHTML = mv.moved.map((r, i) => `
    <tr data-idx="${i}">
      <td>${esc(r.name)}</td><td class="num">${fmt(r.size)}</td>
      <td class="dim" title="${esc(r.source)}">${esc(r.source)}</td>
      <td class="dim" title="${esc(r.target)}">${esc(r.target)}</td>
      <td class="dim">${esc(r.movedAt)}</td>
    </tr>`).join('');
  mv.selMoved = -1;
}

async function mvMove() {
  if (mv.sel < 0) return ui.toast('请先在列表中选中一个应用', 'warn');
  const app = mv.apps[mv.sel];
  if (app.junction) return ui.toast('该应用已经搬过家了', 'warn');

  const base = $('#mv-target').value.trim();
  if (!base) return ui.toast('请先设置搬家目标目录', 'warn');
  const srcRoot = path.parse(app.loc).root.toLowerCase();
  const dstRoot = path.parse(path.resolve(base)).root.toLowerCase();
  if (srcRoot === dstRoot) return ui.toast('目标目录必须在另一个磁盘上（例如 D 盘）', 'warn');

  const dst = path.join(base, sanitize(app.name));
  if (fs.existsSync(dst)) return ui.toast('目标目录已存在：' + esc(dst), 'error', 5000);

  let size = app.size;
  if (size == null || size < 0) {
    ui.busy(true, '正在计算目录大小…');
    size = await dirSize(app.loc, { files: 0 }).catch(() => 0);
    ui.busy(false);
  }
  const ok = await ui.confirm('确认搬家',
    `即将把<br><b>${esc(app.loc)}</b><br>搬到<br><b>${esc(dst)}</b><br><br>大小约 ${fmt(size)}。<br>请确认【${esc(app.name)}】已完全退出（包括系统托盘）。`,
    { okText: '开始搬家' });
  if (!ok) return;

  const bak = app.loc + '.dm_bak';
  ui.busy(true, '① 检查目录占用…');
  try {
    try { await fsp.rename(app.loc, bak); }
    catch (e) { throw new Error('目录正被占用，无法搬家。请先完全退出该软件后重试。'); }

    ui.busy(true, '② 正在复制到目标磁盘（可能需要几分钟）…');
    fs.mkdirSync(base, { recursive: true });
    let r = await execCmd(`robocopy "${bak}" "${dst}" /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /XJ /NFL /NDL /NP`);
    if (r.code >= 8) {
      await fsp.rename(bak, app.loc);
      throw new Error('复制失败（robocopy 退出码 ' + r.code + '），已回滚。');
    }

    ui.busy(true, '③ 创建目录联接…');
    r = await execCmd(`mklink /J "${app.loc}" "${dst}"`);
    if (r.code !== 0) {
      const res = { freed: 0, failed: 0 };
      await deleteDirectory(dst, res);
      await fsp.rename(bak, app.loc);
      throw new Error('创建目录联接失败，已回滚。');
    }

    ui.busy(true, '④ 清理原文件…');
    const res = { freed: 0, failed: 0 };
    await deleteDirectory(bak, res);

    mv.moved.push({
      name: app.name, source: app.loc, target: dst, size,
      movedAt: new Date().toLocaleString('zh-CN', { hour12: false }).slice(0, 16),
    });
    mvSaveMoved(); mvRenderMoved();
    app.junction = true; mvRenderApps();
    ui.busy(false);
    ui.toast(`🎉 搬家完成！释放系统盘约 <b>${fmt(size)}</b>`, 'success', 5000);
    if (res.failed > 0)
      await ui.alert('部分残留', `有 ${res.failed} 个原文件未能删除，残留在：<br>${esc(bak)}<br>可稍后手动删除。`);
    $('#mv-status').textContent = '搬家完成。';
  } catch (e) {
    ui.busy(false);
    await ui.alert('搬家失败', esc(e.message));
    $('#mv-status').textContent = '搬家未完成。';
  }
}

async function mvRestore() {
  if (mv.selMoved < 0) return ui.toast('请先在记录中选中一条', 'warn');
  const rec = mv.moved[mv.selMoved];

  if (!fs.existsSync(rec.target)) {
    if (await ui.confirm('记录失效', '目标目录已不存在，是否删除这条记录？'))
      { mv.moved.splice(mv.selMoved, 1); mvSaveMoved(); mvRenderMoved(); }
    return;
  }
  if (!await ui.confirm('确认还原',
    `把【${esc(rec.name)}】从<br><b>${esc(rec.target)}</b><br>还原回<br><b>${esc(rec.source)}</b><br><br>请确认该软件已完全退出。`,
    { okText: '开始还原' })) return;

  ui.busy(true, '① 移除目录联接…');
  try {
    if (fs.existsSync(rec.source)) {
      if (!isJunction(rec.source))
        throw new Error('原位置已存在普通目录（不是联接），为避免覆盖已中止，请手动处理。');
      await fsp.rmdir(rec.source);
    }
    ui.busy(true, '② 正在复制文件回原位置…');
    const r = await execCmd(`robocopy "${rec.target}" "${rec.source}" /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /XJ /NFL /NDL /NP`);
    if (r.code >= 8) {
      await execCmd(`mklink /J "${rec.source}" "${rec.target}"`);
      throw new Error('复制失败，已恢复联接，软件仍可正常使用。');
    }
    ui.busy(true, '③ 清理搬家目录…');
    const res = { freed: 0, failed: 0 };
    await deleteDirectory(rec.target, res);
    mv.moved.splice(mv.selMoved, 1);
    mvSaveMoved(); mvRenderMoved();
    ui.busy(false);
    ui.toast(`【${esc(rec.name)}】已还原`, 'success');
    mvLoadApps();
  } catch (e) {
    ui.busy(false);
    await ui.alert('还原失败', esc(e.message));
  }
}

async function mvUninstall() {
  if (mv.sel < 0) return ui.toast('请先选中一个应用', 'warn');
  const app = mv.apps[mv.sel];
  if (!app.us) return ui.toast('未找到该应用的卸载程序', 'warn');
  if (!await ui.confirm('卸载软件', `启动【${esc(app.name)}】的官方卸载程序？<br><span class="dim">${esc(app.us)}</span>`, { okText: '启动卸载', danger: true })) return;
  execCmd(`start "" ${app.us.startsWith('"') ? app.us : '"' + app.us + '"'}`);
  ui.toast('已启动卸载程序，请在弹出的窗口中完成卸载', 'info', 4500);
}

$('#mv-target').value = mvGuessTarget();
$('#mv-browse').addEventListener('click', async () => {
  const p = await ipcRenderer.invoke('pick-folder', '选择搬家目标目录');
  if (p) $('#mv-target').value = p;
});
$('#mv-refresh').addEventListener('click', mvLoadApps);
$('#mv-onlysys').addEventListener('change', mvLoadApps);
$('#mv-move').addEventListener('click', mvMove);
$('#mv-restore').addEventListener('click', mvRestore);
$('#mv-uninstall').addEventListener('click', mvUninstall);
$('#mv-open').addEventListener('click', () => {
  if (mv.sel < 0) return ui.toast('请先选中一个应用', 'warn');
  ipcRenderer.invoke('open-path', mv.apps[mv.sel].loc);
});
$('#mv-sort-size').addEventListener('click', () => { mv.sortBySize = !mv.sortBySize; mvRenderApps(); });
bindRowSelect($('#mv-table tbody'), i => mv.sel = i);
bindRowSelect($('#mv-moved tbody'), i => mv.selMoved = i);
mvLoadMoved();
let mvLoaded = false;

/* ============================================================
 * 垃圾清理
 * ============================================================ */
const jk = { cats: [], busy: false };

function jkBuildCats() {
  const cats = [
    { name: '用户临时文件', desc: os.tmpdir(), dirs: [os.tmpdir()], checked: true },
    { name: '系统临时文件', desc: path.join(WIN_DIR, 'Temp'), dirs: [path.join(WIN_DIR, 'Temp')], checked: true },
    { name: 'Windows 更新缓存', desc: '已下载的系统更新安装包，更新完成后即无用',
      dirs: [path.join(WIN_DIR, 'SoftwareDistribution', 'Download')], checked: true },
    { name: '回收站', desc: '清空所有磁盘的回收站（清空后不可恢复，确认后再勾选）', recycle: true, checked: false },
    { name: '缩略图 / 图标缓存', desc: '资源管理器缩略图缓存，删除后系统自动重建',
      patterns: [[path.join(LOCAL, 'Microsoft', 'Windows', 'Explorer'), /^(thumbcache|iconcache)_.*\.db$/i]], checked: true },
    { name: '浏览器缓存（Chrome / Edge）', desc: '网页缓存，删除后自动重建（先关闭浏览器可清理更彻底）',
      dirs: jkBrowserDirs(), checked: true },
    { name: '崩溃转储 / 错误报告', desc: '程序崩溃产生的调试文件',
      dirs: [path.join(LOCAL, 'CrashDumps'), path.join(WIN_DIR, 'Minidump'),
             path.join(LOCAL, 'Microsoft', 'Windows', 'WER'),
             path.join(PROGRAM_DATA, 'Microsoft', 'Windows', 'WER')],
      patterns: [[WIN_DIR, /^MEMORY\.DMP$/i]], checked: true },
    { name: 'Windows 日志', desc: '系统安装与升级日志（C:\\Windows\\Logs、Panther）',
      dirs: [path.join(WIN_DIR, 'Logs'), path.join(WIN_DIR, 'Panther')], checked: true },
    { name: 'DirectX / 显卡着色器缓存', desc: '删除后自动重建（首次启动游戏可能稍慢）',
      dirs: [path.join(LOCAL, 'D3DSCache'), path.join(LOCAL, 'NVIDIA', 'DXCache'),
             path.join(LOCAL, 'NVIDIA', 'GLCache'), path.join(LOCAL, 'AMD', 'DxCache')], checked: true },
    { name: '开发工具缓存（npm / pip / yarn）', desc: '包管理器缓存，删除后下次安装依赖需重新下载',
      dirs: [path.join(LOCAL, 'npm-cache'), path.join(LOCAL, 'pip', 'cache'),
             path.join(LOCAL, 'Yarn', 'Cache')], checked: false },
  ];
  for (const c of cats) { c.size = -1; c.scanning = false; c.dirs = (c.dirs || []).filter(d => fs.existsSync(d)); }
  jk.cats = cats;
}

function jkBrowserDirs() {
  const out = [];
  for (const ud of [path.join(LOCAL, 'Google', 'Chrome', 'User Data'),
                    path.join(LOCAL, 'Microsoft', 'Edge', 'User Data')]) {
    let profiles = [];
    try { profiles = fs.readdirSync(ud).filter(n => n === 'Default' || /^Profile/i.test(n)); } catch { continue; }
    for (const p of profiles)
      for (const c of ['Cache', path.join('Cache', 'Cache_Data'), 'Code Cache', 'GPUCache']) {
        const d = path.join(ud, p, c);
        if (fs.existsSync(d)) out.push(d);
      }
  }
  return out;
}

function jkRender() {
  $('#jk-list').innerHTML = jk.cats.map((c, i) => `
    <div class="jk-row">
      <input type="checkbox" data-idx="${i}" ${c.checked ? 'checked' : ''}>
      <div class="jk-info">
        <div class="jk-name">${esc(c.name)}</div>
        <div class="jk-desc">${esc(c.desc)}</div>
      </div>
      <div class="jk-size ${c.scanning ? 'scanning' : ''}">${c.scanning ? '<span class="spin"></span>' : (c.size < 0 ? '<span class="dim">未扫描</span>' : fmt(c.size))}</div>
    </div>`).join('');
  $('#jk-list').querySelectorAll('input').forEach(cb =>
    cb.addEventListener('change', () => jk.cats[cb.dataset.idx].checked = cb.checked));
}

async function jkPatternOp(patterns, del, res) {
  let total = 0;
  for (const [dir, re] of patterns || []) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!re.test(n)) continue;
      const p = path.join(dir, n);
      try {
        const s = fs.statSync(p);
        if (del) { fs.unlinkSync(p); res.freed += s.size; }
        else total += s.size;
      } catch { if (del) res.failed++; }
    }
  }
  return total;
}

async function jkScan() {
  if (jk.busy) return;
  jk.busy = true; $('#jk-scan').disabled = true; $('#jk-clean').disabled = true;
  $('#jk-status').textContent = '正在扫描…';
  let total = 0;
  for (const c of jk.cats) {
    c.scanning = true; jkRender();
    let size = 0;
    if (c.recycle) {
      const rr = await psRun(`$sh=New-Object -ComObject Shell.Application;$s=0;foreach($i in $sh.NameSpace(10).Items()){$s+=$i.Size};Write-Output $s`);
      size = parseInt((rr.stdout || '').trim().split(/\s+/).pop()) || 0;
    } else {
      for (const d of c.dirs || []) size += await dirSize(d, { files: 0 }).catch(() => 0);
      size += await jkPatternOp(c.patterns, false, {});
    }
    c.size = size; c.scanning = false; total += size;
    jkRender();
  }
  $('#jk-total').textContent = `共发现可清理垃圾 ${fmt(total)}`;
  $('#jk-status').textContent = '扫描完成，勾选后点击「一键清理」。';
  $('#jk-scan').disabled = false; $('#jk-clean').disabled = false; jk.busy = false;
}

async function jkClean() {
  if (jk.busy) return;
  const picked = jk.cats.filter(c => c.checked && c.size > 0);
  if (!picked.length) return ui.toast('没有勾选任何有内容的项目', 'warn');
  const expect = picked.reduce((s, c) => s + c.size, 0);
  if (!await ui.confirm('确认清理', `将清理 <b>${picked.length}</b> 类垃圾，预计释放 <b>${fmt(expect)}</b>。`, { okText: '开始清理', danger: true })) return;

  jk.busy = true; $('#jk-scan').disabled = true; $('#jk-clean').disabled = true;
  $('#jk-status').textContent = '正在清理…';
  const res = { freed: 0, failed: 0 };
  for (const c of picked) {
    c.scanning = true; jkRender();
    if (c.recycle) {
      await psRun('Clear-RecycleBin -Force -ErrorAction SilentlyContinue');
      res.freed += c.size;
    } else {
      for (const d of c.dirs || []) await deleteContents(d, res);
      await jkPatternOp(c.patterns, true, res);
    }
    c.size = 0; c.scanning = false; jkRender();
  }
  $('#jk-total').textContent = '';
  $('#jk-status').textContent = `清理完成，共释放 ${fmt(res.freed)}` + (res.failed ? `（${res.failed} 个被占用文件已跳过）` : '');
  ui.toast(`🎉 清理完成！释放空间 <b>${fmt(res.freed)}</b>` + (res.failed ? `<br><span class="dim">${res.failed} 个文件被占用已跳过</span>` : ''), 'success', 5000);
  $('#jk-scan').disabled = false; jk.busy = false;
}

jkBuildCats(); jkRender();
$('#jk-scan').addEventListener('click', jkScan);
$('#jk-clean').addEventListener('click', jkClean);

/* ============================================================
 * 空间分析（矩形树图 + 目录树）
 * ============================================================ */
const sp = { state: null, custom: null, root: null, mapNode: null, stack: [], rects: [], view: 'map' };
const SP_PALETTE = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#84CC16', '#F97316'];

async function spBuild(dir, state, depth) {
  if (state.stop) throw new Error('cancelled');
  const node = { name: path.basename(dir.replace(/[\\/]+$/, '')) || dir, path: dir, size: 0, children: [] };
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return node; }
  const files = [], subdirs = [];
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) subdirs.push(path.join(dir, e.name));
    else if (e.isFile()) files.push(path.join(dir, e.name));
  }
  let fileBytes = 0;
  for (let i = 0; i < files.length; i += 32) {
    if (state.stop) throw new Error('cancelled');
    const chunk = files.slice(i, i + 32);
    const stats = await Promise.all(chunk.map(f => fsp.stat(f).catch(() => null)));
    for (const s of stats) if (s) fileBytes += s.size;
    state.files += chunk.length;
  }
  if (depth < 2 && subdirs.length > 1) {
    const results = new Array(subdirs.length);
    let idx = 0;
    const worker = async () => {
      while (idx < subdirs.length) { const my = idx++; results[my] = await spBuild(subdirs[my], state, depth + 1); }
    };
    await Promise.all(Array.from({ length: Math.min(8, subdirs.length) }, worker));
    for (const c of results) if (c) { node.children.push(c); node.size += c.size; }
  } else {
    for (const sd of subdirs) { const c = await spBuild(sd, state, depth + 1); node.children.push(c); node.size += c.size; }
  }
  node.size += fileBytes;
  if (files.length && node.children.length)
    node.children.push({ name: `〔本层 ${files.length} 个文件〕`, path: dir, size: fileBytes, children: [], leaf: true });
  node.children.sort((a, b) => b.size - a.size);
  return node;
}

/* --- squarified treemap --- */
function squarify(items, x, y, w, h, out) {
  let start = 0;
  while (start < items.length && w > 0.5 && h > 0.5) {
    const horiz = w >= h;
    const side = horiz ? h : w;
    let remaining = 0;
    for (let k = start; k < items.length; k++) remaining += items[k].size;
    if (remaining <= 0) break;
    const areaScale = w * h / remaining;
    let end = start, rowSum = 0, worst = Infinity;
    while (end < items.length) {
      const s = rowSum + items[end].size;
      const rowThick = (s * areaScale) / side;
      let w0 = 0;
      for (let k = start; k <= end; k++) {
        const len = (items[k].size * areaScale) / (rowThick || 1);
        const ar = Math.max((rowThick || 1) / (len || 1), (len || 1) / (rowThick || 1));
        if (ar > w0) w0 = ar;
      }
      if (w0 > worst && end > start) break;
      worst = w0; rowSum = s; end++;
    }
    const rowThick = (rowSum * areaScale) / side;
    let off = 0;
    for (let k = start; k < end; k++) {
      const len = (items[k].size * areaScale) / (rowThick || 1);
      if (horiz) out.push({ item: items[k], x, y: y + off, w: rowThick, h: len });
      else out.push({ item: items[k], x: x + off, y, w: len, h: rowThick });
      off += len;
    }
    if (horiz) { x += rowThick; w -= rowThick; } else { y += rowThick; h -= rowThick; }
    start = end;
  }
}

function spRenderMap() {
  const node = sp.mapNode;
  const canvas = $('#sp-canvas');
  const wrap = $('#sp-treemap-wrap');
  const dpr = window.devicePixelRatio || 1;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  if (!W || !H) return;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const dark = document.documentElement.dataset.theme === 'dark';
  ctx.fillStyle = dark ? '#0F172A' : '#F1F5F9';
  ctx.fillRect(0, 0, W, H);
  sp.rects = [];
  if (!node || !node.children.length) {
    ctx.fillStyle = dark ? '#475569' : '#94A3B8';
    ctx.font = '14px "Microsoft YaHei UI"';
    ctx.textAlign = 'center';
    ctx.fillText(node ? '该目录没有子项' : '点击「开始扫描」生成矩形树图', W / 2, H / 2);
    spRenderCrumb();
    return;
  }

  // 取前 60 个子项，其余聚合
  let items = node.children.filter(c => c.size > 0).slice(0, 60);
  const restSize = node.children.slice(60).reduce((s, c) => s + c.size, 0);
  if (restSize > 0) items = [...items, { name: `〔其他 ${node.children.length - 60} 项〕`, path: node.path, size: restSize, children: [], leaf: true }];

  const rects = [];
  squarify(items, 2, 2, W - 4, H - 4, rects);
  rects.forEach((r, i) => {
    const color = SP_PALETTE[i % SP_PALETTE.length];
    ctx.fillStyle = color + (dark ? 'CC' : 'E6');
    ctx.fillRect(r.x + 1, r.y + 1, Math.max(0, r.w - 2), Math.max(0, r.h - 2));
    // 内嵌下一层
    const kids = (r.item.children || []).filter(c => c.size > 0).slice(0, 24);
    if (kids.length && r.w > 46 && r.h > 40) {
      const inner = [];
      squarify(kids, r.x + 4, r.y + 18, r.w - 8, r.h - 22, inner);
      ctx.fillStyle = dark ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.35)';
      for (const k of inner) ctx.fillRect(k.x + 1, k.y + 1, Math.max(0, k.w - 2), Math.max(0, k.h - 2));
      for (const k of inner) sp.rects.push({ ...k, top: r.item });
    }
    sp.rects.push({ ...r, top: r.item, isTop: true });
    // 标签
    if (r.w > 58 && r.h > 20) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11.5px "Microsoft YaHei UI"';
      ctx.textAlign = 'left';
      const label = r.item.name.length > Math.floor(r.w / 8) ? r.item.name.slice(0, Math.floor(r.w / 8)) + '…' : r.item.name;
      ctx.fillText(label, r.x + 6, r.y + 13, r.w - 10);
      if (r.h > 34) {
        ctx.font = '10.5px Consolas';
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.fillText(fmt(r.item.size), r.x + 6, r.y + 27, r.w - 10);
      }
    }
  });
  spRenderCrumb();
}

function spRenderCrumb() {
  const parts = [...sp.stack, sp.mapNode].filter(Boolean);
  $('#sp-crumb').innerHTML = parts.length
    ? parts.map((n, i) => `<span data-i="${i}">${esc(n.name)}</span>${i < parts.length - 1 ? ' ›' : ` <b class="dim">${fmt(n.size)}</b>`}`).join(' ')
    : '';
  $('#sp-crumb').querySelectorAll('span').forEach(el =>
    el.addEventListener('click', () => {
      const i = +el.dataset.i;
      const parts2 = [...sp.stack, sp.mapNode];
      sp.mapNode = parts2[i];
      sp.stack = parts2.slice(0, i);
      spRenderMap();
    }));
}

function spHit(ev) {
  const rect = $('#sp-canvas').getBoundingClientRect();
  const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
  // 优先命中内层
  let inner = null, top = null;
  for (const r of sp.rects) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
      if (r.isTop) top = r; else inner = r;
    }
  }
  return { inner, top };
}

$('#sp-canvas').addEventListener('click', ev => {
  const { top } = spHit(ev);
  if (!top) return;
  const node = top.item;
  if (node.children && node.children.length) {
    sp.stack.push(sp.mapNode);
    sp.mapNode = node;
    spRenderMap();
  } else {
    ipcRenderer.invoke('show-in-folder', node.path);
  }
});
$('#sp-canvas').addEventListener('contextmenu', ev => {
  ev.preventDefault();
  if (sp.stack.length) { sp.mapNode = sp.stack.pop(); spRenderMap(); }
});
$('#sp-canvas').addEventListener('mousemove', ev => {
  const { inner, top } = spHit(ev);
  const t = inner || top;
  const tip = $('#sp-tip');
  if (!t) { tip.style.display = 'none'; return; }
  const n = t.item;
  tip.innerHTML = `<b>${esc(n.name)}</b> · ${fmt(n.size)}<br><span style="opacity:.7">${esc(n.path)}</span>`;
  tip.style.display = 'block';
  const wrap = $('#sp-treemap-wrap').getBoundingClientRect();
  let lx = ev.clientX - wrap.left + 14, ly = ev.clientY - wrap.top + 14;
  if (lx + 320 > wrap.width) lx = Math.max(0, wrap.width - 330);
  if (ly + 60 > wrap.height) ly -= 74;
  tip.style.left = lx + 'px'; tip.style.top = ly + 'px';
});
$('#sp-canvas').addEventListener('mouseleave', () => $('#sp-tip').style.display = 'none');
window.addEventListener('resize', () => { if (sp.view === 'map' && sp.root) spRenderMap(); });

/* --- 目录树视图 --- */
function spNodeEl(node, parentSize) {
  const wrap = document.createElement('div');
  const pct = parentSize > 0 ? node.size * 100 / parentSize : 100;
  const row = document.createElement('div');
  row.className = 'tree-row';
  row.innerHTML = `
    <span class="tree-toggle">${node.children.length ? '▶' : ''}</span>
    <span class="tree-size">${fmt(node.size)}</span>
    <span class="tree-bar-wrap"><span class="tree-bar" style="width:${Math.max(2, pct * 0.9)}%"></span></span>
    <span>${esc(node.name)}</span>
    <span class="tree-pct">${pct.toFixed(1)}%</span>`;
  const childBox = document.createElement('div');
  childBox.className = 'tree-children';
  let rendered = false;
  row.addEventListener('click', () => {
    if (!node.children.length) return;
    if (!rendered) { rendered = true; for (const c of node.children) childBox.appendChild(spNodeEl(c, node.size)); }
    const open = childBox.classList.toggle('open');
    row.querySelector('.tree-toggle').textContent = open ? '▼' : '▶';
  });
  row.addEventListener('dblclick', () => ipcRenderer.invoke('open-path', node.path));
  wrap.appendChild(row); wrap.appendChild(childBox);
  return wrap;
}

function spSetView(v) {
  sp.view = v;
  $('#sp-view-map').classList.toggle('on', v === 'map');
  $('#sp-view-tree').classList.toggle('on', v === 'tree');
  $('#sp-canvas').style.display = v === 'map' ? 'block' : 'none';
  $('#sp-tree').style.display = v === 'tree' ? 'block' : 'none';
  $('#sp-crumb').style.display = v === 'map' ? 'flex' : 'none';
  if (v === 'map' && sp.root) spRenderMap();
}

async function spScan() {
  const target = sp.custom || $('#sp-drive').value;
  sp.custom = null;
  if (!target || !fs.existsSync(target)) return ui.toast('请选择磁盘或目录', 'warn');
  $('#sp-path').textContent = '正在扫描：' + target;
  $('#sp-scan').disabled = true; $('#sp-stop').disabled = false;
  $('#sp-tree').innerHTML = '';

  const state = { files: 0, stop: false };
  sp.state = state;
  const timer = setInterval(() => $('#sp-status').textContent = `已扫描 ${state.files.toLocaleString()} 个文件…`, 400);
  try {
    const root = await spBuild(target.replace(/[\\/]+$/, '') + path.sep, state, 0);
    root.name = target;
    sp.root = root; sp.mapNode = root; sp.stack = [];
    const el = spNodeEl(root, root.size);
    $('#sp-tree').appendChild(el);
    el.querySelector('.tree-row').click();
    spRenderMap();
    $('#sp-status').textContent = `扫描完成：${target} 共 ${fmt(root.size)}（${state.files.toLocaleString()} 个文件）`;
    $('#sp-path').textContent = '';
  } catch (e) {
    $('#sp-status').textContent = e.message === 'cancelled' ? '扫描已停止。' : '扫描出错：' + e.message;
  } finally {
    clearInterval(timer);
    $('#sp-scan').disabled = false; $('#sp-stop').disabled = true;
  }
}

$('#sp-browse').addEventListener('click', async () => {
  const p = await ipcRenderer.invoke('pick-folder', '选择要分析的目录');
  if (p) { sp.custom = p; $('#sp-path').textContent = '目标：' + p; }
});
$('#sp-scan').addEventListener('click', spScan);
$('#sp-stop').addEventListener('click', () => { if (sp.state) sp.state.stop = true; });
$('#sp-view-map').addEventListener('click', () => spSetView('map'));
$('#sp-view-tree').addEventListener('click', () => spSetView('tree'));

/* ============================================================
 * 大文件查找
 * ============================================================ */
const bf = { items: [], state: null, custom: null };

async function bfScan() {
  const target = bf.custom || $('#bf-drive').value;
  bf.custom = null;
  if (!target || !fs.existsSync(target)) return ui.toast('请选择磁盘或目录', 'warn');
  const min = +$('#bf-min').value;
  bf.items = [];
  $('#bf-table tbody').innerHTML = '';
  $('#bf-scan').disabled = true; $('#bf-stop').disabled = false; $('#bf-del').disabled = true;

  const state = { files: 0, stop: false };
  bf.state = state;
  const winLower = WIN_DIR.toLowerCase();
  const timer = setInterval(() =>
    $('#bf-status').textContent = `已扫描 ${state.files.toLocaleString()} 个文件，找到 ${bf.items.length} 个大文件…`, 400);
  try {
    await walkFiles(target, state, (p, s) => {
      if (s.size >= min && !p.toLowerCase().startsWith(winLower)) {
        bf.items.push({ p, size: s.size, mtime: s.mtime, checked: false });
      }
    });
    bf.items.sort((a, b) => b.size - a.size);
    if (bf.items.length > 500) bf.items = bf.items.slice(0, 500);
    bfRender();
    $('#bf-status').textContent = `扫描完成：找到 ${bf.items.length} 个大于 ${fmt(min)} 的文件（共扫描 ${state.files.toLocaleString()} 个文件）`;
  } catch (e) {
    if (e.message === 'cancelled') { bf.items.sort((a, b) => b.size - a.size); bfRender(); $('#bf-status').textContent = '扫描已停止（已显示部分结果）。'; }
    else $('#bf-status').textContent = '扫描出错：' + e.message;
  } finally {
    clearInterval(timer);
    $('#bf-scan').disabled = false; $('#bf-stop').disabled = true;
    $('#bf-del').disabled = !bf.items.length;
  }
}

function bfRender() {
  $('#bf-table tbody').innerHTML = bf.items.map((f, i) => `
    <tr data-idx="${i}">
      <td><input type="checkbox" data-idx="${i}" ${f.checked ? 'checked' : ''}></td>
      <td class="num">${fmt(f.size)}</td>
      <td title="${esc(path.basename(f.p))}">${esc(path.basename(f.p))}</td>
      <td class="dim" title="${esc(path.dirname(f.p))}">${esc(path.dirname(f.p))}</td>
      <td class="dim">${f.mtime.toLocaleDateString('zh-CN')}</td>
      <td><button class="mini-btn" data-open="${i}">位置</button></td>
    </tr>`).join('');
  const tb = $('#bf-table tbody');
  tb.querySelectorAll('input').forEach(cb =>
    cb.addEventListener('change', () => bf.items[cb.dataset.idx].checked = cb.checked));
  tb.querySelectorAll('[data-open]').forEach(b =>
    b.addEventListener('click', () => ipcRenderer.invoke('show-in-folder', bf.items[b.dataset.open].p)));
}

async function bfDelete() {
  const picked = bf.items.filter(f => f.checked);
  if (!picked.length) return ui.toast('请先勾选要删除的文件', 'warn');
  const total = picked.reduce((s, f) => s + f.size, 0);
  if (!await ui.confirm('删除到回收站', `将把 <b>${picked.length}</b> 个文件（共 <b>${fmt(total)}</b>）移入回收站。`, { okText: '删除', danger: true })) return;
  ui.busy(true, '正在移入回收站…');
  const { ok, fail } = await recycleFiles(picked.map(f => f.p));
  ui.busy(false);
  bf.items = bf.items.filter(f => !f.checked || !ok);
  // 重新过滤：已删除成功的从列表移除（简单处理：全部重扫状态）
  bf.items = bf.items.filter(f => fs.existsSync(f.p));
  bfRender();
  ui.toast(`已移入回收站 ${ok} 个文件，释放约 ${fmt(total)}` + (fail ? `（${fail} 个失败）` : ''), fail ? 'warn' : 'success', 5000);
}

$('#bf-browse').addEventListener('click', async () => {
  const p = await ipcRenderer.invoke('pick-folder', '选择要扫描的目录');
  if (p) { bf.custom = p; $('#bf-status').textContent = '目标：' + p; }
});
$('#bf-scan').addEventListener('click', bfScan);
$('#bf-stop').addEventListener('click', () => { if (bf.state) bf.state.stop = true; });
$('#bf-del').addEventListener('click', bfDelete);
$('#bf-all').addEventListener('change', () => {
  const on = $('#bf-all').checked;
  bf.items.forEach(f => f.checked = on);
  bfRender();
});

/* ============================================================
 * 重复文件
 * ============================================================ */
const dp = { groups: [], state: null };

async function dpSampleHash(p, size) {
  const fd = await fsp.open(p, 'r');
  try {
    const headLen = Math.min(262144, size);
    const head = Buffer.alloc(headLen);
    await fd.read(head, 0, headLen, 0);
    const h = crypto.createHash('md5').update(head);
    if (size > 262144) {
      const tailLen = Math.min(65536, size - 262144);
      const tail = Buffer.alloc(tailLen);
      await fd.read(tail, 0, tailLen, size - tailLen);
      h.update(tail);
    }
    h.update(String(size));
    return h.digest('hex');
  } finally { await fd.close(); }
}

async function dpScan() {
  const dir = $('#dp-dir').value;
  if (!dir || !fs.existsSync(dir)) return ui.toast('请先选择要扫描的目录', 'warn');
  const min = +$('#dp-min').value;
  dp.groups = [];
  $('#dp-list').innerHTML = '';
  $('#dp-scan').disabled = true; $('#dp-stop').disabled = false; $('#dp-del').disabled = true;

  const state = { files: 0, stop: false };
  dp.state = state;
  const bySize = new Map();
  const timer = setInterval(() => $('#dp-status').textContent = `已扫描 ${state.files.toLocaleString()} 个文件…`, 400);
  try {
    await walkFiles(dir, state, (p, s) => {
      if (s.size < min) return;
      const arr = bySize.get(s.size);
      if (arr) arr.push(p); else bySize.set(s.size, [p]);
    });
    clearInterval(timer);
    const cands = [...bySize.entries()].filter(([, v]) => v.length > 1);
    const totalFiles = cands.reduce((s, [, v]) => s + v.length, 0);
    let done = 0;
    const groups = [];
    for (const [size, paths] of cands) {
      if (state.stop) throw new Error('cancelled');
      $('#dp-status').textContent = `正在比对内容 ${done}/${totalFiles}…`;
      const byHash = new Map();
      // 并发 8 计算哈希
      let idx = 0;
      const worker = async () => {
        while (idx < paths.length) {
          const my = idx++;
          try {
            const h = await dpSampleHash(paths[my], size);
            const arr = byHash.get(h);
            if (arr) arr.push(paths[my]); else byHash.set(h, [paths[my]]);
          } catch { }
          done++;
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, paths.length) }, worker));
      for (const [, files] of byHash)
        if (files.length > 1) groups.push({ size, files: files.sort().map(p => ({ p, checked: false })) });
    }
    groups.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1));
    dp.groups = groups.slice(0, 200);
    dpRender();
    const wasted = groups.reduce((s, g) => s + g.size * (g.files.length - 1), 0);
    $('#dp-status').textContent = groups.length
      ? `找到 ${groups.length} 组重复文件，可释放约 ${fmt(wasted)}${groups.length > 200 ? '（仅显示前 200 组）' : ''}`
      : '未发现重复文件。';
    $('#dp-del').disabled = !groups.length;
  } catch (e) {
    clearInterval(timer);
    $('#dp-status').textContent = e.message === 'cancelled' ? '扫描已停止。' : '扫描出错：' + e.message;
  } finally {
    $('#dp-scan').disabled = false; $('#dp-stop').disabled = true;
  }
}

function dpRender() {
  $('#dp-list').innerHTML = dp.groups.map((g, gi) => `
    <div class="dp-group">
      <div class="dp-group-head">${fmt(g.size)} × ${g.files.length} 个 <span class="tag orange">可释放 ${fmt(g.size * (g.files.length - 1))}</span></div>
      ${g.files.map((f, fi) => `
        <div class="dp-file">
          <input type="checkbox" data-g="${gi}" data-f="${fi}" ${f.checked ? 'checked' : ''}>
          <span class="path dim" title="${esc(f.p)}">${esc(f.p)}</span>
          <button class="mini-btn" data-og="${gi}" data-of="${fi}">位置</button>
        </div>`).join('')}
    </div>`).join('');
  const box = $('#dp-list');
  box.querySelectorAll('input').forEach(cb =>
    cb.addEventListener('change', () => dp.groups[cb.dataset.g].files[cb.dataset.f].checked = cb.checked));
  box.querySelectorAll('[data-og]').forEach(b =>
    b.addEventListener('click', () => ipcRenderer.invoke('show-in-folder', dp.groups[b.dataset.og].files[b.dataset.of].p)));
}

async function dpDelete() {
  const picked = [];
  for (const g of dp.groups) for (const f of g.files) if (f.checked) picked.push({ f, g });
  if (!picked.length) return ui.toast('请先勾选要删除的文件（或点「智能勾选」）', 'warn');
  // 防呆：不允许把某组的全部文件都删掉
  for (const g of dp.groups)
    if (g.files.length && g.files.every(f => f.checked))
      return ui.toast('有分组的全部文件都被勾选了——每组至少要保留一个', 'error', 5000);
  const total = picked.reduce((s, x) => s + x.g.size, 0);
  if (!await ui.confirm('删除重复文件', `将把 <b>${picked.length}</b> 个重复文件（共 <b>${fmt(total)}</b>）移入回收站，每组保留未勾选的文件。`, { okText: '删除', danger: true })) return;
  ui.busy(true, '正在移入回收站…');
  const { ok, fail } = await recycleFiles(picked.map(x => x.f.p));
  ui.busy(false);
  for (const g of dp.groups) g.files = g.files.filter(f => !f.checked || fs.existsSync(f.p));
  dp.groups = dp.groups.filter(g => g.files.length > 1);
  dpRender();
  ui.toast(`已删除 ${ok} 个重复文件，释放约 ${fmt(total)}` + (fail ? `（${fail} 个失败）` : ''), fail ? 'warn' : 'success', 5000);
}

$('#dp-browse').addEventListener('click', async () => {
  const p = await ipcRenderer.invoke('pick-folder', '选择要查重的目录');
  if (p) $('#dp-dir').value = p;
});
$('#dp-scan').addEventListener('click', dpScan);
$('#dp-stop').addEventListener('click', () => { if (dp.state) dp.state.stop = true; });
$('#dp-auto').addEventListener('click', () => {
  for (const g of dp.groups) g.files.forEach((f, i) => f.checked = i > 0);
  dpRender();
  ui.toast('已自动勾选每组除第一个以外的文件', 'info');
});
$('#dp-del').addEventListener('click', dpDelete);

/* ============================================================
 * 启动项管理（注册表 + 启动文件夹 + 计划任务）
 * ============================================================ */
const st = { items: [], sel: -1 };
const ST_BACKUP_KEY = 'HKCU:\\Software\\DiskMate\\DisabledStartup';
const ST_BACKUP_DIR = path.join(DM_DIR, 'DisabledStartup');
const ST_RUNKEYS = {
  RunHKCU: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  RunHKLM: 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
  RunHKLM32: 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run',
};
const ST_FOLDERS = {
  FolderUser: path.join(APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
  FolderCommon: path.join(PROGRAM_DATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'StartUp'),
};
const ST_SOURCE = {
  RunHKCU: '注册表(当前用户)', RunHKLM: '注册表(所有用户)', RunHKLM32: '注册表(32位)',
  FolderUser: '启动文件夹(用户)', FolderCommon: '启动文件夹(公共)', Task: '计划任务',
};

async function stLoad() {
  st.items = []; st.sel = -1;
  $('#st-status').textContent = '正在读取…';
  const script = `
$res=@();
$keys=@(@('RunHKCU','${ST_RUNKEYS.RunHKCU}'),@('RunHKLM','${ST_RUNKEYS.RunHKLM}'),@('RunHKLM32','${ST_RUNKEYS.RunHKLM32}'),@('BK','${ST_BACKUP_KEY}'));
foreach($k in $keys){
 $key=Get-Item -Path $k[1] -ErrorAction SilentlyContinue;
 if($key){foreach($n in $key.GetValueNames()){if($n){$res+=[pscustomobject]@{kind=$k[0];name=$n;cmd=[string]$key.GetValue($n)}}}}
};
ConvertTo-Json -InputObject @($res) -Compress`;
  const rr = await psRun(script);
  for (const it of parseJsonArray(rr.stdout || rr.out)) {
    if (it.kind === 'BK') {
      const i = it.name.indexOf('|');
      if (i <= 0) continue;
      st.items.push({ kind: it.name.slice(0, i), name: it.name.slice(i + 1), cmd: it.cmd, enabled: false });
    } else st.items.push({ kind: it.kind, name: it.name, cmd: it.cmd, enabled: true });
  }
  for (const [kind, dir] of Object.entries(ST_FOLDERS)) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { }
    for (const n of names)
      if (/\.(lnk|exe|bat|cmd|url)$/i.test(n))
        st.items.push({ kind, name: n.replace(/\.[^.]+$/, ''), cmd: path.join(dir, n), enabled: true, file: path.join(dir, n) });
    const bdir = path.join(ST_BACKUP_DIR, kind);
    let bnames = [];
    try { bnames = fs.readdirSync(bdir); } catch { }
    for (const n of bnames)
      st.items.push({ kind, name: n.replace(/\.[^.]+$/, ''), cmd: path.join(bdir, n), enabled: false, file: path.join(bdir, n) });
  }
  // 计划任务（非微软系统任务）
  const tk = await psRun(`Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {$_.TaskPath -notlike '\\Microsoft\\*'} | Select-Object TaskName,TaskPath,State | ConvertTo-Json -Compress`);
  for (const t of parseJsonArray(tk.stdout || tk.out)) {
    const disabled = t.State === 1 || /disabled/i.test(String(t.State));
    st.items.push({ kind: 'Task', name: t.TaskName, cmd: (t.TaskPath || '\\') + t.TaskName, enabled: !disabled, taskPath: t.TaskPath || '\\' });
  }
  stRender();
  $('#st-count').textContent = `共 ${st.items.length} 项，${st.items.filter(i => i.enabled).length} 项已启用`;
  $('#st-status').textContent = '';
}

function stRender() {
  $('#st-table tbody').innerHTML = st.items.map((it, i) => `
    <tr data-idx="${i}">
      <td>${it.enabled ? '<span class="tag green">启用</span>' : '<span class="tag">已禁用</span>'}</td>
      <td title="${esc(it.name)}">${esc(it.name)}</td>
      <td class="dim" title="${esc(it.cmd)}">${esc(it.cmd)}</td>
      <td class="dim">${ST_SOURCE[it.kind] || esc(it.kind)}</td>
    </tr>`).join('');
  st.sel = -1;
}

async function stToggle(disable) {
  if (st.sel < 0) return ui.toast('请先选中一项', 'warn');
  const it = st.items[st.sel];
  if (it.enabled !== disable) return ui.toast(disable ? '该项已是禁用状态' : '该项已是启用状态', 'warn');
  try {
    if (it.kind === 'Task') {
      const cmd = disable ? 'Disable-ScheduledTask' : 'Enable-ScheduledTask';
      const r = await psRun(`${cmd} -TaskPath '${psq(it.taskPath)}' -TaskName '${psq(it.name)}' -ErrorAction Stop | Out-Null; Write-Output OK`);
      if (!/OK/.test(r.stdout || '')) throw new Error((r.stderr || r.out).trim().slice(0, 200));
    } else if (it.kind.startsWith('Run')) {
      if (disable) {
        const r = await psRun(`
New-Item -Path '${ST_BACKUP_KEY}' -Force | Out-Null;
Set-ItemProperty -Path '${ST_BACKUP_KEY}' -Name '${psq(it.kind + '|' + it.name)}' -Value '${psq(it.cmd)}';
Remove-ItemProperty -Path '${ST_RUNKEYS[it.kind]}' -Name '${psq(it.name)}' -ErrorAction Stop; Write-Output OK`);
        if (!/OK/.test(r.stdout || '')) throw new Error((r.stderr || r.out).trim().slice(0, 200));
      } else {
        const r = await psRun(`
Set-ItemProperty -Path '${ST_RUNKEYS[it.kind]}' -Name '${psq(it.name)}' -Value '${psq(it.cmd)}' -ErrorAction Stop;
Remove-ItemProperty -Path '${ST_BACKUP_KEY}' -Name '${psq(it.kind + '|' + it.name)}' -ErrorAction SilentlyContinue; Write-Output OK`);
        if (!/OK/.test(r.stdout || '')) throw new Error((r.stderr || r.out).trim().slice(0, 200));
      }
    } else {
      if (disable) {
        const bdir = path.join(ST_BACKUP_DIR, it.kind);
        fs.mkdirSync(bdir, { recursive: true });
        fs.renameSync(it.file, path.join(bdir, path.basename(it.file)));
      } else {
        fs.renameSync(it.file, path.join(ST_FOLDERS[it.kind], path.basename(it.file)));
      }
    }
    await stLoad();
    ui.toast(disable ? `已禁用「${esc(it.name)}」，可随时恢复` : `已启用「${esc(it.name)}」`, 'success');
  } catch (e) {
    ui.toast((disable ? '禁用' : '启用') + '失败：' + esc(e.message), 'error', 5000);
  }
}

$('#st-refresh').addEventListener('click', stLoad);
$('#st-disable').addEventListener('click', () => stToggle(true));
$('#st-enable').addEventListener('click', () => stToggle(false));
bindRowSelect($('#st-table tbody'), i => st.sel = i);
let stLoaded = false;

/* ============================================================
 * 微信 / QQ 专清
 * ============================================================ */
const tc = { items: [], customRoots: [], busy: false, sortBySize: false };
const SAFE_WORDS = ['cache', 'temp', 'tmp', 'log', 'xlog', 'crash', 'applet', 'wmpf', 'sns', 'thumb'];
const CAUTION_WORDS = ['file', 'video', 'image', 'attach', 'recv', 'msg', 'data', 'backup', 'favorite'];

function tcClassify(name) {
  const n = name.toLowerCase();
  if (SAFE_WORDS.some(w => n.includes(w))) return { cat: '缓存（可安全清理）', safe: true };
  if (CAUTION_WORDS.some(w => n.includes(w))) return { cat: '聊天/数据文件（谨慎）', safe: false };
  return { cat: '其他', safe: false };
}

async function tcDocuments() {
  const r = await psRun(`(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders').Personal`);
  let p = (r.stdout || '').trim().split(/\r?\n/)[0] || '';
  p = p.replace('%USERPROFILE%', os.homedir());
  return p && fs.existsSync(p) ? p : path.join(os.homedir(), 'Documents');
}

function tcListDirs(p) {
  try {
    return fs.readdirSync(p, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.isSymbolicLink())
      .map(e => path.join(p, e.name));
  } catch { return []; }
}

async function tcScan() {
  if (tc.busy) return;
  tc.items = [];
  const docs = await tcDocuments();
  const roots = [
    [path.join(docs, 'WeChat Files'), '微信'],
    [path.join(docs, 'xwechat_files'), '微信'],
    [path.join(docs, 'Tencent Files'), 'QQ'],
    ...tc.customRoots.map(r => [r, '自定义']),
  ];
  for (const [root, app] of roots) {
    if (!fs.existsSync(root)) continue;
    for (const acct of tcListDirs(root)) {
      const acctName = path.basename(acct);
      if (/^(applet|wmpf|all[ _]users)$/i.test(acctName)) {
        const { cat, safe } = tcClassify(acctName);
        tc.items.push({ app, cat, safe, path: acct, size: -1, checked: false });
        continue;
      }
      let added = false;
      for (const sub of tcListDirs(acct)) {
        const subName = path.basename(sub);
        if (/^(filestorage|msg|nt_qq)$/i.test(subName)) {
          for (const deep of tcListDirs(sub)) {
            const { cat, safe } = tcClassify(path.basename(deep));
            tc.items.push({ app, cat, safe, path: deep, size: -1, checked: false });
            added = true;
          }
        } else {
          const { cat, safe } = tcClassify(subName);
          tc.items.push({ app, cat, safe, path: sub, size: -1, checked: false });
          added = true;
        }
      }
      if (!added) tc.items.push({ app, cat: '其他', safe: false, path: acct, size: -1, checked: false });
    }
  }
  if (!tc.items.length) {
    $('#tc-status').textContent = '未找到微信/QQ 数据目录。若修改过保存位置，请用「添加目录」指定。';
    tcRender(); return;
  }
  tc.busy = true; $('#tc-scan').disabled = true; $('#tc-clean').disabled = true;
  $('#tc-status').textContent = '正在计算各目录大小…';
  tcRender();
  let total = 0;
  for (const it of tc.items) {
    it.size = await dirSize(it.path, { files: 0 }).catch(() => 0);
    total += it.size;
    tcUpdateRow(it);
  }
  $('#tc-total').textContent = `合计 ${fmt(total)}`;
  $('#tc-status').textContent = '扫描完成。「勾选全部缓存」可快速选择安全项。';
  $('#tc-scan').disabled = false; $('#tc-clean').disabled = false; tc.busy = false;
}

function tcRender() {
  const arr = tc.sortBySize ? [...tc.items].sort((a, b) => (b.size ?? -1) - (a.size ?? -1)) : tc.items;
  $('#tc-table tbody').innerHTML = arr.map(it => {
    const i = tc.items.indexOf(it);
    const tag = it.safe ? 'green' : (it.cat.startsWith('聊天') ? 'orange' : '');
    return `
    <tr data-idx="${i}">
      <td><input type="checkbox" data-idx="${i}" ${it.checked ? 'checked' : ''}></td>
      <td>${esc(it.app)}</td>
      <td><span class="tag ${tag}">${esc(it.cat)}</span></td>
      <td class="num" data-col="size">${fmt(it.size)}</td>
      <td class="dim" title="${esc(it.path)}">${esc(it.path)}</td>
    </tr>`;
  }).join('');
  $('#tc-table tbody').querySelectorAll('input').forEach(cb =>
    cb.addEventListener('change', () => tc.items[cb.dataset.idx].checked = cb.checked));
}
function tcUpdateRow(it) {
  const i = tc.items.indexOf(it);
  const tr = $('#tc-table tbody').querySelector(`tr[data-idx="${i}"]`);
  if (tr) tr.querySelector('[data-col=size]').textContent = fmt(it.size);
}

async function tcClean() {
  if (tc.busy) return;
  const picked = tc.items.filter(i => i.checked && i.size > 0);
  if (!picked.length) return ui.toast('请先勾选要清理的目录', 'warn');
  const expect = picked.reduce((s, i) => s + i.size, 0);
  const caution = picked.filter(i => !i.safe).length;
  const warn = caution
    ? `<br><br>⚠ 其中 <b>${caution}</b> 项属于「聊天/数据文件」，包含聊天中的原始文件，<b>删除后无法从本机找回</b>！`
    : '';
  if (!await ui.confirm('确认清理', `将清理 <b>${picked.length}</b> 个目录，预计释放 <b>${fmt(expect)}</b>。${warn}`, { okText: '开始清理', danger: caution > 0 })) return;

  tc.busy = true; $('#tc-scan').disabled = true; $('#tc-clean').disabled = true;
  $('#tc-status').textContent = '正在清理…';
  const res = { freed: 0, failed: 0 };
  for (const it of picked) {
    await deleteContents(it.path, res);
    it.size = 0; it.checked = false;
  }
  tcRender();
  $('#tc-status').textContent = `清理完成，共释放 ${fmt(res.freed)}` + (res.failed ? `（${res.failed} 个被占用文件已跳过，退出微信/QQ 后可再清）` : '');
  ui.toast(`🎉 清理完成！释放空间 <b>${fmt(res.freed)}</b>`, 'success', 5000);
  $('#tc-scan').disabled = false; $('#tc-clean').disabled = false; tc.busy = false;
}

$('#tc-scan').addEventListener('click', tcScan);
$('#tc-add').addEventListener('click', async () => {
  const p = await ipcRenderer.invoke('pick-folder', '选择要扫描的目录（如自定义的微信文件保存位置）');
  if (p && !tc.customRoots.includes(p)) {
    tc.customRoots.push(p);
    ui.toast('已添加：' + esc(p) + '，点击「扫描」生效', 'info');
  }
});
$('#tc-safe').addEventListener('click', () => {
  for (const i of tc.items) if (i.safe && i.size > 0) i.checked = true;
  tcRender();
});
$('#tc-clean').addEventListener('click', tcClean);
$('#tc-sort-size').addEventListener('click', () => { tc.sortBySize = !tc.sortBySize; tcRender(); });

/* ============================================================
 * 设置 & 懒加载
 * ============================================================ */
$('#set-moves-path').textContent = MOVES_FILE;
$('#set-open-data').addEventListener('click', () => {
  fs.mkdirSync(DM_DIR, { recursive: true });
  ipcRenderer.invoke('open-path', DM_DIR);
});

window.addEventListener('page-show', e => {
  const p = e.detail;
  if (p === 'mover' && !mvLoaded) { mvLoaded = true; mvLoadApps(); }
  if (p === 'startup' && !stLoaded) { stLoaded = true; stLoad(); }
  if (p === 'space' && sp.view === 'map' && sp.root) spRenderMap();
});

/* ============================================================
 * v2.1 —— 首页实时状态（CPU / 内存）
 * ============================================================ */
let _lastCpu = os.cpus();
function cpuPct() {
  const cur = os.cpus();
  let idle = 0, total = 0;
  for (let i = 0; i < cur.length && i < _lastCpu.length; i++) {
    const a = cur[i].times, b = _lastCpu[i].times;
    const dIdle = a.idle - b.idle;
    const dTotal = (a.user - b.user) + (a.nice - b.nice) + (a.sys - b.sys) + (a.irq - b.irq) + dIdle;
    idle += dIdle; total += dTotal;
  }
  _lastCpu = cur;
  return total > 0 ? 100 * (1 - idle / total) : 0;
}
setInterval(() => {
  if (!$('#page-home').classList.contains('active')) return;
  const c = cpuPct();
  const m = 100 * (1 - os.freemem() / os.totalmem());
  $('#live-cpu-txt').textContent = c.toFixed(0) + '%';
  $('#live-mem-txt').textContent = `${m.toFixed(0)}%（${fmt(os.totalmem() - os.freemem())} / ${fmt(os.totalmem())}）`;
  const cb = $('#live-cpu-bar'), mb = $('#live-mem-bar');
  cb.style.width = c.toFixed(0) + '%'; cb.className = c > 85 ? 'warn' : '';
  mb.style.width = m.toFixed(0) + '%'; mb.className = m > 85 ? 'warn' : '';
}, 2000);

/* ============================================================
 * v2.1 —— 系统加速（进程 / 内存释放）
 * ============================================================ */
const bo = { procs: [], sel: -1, busy: false };

async function boLoad() {
  $('#bo-status').textContent = '正在读取进程…';
  const r = await psRun(`Get-Process | Sort-Object WS -Descending | Select-Object -First 80 Name,Id,WS,MainWindowTitle | ConvertTo-Json -Compress`);
  bo.procs = parseJsonArray(r.stdout || r.out);
  $('#bo-table tbody').innerHTML = bo.procs.map((p, i) => `
    <tr data-idx="${i}">
      <td title="${esc(p.Name)}">${esc(p.Name)}</td>
      <td class="dim">${p.Id}</td>
      <td class="num">${fmt(p.WS)}</td>
      <td class="dim" title="${esc(p.MainWindowTitle || '')}">${esc(p.MainWindowTitle || '')}</td>
    </tr>`).join('');
  bo.sel = -1;
  const totalWs = bo.procs.reduce((s, p) => s + (p.WS || 0), 0);
  $('#bo-status').textContent = `显示内存占用前 ${bo.procs.length} 的进程（合计 ${fmt(totalWs)}）。`;
  $('#bo-total').textContent = `内存使用 ${(100 * (1 - os.freemem() / os.totalmem())).toFixed(0)}%`;
}

async function boTrim() {
  if (bo.busy) return;
  bo.busy = true; $('#bo-trim').disabled = true;
  ui.busy(true, '正在释放各进程闲置内存…');
  const r = await psRun(`
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class MemTrim{[DllImport("psapi.dll")]public static extern int EmptyWorkingSet(IntPtr h);}';
$before=(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory;
$n=0;
foreach($p in Get-Process){ try{ if([MemTrim]::EmptyWorkingSet($p.Handle) -ne 0){$n++} }catch{} };
Start-Sleep -Milliseconds 600;
$after=(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory;
Write-Output "$n $before $after"`);
  ui.busy(false);
  const m = (r.stdout || '').trim().match(/(\d+)\s+(\d+)\s+(\d+)\s*$/);
  if (m) {
    const freed = Math.max(0, (+m[3] - +m[2]) * 1024);
    ui.toast(`⚡ 已优化 ${m[1]} 个进程${freed > 0 ? `，释放内存约 <b>${fmt(freed)}</b>` : ''}`, 'success', 4500);
  } else {
    ui.toast('内存释放完成', 'success');
  }
  bo.busy = false; $('#bo-trim').disabled = false;
  boLoad();
}

async function boKill() {
  if (bo.sel < 0) return ui.toast('请先选中一个进程', 'warn');
  const p = bo.procs[bo.sel];
  const protectedNames = ['system', 'idle', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'smss', 'dwm', 'explorer', 'diskmate', 'electron'];
  if (protectedNames.includes(String(p.Name).toLowerCase()))
    return ui.toast('该进程是系统关键进程或本程序自身，不允许结束', 'error');
  if (!await ui.confirm('结束进程', `确定强制结束【${esc(p.Name)}】(PID ${p.Id})？<br><span class="dim">未保存的数据可能丢失。</span>`, { okText: '结束进程', danger: true })) return;
  const r = await psRun(`Stop-Process -Id ${+p.Id} -Force -ErrorAction Stop; Write-Output OK`);
  if (/OK/.test(r.stdout || '')) { ui.toast(`已结束 ${esc(p.Name)}`, 'success'); boLoad(); }
  else ui.toast('结束失败：' + esc((r.stderr || r.out).trim().slice(0, 150)), 'error', 5000);
}

$('#bo-refresh').addEventListener('click', boLoad);
$('#bo-trim').addEventListener('click', boTrim);
$('#bo-kill').addEventListener('click', boKill);
bindRowSelect($('#bo-table tbody'), i => bo.sel = i);
let boLoaded = false;

/* ============================================================
 * v2.1 —— 隐私清理
 * ============================================================ */
const pv = { items: [], busy: false };

function pvBuild() {
  const recent = path.join(APPDATA, 'Microsoft', 'Windows', 'Recent');
  pv.items = [
    { name: '最近打开的文档记录', desc: '开始菜单/资源管理器里的「最近使用」列表（不影响文件本身）',
      dirs: [recent, path.join(recent, 'AutomaticDestinations'), path.join(recent, 'CustomDestinations')],
      shallow: true, checked: true, size: -1 },
    { name: '「运行」对话框历史', desc: 'Win+R 运行框的历史命令记录', reg: 'RunMRU', checked: true, size: -1 },
    { name: '资源管理器地址栏历史', desc: '文件夹地址栏输入过的路径记录', reg: 'TypedPaths', checked: true, size: -1 },
    { name: '剪贴板内容', desc: '清空当前剪贴板（防止密码等敏感内容残留）', clip: true, checked: true, size: -1 },
    { name: 'Chrome 浏览历史', desc: '删除历史记录数据库（书签/密码不受影响，需先关闭 Chrome）',
      histFiles: pvBrowserHist(path.join(LOCAL, 'Google', 'Chrome', 'User Data')), checked: false, size: -1 },
    { name: 'Edge 浏览历史', desc: '删除历史记录数据库（书签/密码不受影响，需先关闭 Edge）',
      histFiles: pvBrowserHist(path.join(LOCAL, 'Microsoft', 'Edge', 'User Data')), checked: false, size: -1 },
  ];
}
function pvBrowserHist(ud) {
  const out = [];
  let profiles = [];
  try { profiles = fs.readdirSync(ud).filter(n => n === 'Default' || /^Profile/i.test(n)); } catch { return out; }
  for (const p of profiles)
    for (const f of ['History', 'History-journal', 'Visited Links', 'Top Sites', 'Top Sites-journal'])
      { const fp = path.join(ud, p, f); if (fs.existsSync(fp)) out.push(fp); }
  return out;
}

async function pvScan() {
  if (pv.busy) return;
  pv.busy = true; $('#pv-scan').disabled = true; $('#pv-clean').disabled = true;
  pvBuild();
  let total = 0;
  for (const it of pv.items) {
    let size = 0, count = 0;
    if (it.reg) {
      const r = await psRun(`$k=Get-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\${it.reg}' -ErrorAction SilentlyContinue; if($k){Write-Output $k.GetValueNames().Count}else{Write-Output 0}`);
      count = parseInt((r.stdout || '').trim().split(/\s+/).pop()) || 0;
      it.count = count; size = 0;
    } else if (it.clip) {
      it.count = -1;
    } else if (it.histFiles) {
      for (const f of it.histFiles) { try { size += fs.statSync(f).size; count++; } catch { } }
      it.count = count;
    } else if (it.dirs) {
      for (const d of it.dirs) {
        let names = [];
        try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
        for (const e of names) {
          if (!e.isFile()) continue;
          try { size += fs.statSync(path.join(d, e.name)).size; count++; } catch { }
        }
      }
      it.count = count;
    }
    it.size = size; total += size;
  }
  pvRender();
  $('#pv-total').textContent = `共 ${pv.items.reduce((s, i) => s + Math.max(0, i.count || 0), 0)} 条痕迹`;
  $('#pv-status').textContent = '扫描完成，勾选后点击「一键清除」。';
  $('#pv-scan').disabled = false; $('#pv-clean').disabled = false; pv.busy = false;
}

function pvRender() {
  $('#pv-list').innerHTML = pv.items.map((it, i) => `
    <div class="jk-row">
      <input type="checkbox" data-idx="${i}" ${it.checked ? 'checked' : ''}>
      <div class="jk-info">
        <div class="jk-name">${esc(it.name)}</div>
        <div class="jk-desc">${esc(it.desc)}</div>
      </div>
      <div class="jk-size">${it.size < 0 ? '<span class="dim">未扫描</span>' :
        (it.clip ? '<span class="dim">—</span>' :
         `${it.count} 条${it.size > 0 ? ' · ' + fmt(it.size) : ''}`)}</div>
    </div>`).join('');
  $('#pv-list').querySelectorAll('input').forEach(cb =>
    cb.addEventListener('change', () => pv.items[cb.dataset.idx].checked = cb.checked));
}

async function pvClean() {
  if (pv.busy) return;
  const picked = pv.items.filter(i => i.checked && (i.clip || (i.count || 0) > 0));
  if (!picked.length) return ui.toast('没有勾选任何有内容的项目', 'warn');
  if (!await ui.confirm('清除痕迹', `将清除 <b>${picked.length}</b> 类使用痕迹。浏览历史清除后不可恢复。`, { okText: '清除', danger: true })) return;
  pv.busy = true; $('#pv-clean').disabled = true;
  let cleaned = 0, failed = 0;
  for (const it of picked) {
    if (it.reg) {
      await psRun(`Remove-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\${it.reg}' -ErrorAction SilentlyContinue`);
      cleaned += it.count || 0;
    } else if (it.clip) {
      await execCmd('echo off | clip');
      cleaned++;
    } else if (it.histFiles) {
      for (const f of it.histFiles) { try { fs.unlinkSync(f); cleaned++; } catch { failed++; } }
    } else if (it.dirs) {
      for (const d of it.dirs) {
        let names = [];
        try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
        for (const e of names) {
          if (!e.isFile()) continue;
          try { fs.unlinkSync(path.join(d, e.name)); cleaned++; } catch { failed++; }
        }
      }
    }
    it.size = -1; it.count = 0;
  }
  pv.busy = false;
  ui.toast(`已清除 ${cleaned} 条痕迹` + (failed ? `（${failed} 条被占用，关闭浏览器后重试）` : ''), failed ? 'warn' : 'success', 4500);
  pvScan();
}

$('#pv-scan').addEventListener('click', pvScan);
$('#pv-clean').addEventListener('click', pvClean);
pvBuild(); pvRender();

/* ============================================================
 * v2.1 —— 软件更新（winget）
 * ============================================================ */
const up = { rows: [], busy: false };

async function upScan() {
  if (up.busy) return;
  up.busy = true; $('#up-scan').disabled = true;
  $('#up-status').textContent = '正在通过 winget 检查更新（首次可能较慢）…';
  $('#up-table tbody').innerHTML = '';
  const r = await execCmd('chcp 65001 >nul & winget upgrade --include-unknown --accept-source-agreements --disable-interactivity');
  up.busy = false; $('#up-scan').disabled = false;
  if (/'winget'|不是内部或外部命令|not recognized/i.test(r.out) || (r.code !== 0 && !r.out.trim())) {
    $('#up-status').textContent = '未找到 winget（Windows 应用安装程序）。可在 Microsoft Store 安装「应用安装程序」后重试。';
    return;
  }
  const lines = r.out.split(/\r?\n/);
  const headIdx = lines.findIndex(l => /^(名称|Name)\s{2,}/.test(l.trim()));
  if (headIdx < 0) {
    $('#up-status').textContent = /升级|upgrades|No installed package/i.test(r.out)
      ? '所有软件均为最新版本 🎉' : '未能解析 winget 输出。';
    return;
  }
  const rows = [];
  for (let i = headIdx + 2; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l || /^\d+\s|^-{3,}/.test(l) === false && /升级|upgrade|available/i.test(l) && l.split(/\s{2,}/).length < 3) continue;
    const parts = l.split(/\s{2,}/).filter(Boolean);
    if (parts.length >= 4) {
      const src = parts[parts.length - 1];
      if (!/winget|msstore/i.test(src)) continue;
      rows.push({ name: parts[0], id: parts[1], cur: parts[2], next: parts[3] });
    }
  }
  up.rows = rows;
  $('#up-table tbody').innerHTML = rows.map((x, i) => `
    <tr data-idx="${i}">
      <td title="${esc(x.name)}">${esc(x.name)}</td>
      <td class="dim">${esc(x.cur)}</td>
      <td><span class="tag green">${esc(x.next)}</span></td>
      <td class="dim" title="${esc(x.id)}">${esc(x.id)}</td>
      <td><button class="mini-btn" data-up="${i}">升级</button></td>
    </tr>`).join('');
  $('#up-total').textContent = rows.length ? `${rows.length} 个可更新` : '';
  $('#up-status').textContent = rows.length ? '点击「升级」自动下载安装最新版。' : '所有软件均为最新版本 🎉';
  $('#up-table tbody').querySelectorAll('[data-up]').forEach(b =>
    b.addEventListener('click', () => upDo(+b.dataset.up, b)));
}

async function upDo(i, btn) {
  const x = up.rows[i];
  btn.disabled = true; btn.textContent = '升级中…';
  ui.toast(`开始升级 ${esc(x.name)}，请稍候…`, 'info');
  const r = await execCmd(`chcp 65001 >nul & winget upgrade --id "${x.id}" --silent --accept-package-agreements --accept-source-agreements --disable-interactivity`);
  if (r.code === 0) { ui.toast(`✅ ${esc(x.name)} 升级完成`, 'success'); btn.textContent = '已完成'; }
  else { ui.toast(`${esc(x.name)} 升级失败（可能需要手动安装）`, 'error', 5000); btn.disabled = false; btn.textContent = '升级'; }
}

$('#up-scan').addEventListener('click', upScan);

/* ============================================================
 * v2.1 —— 工具箱
 * ============================================================ */
const TOOLS = [
  { ico: '🛠️', name: '系统文件修复', desc: '运行 SFC /scannow 检查并修复受损系统文件（弹出窗口显示进度）',
    run: () => execCmd('start "系统文件修复" cmd /k sfc /scannow') },
  { ico: '🧊', name: 'WinSxS 组件瘦身', desc: '清理系统组件存储中的过期更新（可回收数 GB，弹窗显示进度）',
    run: () => execCmd('start "组件清理" cmd /k Dism.exe /Online /Cleanup-Image /StartComponentCleanup') },
  { ico: '🌐', name: '刷新 DNS 缓存', desc: '解决部分网页打不开/解析异常的问题',
    run: async () => { const r = await execCmd('ipconfig /flushdns'); ui.toast(r.code === 0 ? 'DNS 缓存已刷新' : '操作失败', r.code === 0 ? 'success' : 'error'); } },
  { ico: '📡', name: '重置网络', desc: '重置 Winsock（网络异常时使用，完成后需重启电脑）', confirm: '将执行 netsh winsock reset，完成后需要重启电脑生效。',
    run: async () => { const r = await execCmd('netsh winsock reset'); ui.toast(r.code === 0 ? '网络已重置，请重启电脑生效' : '操作失败', r.code === 0 ? 'success' : 'error', 5000); } },
  { ico: '🖼️', name: '重建图标缓存', desc: '修复桌面/资源管理器图标显示异常（会重启资源管理器）', confirm: '将重启资源管理器（桌面会闪一下），并重建图标缓存。',
    run: async () => {
      await execCmd('taskkill /f /im explorer.exe');
      await execCmd(`del /f /q "${LOCAL}\\IconCache.db" & del /f /q "${LOCAL}\\Microsoft\\Windows\\Explorer\\iconcache_*.db"`);
      await execCmd('start explorer.exe');
      ui.toast('图标缓存已重建', 'success');
    } },
  { ico: '🔥', name: '文件粉碎', desc: '用随机数据覆写后删除，防止文件被恢复（不可逆！）',
    run: async () => {
      const files = await ipcRenderer.invoke('pick-files', '选择要粉碎的文件（不可恢复！）');
      if (!files.length) return;
      const total = files.reduce((s, f) => { try { return s + fs.statSync(f).size; } catch { return s; } }, 0);
      if (!await ui.confirm('文件粉碎', `将<b>彻底粉碎</b> ${files.length} 个文件（${fmt(total)}）：<br>${files.slice(0, 5).map(esc).join('<br>')}${files.length > 5 ? '<br>…' : ''}<br><br><b style="color:#EF4444">粉碎后任何软件都无法恢复！</b>`, { okText: '确认粉碎', danger: true })) return;
      ui.busy(true, '正在粉碎文件…');
      let ok = 0, fail = 0;
      for (const f of files) {
        try {
          const size = fs.statSync(f).size;
          const fd = fs.openSync(f, 'r+');
          const buf = crypto.randomBytes(Math.min(size, 4 * 1048576));
          let off = 0;
          while (off < size) { const n = Math.min(buf.length, size - off); fs.writeSync(fd, buf, 0, n, off); off += n; }
          fs.closeSync(fd);
          const tmp = path.join(path.dirname(f), 'dm_' + Math.random().toString(36).slice(2) + '.tmp');
          fs.renameSync(f, tmp);
          fs.unlinkSync(tmp);
          ok++;
        } catch { fail++; }
      }
      ui.busy(false);
      ui.toast(`已粉碎 ${ok} 个文件` + (fail ? `（${fail} 个失败，可能被占用）` : ''), fail ? 'warn' : 'success', 5000);
    } },
  { ico: '🧮', name: '磁盘清理(系统)', desc: '打开 Windows 自带磁盘清理工具', run: () => execCmd('start cleanmgr') },
  { ico: '📋', name: '任务管理器', desc: '查看进程 / 性能 / 启动详情', run: () => execCmd('start taskmgr') },
  { ico: '🔧', name: '设备管理器', desc: '查看和管理硬件设备驱动', run: () => execCmd('start devmgmt.msc') },
  { ico: '⚙️', name: '系统配置', desc: '打开 msconfig（引导 / 服务管理）', run: () => execCmd('start msconfig') },
  { ico: '🗄️', name: '服务管理', desc: '打开 services.msc 管理系统服务', run: () => execCmd('start services.msc') },
  { ico: '📊', name: '磁盘管理', desc: '分区 / 格式化 / 更改盘符', run: () => execCmd('start diskmgmt.msc') },
];

$('#tool-grid').innerHTML = TOOLS.map((t, i) => `
  <div class="tool-card" data-idx="${i}">
    <div class="t-ico">${t.ico}</div>
    <div class="t-name">${esc(t.name)}</div>
    <div class="t-desc">${esc(t.desc)}</div>
  </div>`).join('');
$('#tool-grid').querySelectorAll('.tool-card').forEach(card =>
  card.addEventListener('click', async () => {
    const t = TOOLS[card.dataset.idx];
    if (t.confirm && !await ui.confirm(t.name, t.confirm, { okText: '执行', danger: true })) return;
    t.run();
  }));

/* v2.1 懒加载 */
window.addEventListener('page-show', e => {
  if (e.detail === 'boost' && !boLoaded) { boLoaded = true; boLoad(); }
});
