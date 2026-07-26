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

  hmStats();
}

function hmStats() {
  const sys = hm.drives.find(d => (d.DeviceID + '\\').toLowerCase() === SYS_DRIVE.toLowerCase()) || hm.drives[0];
  const memUsedPct = (100 * (1 - os.freemem() / os.totalmem())).toFixed(0);
  const cards = [
    { ico: '💽', label: '磁盘分区', num: hm.drives.length, grad: true },
    { ico: '🖴', label: `系统盘可用（${sys ? esc(sys.DeviceID) : 'C:'}）`, num: sys ? fmt(sys.FreeSpace) : '—' },
    { ico: '⚙️', label: '内存占用', num: memUsedPct + '%', grad: true },
    { ico: '🧠', label: '总内存', num: fmt(os.totalmem()) },
    { ico: '🩺', label: '健康评分', num: hm.checked ? ($('#score-val').textContent || '—') : '未体检', id: 'stat-score' },
  ];
  $('#hm-stats').innerHTML = cards.map(c => `
    <div class="stat-card">
      <div class="stat-top">
        <div class="stat-ico">${c.ico}</div>
        <div class="stat-label">${c.label}</div>
      </div>
      <div class="stat-num ${c.grad ? 'grad' : ''}">${c.num}</div>
    </div>`).join('');
  ui.stagger($('#page-home'));
}

async function hmCheck() {
  $('#hm-check').disabled = true;
  $('#score-card').classList.add('checking');
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
  $('#score-card').classList.remove('checking');
  ui.countUp($('#score-val'), score, { dur: 1100 });
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
  setTimeout(hmStats, 60);
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
      // 先清掉 robocopy 的部分残留，否则 mklink /J 会因目录已存在而失败
      if (fs.existsSync(rec.source) && !isJunction(rec.source)) {
        const res0 = { freed: 0, failed: 0 };
        await deleteDirectory(rec.source, res0);
      }
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
  $('#jk-scan').disabled = false; $('#jk-clean').disabled = false; jk.busy = false;
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
    const truncated = bf.items.length > 500;
    if (truncated) bf.items = bf.items.slice(0, 500);
    bfRender();
    $('#bf-status').textContent = `扫描完成：找到 ${bf.items.length} 个大于 ${fmt(min)} 的文件（共扫描 ${state.files.toLocaleString()} 个文件）` +
      (truncated ? '，仅显示最大的 500 个' : '');
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
    </tr>`).join('') || '<tr><td colspan="6"><div class="empty-state"><span class="es-ico">📂</span>未找到符合条件的大文件</div></td></tr>';
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
  // 仅移除磁盘上确实已不存在的文件（删除失败的会保留在列表中）
  const freed = bf.items.filter(f => f.checked && !fs.existsSync(f.p)).reduce((s, f) => s + f.size, 0);
  bf.items = bf.items.filter(f => fs.existsSync(f.p));
  bfRender();
  ui.toast(`已移入回收站 ${ok} 个文件，释放约 ${fmt(freed)}` + (fail ? `（${fail} 个失败，可能被占用）` : ''), fail ? 'warn' : 'success', 5000);
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
  if (!await ui.confirm('删除重复文件', `将把 <b>${picked.length}</b> 个重复文件（共 <b>${fmt(total)}</b>）移入回收站，每组保留未勾选的文件。<br><span class="dim">删除前会对每个文件与保留文件做逐字节校验，确保内容完全一致。</span>`, { okText: '删除', danger: true })) return;
  ui.busy(true, '正在逐字节校验内容…');
  // 采样哈希可能碰撞，删除前对每个待删文件与本组“保留文件”做真实逐字节比对
  const safe = [], skipped = [];
  for (const x of picked) {
    const keeper = x.g.files.find(f => !f.checked);
    if (keeper && await filesEqual(keeper.p, x.f.p)) safe.push(x);
    else skipped.push(x);
  }
  if (!safe.length) {
    ui.busy(false);
    return ui.toast('校验后未发现内容完全一致的可删文件（已避免误删）', 'warn', 5000);
  }
  ui.busy(true, '正在移入回收站…');
  const { ok, fail } = await recycleFiles(safe.map(x => x.f.p));
  ui.busy(false);
  for (const g of dp.groups) g.files = g.files.filter(f => fs.existsSync(f.p));
  dp.groups = dp.groups.filter(g => g.files.length > 1);
  dpRender();
  const freed = safe.reduce((s, x) => s + x.g.size, 0);
  ui.toast(`已删除 ${ok} 个重复文件，释放约 ${fmt(freed)}` +
    (skipped.length ? `<br><span class="dim">${skipped.length} 个经校验内容不一致，已跳过</span>` : '') +
    (fail ? `（${fail} 个失败）` : ''), (fail || skipped.length) ? 'warn' : 'success', 5500);
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
  // 去掉进度条回车残留（\r 之后为最终内容）
  const lines = r.out.split(/\r?\n/).map(l => l.includes('\r') ? l.split('\r').pop() : l);
  const headIdx = lines.findIndex(l => /^(名称|Name)\s+(ID)\s+/.test(l));
  if (headIdx < 0) {
    $('#up-status').textContent = /No installed package|没有可用的升级|无可用升级|as no available upgrade/i.test(r.out)
      ? '所有软件均为最新版本 🎉' : '未能解析 winget 输出。';
    return;
  }
  // 按表头各列的字符起始位置切固定宽度列（比按空白 split 更稳）
  const head = lines[headIdx];
  const colAt = re => { const m = head.match(re); return m ? m.index : -1; };
  const cId = colAt(/\bID\b/), cVer = colAt(/(版本|Version)/),
        cAvail = colAt(/(可用|Available)/), cSrc = colAt(/(源|Source)/);
  const rows = [];
  const slice = (l, a, b) => (a < 0 ? '' : (b < 0 ? l.slice(a) : l.slice(a, b))).trim();
  for (let i = headIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || /^-{3,}$/.test(l.trim()) || /^\d+\s+(升级|upgrades?|package)/i.test(l.trim())) continue;
    if (l.length < cAvail) continue;
    const name = slice(l, 0, cId), id = slice(l, cId, cVer),
          cur = slice(l, cVer, cAvail), next = slice(l, cAvail, cSrc),
          src = slice(l, cSrc, -1);
    if (!id || !next) continue;
    if (cSrc >= 0 && src && !/winget|msstore/i.test(src)) continue;
    rows.push({ name: name || id, id, cur, next });
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
  { ico: '⏱️', name: '创建系统还原点', desc: '为当前系统状态创建还原点，出问题时可回退',
    run: async () => {
      if (!await ui.confirm('创建系统还原点', '将为当前系统创建一个还原点（需要系统保护已开启，可能耗时 1-2 分钟）。')) return;
      ui.busy(true, '正在创建还原点…');
      const r = await psRun(`Enable-ComputerRestore -Drive '${psq(SYS_DRIVE)}' -ErrorAction SilentlyContinue; Checkpoint-Computer -Description 'DiskMate 手动还原点' -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop; Write-Output OK`);
      ui.busy(false);
      ui.toast(/OK/.test(r.stdout || '') ? '✅ 系统还原点已创建' : '创建失败：' + esc((r.stderr || r.out).trim().slice(0, 150)), /OK/.test(r.stdout || '') ? 'success' : 'error', 5000);
    } },
  { ico: '🔙', name: '打开系统还原', desc: '打开 Windows 系统还原向导（回退到还原点）', run: () => execCmd('start rstrui') },
  { ico: '📝', name: 'Hosts 编辑器', desc: '用记事本以管理员权限编辑 hosts 文件（域名映射）',
    run: () => execCmd(`start notepad "${WIN_DIR}\\System32\\drivers\\etc\\hosts"`) },
  { ico: '🔋', name: '电池健康报告', desc: '生成笔记本电池损耗报告（HTML，自动打开）',
    run: async () => {
      ui.busy(true, '正在生成电池报告…');
      const out = path.join(DM_DIR, 'battery-report.html');
      fs.mkdirSync(DM_DIR, { recursive: true });
      const r = await execCmd(`powercfg /batteryreport /output "${out}"`);
      ui.busy(false);
      if (fs.existsSync(out)) { ipcRenderer.invoke('open-path', out); ui.toast('电池报告已生成', 'success'); }
      else ui.toast('生成失败（台式机可能无电池）', 'warn', 4000);
    } },
  { ico: '🧩', name: '磁盘优化/碎片整理', desc: '打开 Windows 磁盘优化工具（SSD 执行 TRIM）', run: () => execCmd('start dfrgui') },
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

/* ============================================================
 * v2.2 —— 驱动管理
 * ============================================================ */
const dv = { list: [], busy: false };

async function dvScan() {
  if (dv.busy) return;
  dv.busy = true; $('#dv-scan').disabled = true;
  $('#dv-status').textContent = '正在读取驱动列表…';
  // 已签名驱动 + 有问题的 PnP 设备（ConfigManagerErrorCode != 0）
  const r = await psRun(`
$bad=@{};
Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object {$_.ConfigManagerErrorCode -ne 0} | ForEach-Object { if($_.PNPDeviceID){$bad[$_.PNPDeviceID]=$_.ConfigManagerErrorCode} };
$d=Get-CimInstance Win32_PnPSignedDriver -ErrorAction SilentlyContinue | Where-Object {$_.DeviceName} | Select-Object DeviceName,DriverVersion,DriverDate,Manufacturer,DeviceClass,DeviceID;
$d | ForEach-Object { $_ | Add-Member -NotePropertyName Err -NotePropertyValue ([int]($bad[$_.DeviceID])) -PassThru } | ConvertTo-Json -Compress -Depth 2`);
  dv.busy = false; $('#dv-scan').disabled = false;
  const rows = parseJsonArray(r.stdout || r.out);
  dv.list = rows.map(x => ({
    name: x.DeviceName || '', ver: x.DriverVersion || '', mfr: x.Manufacturer || '',
    cls: x.DeviceClass || '', err: x.Err || 0,
    date: (String(x.DriverDate || '').match(/^\d{8}|\/Date\((\d+)\)/) ? dvFmtDate(x.DriverDate) : ''),
  }));
  dvRender();
  const bad = dv.list.filter(d => d.err).length;
  $('#dv-total').textContent = `共 ${dv.list.length} 个驱动` + (bad ? ` · ${bad} 个异常` : '');
  $('#dv-status').textContent = bad ? `发现 ${bad} 个异常设备（黄色叹号），建议更新或重装其驱动。` : '所有设备驱动工作正常。';
}

function dvFmtDate(v) {
  const s = String(v);
  let m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/\/Date\((\d+)\)/);
  if (m) { const d = new Date(+m[1]); return isFinite(d) ? d.toISOString().slice(0, 10) : ''; }
  return '';
}

function dvRender() {
  const kw = $('#dv-filter').value.trim().toLowerCase();
  const onlyBad = $('#dv-onlybad').checked;
  const arr = dv.list.filter(d =>
    (!onlyBad || d.err) &&
    (!kw || d.name.toLowerCase().includes(kw) || d.mfr.toLowerCase().includes(kw)));
  $('#dv-table tbody').innerHTML = arr.map(d => `
    <tr>
      <td>${d.err ? '<span class="tag red">异常</span>' : '<span class="tag green">正常</span>'}</td>
      <td title="${esc(d.name)}">${esc(d.name)}</td>
      <td class="dim" title="${esc(d.mfr)}">${esc(d.mfr)}</td>
      <td class="dim">${esc(d.ver)}</td>
      <td class="dim">${esc(d.date)}</td>
      <td class="dim">${esc(d.cls)}</td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:24px" class="dim">无匹配结果</td></tr>';
}

