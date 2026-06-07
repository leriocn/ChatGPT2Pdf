# ChatGPT to PDF

一款强大的Chrome浏览器扩展，可一键将ChatGPT对话（包含图片）导出为高质量PDF文件。支持自有对话和分享对话，提供三种导出模式满足不同需求。

![版本](https://img.shields.io/badge/version-1.0.0-blue.svg)
![许可证](https://img.shields.io/badge/license-MIT-green.svg)
![Manifest](https://img.shields.io/badge/manifest-v3-orange.svg)

## ✨ 核心特性

### 🎯 三种导出模式

| 模式 | 技术原理 | 优势 | 适用场景 |
|------|---------|------|----------|
| **直读模式** | DOM内容提取 + html2canvas逐段渲染 | 高清文字、可选可复制、文件体积小 | 文字为主的对话、需要高质量文字 |
| **截图模式** | captureVisibleTab逐屏截图 | 所见即所得、保留完整视觉效果 | 含复杂排版、图表、特殊样式的对话 |
| **打印模式** | 浏览器原生window.print() | 灵活控制打印选项、支持自定义设置 | 需要精细控制打印参数的场景 |

### 🚀 强大功能

- **智能图片处理**
  - 自动提取对话中所有图片（支持`<img>`、`<source srcset>`、`background-image`）
  - DOM直接提取base64（无需重新下载）
  - 智能压缩：等比缩放至800px内，JPEG 85%质量
  - 三级降级策略：DOM提取 → 页面fetch → background下载

- **SAS过期检测**
  - 预扫描Azure SAS签名URL有效期
  - 过期前友好提示 + 一键刷新页面
  - 避免无效等待，提升用户体验

- **性能优化**
  - 快速滚动：120ms间隔 + 85%视口步长
  - 逐段渲染：内存占用小，失败隔离
  - 并行下载：图片批量获取，速度提升显著

- **智能适配**
  - 自动识别滚动容器（支持5种候选策略）
  - 截图模式自动隐藏侧边栏，全宽显示内容
  - 智能裁剪浏览器chrome（地址栏、工具栏等）

- **样式保真**
  - 保留代码块语法高亮
  - 清除oklch颜色（兼容html2canvas）
  - 强制白底黑字，避免深色模式残留
  - 完整保留表格、引用、列表等样式

## 📦 安装指南

### 方式一：从GitHub Release安装（推荐）

1. 访问 [Releases页面](../../releases) 下载最新版`ChatGPT2Pdf.zip`
2. 解压到本地任意文件夹
3. 打开Chrome浏览器，地址栏输入 `chrome://extensions/`
4. 开启右上角 **开发者模式**
5. 点击 **加载已解压的扩展程序**，选择解压后的文件夹

> **Edge浏览器用户**：地址栏输入 `edge://extensions/`，步骤相同

### 方式二：从源码安装

```bash
git clone https://github.com/leriocn/ChatGPT2Pdf.git
cd ChatGPT2Pdf
```

然后按照方式一的步骤3-5加载扩展。

## 🚀 使用教程

### 基础使用

1. **打开对话页面**
   - 自有对话：`https://chatgpt.com/c/xxxxx`
   - 分享对话：`https://chatgpt.com/share/xxxxx`

2. **启动扩展**
   - 点击浏览器工具栏的 **ChatGPT to PDF** 图标

3. **选择模式**
   - 📖 **直读模式**：高清文字 + 原图（默认推荐）
   - 📸 **截图模式**：所见即所得
   - 🖨️ **打印模式**：浏览器原生PDF

4. **开始导出**
   - 点击 **导出为 PDF** 按钮
   - 等待进度提示，PDF将自动下载

### 模式选择建议

```
对话内容类型          推荐模式
─────────────────────────────────
纯文字/代码为主      → 直读模式
含大量生成图片       → 直读模式
复杂排版/表格        → 截图模式
需要精细打印控制     → 打印模式
```

## ⚠️ 注意事项

### 图片签名过期问题

ChatGPT生成的图片使用Azure SAS签名URL，**有效期约1小时**。

**症状**：导出时提示"图片签名已过期"  
**解决**：刷新ChatGPT页面，让ChatGPT重新生成图片链接，然后重新导出

### 长对话导出

- 超过100条消息的对话导出时间较长，请耐心等待
- 导出过程中请勿关闭或刷新页面
- 可在页面右下角浮动面板随时取消导出

### 截图模式要求

- 导出过程中**请勿切换标签页或最小化窗口**
- 浏览器窗口必须保持可见状态
- 如窗口不可见，扩展会自动重试（最多10次）

## 🛠️ 技术架构

### 核心技术栈

| 技术 | 版本/用途 | 说明 |
|------|----------|------|
| **html2canvas** | 1.4.1 | DOM渲染为Canvas，支持复杂样式 |
| **jsPDF** | latest | Canvas拼接为PDF，支持分页、页眉页脚 |
| **Chrome Extension** | Manifest V3 | 现代扩展架构，Service Worker后台 |
| **captureVisibleTab** | Chrome API | 标签页截图，截图模式核心 |

### 架构设计

```
┌─────────────────────────────────────────────┐
│                 Popup UI                    │
│  模式选择 + 导出控制 + 状态显示              │
└──────────────┬──────────────────────────────┘
               │ chrome.runtime.sendMessage
               ▼
┌─────────────────────────────────────────────┐
│            Content Script                   │
│  • 滚动容器识别                              │
│  • DOM内容收集（直读模式）                   │
│  • 逐屏截图（截图模式）                      │
│  • 打印样式注入（打印模式）                  │
│  • 图片提取与压缩                            │
│  • PDF生成与下载                             │
└──────────────┬──────────────────────────────┘
               │ chrome.runtime.sendMessage
               ▼
┌─────────────────────────────────────────────┐
│          Background Service Worker          │
│  • captureVisibleTab截图                    │
│  • 跨域图片下载转base64                      │
│  • MAIN world注入（页面fetch）               │
│  • 系统通知                                  │
└─────────────────────────────────────────────┘
```

### 关键算法

#### 滚动容器识别（5级策略）
1. `[data-scroll-root]` 属性元素
2. `main`内overflow:auto/scroll元素
3. `documentElement`全局滚动
4. `body`滚动
5. 全局扫描兜底

#### 图片提取（三级降级）
1. **DOM直接提取**：canvas.drawImage → toDataURL（最快）
2. **页面MAIN world fetch**：利用页面cookie认证上下文
3. **Background Service Worker下载**：跨域请求兜底

#### PDF分页策略
- **直读模式**：逐段canvas切片，自动按A4高度分页
- **截图模式**：A4横版页面，截图按比例缩放居中
- **页眉页脚**：页码、时间戳、URL信息

## 📁 项目结构

```
ChatGPT2Pdf/
├── manifest.json           # 扩展清单（Manifest V3）
├── content.js              # 内容脚本（核心导出逻辑，1488行）
├── background.js           # 后台服务（截图、图片下载）
├── popup.html              # 弹出窗口UI
├── popup.js                # 弹出窗口交互逻辑
├── generate_icons.js       # 图标生成脚本
├── styles/
│   └── popup.css           # Popup样式（317行）
├── libs/
│   ├── html2canvas.min.js  # DOM渲染库
│   └── jspdf.umd.min.js    # PDF生成库
├── icons/
│   ├── icon16.png          # 工具栏图标
│   ├── icon48.png          # 扩展管理页图标
│   └── icon128.png         # Chrome Web Store图标
└── README.md               # 项目文档
```

## 🔧 开发指南

### 本地开发

```bash
# 1. 克隆仓库
git clone https://github.com/leriocn/ChatGPT2Pdf.git
cd ChatGPT2Pdf

# 2. 加载扩展到浏览器
# chrome://extensions/ → 开发者模式 → 加载已解压的扩展程序

# 3. 修改代码后刷新扩展即可生效
```

### 调试技巧

- **Console日志**：所有操作都有`[ChatGPT2PDF]`前缀，方便过滤
- **Popup调试**：右键扩展图标 → 审查弹出内容
- **Content Script调试**：打开DevTools → Console查看日志
- **Background调试**：chrome://extensions/ → Service Worker → 检查视图

### 代码规范

- 使用ES6+语法
- 关键函数添加JSDoc注释
- 错误处理完善，避免中断用户体验
- 性能优化：减少DOM操作，使用requestAnimationFrame

## 🐛 常见问题

### Q: 导出时提示"content script未注入"？
A: 点击导出按钮时扩展会自动注入，如仍失败请刷新页面后重试。

### Q: 导出的PDF缺少部分内容？
A: 可能是滚动收集时遗漏了部分章节。建议：
1. 确保页面完全加载后再导出
2. 尝试截图模式（所见即所得）
3. 检查浏览器Console是否有错误日志

### Q: 图片显示为空白或加载失败？
A: 通常是SAS签名过期导致，请：
1. 刷新ChatGPT页面（重新生成图片链接）
2. 等待图片完全加载后再导出
3. 检查网络连接是否正常

### Q: 导出速度很慢？
A: 可能原因：
1. 对话过长（>100条消息），属正常现象
2. 图片过多，需要时间下载和压缩
3. 浏览器性能限制，建议关闭其他标签页

## 📝 更新日志

### v1.0.0 (2026-06-07)

**首次发布**

- ✅ 三种导出模式：直读、截图、打印
- ✅ 智能图片提取与压缩
- ✅ SAS过期检测与友好提示
- ✅ 自动隐藏侧边栏，全宽显示
- ✅ 逐段渲染，失败隔离
- ✅ 页眉页脚自动生成
- ✅ 浮动进度条，支持取消导出
- ✅ 完善的错误处理与降级策略

## 📄 开源协议

MIT License

## 🙏 致谢

感谢以下开源项目：
- [html2canvas](https://github.com/niklasvh/html2canvas) - DOM渲染
- [jsPDF](https://github.com/parallax/jsPDF) - PDF生成

---

**Made with ❤️ by [Jeffer Su](https://github.com/leriocn)**

如果这个项目对您有帮助，欢迎 ⭐ Star 支持！