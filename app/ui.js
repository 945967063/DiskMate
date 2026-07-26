/* DiskMate v2 — UI 组件（toast / modal / busy / 主题 / 导航 / 窗口控制） */

const ui = {
  toast(msg, type = 'info', ms = 3200) {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, ms - 300);
    setTimeout(() => el.remove(), ms);
  },

  _modalResolve: null,
  confirm(title, bodyHtml, { okText = '确定', danger = false, showCancel = true } = {}) {
    return new Promise(resolve => {
      // 若已有未决弹窗，先以 false 结算，避免其 await 永久挂起
      if (ui._modalResolve) { ui._modalResolve(false); ui._modalResolve = null; }
      ui._modalResolve = resolve;
      $('#modal-title').textContent = title;
      $('#modal-body').innerHTML = bodyHtml;
      const ok = $('#modal-ok');
      ok.textContent = okText;
      ok.className = danger ? 'red' : '';
      $('#modal-cancel').style.display = showCancel ? '' : 'none';
      $('#modal-mask').classList.add('show');
    });
  },
  alert(title, bodyHtml) { return ui.confirm(title, bodyHtml, { showCancel: false }); },
  _closeModal(v) {
    $('#modal-mask').classList.remove('show');
    if (ui._modalResolve) { ui._modalResolve(v); ui._modalResolve = null; }
  },

  busy(show, text) {
    $('#busy-mask').classList.toggle('show', !!show);
    if (text) $('#busy-text').textContent = text;
  },

  setTheme(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const cfg = loadConfig(); cfg.dark = dark; saveConfig(cfg);
    window.dispatchEvent(new Event('theme-change'));
  },

  go(page) {
    $$('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
    $$('.page').forEach(p => p.classList.remove('active'));
    $('#page-' + page).classList.add('active');
    // 手风琴：展开当前项所在分组，收起其它分组
    const act = document.querySelector('.nav-item.active');
    const grp = act ? act.closest('.nav-group') : null;
    $$('.nav-group').forEach(g => g.classList.toggle('collapsed', g !== grp));
    window.dispatchEvent(new CustomEvent('page-show', { detail: page }));
  },
};

// 分组标题点击折叠/展开（手风琴，一次只开一个）
$$('.nav-group-head').forEach(h =>
  h.addEventListener('click', () => {
    const g = h.parentElement;
    const willOpen = g.classList.contains('collapsed');
    $$('.nav-group').forEach(x => x.classList.toggle('collapsed', !(willOpen && x === g)));
  }));
// 初始全部折叠（首页无分组）
$$('.nav-group').forEach(g => g.classList.add('collapsed'));

$('#modal-ok').addEventListener('click', () => ui._closeModal(true));
$('#modal-cancel').addEventListener('click', () => ui._closeModal(false));
$('#modal-mask').addEventListener('click', e => { if (e.target.id === 'modal-mask') ui._closeModal(false); });

$$('.nav-item').forEach(item =>
  item.addEventListener('click', () => ui.go(item.dataset.page)));

/* 窗口控制 */
$('#tb-min').addEventListener('click', () => ipcRenderer.send('win-min'));
$('#tb-max').addEventListener('click', () => ipcRenderer.send('win-max'));
$('#tb-close').addEventListener('click', () => ipcRenderer.send('win-close'));
ipcRenderer.on('win-state', (e, maximized) => {
  $('#tb-max').innerHTML = maximized ? '&#xE923;' : '&#xE922;';
});

/* 主题初始化 */
(() => {
  const cfg = loadConfig();
  // v3 一次性迁移：把旧版本记住的深色重置为新版默认的浅色（驾驶舱风格）
  if (!cfg.v3themed) { cfg.dark = false; cfg.v3themed = true; saveConfig(cfg); }
  const dark = cfg.dark === true;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const sw = $('#set-dark');
  if (sw) { sw.checked = dark; sw.addEventListener('change', () => ui.setTheme(sw.checked)); }
})();

/* 管理员标识 */
(async () => {
  const admin = await ipcRenderer.invoke('is-admin');
  const badge = $('#admin-badge');
  if (!admin) { badge.textContent = '普通权限'; badge.classList.add('noadmin'); }
})();

/* ---------- 按钮涟漪特效 ---------- */
document.addEventListener('click', e => {
  const btn = e.target.closest('button:not(.gray)');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const d = Math.max(r.width, r.height);
  const el = document.createElement('span');
  el.className = 'ripple';
  el.style.width = el.style.height = d + 'px';
  el.style.left = (e.clientX - r.left - d / 2) + 'px';
  el.style.top = (e.clientY - r.top - d / 2) + 'px';
  btn.appendChild(el);
  setTimeout(() => el.remove(), 600);
});

/* ---------- 工具卡片光标跟随光晕 ---------- */
document.addEventListener('mousemove', e => {
  const card = e.target.closest('.tool-card');
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
  card.style.setProperty('--my', (e.clientY - r.top) + 'px');
});

/* ---------- 数字滚动动画 ---------- */
ui.countUp = (el, to, { dur = 900, suffix = '', decimals = 0 } = {}) => {
  if (!el) return;
  const from = 0, start = performance.now();
  const step = now => {
    const t = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
    el.textContent = (from + (to - from) * e).toFixed(decimals) + suffix;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};

/* ---------- 卡片入场错位 ---------- */
ui.stagger = container => {
  const cards = (container || document).querySelectorAll('.stat-card, .card, .hw-card, .tool-card');
  cards.forEach((c, i) => {
    c.style.setProperty('--i', i);
    c.classList.remove('stagger-in'); void c.offsetWidth; c.classList.add('stagger-in');
  });
};

/* 首页快捷操作 */
document.querySelectorAll('.quick-btn[data-go]').forEach(b =>
  b.addEventListener('click', () => ui.go(b.dataset.go)));

/* 表格单选辅助 */
function bindRowSelect(tbody, onSelect) {
  tbody.addEventListener('click', ev => {
    if (ev.target.closest('button') || ev.target.type === 'checkbox') return;
    const tr = ev.target.closest('tr');
    if (!tr || tr.dataset.idx == null) return;
    tbody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
    tr.classList.add('selected');
    onSelect(Number(tr.dataset.idx));
  });
}