async function dvBackup() {
  const dir = await ipcRenderer.invoke('pick-folder', '选择驱动备份目录（建议空文件夹）');
  if (!dir) return;
  const target = path.join(dir, 'DriverBackup_' + new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  if (!await ui.confirm('备份全部驱动', `将把本机所有第三方驱动导出到：<br><b>${esc(target)}</b><br><br>该过程可能需要几分钟。`, { okText: '开始备份' })) return;
  ui.busy(true, '正在导出驱动（可能需要几分钟）…');
  fs.mkdirSync(target, { recursive: true });
  // 优先 DISM（含 inf 依赖），失败回退 pnputil
  let r = await psRun(`Export-WindowsDriver -Online -Destination '${psq(target)}' -ErrorAction SilentlyContinue | Out-Null; Write-Output DONE`);
  if (!/DONE/.test(r.stdout || '')) r = await execCmd(`pnputil /export-driver * "${target}"`);
  ui.busy(false);
  let count = 0;
  try { count = fs.readdirSync(target).length; } catch { }
  if (count > 0) {
    ui.toast(`✅ 驱动已备份到 ${count} 个文件夹`, 'success', 5000);
    ipcRenderer.invoke('open-path', target);
  } else {
    ui.toast('备份未生成文件，请确认以管理员身份运行', 'error', 5000);
  }
}

$('#dv-scan').addEventListener('click', dvScan);
$('#dv-filter').addEventListener('input', () => dv.list.length && dvRender());
$('#dv-onlybad').addEventListener('change', () => dv.list.length && dvRender());
$('#dv-backup').addEventListener('click', dvBackup);
let dvLoaded = false;

/* ============================================================
 * v2.2 —— 硬件信息
 * ============================================================ */
const hw = { text: '' };

async function hwScan() {
  $('#hw-status').textContent = '正在读取硬件信息…';
  $('#hw-grid').innerHTML = '<span class="dim">读取中…</span>';
  const r = await psRun(`
$o=[ordered]@{};
$cs=Get-CimInstance Win32_ComputerSystem; $bios=Get-CimInstance Win32_BIOS; $bb=Get-CimInstance Win32_BaseBoard; $os=Get-CimInstance Win32_OperatingSystem;
$o.cpu=@(Get-CimInstance Win32_Processor | ForEach-Object { [ordered]@{name=$_.Name.Trim();cores=$_.NumberOfCores;threads=$_.NumberOfLogicalProcessors;mhz=$_.MaxClockSpeed} });
$o.gpu=@(Get-CimInstance Win32_VideoController | Where-Object {$_.Name} | ForEach-Object { [ordered]@{name=$_.Name;ram=[int64]$_.AdapterRAM;drv=$_.DriverVersion} });
$o.mem=@(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { [ordered]@{cap=[int64]$_.Capacity;speed=$_.Speed;mfr=$_.Manufacturer;slot=$_.DeviceLocator} });
$o.disk=@(Get-CimInstance Win32_DiskDrive | ForEach-Object { [ordered]@{model=$_.Model;size=[int64]$_.Size;type=$_.MediaType} });
$o.mon=@(Get-CimInstance Win32_DesktopMonitor -ErrorAction SilentlyContinue | Where-Object {$_.ScreenWidth} | ForEach-Object { [ordered]@{w=$_.ScreenWidth;h=$_.ScreenHeight} });
$o.sys=[ordered]@{maker=$cs.Manufacturer;model=$cs.Model;board=($bb.Manufacturer+' '+$bb.Product);bios=($bios.Manufacturer+' '+$bios.SMBIOSBIOSVersion);os=$os.Caption;osver=$os.Version;host=$cs.Name};
$o | ConvertTo-Json -Compress -Depth 4`);
  const d = parseJsonArray('[' + (r.stdout || r.out).trim() + ']')[0] || {};
  const cards = [];
  const arr = x => Array.isArray(x) ? x : (x ? [x] : []);

  cards.push(hwCard('🧠', '处理器', arr(d.cpu).map(c =>
    [[c.name, ''], ['核心 / 线程', `${c.cores} 核 ${c.threads} 线程`], ['主频', c.mhz ? (c.mhz / 1000).toFixed(2) + ' GHz' : '-']]).flat()));

  cards.push(hwCard('🎮', '显卡', arr(d.gpu).map(g =>
    [[g.name, ''], ['显存', g.ram > 0 ? fmt(g.ram) : '共享/未知'], ['驱动版本', g.drv || '-']]).flat()));

  const memRows = arr(d.mem).map(m => [`${m.slot || '内存'}`, `${fmt(m.cap)} ${m.speed ? m.speed + 'MHz' : ''} ${(m.mfr || '').trim()}`.trim()]);
  const memTotal = arr(d.mem).reduce((s, m) => s + (m.cap || 0), 0);
  cards.push(hwCard('💾', `内存（共 ${fmt(memTotal)}）`, memRows.length ? memRows : [['—', '未读取到']]));

  cards.push(hwCard('🗄️', '硬盘', arr(d.disk).map(k =>
    [k.model || '磁盘', `${fmt(k.size)} ${/ssd/i.test(k.type || '') ? 'SSD' : (k.type || '')}`.trim()])));

  if (d.sys) {
    const s = d.sys;
    cards.push(hwCard('🖥️', '主机 / 系统', [
      ['厂商型号', `${(s.maker || '').trim()} ${(s.model || '').trim()}`.trim() || '-'],
      ['主板', (s.board || '').trim() || '-'],
      ['BIOS', (s.bios || '').trim() || '-'],
      ['操作系统', s.os || '-'],
      ['系统版本', s.osver || '-'],
      ['计算机名', s.host || '-'],
    ]));
  }
  const mons = arr(d.mon);
  if (mons.length) cards.push(hwCard('📺', '显示器', mons.map((m, i) => [`显示器 ${i + 1}`, `${m.w} × ${m.h}`])));

  $('#hw-grid').innerHTML = cards.join('');
  // 生成纯文本清单
  hw.text = cards2text(d, arr, memTotal);
  $('#hw-status').textContent = '读取完成。';
}

function hwCard(ico, title, kvs) {
  const rows = kvs.filter(kv => kv[0]).map(kv =>
    kv[1] === '' ? `<div class="hw-kv"><span class="v" style="text-align:left;font-weight:600">${esc(kv[0])}</span></div>`
                 : `<div class="hw-kv"><span class="k">${esc(kv[0])}</span><span class="v">${esc(kv[1])}</span></div>`).join('');
  return `<div class="hw-card"><div class="hw-head"><span class="hw-ico">${ico}</span>${esc(title)}</div>${rows}</div>`;
}

function cards2text(d, arr, memTotal) {
  const L = [];
  L.push('===== 本机硬件配置清单 =====');
  L.push('生成时间：' + new Date().toLocaleString('zh-CN'));
  L.push('');
  arr(d.cpu).forEach(c => L.push(`处理器：${c.name}（${c.cores}核${c.threads}线程 @ ${(c.mhz / 1000).toFixed(2)}GHz）`));
  arr(d.gpu).forEach(g => L.push(`显卡：${g.name}${g.ram > 0 ? '（' + fmt(g.ram) + '）' : ''}`));
  L.push(`内存：共 ${fmt(memTotal)}`);
  arr(d.mem).forEach(m => L.push(`  - ${m.slot}: ${fmt(m.cap)} ${m.speed ? m.speed + 'MHz' : ''} ${(m.mfr || '').trim()}`));
  arr(d.disk).forEach(k => L.push(`硬盘：${k.model}（${fmt(k.size)}）`));
  if (d.sys) { L.push(`主板：${(d.sys.board || '').trim()}`); L.push(`系统：${d.sys.os}（${d.sys.osver}）`); }
  return L.join('\n');
}

$('#hw-scan').addEventListener('click', hwScan);
$('#hw-copy').addEventListener('click', () => {
  if (!hw.text) return ui.toast('请先刷新读取硬件信息', 'warn');
  require('electron').clipboard.writeText(hw.text);
  ui.toast('配置清单已复制到剪贴板', 'success');
});
$('#hw-export').addEventListener('click', async () => {
  if (!hw.text) return ui.toast('请先刷新读取硬件信息', 'warn');
  const dir = await ipcRenderer.invoke('pick-folder', '选择保存位置');
  if (!dir) return;
  const fp = path.join(dir, '硬件配置清单.txt');
  try { fs.writeFileSync(fp, hw.text, 'utf8'); ui.toast('已保存：' + esc(fp), 'success', 4000); ipcRenderer.invoke('show-in-folder', fp); }
  catch (e) { ui.toast('保存失败：' + esc(e.message), 'error'); }
});

/* v2.2 懒加载 */
window.addEventListener('page-show', e => {
  if (e.detail === 'driver' && !dvLoaded) { dvLoaded = true; dvScan(); }
  if (e.detail === 'hardware' && !hw.text) hwScan();
});

/* ============================================================
 * v2.3 —— 磁盘健康 (SMART)
 * ============================================================ */
async function dhScan() {
  $('#dh-scan').disabled = true;
  $('#dh-status').textContent = '正在读取硬盘健康数据…';
  $('#dh-grid').innerHTML = '<span class="dim">读取中…</span>';
  const r = await psRun(`
$res=@();
Get-PhysicalDisk -ErrorAction SilentlyContinue | ForEach-Object {
  $d=$_; $rc=$d | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue;
  $res += [ordered]@{
    name=$d.FriendlyName; media=$d.MediaType; bus=$d.BusType;
    size=[int64]$d.Size; health=$d.HealthStatus; usage=$d.Usage;
    temp=[int]$rc.Temperature; poh=[int]$rc.PowerOnHours; wear=[int]$rc.Wear;
    readErr=[int64]$rc.ReadErrorsTotal; writeErr=[int64]$rc.WriteErrorsTotal }
};
ConvertTo-Json -InputObject @($res) -Compress -Depth 3`);
  $('#dh-scan').disabled = false;
  const rows = parseJsonArray(r.stdout || r.out);
  if (!rows.length) {
    $('#dh-grid').innerHTML = '<span class="dim">未读取到硬盘信息（可能需要管理员权限，或系统不支持）。</span>';
    $('#dh-status').textContent = '';
    return;
  }
  const mediaName = m => ({ 3: 'HDD 机械硬盘', 4: 'SSD 固态硬盘' }[m] || (String(m).match(/ssd/i) ? 'SSD' : (String(m).match(/hdd/i) ? 'HDD' : (m || '未知'))));
  const busName = b => ({ 7: 'USB', 8: 'RAID', 11: 'SATA', 17: 'NVMe' }[b] || b || '');
  const healthMap = h => {
    const s = String(h);
    if (s === '0' || /healthy/i.test(s)) return ['green', '健康'];
    if (s === '1' || /warning/i.test(s)) return ['orange', '警告'];
    return ['red', '异常'];
  };
  $('#dh-grid').innerHTML = rows.map(d => {
    const [cls, txt] = healthMap(d.health);
    const kvs = [
      ['接口 / 类型', `${busName(d.bus)} · ${mediaName(d.media)}`],
      ['容量', fmt(d.size)],
      ['健康状态', `<span class="tag ${cls}">${txt}</span>`],
    ];
    if (d.temp > 0) kvs.push(['温度', d.temp + ' °C']);
    if (d.poh > 0) kvs.push(['通电时长', `${d.poh} 小时（约 ${(d.poh / 24 / 365).toFixed(1)} 年）`]);
    if (d.wear > 0) kvs.push(['SSD 损耗', `${d.wear}%（剩余寿命约 ${100 - d.wear}%）`]);
    if (d.readErr > 0 || d.writeErr > 0) kvs.push(['读写错误', `读 ${d.readErr} / 写 ${d.writeErr}`]);
    const rows2 = kvs.map(kv => `<div class="hw-kv"><span class="k">${esc(kv[0])}</span><span class="v">${kv[1]}</span></div>`).join('');
    return `<div class="hw-card"><div class="hw-head"><span class="hw-ico">🗄️</span>${esc(d.name || '硬盘')}</div>${rows2}</div>`;
  }).join('');
  const bad = rows.filter(d => healthMap(d.health)[0] !== 'green').length;
  $('#dh-status').textContent = bad ? `⚠ 有 ${bad} 块硬盘状态异常，建议尽快备份数据。` : '所有硬盘健康状态良好。';
}
$('#dh-scan').addEventListener('click', dhScan);

/* ============================================================
 * v2.3 —— 网络工具
 * ============================================================ */
const nw = { timer: null, last: null };

async function nwInfo() {
  $('#nw-info').innerHTML = '读取中…';
  const r = await psRun(`
$ip=Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object {$_.IPv4Address -and $_.NetAdapter.Status -eq 'Up'} | Select-Object -First 1;
$o=[ordered]@{
  ipv4=($ip.IPv4Address.IPAddress -join ', ');
  gw=($ip.IPv4DefaultGateway.NextHop -join ', ');
  dns=($ip.DNSServer | Where-Object {$_.AddressFamily -eq 2} | ForEach-Object {$_.ServerAddresses} ) -join ', ';
  adapter=$ip.InterfaceAlias;
};
try{ $pub=(Invoke-RestMethod -Uri 'https://api.ipify.org?format=json' -TimeoutSec 4).ip; $o.pub=$pub }catch{ $o.pub='(获取失败)' }
$o | ConvertTo-Json -Compress`);
  const d = parseJsonArray('[' + (r.stdout || r.out).trim() + ']')[0] || {};
  $('#nw-info').innerHTML = [
    ['网卡', d.adapter], ['内网 IP', d.ipv4], ['网关', d.gw],
    ['DNS', d.dns], ['公网 IP', d.pub],
  ].filter(kv => kv[1]).map(kv => `<div class="hw-kv"><span class="k">${esc(kv[0])}</span><span class="v">${esc(kv[1])}</span></div>`).join('');
}

function nwStartSpeed() {
  if (nw.timer) clearInterval(nw.timer);
  nw.timer = setInterval(async () => {
    if (!$('#page-network').classList.contains('active')) return;
    const r = await psRun(`$s=Get-NetAdapterStatistics -ErrorAction SilentlyContinue | Measure-Object -Property ReceivedBytes,SentBytes -Sum; $rx=(Get-NetAdapterStatistics | Measure-Object ReceivedBytes -Sum).Sum; $tx=(Get-NetAdapterStatistics | Measure-Object SentBytes -Sum).Sum; Write-Output "$rx $tx"`);
    const m = (r.stdout || '').trim().match(/(\d+)\s+(\d+)/);
    if (!m) return;
    const rx = +m[1], tx = +m[2], now = Date.now();
    if (nw.last) {
      const dt = (now - nw.last.t) / 1000;
      const dn = Math.max(0, (rx - nw.last.rx) / dt), up = Math.max(0, (tx - nw.last.tx) / dt);
      $('#nw-down').textContent = fmt(dn) + '/s';
      $('#nw-up').textContent = fmt(up) + '/s';
      $('#nw-down-bar').style.width = Math.min(100, dn / (1048576) * 100).toFixed(0) + '%';
      $('#nw-up-bar').style.width = Math.min(100, up / (524288) * 100).toFixed(0) + '%';
    }
    nw.last = { rx, tx, t: now };
  }, 1500);
}

async function nwPorts() {
  $('#nw-right-title').textContent = '端口占用（监听中的连接）';
  $('#nw-out').textContent = '正在读取…';
  const r = await psRun(`
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Sort-Object LocalPort -Unique | ForEach-Object {
  $p=Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue;
  '{0,-7} {1}' -f $_.LocalPort, ($p.ProcessName + ' (PID ' + $_.OwningProcess + ')')
} | Select-Object -First 60 | Out-String`);
  $('#nw-out').textContent = (r.stdout || '').trim() || '未读取到监听端口。';
}

async function nwPing() {
  const host = $('#nw-ping').value.trim();
  if (!host) return ui.toast('请输入域名或 IP', 'warn');
  $('#nw-right-title').textContent = 'Ping ' + host;
  $('#nw-out').textContent = '正在 ping…';
  const r = await execCmd(`ping -n 4 ${host.replace(/[^\w.\-:]/g, '')}`);
  $('#nw-out').textContent = (r.out || '').trim();
}

$('#nw-scan').addEventListener('click', () => { nwInfo(); nwStartSpeed(); });
$('#nw-ports').addEventListener('click', nwPorts);
$('#nw-pingbtn').addEventListener('click', nwPing);
$('#nw-ping').addEventListener('keydown', e => { if (e.key === 'Enter') nwPing(); });
let nwLoaded = false;

/* ============================================================
 * v2.3 —— 深度清理（空文件夹 / 失效快捷方式）
 * ============================================================ */
const dc = { items: [], busy: false };

async function dcScanEmpty() {
  const dir = $('#dc-dir').value;
  if (!dir || !fs.existsSync(dir)) return ui.toast('请先选择要扫描的目录', 'warn');
  dc.items = []; dc.busy = true;
  $('#dc-scan').disabled = true; $('#dc-clean').disabled = true;
  $('#dc-status').textContent = '正在扫描空文件夹…';
  // 递归自底向上判断空目录（含只包含空子目录的目录）
  const emptyDirs = [];
  async function walk(d) {
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return false; }
    let hasFile = false;
    for (const e of entries) {
      if (e.isSymbolicLink()) { hasFile = true; continue; }
      if (e.isDirectory()) { const childEmpty = await walk(path.join(d, e.name)); if (!childEmpty) hasFile = true; }
      else hasFile = true;
    }
    if (!hasFile && d !== dir) emptyDirs.push(d);
    return !hasFile;
  }
  try { await walk(dir); } catch { }
  for (const d of emptyDirs) dc.items.push({ type: '空文件夹', path: d, note: '不含任何文件', kind: 'dir' });
  dc.busy = false; $('#dc-scan').disabled = false;
  dcRender();
  $('#dc-status').textContent = `找到 ${emptyDirs.length} 个空文件夹。`;
  $('#dc-clean').disabled = !dc.items.length;
}

