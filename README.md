<div align="center">

<img src="app/logo.png" width="96" alt="DiskMate logo">

# DiskMate 磁盘管家

**开源的 Windows 磁盘空间管理工具箱 —— 应用搬家 · 垃圾清理 · 空间分析**

基于 Electron · 无边框现代 UI · 深色/浅色双主题 · 单目录绿色便携

</div>

---

## ✨ 功能一览

| 模块 | 说明 |
|------|------|
| 🏠 **首页体检** | 磁盘/内存概况、CPU·内存实时监控、一键体检评分与问题直达 |
| 📦 **应用搬家** | 把 C 盘软件整体迁到其他磁盘，原位置创建目录联接（Junction），软件无感知、可一键还原；集成卸载 |
| 🧹 **垃圾清理** | 临时文件、Windows 更新缓存、回收站、缩略图、浏览器缓存、崩溃转储、着色器缓存、开发工具缓存等 10 类 |
| 📊 **空间分析** | WizTree 风格 squarified 矩形树图 + 目录树双视图，单击钻取、右键返回、悬停详情 |
| 📄 **大文件查找** | 按阈值全盘扫描，自动排除系统目录，删除走回收站 |
| 🔁 **重复文件** | 大小 + 内容哈希双重比对，智能勾选，每组强制保留一份 |
| ⚡ **系统加速** | 进程内存排行、一键释放闲置内存（EmptyWorkingSet）、结束进程（关键进程防呆） |
| 🛡️ **隐私清理** | 最近文档、运行历史、地址栏历史、剪贴板、Chrome/Edge 浏览历史 |
| 🔄 **软件更新** | 基于 winget 检测已装软件更新，一键静默升级 |
| 🚀 **启动项管理** | 注册表 Run 键 + 启动文件夹 + 计划任务三类来源，禁用自动备份可恢复 |
| 💬 **微信/QQ 专清** | 自动定位微信（含 4.0 xwechat_files）/QQ 数据目录，区分缓存与聊天文件防误删 |
| 🧰 **工具箱** | SFC 修复、DISM 组件瘦身、DNS 刷新、网络重置、图标缓存重建、文件粉碎等 12 项 |

## 🚀 快速开始

### 方式一：从源码构建（推荐）

> 要求：Windows 10/11 x64，可联网

```bat
git clone https://github.com/<你的用户名>/DiskMate.git
cd DiskMate
build.bat
```

`build.bat` 会自动从 npmmirror/GitHub 下载 Electron 运行时（约 110MB）并组装出 `DiskMate\DiskMate.exe`，同时创建桌面快捷方式。

### 方式二：便携使用

构建产物 `DiskMate\` 是完全绿色便携的——整个文件夹拷到任何 Windows x64 电脑直接运行 `DiskMate.exe`，无需安装。

> 程序需要管理员权限（搬家/清理系统目录），启动时会自动请求 UAC 提权。
> 首次运行如遇 SmartScreen 提示，点「更多信息 → 仍要运行」。

## 🏗️ 项目结构

```
DiskMate/
├── app/                  # 应用源码（即 Electron 的 resources/app）
│   ├── main.js           # 主进程：窗口、UAC 提权、系统对话框
│   ├── renderer.js       # 13 个功能模块的全部逻辑
│   ├── index.html        # 界面结构
│   ├── style.css         # 设计系统（CSS 变量双主题）
│   ├── util.js           # PowerShell 调用、目录遍历、回收站删除等
│   ├── ui.js             # Toast / Modal / 主题 / 自绘标题栏
│   └── package.json
├── build.bat / build.ps1 # 一键构建脚本
└── README.md
```

## 🔧 技术要点

- **应用搬家**：`rename` 探测目录占用 → `robocopy` 复制 → `mklink /J` 目录联接 → 失败自动回滚；记录存于 `%ProgramData%\DiskMate\moves.json`
- **系统交互**：注册表/计划任务/回收站等通过 PowerShell `-EncodedCommand` 调用（UTF-8 安全），文件操作用 Node.js 原生 API
- **矩形树图**：Canvas 实现 squarified treemap 算法，两层嵌套渲染
- **内存释放**：PowerShell `Add-Type` 调用 `psapi.dll!EmptyWorkingSet`
- 开发即运行：修改 `app/` 下任意文件，重启程序即生效，无需编译

## ⚠️ 免责声明

本工具会对系统文件与注册表进行修改（均有确认提示与备份/回滚机制），请在了解相应功能作用的前提下使用。清理与删除操作有不可逆风险，作者不对数据损失负责。

## 📄 License

[MIT](LICENSE)
