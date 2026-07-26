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
  },

  go(page) {
    $$('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
    $$('.page').forEach(p => p.classList.remove('active'));
    $('#page-' + page).classList.add('active');
    window.dispatchEvent(new CustomEvent('page-show', { detail: page }));
  },
};

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
  const dark = cfg.dark !== false; // 默认深色
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