async function dcScanShortcuts() {
  dc.items = []; dc.busy = true;
  $('#dc-shortcuts').disabled = true; $('#dc-clean').disabled = true;
  $('#dc-status').textContent = '正在扫描失效快捷方式…';
  const desktops = [
    path.join(os.homedir(), 'Desktop'),
    path.join(PROGRAM_DATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ].filter(d => fs.existsSync(d)).map(d => `'${psq(d)}'`).join(',');
  const r = await psRun(`
$sh=New-Object -ComObject WScript.Shell;
$res=@();
foreach($root in @(${desktops})){
  Get-ChildItem -Path $root -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    try{ $t=$sh.CreateShortcut($_.FullName).TargetPath;
      if($t -and -not (Test-Path $t)){ $res += [ordered]@{lnk=$_.FullName;target=$t} } }catch{}
  }
};
ConvertTo-Json -InputObject @($res) -Compress`);
  for (const x of parseJsonArray(r.stdout || r.out))
    dc.items.push({ type: '失效快捷方式', path: x.lnk, note: '目标不存在', kind: 'file' });
  dc.busy = false; $('#dc-shortcuts').disabled = false;
  dcRender();
  $('#dc-status').textContent = `找到 ${dc.items.length} 个失效快捷方式（目标程序已被删除/卸载）。`;
  $('#dc-clean').disabled = !dc.items.length;
}

function dcRender() {
  $('#dc-table tbody').innerHTML = dc.items.map((it, i) => `
    <tr>
      <td><input type="checkbox" data-idx="${i}" checked></td>
      <td><span class="tag ${it.kind === 'dir' ? '' : 'orange'}">${esc(it.type)}</span></td>
      <td class="dim" title="${esc(it.path)}">${esc(it.path)}</td>
      <td class="dim">${esc(it.note)}</td>
    </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;padding:24px" class="dim">未发现可清理项</td></tr>';
  dc.items.forEach((it, i) => it.checked = true);
  $('#dc-table tbody').querySelectorAll('input').forEach(cb =>
    cb.addEventListener('change', () => dc.items[cb.dataset.idx].checked = cb.checked));
  $('#dc-all').checked = true;
}

async function dcClean() {
  const picked = dc.items.filter(i => i.checked);
  if (!picked.length) return ui.toast('没有勾选任何项目', 'warn');
  if (!await ui.confirm('深度清理', `将删除 <b>${picked.length}</b> 项（空文件夹直接删除，失效快捷方式移入回收站）。`, { okText: '清理', danger: true })) return;
  ui.busy(true, '正在清理…');
  const toRecycle = picked.filter(i => i.kind === 'file').map(i => i.path);
  let dirOk = 0;
  for (const it of picked.filter(i => i.kind === 'dir')) { try { fs.rmdirSync(it.path); dirOk++; } catch { } }
  let fileRes = { ok: 0 };
  if (toRecycle.length) fileRes = await recycleFiles(toRecycle);
  ui.busy(false);
  dc.items = dc.items.filter(i => fs.existsSync(i.path));
  dcRender();
  $('#dc-clean').disabled = !dc.items.length;
  ui.toast(`✅ 已清理 ${dirOk} 个空文件夹、${fileRes.ok} 个失效快捷方式`, 'success', 4500);
}

$('#dc-browse').addEventListener('click', async () => {
  const p = await ipcRenderer.invoke('pick-folder', '选择要深度扫描的目录');
  if (p) $('#dc-dir').value = p;
});
$('#dc-scan').addEventListener('click', dcScanEmpty);
$('#dc-shortcuts').addEventListener('click', dcScanShortcuts);
$('#dc-clean').addEventListener('click', dcClean);
$('#dc-all').addEventListener('change', () => {
  const on = $('#dc-all').checked;
  dc.items.forEach(i => i.checked = on);
  $('#dc-table tbody').querySelectorAll('input[data-idx]').forEach(cb => cb.checked = on);
});

/* ============================================================
 * v2.3 —— 右键菜单管理
 * ============================================================ */
const cx = { items: [], sel: -1 };
const CX_ROOTS = [
  ['HKCR:\\*\\shell', '所有文件'],
  ['HKCR:\\Directory\\shell', '文件夹'],
  ['HKCR:\\Directory\\Background\\shell', '桌面空白处'],
  ['HKCR:\\Drive\\shell', '磁盘'],
];
const CX_BACKUP = 'HKCU:\\Software\\DiskMate\\DisabledContextMenu';

async function cxLoad() {
  $('#cx-status').textContent = '正在读取右键菜单项…';
  cx.items = []; cx.sel = -1;
  const roots = CX_ROOTS.map(x => `@('${x[0]}','${psq(x[1])}')`).join(',');
  const r = await psRun(`
if(-not (Get-PSDrive HKCR -ErrorAction SilentlyContinue)){ New-PSDrive -Name HKCR -PSProvider Registry -Root HKEY_CLASSES_ROOT | Out-Null }
$res=@();
foreach($pair in @(${roots})){
  $root=$pair[0]; $loc=$pair[1];
  Get-ChildItem -Path $root -ErrorAction SilentlyContinue | ForEach-Object {
    $key=$_; $name=$key.PSChildName;
    $disp=(Get-ItemProperty -Path $key.PSPath -Name '(default)' -ErrorAction SilentlyContinue).'(default)';
    $cmd=(Get-ItemProperty -Path ($key.PSPath+'\\command') -Name '(default)' -ErrorAction SilentlyContinue).'(default)';
    $res += [ordered]@{name=$name; disp=[string]$disp; loc=$loc; root=$root; cmd=[string]$cmd; enabled=$true}
  }
};
$bk=Get-Item -Path '${CX_BACKUP}' -ErrorAction SilentlyContinue;
if($bk){ foreach($n in $bk.GetValueNames()){ if($n){ $v=$bk.GetValue($n) | ConvertFrom-Json; $res += [ordered]@{name=$v.name;disp=$v.disp;loc=$v.loc;root=$v.root;cmd=$v.cmd;enabled=$false} } } };
ConvertTo-Json -InputObject @($res) -Compress -Depth 3`);
  const sys = /^(open|edit|print|runas|find|explore|cmd|pintohome|pintostartscreen|windows\.|properties)/i;
  for (const x of parseJsonArray(r.stdout || r.out)) {
    if (x.enabled && sys.test(x.name)) continue; // 隐藏系统内置项
    cx.items.push(x);
  }
  cxRender();
  $('#cx-count').textContent = `共 ${cx.items.length} 项（${cx.items.filter(i => i.enabled).length} 项启用）`;
  $('#cx-status').textContent = '';
}

function cxRender() {
  $('#cx-table tbody').innerHTML = cx.items.map((it, i) => `
    <tr data-idx="${i}">
      <td>${it.enabled ? '<span class="tag green">启用</span>' : '<span class="tag">已禁用</span>'}</td>
      <td title="${esc(it.disp || it.name)}">${esc((it.disp || it.name).replace(/&/g, ''))}</td>
      <td class="dim">${esc(it.loc)}</td>
      <td class="dim" title="${esc(it.cmd)}">${esc(it.cmd)}</td>
    </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;padding:24px" class="dim">未发现第三方右键项</td></tr>';
  cx.sel = -1;
}

async function cxToggle(disable) {
  if (cx.sel < 0) return ui.toast('请先选中一项', 'warn');
  const it = cx.items[cx.sel];
  if (it.enabled !== disable) return ui.toast(disable ? '该项已禁用' : '该项已启用', 'warn');
  try {
    if (disable) {
      // 通过在键上加 LegacyDisable 值来禁用（可逆），并备份元数据
      const r = await psRun(`
if(-not (Get-PSDrive HKCR -ErrorAction SilentlyContinue)){ New-PSDrive -Name HKCR -PSProvider Registry -Root HKEY_CLASSES_ROOT | Out-Null }
Set-ItemProperty -Path '${psq(it.root)}\\${psq(it.name)}' -Name 'LegacyDisable' -Value '' -ErrorAction Stop;
New-Item -Path '${CX_BACKUP}' -Force | Out-Null;
$meta=@{name='${psq(it.name)}';disp='${psq(it.disp)}';loc='${psq(it.loc)}';root='${psq(it.root)}';cmd='${psq(it.cmd)}'} | ConvertTo-Json -Compress;
Set-ItemProperty -Path '${CX_BACKUP}' -Name '${psq(it.loc + '|' + it.name)}' -Value $meta;
Write-Output OK`);
      if (!/OK/.test(r.stdout || '')) throw new Error((r.stderr || r.out).trim().slice(0, 150));
    } else {
      const r = await psRun(`
if(-not (Get-PSDrive HKCR -ErrorAction SilentlyContinue)){ New-PSDrive -Name HKCR -PSProvider Registry -Root HKEY_CLASSES_ROOT | Out-Null }
Remove-ItemProperty -Path '${psq(it.root)}\\${psq(it.name)}' -Name 'LegacyDisable' -ErrorAction SilentlyContinue;
Remove-ItemProperty -Path '${CX_BACKUP}' -Name '${psq(it.loc + '|' + it.name)}' -ErrorAction SilentlyContinue;
Write-Output OK`);
      if (!/OK/.test(r.stdout || '')) throw new Error((r.stderr || r.out).trim().slice(0, 150));
    }
    await cxLoad();
    ui.toast(disable ? `已禁用「${esc(it.disp || it.name)}」` : `已启用「${esc(it.disp || it.name)}」`, 'success');
  } catch (e) { ui.toast((disable ? '禁用' : '启用') + '失败：' + esc(e.message), 'error', 5000); }
}

$('#cx-refresh').addEventListener('click', cxLoad);
$('#cx-disable').addEventListener('click', () => cxToggle(true));
$('#cx-enable').addEventListener('click', () => cxToggle(false));
bindRowSelect($('#cx-table tbody'), i => cx.sel = i);
let cxLoaded = false;

/* v2.3 懒加载 */
window.addEventListener('page-show', e => {
  if (e.detail === 'diskhealth') { /* 手动触发 */ }
  if (e.detail === 'network' && !nwLoaded) { nwLoaded = true; nwInfo(); nwStartSpeed(); }
  if (e.detail === 'ctxmenu' && !cxLoaded) { cxLoaded = true; cxLoad(); }
});


/* ============================================================
 * v2.4 —— 注册表清理（保守：仅清失效引用，先备份 .reg）
 * ============================================================ */
const rg = { items: [], busy: false };

async function rgScan() {
  if (rg.busy) return;
  rg.busy = true; $('#rg-scan').disabled = true; $('#rg-clean').disabled = true;
  $('#rg-status').textContent = '正在扫描注册表失效引用…';
  rg.items = [];
  const r = await psRun(`
$res=@();
foreach($base in 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'){
  Get-ChildItem $base -ErrorAction SilentlyContinue | ForEach-Object {
    $p=Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue;
    if($p.DisplayName -and $p.InstallLocation){
      $loc=$p.InstallLocation.Trim('"').TrimEnd('\\');
      if($loc.Length -gt 3 -and $loc -match '^[A-Za-z]:\\\\' -and -not (Test-Path -LiteralPath $loc)){
        $res += [ordered]@{type='残留卸载项';name=[string]$p.DisplayName;reason='安装目录不存在: '+$loc;path=($_.PSPath -replace '.*Registry::','');valname=''}
      }
    }
  }
};
foreach($base in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'){
  $k=Get-Item $base -ErrorAction SilentlyContinue;
  if($k){ foreach($n in $k.GetValueNames()){ if(-not $n){continue}
    $v=[string]$k.GetValue($n); $m=[regex]::Match($v,'^"?([A-Za-z]:\\\\[^"]+?\.exe)');
    if($m.Success -and -not (Test-Path -LiteralPath $m.Groups[1].Value)){
      $res += [ordered]@{type='失效启动项';name=$n;reason='程序不存在: '+$m.Groups[1].Value;path=$base;valname=$n}
    }
  }}
};
foreach($base in 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths'){
  Get-ChildItem $base -ErrorAction SilentlyContinue | ForEach-Object {
    $d=(Get-ItemProperty $_.PSPath -Name '(default)' -ErrorAction SilentlyContinue).'(default)';
    if($d){ $ex=$d.Trim('"'); if($ex -match '^[A-Za-z]:\\\\' -and -not (Test-Path -LiteralPath $ex)){
      $res += [ordered]@{type='失效程序路径';name=$_.PSChildName;reason='程序不存在: '+$ex;path=($_.PSPath -replace '.*Registry::','');valname=''}
    }}
  }
};
ConvertTo-Json -InputObject @($res) -Compress -Depth 3`);
  rg.items = parseJsonArray(r.stdout || r.out).map(x => ({ ...x, checked: true }));
  rg.busy = false; $('#rg-scan').disabled = false;
  rgRender();
  $('#rg-total').textContent = rg.items.length ? `发现 ${rg.items.length} 个失效项` : '';
  $('#rg-status').textContent = rg.items.length ? '扫描完成。清理前会自动导出 .reg 备份文件。' : '未发现失效的注册表引用，注册表很干净 🎉';
  $('#rg-clean').disabled = !rg.items.length;
}

function rgRender() {
  $('#rg-table tbody').innerHTML = rg.items.map((it, i) => `
    <tr>
      <td><input type="checkbox" data-idx="${i}" ${it.checked ? 'checked' : ''}></td>
      <td><span class="tag orange">${esc(it.type)}</span></td>
      <td title="${esc(it.name)}">${esc(it.name)}</td>
      <td class="dim" title="${esc(it.reason)}">${esc(it.reason)}</td>
    </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;padding:24px" class="dim">未发现失效项</td></tr>';
  $('#rg-table tbody').querySelectorAll('input').forEach(cb =>
    cb.addEventListener('change', () => rg.items[cb.dataset.idx].checked = cb.checked));
  $('#rg-all').checked = rg.items.length > 0;
}

async function rgClean() {
  const picked = rg.items.filter(i => i.checked);
  if (!picked.length) return ui.toast('没有勾选任何项目', 'warn');
  if (!await ui.confirm('清理注册表', `将清理 <b>${picked.length}</b> 个失效项。<br><span class="dim">清理前会先导出 .reg 备份到数据目录，若有异常可双击备份还原。</span>`, { okText: '备份并清理', danger: true })) return;
  ui.busy(true, '正在导出备份并清理…');
  fs.mkdirSync(DM_DIR, { recursive: true });
  const backup = path.join(DM_DIR, 'reg-backup-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '') + '.reg');
  const toReg = p => p.replace(/^HKLM:\\/, 'HKLM\\').replace(/^HKCU:\\/, 'HKCU\\').replace(/^HKCR:\\/, 'HKCR\\');
  const parts = picked.map(it => {
    const rp = toReg(it.path);
    const del = it.type === '失效启动项'
      ? `reg delete "${rp}" /v "${String(it.valname).replace(/"/g, '')}" /f >nul 2>&1 && echo OK`
      : `reg delete "${rp}" /f >nul 2>&1 && echo OK`;
    return `reg export "${rp}" "${backup}.tmp" /y >nul 2>&1 & type "${backup}.tmp" >> "${backup}" 2>nul & ${del}`;
  });
  const r = await execCmd(parts.join(' & ') + ` & del "${backup}.tmp" >nul 2>&1`);
  const ok = (r.out.match(/OK/g) || []).length;
  const fail = picked.length - ok;
  ui.busy(false);
  await rgScan();
  ui.toast(`✅ 已清理 ${ok} 个失效项，备份已存到数据目录` + (fail ? `（${fail} 个失败）` : ''), fail ? 'warn' : 'success', 5000);
}

