# Kajimanga

Kajimanga 是一个浏览器端漫画翻译阅读器：导入漫画、离线书架、流畅阅读；框选页面区域即可调用视觉大模型完成日文识别与翻译。纯前端实现，本地运行，无服务端依赖。

Kajimanga is a browser-based manga translation reader. Import comics into an offline bookshelf and read smoothly — select any region of a page and a vision model will OCR and translate Japanese text to simplified Chinese. Purely front-end, runs locally, no server required.

## 功能 Features

- 支持导入 ZIP / CBZ / RAR / CBR / PDF 格式漫画 — Import comics in ZIP / CBZ / RAR / CBR / PDF formats
- IndexedDB 离线书架，保存漫画与阅读进度，随时继续阅读 — IndexedDB bookshelf keeps comics and reading progress for resuming anytime
- 左右热区翻页、推页式翻页动画、双击缩放、拖动平移 — Left/right tap zones for page turning, slide page-turn animation, double-tap zoom, drag to pan
- 框选任意区域，OCR 识别日文并翻译为简体中文 — Select any region, OCR Japanese and translate into simplified Chinese
- 学习模式：额外返回语法说明与单词 / 短语释义 — Learn mode with grammar notes and word/phrase explanations
- 移动端适配，iOS 风格页面切换 — Mobile-friendly with iOS-style page transitions

## 快速开始 Quick Start

```bash
npm install
npm run dev
```

生产构建与预览 Build & preview:

```bash
npm run build     # 类型检查 + 打包到 dist/  |  Type-check and build to dist/
npm run preview   # 本地预览构建产物            |  Preview the production build locally
```

## 使用说明 Usage

### 导入漫画 Import Comics

支持把压缩包 / PDF 直接拖入窗口，或点击「导入漫画」选择文件。图片页面会自动生成封面缩略图并存入书架；导入失败会有错误提示。

Drag archives / PDFs into the window or click "Import" to pick files. Page covers are generated automatically and stored in the bookshelf; failures show a clear error.

### 书架 Bookshelf

- 漫画以 IndexedDB 缓存在本地，刷新页面后依然存在 — Comics are cached in IndexedDB and survive page refreshes
- 每本漫画记录阅读进度，点击封面可继续阅读 — Reading progress is saved per comic; click the cover to resume
- 封面右上角 × 可移除漫画 — Use the × on the cover to remove a comic

### 阅读器 Reader

| 操作 Action | 效果 Effect |
|------|------|
| 点击页面左 / 右边缘热区 Tap left/right edge | 上一页 / 下一页 Previous / next page |
| 点击顶栏 / 底部导航按钮 Toolbar / bottom nav buttons | 翻页 Turn page |
| 双击页面中央 Double-tap the center | 放大 / 还原 Zoom in / reset (ratio configurable) |
| 放大后拖动 Drag while zoomed | 平移 Pan |
| 点击「翻译」Tap "Translate" | 进入框选模式 Enter selection mode and drag a region |

翻页动画为推页式滑动；缩放状态只对当前页有效，翻页后自动恢复。

Page turns use a sliding animation; zoom applies to the current page only and resets automatically on page change.

### 翻译 Translation

1. 点击顶栏「翻译」进入框选模式 — Tap "Translate" to enter selection mode
2. 在页面上拖出要翻译的文字区域（支持缩放状态下框选）— Drag over the text you want translated (works while zoomed)
3. 松手后自动裁剪该区域并调用视觉模型 — The region is cropped and sent to the vision model
4. 识别结果以译文卡片形式显示在选区旁 — Results appear in a card next to the selection

支持的服务商（OpenAI 兼容接口）：DeepSeek、Qwen（DashScope）、Kimi（Moonshot）、自定义。每个服务商可独立配置 `baseUrl / API Key / 模型名 / 思考档位`，支持「测试连接」。

Supported providers (OpenAI-compatible): DeepSeek, Qwen (DashScope), Kimi (Moonshot), and custom. Each provider has its own `baseUrl / API Key / model / thinking level`, with a "test connection" option.

翻译模式分为「翻译」与「学习」：翻译返回日文原文与中文译文；学习额外返回语法说明与单词 / 短语释义。

Two modes: "Translate" returns the Japanese text and Chinese translation; "Learn" additionally returns grammar notes and word/phrase explanations.

### 设置 Settings

| 设置项 Setting | 默认值 Default | 说明 Description |
|--------|--------|------|
| 双击缩放 Double-tap zoom | 开启 On | 双击页面切换放大 / 还原 Toggle zoom with double-tap |
| 缩放倍率 Zoom ratio | 2x | 双击放大的倍率 Double-tap zoom level |
| 翻译模式 Mode | 翻译 Translate | 翻译模式 / 学习模式 Translate / Learn |

设置保存在浏览器本地存储中。Settings persist in browser local storage.

## 技术栈 Tech Stack

- React 18 + TypeScript
- Vite 5
- JSZip / node-unrar-js（WASM 解压）
- pdfjs-dist（PDF 渲染）
- IndexedDB（书架与进度存储）

## 项目结构 Project Structure

```text
src/
├── App.tsx                    # 应用入口：书架 / 阅读层 / 设置导航  Entry: bookshelf / reader / settings
├── components/
│   ├── MangaViewer.tsx        # 阅读器：翻页、缩放、平移、框选、热区  Reader: paging, zoom, pan, selection, tap zones
│   ├── Toolbar.tsx            # 顶部工具栏 Top toolbar
│   ├── TranslationCard.tsx    # 译文结果卡片 Translation result card
│   ├── PageJump.tsx           # 页码跳转 Page jump
│   ├── SettingsModal.tsx      # 桌面端设置弹窗 Desktop settings modal
│   └── SettingsPage.tsx       # 移动端设置页 Mobile settings page
├── lib/
│   ├── mangaImport.ts         # ZIP / RAR / PDF 解析 Archive & PDF parsing
│   ├── readingCache.ts        # IndexedDB 书架缓存 Bookshelf cache
│   ├── visionApi.ts           # 视觉模型翻译请求 Vision model API calls
│   ├── crop.ts                # 选区裁剪 Selection cropping
│   ├── cover.ts               # 封面缩略图 Cover thumbnails
│   └── types.ts               # 共享类型 Shared types
└── styles.css                 # 全局样式 Global styles
```

## 隐私说明 Privacy

- 所有数据保存在本地浏览器：漫画文件、书架、阅读进度均不出本机 — All data (comics, bookshelf, progress) stays in your browser
- 只有框选出的那一小块图片会发送到你配置的服务商 API 用于识别和翻译，页面整体不会上传 — Only the small cropped region is sent to your configured provider for OCR/translation; the full page is never uploaded
- API Key 仅存储在浏览器 localStorage — API keys are stored only in browser localStorage

## 开发脚本 Scripts

| 命令 Command | 作用 Purpose |
|------|------|
| `npm run dev` | 启动开发服务器（HMR） Start dev server (HMR) |
| `npm run build` | 类型检查并生产构建 Type-check and build |
| `npm run preview` | 本地预览生产构建 Preview production build |