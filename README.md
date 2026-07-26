<div align="center">

<img src="app/logo.png" width="88" alt="DiskMate">

# DiskMate 磁盘管家

**开源的 Windows 电脑管家 · 驾驶舱玻璃拟态界面**

应用搬家 · 垃圾清理 · 空间分析 · 系统优化 · 硬件监测 —— 21 大功能模块

![platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0ea5e9)
![electron](https://img.shields.io/badge/Electron-33-47848F)
![license](https://img.shields.io/badge/license-MIT-10b981)

</div>

---

## ✨ 功能总览

<table>
<tr><td width="33%">

**🧹 清理**
- 垃圾清理（10 类）
- 深度清理（空文件夹 / 失效快捷方式）
- 隐私清理（痕迹 / 浏览记录）
- 注册表清理（失效项，带备份）
- 微信 / QQ 专项清理

</td><td width="33%">

**📊 空间**
- 空间分析（矩形树图 + 目录树）
- 大文件查找
- 重复文件（哈希 + 逐字节校验）
- 应用搬家（目录联接，可还原）

</td><td width="33%">

**⚡ 优化 / 系统**
- 系统加速（内存释放 / 进程）
- 一键优化（可逆调优）
- 启动项管理（含计划任务）
- 右键菜单管理
- 驱动管理 / 硬件信息
- 磁盘健康（SMART）/ 网络工具
- 软件更新（winget）/ 工具箱

</td></tr>
</table>

## 🎨 界面特性

- **驾驶舱玻璃拟态**：浅色渐变 / 深色双主题，悬浮胶囊侧边栏，磨砂玻璃卡片
- **自定义背景**：图片 / 视频背景，亮暗分设，模糊 + 遮罩，每 30 秒可自动切换壁纸
- **丰富动效**：极光背景、评分环炫光、卡片入场、按钮涟漪、数字滚动等
- **应用内自动更新**：检测新版 → 下载安装包 → 一键安装

## 🚀 快速开始

### 方式一：直接安装（推荐）

前往 [Releases](https://github.com/945967063/DiskMate/releases) 下载 `DiskMate-Setup-vX.X.exe`，双击安装（简体中文向导，装完自动运行）。

> 程序需要管理员权限，启动时自动请求 UAC。首次运行如遇 SmartScreen 提示，点「更多信息 → 仍要运行」。

### 方式二：从源码构建

```bat
git clone https://github.com/945967063/DiskMate.git
cd DiskMate
build.bat
```

`build.bat` 会自动下载 Electron 运行时并组装出 `DiskMate\DiskMate.exe`。

### 方式三：开发调试

`app\` 目录即 Electron 的 `resources\app`，修改其中任意文件后重启程序（或按 **Ctrl+R** 刷新）即可生效，无需编译。按 **F12** 打开开发者工具实时调试界面。

## 🏗️ 项目结构

```
DiskMate/
├── app/                 # 应用源码（= Electron resources/app）
│   ├── main.js          # 主进程：窗口 / UAC 提权 / IPC / 自动更新
│   ├── renderer.js      # 全部 21 个功能模块逻辑
│   ├── index.html       # 界面结构
│   ├── style.css        # 设计系统（CSS 变量双主题）
│   ├── effects.css      # 视觉特效层（玻璃 / 动效 / 背景）
│   ├── util.js          # PowerShell 调用 / 文件遍历 / 回收站
│   ├── ui.js            # Toast / Modal / 主题 / 导航
│   └── package.json
├── build.bat / build.ps1  # 一键构建脚本
├── 一键推送.bat            # 本地 git push helper
├── CHANGELOG.md
└── README.md
```

> 安装包通过 GitHub Releases 分发，不纳入 git 仓库（避免历史膨胀）。

## 🔧 技术要点

- **应用搬家**：`robocopy` 复制 → `mklink /J` 目录联接 → 失败自动回滚；记录存于 `%ProgramData%\DiskMate`
- **系统交互**：注册表 / 计划任务 / 回收站 / SMART 等经 PowerShell `-EncodedCommand`（UTF-8 安全）调用
- **矩形树图**：Canvas 实现 squarified treemap
- **玻璃拟态**：`backdrop-filter` 磨砂 + 自定义背景层
- **自动更新**：读取 GitHub Releases API，应用内 `fetch` 下载安装包并运行

## ⚠️ 免责声明

本工具会修改系统文件与注册表（均有确认提示与备份 / 回滚），清理删除操作有不可逆风险，请在了解功能作用的前提下使用，作者不对数据损失负责。

## 📄 License

[MIT](LICENSE) © lihaha