$('#rg-scan').addEventListener('click', rgScan);
$('#rg-clean').addEventListener('click', rgClean);
$('#rg-all').addEventListener('change', () => {
  const on = $('#rg-all').checked;
  rg.items.forEach(i => i.checked = on);
  $('#rg-table tbody').querySelectorAll('input[data-idx]').forEach(cb => cb.checked = on);
});
let rgLoaded = false;

/* ============================================================
 * v2.4 —— 一键优化（可逆系统调优）
 * ============================================================ */
const OPT_ITEMS = [
  { id: 'power', name: '高性能电源计划', desc: '切换到高性能电源方案，减少 CPU 降频带来的卡顿',
    check: async () => { const r = await psRun(`(powercfg /getactivescheme)`); return /高性能|High performance|8c5e7fda/i.test(r.stdout || ''); },
    apply: () => execCmd('powercfg -setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'),
    revert: () => execCmd('powercfg -setactive 381b4222-f694-41f0-9685-ff5bb260df2e') },
  { id: 'visual', name: '视觉效果偏向性能', desc: '关闭部分窗口动画与阴影，界面更跟手（不影响字体清晰度）',
    check: async () => { const r = await psRun(`(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects' -Name VisualFXSetting -ErrorAction SilentlyContinue).VisualFXSetting`); return String((r.stdout || '').trim()) === '2'; },
    apply: () => psRun(`New-Item 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects' -Force|Out-Null;Set-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects' -Name VisualFXSetting -Value 2`),
    revert: () => psRun(`Set-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects' -Name VisualFXSetting -Value 0 -ErrorAction SilentlyContinue`) },
  { id: 'menushow', name: '加快菜单弹出速度', desc: '缩短菜单展开延迟（MenuShowDelay 400→0）',
    check: async () => { const r = await psRun(`(Get-ItemProperty 'HKCU:\\Control Panel\\Desktop' -Name MenuShowDelay -ErrorAction SilentlyContinue).MenuShowDelay`); return String((r.stdout || '').trim()) === '0'; },
    apply: () => psRun(`Set-ItemProperty 'HKCU:\\Control Panel\\Desktop' -Name MenuShowDelay -Value 0`),
    revert: () => psRun(`Set-ItemProperty 'HKCU:\\Control Panel\\Desktop' -Name MenuShowDelay -Value 400`) },
  { id: 'bgapps', name: '关闭后台应用', desc: '禁止 UWP 应用在后台自动运行，省内存省电',
    check: async () => { const r = await psRun(`(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications' -Name GlobalUserDisabled -ErrorAction SilentlyContinue).GlobalUserDisabled`); return String((r.stdout || '').trim()) === '1'; },
    apply: () => psRun(`New-Item 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications' -Force|Out-Null;Set-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications' -Name GlobalUserDisabled -Value 1`),
    revert: () => psRun(`Set-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications' -Name GlobalUserDisabled -Value 0 -ErrorAction SilentlyContinue`) },
  { id: 'gamebar', name: '关闭 Xbox Game Bar', desc: '关闭游戏栏与后台录制，减少资源占用',
    check: async () => { const r = await psRun(`(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\GameBar' -Name UseNexusForGameBarEnabled -ErrorAction SilentlyContinue).UseNexusForGameBarEnabled`); return String((r.stdout || '').trim()) === '0'; },
    apply: () => psRun(`New-Item 'HKCU:\\Software\\Microsoft\\GameBar' -Force|Out-Null;Set-ItemProperty 'HKCU:\\Software\\Microsoft\\GameBar' -Name UseNexusForGameBarEnabled -Value 0;Set-ItemProperty 'HKCU:\\System\\GameConfigStore' -Name GameDVR_Enabled -Value 0 -ErrorAction SilentlyContinue`),
    revert: () => psRun(`Set-ItemProperty 'HKCU:\\Software\\Microsoft\\GameBar' -Name UseNexusForGameBarEnabled -Value 1 -ErrorAction SilentlyContinue`) },
];
const op = { state: {} };

