# COCO Downloader (COCO音乐下载站)

![Next.js](https://img.shields.io/badge/Next.js-16.1-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.0-38B2AC)
![License](https://img.shields.io/badge/License-MIT-green)
> 基于 [markcxx/coco-downloader](https://github.com/markcxx/coco-downloader) 做了一些功能扩展，增加了歌单导入、官方搜索、歌词显示、音频元数据写入、适配器负载均衡等能力。

> 本仓库地址：[https://github.com/zjy8963/coco-downloader](https://github.com/zjy8963/coco-downloader)

## 📖 简介

**COCO音乐下载站** 是一个基于 Next.js 16 构建的现代化音乐搜索与下载平台。界面设计简约纯净，支持多渠道音乐搜索、在线试听、批量下载，并配备了丝滑的暗黑模式（涟漪过渡动画）。

本项目致力于提供无广告、极速、纯净的音乐获取体验。

## ✨ 主要特性

- 🎵 **多源聚合搜索**：支持全网聚合搜索，内置多种音乐源渠道，一键切换。
- 🎧 **在线试听**：内置精美悬浮播放器，支持播放/暂停、进度拖拽、音量调节、上下曲切换、播放模式切换（顺序/随机/单曲）。
- 🖱️ **便捷交互**：列表双击播放，鼠标悬停/选中效果优化，操作流畅。
- ⬇️ **批量下载**：多选歌曲，一键批量下载。
- 🌓 **极致主题体验**：深色/浅色模式，涟漪扩散切换动画（View Transitions API）。
- ⚡ **现代化技术栈**：React 19、Next.js 16 App Router、Tailwind CSS v4。

### 本版扩展

- 🔍 **官方搜索**：支持直接调用网易云、QQ、酷狗、酷我官方 API 搜索，搜索结果更准确，同时保留原版第三方聚合搜索作为备用。
- 📋 **歌单导入**：支持四大平台歌单链接一键导入，自动解析曲目列表。
- 📝 **歌词显示**：播放时自动获取并展示同步歌词，支持点击跳转。
- 🏷️ **元数据写入**：下载时自动为音频文件写入歌曲信息（标题、歌手、封面、歌词），MP3 和 FLAC 均有支持。
- 🔗 **适配器扩展**：集成了大量第三方音频解析接口，内置负载均衡器（主池轮转 + 探路替换 + 冷却淘汰），自动选择最优适配器。
- 🔄 **跨平台兜底**：当某首歌在当前平台无版权时，自动到其他平台搜索匹配并切换解析。
- 🧪 **适配器测试工具**：提供 `/api-test` 可视化页面，支持 SSE 实时测试、拖拽排序调整优先级、死名单管理。

## 🎹 支持音源与音质说明

在原项目音源下聚合了大量第三方api，支持以下音源：

- **歌曲宝**
- **歌曲海**
- **布谷**
- **QQ音乐**
- **QQMP3**
- **咪咕**
- **力音**
- **煎饼系列**（网易/QQ/酷狗/酷我聚合）
- **第三方Api**

> **⚠️ 关于音质的重要说明：**
> 1. 程序自动解析目标源提供的默认最高可用音质。
> 2. 部分音源（如咪咕、QQMP3等）在资源允许的情况下会自动解析出 FLAC 无损格式。
> 3. 若某个源无法播放，建议切换其他源重试。

## 🛠 技术栈

- **核心框架**: [Next.js 16.1.2](https://nextjs.org/) (App Router)
- **编程语言**: [TypeScript](https://www.typescriptlang.org/)
- **样式方案**: [Tailwind CSS v4](https://tailwindcss.com/)
- **动画库**: [Framer Motion](https://www.framer.com/motion/)
- **图标库**: [Lucide React](https://lucide.dev/)
- **主题管理**: [next-themes](https://github.com/pacocoursey/next-themes) + View Transitions API
- **后端处理**: Next.js API Routes + Axios + Cheerio

## 🚀 快速开始

### 环境要求

- Node.js >= 18.17.0
- npm / pnpm / yarn

### 1. 克隆项目

```bash
git clone https://github.com/zjy8963/coco-downloader.git
cd coco-downloader
```

### 2. 安装依赖

```bash
npm install
# 或者
yarn install
# 或者
pnpm install
```

### 3. 运行开发服务器

```bash
npm run dev
```

打开浏览器访问 [http://localhost:3000](http://localhost:3000) 即可开始使用。

### 4. 构建生产版本

```bash
npm run build
npm start
```

## 🚀 docker部署方案

**适合不想装 Node.js 的小伙伴，一行命令跑起来：**

```bash
# 1. 拉取镜像
docker pull zjy8963/coco-downloader:latest

# 2. 运行
docker run -d -p 3000:3000 --name coco-downloader zjy8963/coco-downloader:latest
```

打开浏览器访问 `http://localhost:3000` 即可使用。

## 📂 项目结构

```
coco-downloader/
├── src/
│   ├── app/                 # Next.js App Router 核心目录
│   │   ├── api/             # 后端 API 路由 (search, url, download, playlist)
│   │   ├── globals.css      # 全局样式 (含 Tailwind v4 配置)
│   │   ├── layout.tsx       # 根布局 (集成 ThemeProvider)
│   │   └── page.tsx         # 首页主要逻辑 (搜索、列表、交互)
│   ├── components/          # UI 组件
│   │   ├── Navbar.tsx       # 顶部导航栏 (含涟漪主题切换逻辑)
│   │   ├── PlayerBar.tsx    # 底部悬浮播放器
│   │   ├── LyricsDisplay.tsx# 歌词展示组件
│   │   └── ThemeProvider.tsx# 主题上下文提供者
│   ├── lib/                 # 工具库
│   │   ├── metadata.ts      # 音频元数据嵌入
│   │   ├── providers/       # 音乐源策略模式实现
│   │   ├── playlist/        # 歌单解析模块
│   │   └── search/          # 平台官方搜索
│   └── types/               # TypeScript 类型定义
├── public/                  # 静态资源文件
└── ...
```

## 🎨 特色功能实现解析

### 涟漪主题切换

在 `src/components/Navbar.tsx` 中，利用了浏览器原生的 `document.startViewTransition` API 配合 CSS `clip-path` 属性。当用户点击主题切换按钮时，计算点击坐标，以该坐标为圆心，计算覆盖全屏所需的最大半径，然后执行圆形扩散遮罩动画。

### 音乐源扩展

项目后端采用策略模式设计。在 `src/lib/providers` 下定义了统一的接口。若需添加新的音乐网站源，只需新建一个实现类并在工厂方法中注册即可，无需大幅修改前端逻辑。



## ⚠️ 免责声明

1. 本项目仅供**个人学习与技术交流**使用，严禁用于任何商业用途。
2. 本项目所有音乐资源均来源于互联网第三方网站，本项目仅提供数据聚合与检索服务，不存储任何音乐文件。
3. 若您发现本项目侵犯了您的权益，请联系我们进行删除。
4. 使用本项目产生的任何法律后果由使用者自行承担。

## 🤝 贡献与反馈

如果您发现任何问题或有新功能建议，欢迎提交 Issue 或 Pull Request。

仓库地址：[https://github.com/zjy8963/coco-downloader](https://github.com/zjy8963/coco-downloader)

## 📄 许可证

MIT License