async function opRefresh() {
  $('#op-status').textContent = '正在读取当前设置…';
  for (const it of OPT_ITEMS) { try { op.state[it.id] = await it.check(); } catch { op.state[it.id] = false; } }
  opRender();
  const on = Object.values(op.state).filter(Boolean).length;
  $('#op-hint').textContent = `已优化 ${on}/${OPT_ITEMS.length} 项`;
  $('#op-status').textContent = '勾选想启用的优化项，取消勾选可还原。';
}

function opRender() {
  $('#op-list').innerHTML = OPT_ITEMS.map(it => `
    <div class="jk-row">
      <input type="checkbox" data-id="${it.id}" ${op.state[it.id] ? 'checked' : ''}>
      <div class="jk-info">
        <div class="jk-name">${esc(it.name)}${op.state[it.id] ? ' <span class="tag green">已启用</span>' : ''}</div>
        <div class="jk-desc">${esc(it.desc)}</div>
      </div>
    </div>`).join('');
  $('#op-list').querySelectorAll('input').forEach(cb =>
    cb.addEventListener('change', () => op.state[cb.dataset.id] = cb.checked));
}

async function opApply() {
  $('#op-apply').disabled = true;
  ui.busy(true, '正在应用优化设置…');
  let changed = 0;
  for (const it of OPT_ITEMS) {
    const want = !!op.state[it.id];
    let cur; try { cur = await it.check(); } catch { cur = false; }
    if (want !== cur) { try { await (want ? it.apply() : it.revert()); changed++; } catch { } }
  }
  ui.busy(false); $('#op-apply').disabled = false;
  await opRefresh();
  ui.toast(changed ? `✅ 已应用 ${changed} 项更改（部分需重启或重开资源管理器生效）` : '设置无变化', 'success', 4500);
}

$('#op-apply').addEventListener('click', opApply);
$('#op-refresh').addEventListener('click', opRefresh);
let opLoaded = false;

/* ============================================================
 * v2.4 —— 每周自动清理（计划任务）
 * ============================================================ */
const AUTOCLEAN_TASK = 'DiskMate_AutoClean';
async function autocleanStatus() {
  const r = await psRun(`if(Get-ScheduledTask -TaskName '${AUTOCLEAN_TASK}' -ErrorAction SilentlyContinue){Write-Output YES}else{Write-Output NO}`);
  return /YES/.test(r.stdout || '');
}
async function autocleanSet(on) {
  if (on) {
    const inner = `Remove-Item -Path \\"$env:TEMP\\*\\" -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -Path \\"$env:WINDIR\\Temp\\*\\" -Recurse -Force -ErrorAction SilentlyContinue; Clear-RecycleBin -Force -ErrorAction SilentlyContinue`;
    const r = await psRun(`
$a=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -WindowStyle Hidden -Command "${inner}"';
$t=New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3am;
$p=New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest;
Register-ScheduledTask -TaskName '${AUTOCLEAN_TASK}' -Action $a -Trigger $t -Principal $p -Force -ErrorAction Stop | Out-Null; Write-Output OK`);
    return /OK/.test(r.stdout || '');
  } else {
    await psRun(`Unregister-ScheduledTask -TaskName '${AUTOCLEAN_TASK}' -Confirm:$false -ErrorAction SilentlyContinue`);
    return true;
  }
}
(async () => {
  const sw = $('#set-autoclean');
  if (!sw) return;
  sw.checked = await autocleanStatus();
  sw.addEventListener('change', async () => {
    const ok = await autocleanSet(sw.checked);
    if (ok) ui.toast(sw.checked ? '已开启每周日凌晨 3 点自动清理' : '已关闭自动清理', 'success');
    else { ui.toast('设置失败（需管理员权限）', 'error'); sw.checked = !sw.checked; }
  });
})();

/* v2.4 懒加载 */
window.addEventListener('page-show', e => {
  if (e.detail === 'regclean' && !rgLoaded) { rgLoaded = true; rgScan(); }
  if (e.detail === 'optimize' && !opLoaded) { opLoaded = true; opRefresh(); }
});

/* ============================================================
 * v2.5 —— 页面切换时卡片错位入场
 * ============================================================ */
window.addEventListener('page-show', e => {
  const cardPages = ['home', 'hardware', 'tools', 'diskhealth', 'optimize'];
  if (cardPages.includes(e.detail)) {
    const host = document.getElementById('page-' + e.detail);
    if (host) ui.stagger(host);
  }
});
// 首屏首页卡片入场
window.addEventListener('DOMContentLoaded', () => ui.stagger(document.getElementById('page-home')));
setTimeout(() => ui.stagger(document.getElementById('page-home')), 60);

/* ============================================================
 * v3.4 —— 自定义背景（图片 / 视频 · 亮暗分设 · 模糊 · 遮罩）
 * ============================================================ */
function bgToUrl(p) {
  if (!p) return '';
  if (/^(https?:|file:|data:)/i.test(p)) return p;
  let u = p.replace(/\\/g, '/');
  if (!/^\//.test(u)) u = '/' + u;
  return 'file://' + encodeURI(u).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

function applyBg() {
  const b = (loadConfig().bg) || {};
  const bg = $('#app-bg'), mask = $('#app-bg-mask');
  if (!bg || !mask) return;
  bg.innerHTML = ''; bg.style.backgroundImage = '';
  const dark = document.documentElement.dataset.theme === 'dark';
  const src = dark ? (b.dark || b.light) : (b.light || b.dark);
  if (!b.enabled || !src) { document.documentElement.classList.remove('has-bg'); return; }
  document.documentElement.classList.add('has-bg');
  const url = bgToUrl(src.trim());
  if (b.type === 'video') {
    const v = document.createElement('video');
    v.src = url; v.autoplay = true; v.loop = true; v.muted = true;
    v.setAttribute('playsinline', ''); v.setAttribute('disablepictureinpicture', '');
    bg.appendChild(v);
  } else {
    bg.style.backgroundImage = `url("${url}")`;
  }
  const blur = Math.max(0, parseInt(b.blur) || 0);
  const filt = blur > 0 ? `blur(${blur}px)` : '';
  const tf = blur > 0 ? 'scale(1.08)' : '';
  bg.style.filter = filt; bg.style.transform = tf;
  const bg2 = $('#app-bg2'); if (bg2) { bg2.style.filter = filt; bg2.style.transform = tf; bg2.style.opacity = '0'; }
  let ov = parseInt(b.overlay) || 0; ov = Math.max(-100, Math.min(100, ov));
  mask.style.background = ov > 0 ? `rgba(0,0,0,${ov / 100})`
    : ov < 0 ? `rgba(255,255,255,${-ov / 100})` : 'transparent';

  // 图片背景每 30 秒交叉淡入切换（配合随机图 API 可自动换壁纸）
  clearInterval(window._bgTimer);
  if (b.enabled && src && b.type === 'image') {
    window._bgTimer = setInterval(bgRotate, 30000);
  }
}
window.applyBg = applyBg;

function bgRotate() {
  if (!document.documentElement.classList.contains('has-bg')) return;
  const b = (loadConfig().bg) || {};
  if (b.type !== 'image') return;
  const dark = document.documentElement.dataset.theme === 'dark';
  const src = dark ? (b.dark || b.light) : (b.light || b.dark);
  if (!src) return;
  const u = bgToUrl(src.trim());
  const nu = u + (u.includes('?') ? '&' : '?') + '_dm=' + Date.now();
  const bg = $('#app-bg'), bg2 = $('#app-bg2');
  const img = new Image();
  img.onload = () => {
    bg2.style.backgroundImage = `url("${nu}")`;
    bg2.style.filter = bg.style.filter; bg2.style.transform = bg.style.transform;
    bg2.style.opacity = '1';
    setTimeout(() => { bg.style.backgroundImage = `url("${nu}")`; bg2.style.opacity = '0'; }, 950);
  };
  img.onerror = () => {};
  img.src = nu;
}

function bgLoadUI() {
  const b = (loadConfig().bg) || {};
  $('#bg-enable').checked = !!b.enabled;
  $('#bg-type').value = b.type || 'image';
  $('#bg-light').value = b.light || '';
  $('#bg-dark').value = b.dark || '';
  $('#bg-blur').value = b.blur ?? 0;
  $('#bg-overlay').value = b.overlay ?? 0;
}
function bgSave() {
  const cfg = loadConfig();
  cfg.bg = {
    enabled: $('#bg-enable').checked,
    type: $('#bg-type').value,
    light: $('#bg-light').value.trim(),
    dark: $('#bg-dark').value.trim(),
    blur: parseInt($('#bg-blur').value) || 0,
    overlay: parseInt($('#bg-overlay').value) || 0,
  };
  saveConfig(cfg);
  applyBg();
}
$('#bg-enable').addEventListener('change', bgSave);
$('#bg-type').addEventListener('change', bgSave);
$('#bg-blur').addEventListener('change', bgSave);
$('#bg-overlay').addEventListener('change', bgSave);
$('#bg-apply').addEventListener('click', () => { bgSave(); ui.toast('背景设置已应用', 'success'); });
$('#bg-light-pick').addEventListener('click', async () => {
  const f = await ipcRenderer.invoke('pick-files', '选择浅色模式背景文件');
  if (f && f[0]) { $('#bg-light').value = f[0]; bgSave(); }
});
$('#bg-dark-pick').addEventListener('click', async () => {
  const f = await ipcRenderer.invoke('pick-files', '选择深色模式背景文件');
  if (f && f[0]) { $('#bg-dark').value = f[0]; bgSave(); }
});
window.addEventListener('theme-change', applyBg);
bgLoadUI();
applyBg();

/* ============================================================
 * v3.5 —— 版本更新检查（GitHub Releases）
 * ============================================================ */
const REPO_OWNER = '945967063', REPO_NAME = 'DiskMate';
let APP_VER = '3.5.0';
try { APP_VER = require('./package.json').version; } catch { }

function cmpVer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n) || 0);
  const pb = String(b).split('.').map(n => parseInt(n) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
}

async function checkUpdate(manual) {
  if (manual) $('#upd-status').textContent = '正在检查更新…';
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
      { headers: { 'Accept': 'application/vnd.github+json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const latest = String(j.tag_name || '').replace(/^v/i, '');
    if (!latest) throw new Error('no tag');
    if (cmpVer(latest, APP_VER) > 0) {
      $('#upd-status').textContent = `发现新版本 v${latest}（当前 v${APP_VER}）`;
      $('#upd-badge').style.display = '';
      const btn = $('#upd-open'); btn.style.display = '';
      const url = (j.assets && j.assets[0] && j.assets[0].browser_download_url) || j.html_url;
      btn.onclick = () => ipcRenderer.invoke('open-external', url);
      if (manual) ui.toast(`🎉 发现新版本 v${latest}，点「前往下载」更新`, 'success', 5000);
      else ui.toast(`发现新版本 v${latest}，可在设置中更新`, 'info', 5000);
    } else {
      $('#upd-status').textContent = `已是最新版本 v${APP_VER}`;
      $('#upd-badge').style.display = 'none';
      if (manual) ui.toast('已是最新版本', 'success');
    }
  } catch (e) {
    $('#upd-status').textContent = `当前版本 v${APP_VER}（检查失败：网络或尚未发布 Release）`;
    if (manual) ui.toast('检查更新失败：网络异常或仓库尚未发布 Release', 'warn', 5000);
  }
}
$('#upd-status').textContent = `当前版本 v${APP_VER}`;
$('#upd-check').addEventListener('click', () => checkUpdate(true));
$('#open-devtools').addEventListener('click', () => ipcRenderer.invoke('toggle-devtools'));
$('#open-repo').addEventListener('click', () => ipcRenderer.invoke('open-external', `https://github.com/${REPO_OWNER}/${REPO_NAME}`));
// 启动 5 秒后静默检查一次
setTimeout(() => checkUpdate(false), 5000);
