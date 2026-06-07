/**
 * ChatGPT to PDF - Content Script (v3)
 * Developer: Jeffer SU
 *
 * 两种导出模式：
 *   1. 直读模式：边滚动边提取 DOM 内容，文字高清 + 图片原始分辨率
 *   2. 截图模式：边滚动边截图，所见即所得
 *
 * 共同策略：滚动到顶部 → 逐屏向下处理 → 拼成 PDF
 *
 * 稳定选择器（只用 data-* 属性和语义标签）：
 *   - section[data-testid^="conversation-turn-"]  → 对话轮次
 *   - div[data-message-author-role]               → 消息
 *   - [data-scroll-root]                          → 滚动容器
 *   - [class*="imagegen"]                         → 图片容器（语义词）
 *   - img[src*="oaiusercontent.com"]              → 生成的图片
 *   - img[src*="oaidalleapiprodscus"]             → DALL-E 图片
 */

// ─────────────────────────────────────────────
//  取消标志
// ─────────────────────────────────────────────
let _cancelled = false;

// ─────────────────────────────────────────────
//  消息监听
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'cancelExport') {
    _cancelled = true;
    const wrapper = document.getElementById('__chatgpt2pdf_print__');
    if (wrapper) wrapper.remove();
    const hide = document.getElementById('__chatgpt2pdf_hide__');
    if (hide) hide.remove();
    sendResponse({ cancelled: true });
    return;
  }
  if (message.action === 'exportPDF') {
    _cancelled = false;
    const mode = message.mode || 'read';
    if (mode === 'print') {
      // ★ 打印模式：注入 CSS + window.print()
      exportByPrintMode()
        .then(() => sendResponse({ success: true, filename: document.title + '.pdf', pages: 1 }))
        .catch(err => {
          console.error('[ChatGPT2PDF] 打印失败:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }
    exportToPDF(mode)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => {
        console.error('[ChatGPT2PDF] 导出失败:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
  if (message.action === 'getPageInfo') {
    sendResponse({
      title: getConversationTitle(),
      url: window.location.href,
      isSupported: isSupportedPage()
    });
  }
});

// ─────────────────────────────────────────────
//  工具函数
// ─────────────────────────────────────────────
function isSupportedPage() {
  return /chatgpt\.com\/(c|share)\//.test(window.location.href);
}

function getConversationTitle() {
  let title = document.title || '';
  title = title.replace(/\s*[-–|]\s*ChatGPT\s*$/i, '').trim();
  if (title && title !== 'ChatGPT') return title;
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle?.content) {
    title = ogTitle.content.replace(/\s*[-–|]\s*ChatGPT\s*$/i, '').trim();
    if (title) return title;
  }
  const h1 = document.querySelector('h1');
  if (h1?.textContent.trim()) return h1.textContent.trim();
  return 'ChatGPT对话_' + new Date().toLocaleDateString('zh-CN').replace(/\//g, '-');
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().substring(0, 200);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ─────────────────────────────────────────────
//  页面浮动进度条
// ─────────────────────────────────────────────
let _overlayEl = null;

function showOverlay(text) {
  if (_overlayEl) {
    _overlayEl.querySelector('.cg2p-text').textContent = text;
    return;
  }
  _overlayEl = document.createElement('div');
  _overlayEl.id = '__chatgpt2pdf_overlay__';
  _overlayEl.innerHTML = `
    <div class="cg2p-panel">
      <div class="cg2p-header">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="6" fill="#10a37f"/>
          <path d="M6 7h12M6 11h12M6 15h8" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span class="cg2p-title">ChatGPT to PDF</span>
      </div>
      <div class="cg2p-body">
        <div class="cg2p-spinner"></div>
        <span class="cg2p-text">${text}</span>
      </div>
      <button class="cg2p-cancel">取消</button>
    </div>
  `;
  _overlayEl.querySelector('.cg2p-cancel').addEventListener('click', () => {
    _cancelled = true;
    hideOverlay();
  });
  const style = document.createElement('style');
  style.id = '__chatgpt2pdf_overlay_style__';
  style.textContent = `
    #__chatgpt2pdf_overlay__ {
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
      animation: cg2pSlideIn 0.3s ease;
    }
    @keyframes cg2pSlideIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .cg2p-panel {
      background: #fff; border-radius: 12px; padding: 14px 18px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.1);
      border: 1px solid #e8e8e8; min-width: 240px; max-width: 340px;
    }
    .cg2p-header {
      display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
    }
    .cg2p-title { font-size: 13px; font-weight: 700; color: #111; }
    .cg2p-body {
      display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
    }
    .cg2p-spinner {
      width: 16px; height: 16px; flex-shrink: 0;
      border: 2px solid rgba(16,163,127,0.3); border-top-color: #10a37f;
      border-radius: 50%; animation: cg2pSpin 0.8s linear infinite;
    }
    @keyframes cg2pSpin { to { transform: rotate(360deg); } }
    .cg2p-text { font-size: 13px; color: #444; line-height: 1.4; }
    .cg2p-cancel {
      width: 100%; padding: 7px; border: 1px solid #ddd; border-radius: 8px;
      background: transparent; color: #888; font-size: 12px; cursor: pointer;
      transition: all 0.15s;
    }
    .cg2p-cancel:hover { color: #ef4444; border-color: #ef4444; background: #fff5f5; }
  `;
  document.head.appendChild(style);
  document.body.appendChild(_overlayEl);
}

function hideOverlay() {
  if (_overlayEl) {
    _overlayEl.style.animation = 'cg2pSlideIn 0.2s ease reverse';
    setTimeout(() => {
      _overlayEl?.remove();
      _overlayEl = null;
      document.getElementById('__chatgpt2pdf_overlay_style__')?.remove();
    }, 200);
  }
}

function showOverlayResult(text) {
  if (!_overlayEl) return;
  _overlayEl.querySelector('.cg2p-spinner').style.display = 'none';
  _overlayEl.querySelector('.cg2p-text').textContent = text;
  _overlayEl.querySelector('.cg2p-cancel').textContent = '关闭';
  _overlayEl.querySelector('.cg2p-cancel').onclick = hideOverlay;
  setTimeout(hideOverlay, 4000);
}

function showOverlayError(text) {
  if (!_overlayEl) return;
  _overlayEl.querySelector('.cg2p-spinner').style.display = 'none';
  _overlayEl.querySelector('.cg2p-text').textContent = '❌ ' + text;
  _overlayEl.querySelector('.cg2p-text').style.color = '#c62828';
  _overlayEl.querySelector('.cg2p-cancel').textContent = '关闭';
  _overlayEl.querySelector('.cg2p-cancel').onclick = hideOverlay;
  setTimeout(hideOverlay, 6000);
}

// ★ SAS 过期警告：显示提示 + 刷新按钮
function showSASExpiredWarning(count, minutes) {
  if (!_overlayEl) showOverlay('');
  _overlayEl.querySelector('.cg2p-spinner').style.display = 'none';
  const textEl = _overlayEl.querySelector('.cg2p-text');
  textEl.innerHTML = `⚠️ <b>${count} 张图片签名已过期</b>（${minutes}分钟前）<br><span style="font-size:12px;color:#888">Azure 会拒绝下载，请先刷新页面让 ChatGPT 重新生成链接</span>`;
  textEl.style.color = '#b45309';

  // 把取消按钮改为“刷新页面”按钮
  const btn = _overlayEl.querySelector('.cg2p-cancel');
  btn.textContent = '🔄 刷新页面';
  btn.style.cssText = 'width:100%;padding:8px;border:none;border-radius:8px;background:#10a37f;color:#fff;font-size:13px;font-weight:600;cursor:pointer;margin-top:4px;';
  btn.onmouseover = () => btn.style.background = '#0d8c6d';
  btn.onmouseout = () => btn.style.background = '#10a37f';
  btn.onclick = () => { location.reload(); };

  // 再加一个“取消”链接
  const cancelLink = document.createElement('div');
  cancelLink.style.cssText = 'text-align:center;margin-top:6px;';
  cancelLink.innerHTML = '<a href="#" style="font-size:11px;color:#999;">取消导出</a>';
  cancelLink.querySelector('a').onclick = (e) => { e.preventDefault(); _cancelled = true; hideOverlay(); };
  btn.parentElement.appendChild(cancelLink);
}

function notifyProgress(message) {
  if (message) showOverlay(message);
  try { chrome.runtime.sendMessage({ action: 'progressUpdate', message }); } catch (_) {}
}

// ─────────────────────────────────────────────
//  找到滚动容器（用 data-scroll-root）
// ─────────────────────────────────────────────
function findScrollContainer() {
  // 候选 1：[data-scroll-root]（普通对话页面）
  const scrollRoot = document.querySelector('[data-scroll-root]');
  if (scrollRoot && scrollRoot.scrollHeight > scrollRoot.clientHeight + 50) {
    console.log('[ChatGPT2PDF] 滚动容器候选 1: [data-scroll-root]',
      'scrollH=' + scrollRoot.scrollHeight, 'clientH=' + scrollRoot.clientHeight);
    return scrollRoot;
  }

  // 候选 2：main 内任何 overflow:auto/scroll 元素
  const main = document.querySelector('main');
  if (main) {
    let best = null, bestH = 0;
    const check = el => {
      const s = window.getComputedStyle(el);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 50 && el.scrollHeight > bestH) {
        best = el; bestH = el.scrollHeight;
      }
    };
    check(main);
    main.querySelectorAll('*').forEach(check);
    if (best) {
      console.log('[ChatGPT2PDF] 滚动容器候选 2: main 内元素', best.tagName,
        'scrollH=' + best.scrollHeight, 'clientH=' + best.clientHeight);
      return best;
    }
  }

  // 候选 3：documentElement 全局滚动（share 页面常见）
  const docEl = document.documentElement;
  if (docEl.scrollHeight > docEl.clientHeight + 50) {
    console.log('[ChatGPT2PDF] 滚动容器候选 3: documentElement',
      'scrollH=' + docEl.scrollHeight, 'clientH=' + docEl.clientHeight);
    return docEl;
  }

  // 候选 4：body 滚动
  if (document.body.scrollHeight > document.body.clientHeight + 50) {
    console.log('[ChatGPT2PDF] 滚动容器候选 4: body',
      'scrollH=' + document.body.scrollHeight, 'clientH=' + document.body.clientHeight);
    return document.body;
  }

  // 候选 5：全局扫描（最后兜底）
  let best = null, bestH = 0;
  document.querySelectorAll('*').forEach(el => {
    const s = window.getComputedStyle(el);
    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 50 && el.scrollHeight > bestH) {
      best = el; bestH = el.scrollHeight;
    }
  });
  if (best) {
    console.log('[ChatGPT2PDF] 滚动容器候选 5: 全局扫描', best.tagName,
      best.className.toString().substring(0, 60),
      'scrollH=' + best.scrollHeight, 'clientH=' + best.clientHeight);
    return best;
  }

  console.warn('[ChatGPT2PDF] 未找到任何滚动容器，使用 documentElement（可能不会滚动）');
  return document.documentElement;
}

// ─────────────────────────────────────────────
//  滚动到顶部（快速确认）
// ─────────────────────────────────────────────
async function scrollToTop(container) {
  for (let i = 0; i < 10; i++) {
    container.scrollTop = 0;
    await sleep(200);
    if (container.scrollTop === 0) {
      await sleep(300);
      if (container.scrollTop === 0) return;
    }
  }
}

// ─────────────────────────────────────────────
//  captureVisibleTab 调用
// ─────────────────────────────────────────────
function captureTab(retries = 10) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'captureTab' }, resp => {
      const errMsg = chrome.runtime.lastError?.message || resp?.error || '';
      const isAccessError = errMsg.includes('Cannot access contents') || errMsg.includes('captureVisibleTab');
      if (chrome.runtime.lastError || !resp?.success) {
        if (retries > 0 && isAccessError) {
          const delay = retries > 5 ? 3000 : 1500;
          console.warn(`[ChatGPT2PDF] captureTab 窗口可能最小化，${retries}次重试剩余，等待${delay}ms`);
          notifyProgress(`浏览器窗口不可见，请恢复窗口（剩余${retries}次重试）...`);
          setTimeout(() => captureTab(retries - 1).then(resolve, reject), delay);
        } else {
          reject(new Error(errMsg || '截图失败'));
        }
      } else {
        resolve(resp.dataUrl);
      }
    });
  });
}

// ─────────────────────────────────────────────
//  图片 base64 获取 — 直接从 DOM 已加载的图片提取
// ─────────────────────────────────────────────

/**
 * 从页面上已加载的 <img> 元素直接提取 base64（无需重新下载）
 * 原理：图片已在浏览器中渲染 → canvas.drawImage → toDataURL
 */
function extractImagesFromDOM(imageURLs) {
  const map = new Map();
  const allImgs = document.querySelectorAll('img');

  for (const targetUrl of imageURLs) {
    const base = targetUrl.split('?')[0];

    // 在 DOM 中找到匹配的已加载 <img>
    for (const img of allImgs) {
      const imgSrc = img.currentSrc || img.src || img.getAttribute('src') || '';
      if (!imgSrc) continue;

      // 匹配：相同 base URL，或相同去参数 URL
      const imgBase = imgSrc.split('?')[0];
      const isMatch = imgBase === base || imgSrc === targetUrl;
      if (!isMatch) continue;

      // 确保图片已加载
      if (!img.complete || img.naturalWidth === 0) continue;

      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        // 验证提取成功（不是空白图片）
        if (dataUrl && dataUrl.length > 200) {
          map.set(targetUrl, dataUrl);
          console.log('[ChatGPT2PDF] DOM提取成功:', targetUrl.substring(0, 60) + '...',
            `(${img.naturalWidth}x${img.naturalHeight})`);
          break;
        }
      } catch (e) {
        console.warn('[ChatGPT2PDF] DOM canvas提取失败:', imgSrc.substring(0, 60), e.message);
      }
    }
  }

  return map;
}

// 降级：通过 background service worker 下载
async function fetchImageBase64(url) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'fetchImage', url }, resp => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (resp?.success) resolve(resp.data);
      else reject(new Error(resp?.error || '图片加载失败'));
    });
  });
}

// 降级：在页面 MAIN world 中批量 fetch（origin=chatgpt.com，可读取 oaiusercontent.com 资源）
async function fetchImagesInPageWorld(urls) {
  if (urls.length === 0) return new Map();
  const map = new Map();
  try {
    const resp = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'fetchImagesInPage', urls },
        r => { if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(r); }
      );
    });
    if (resp?.success && resp.results) {
      for (const [url, dataUrl] of Object.entries(resp.results)) {
        if (dataUrl) map.set(url, dataUrl);
      }
    } else {
      console.warn('[ChatGPT2PDF] fetchImagesInPage 返回失败:', resp?.error);
    }
  } catch (e) {
    console.warn('[ChatGPT2PDF] fetchImagesInPage 异常:', e.message);
  }
  return map;
}

// ─────────────────────────────────────────────
//  判断图片 src 是否属于 ChatGPT 生成
// ─────────────────────────────────────────────
const IMAGE_DOMAINS = ['oaiusercontent.com', 'oaidalleapiprodscus.blob.core.windows.net', 'oaidalleprodscus.blob.core.windows.net'];
function isChatGPTImage(src) {
  if (!src || src.startsWith('data:')) return false;
  return IMAGE_DOMAINS.some(d => src.includes(d));
}

// 检查 Azure SAS URL 是否过期
//   ?se=2026-06-06T08:29:03Z 这个 se 参数是过期时间（UTC ISO）
//   过期后 Azure 直接 403，连 ChatGPT 自己也 fetch 不到
function checkSASExpiry(urls) {
  const expired = [];
  const valid = [];
  const now = new Date();
  for (const url of urls) {
    try {
      const seParam = new URL(url).searchParams.get('se');
      if (!seParam) { valid.push(url); continue; }
      const expireTime = new Date(seParam);
      if (isNaN(expireTime.getTime())) { valid.push(url); continue; }
      if (now > expireTime) {
        expired.push({ url, expireTime, expiredMinutes: Math.floor((now - expireTime) / 60000) });
      } else {
        valid.push(url);
      }
    } catch (e) {
      valid.push(url);
    }
  }
  return { expired, valid, allExpired: expired.length === urls.length && urls.length > 0 };
}

// ─────────────────────────────────────────────
//  检查第三方库是否就绪（由 manifest content_scripts 自动注入）
// ─────────────────────────────────────────────
function ensureLibs() {
  if (!window.html2canvas) throw new Error('html2canvas 库未加载，请刷新页面重试');
  if (!window.jspdf) throw new Error('jsPDF 库未加载，请刷新页面重试');
}

// ═══════════════════════════════════════════════
//  模式1：直读模式
//  边滚动边收集整个 section 的完整内容（含图片位置）
//  按 data-testid 排序去重
// ═══════════════════════════════════════════════
async function exportByReadMode() {
  const container = findScrollContainer();

  notifyProgress('正在滚动到对话开头...');
  await scrollToTop(container);
  if (_cancelled) return null;

  // ★ 快速预扫描：先检查图片 SAS 是否过期，避免浪费时间滚动收集
  const preScanURLs = new Set();
  document.querySelectorAll('source[srcset]').forEach(source => {
    const srcset = source.getAttribute('srcset') || '';
    const firstUrl = srcset.split(',')[0].trim().split(/\s+/)[0];
    if (isChatGPTImage(firstUrl)) preScanURLs.add(firstUrl);
  });
  document.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || img.src || '';
    if (isChatGPTImage(src)) preScanURLs.add(src);
  });
  if (preScanURLs.size > 0) {
    const preCheck = checkSASExpiry([...preScanURLs]);
    if (preCheck.expired.length > 0) {
      const sample = preCheck.expired[0];
      console.warn(`[ChatGPT2PDF] 预扫描发现 ${preCheck.expired.length} 个图片 SAS 已过期（${sample.expiredMinutes}分钟前）`);
      showSASExpiredWarning(preCheck.expired.length, sample.expiredMinutes);
      _cancelled = true;
      return null;
    }
    console.log(`[ChatGPT2PDF] 预扫描通过: ${preScanURLs.size} 个图片 SAS 均未过期`);
  }

  notifyProgress('正在逐屏收集对话内容...');

  const collected = new Map(); // key: data-testid → { role, html, imageURLs }
  const viewHeight = container.clientHeight;
  let pos = 0;

  while (true) {
    if (_cancelled) return null;

    container.scrollTop = pos;
    await sleep(120);  // ★ 加快滚动速度（原 350ms → 120ms）

    const sections = document.querySelectorAll('section[data-testid^="conversation-turn-"]');
    sections.forEach(section => {
      const testid = section.getAttribute('data-testid');
      if (collected.has(testid)) return;

      const msgEl = section.querySelector('div[data-message-author-role]');
      const role = msgEl?.getAttribute('data-message-author-role') || 'assistant';

      // ★ 在 section 级别收集所有 ChatGPT 图片（URL + 直接提取 base64）
      const imageURLs = [];
      const imageData = []; // {url, base64}
      const seenURLs = new Set();

      // 辅助：尝试从 <img> 元素直接提取 base64
      function tryExtractBase64(img) {
        if (!img.complete || img.naturalWidth === 0) return null;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL('image/png');
          return (dataUrl && dataUrl.length > 200) ? dataUrl : null;
        } catch (e) {
          // 跨域图片未设置 crossOrigin，canvas 被污染，toDataURL 抛 SecurityError
          if (!window.__cg2p_canvas_warned) {
            console.warn('[ChatGPT2PDF] canvas 提取失败（tainted）:', e.name, e.message, '→ 将走 fetch 降级');
            window.__cg2p_canvas_warned = true;
          }
          return null;
        }
      }

      // 从 <img> 收集 + 直接提取
      section.querySelectorAll('img').forEach(img => {
        const src = img.getAttribute('src') || img.src || '';
        if (!isChatGPTImage(src)) return;
        if (img.closest('[class*="blur"]')) return;
        const base = src.split('?')[0];
        if (seenURLs.has(base)) return;
        seenURLs.add(base);
        imageURLs.push(src);
        imageData.push({ url: src, base64: tryExtractBase64(img) });
      });

      // ★ 从 <source srcset="..."> 收集（ChatGPT 用 <picture> 包裹图片）
      section.querySelectorAll('source[srcset]').forEach(source => {
        const srcset = source.getAttribute('srcset') || '';
        const firstUrl = srcset.split(',')[0].trim().split(/\s+/)[0];
        if (!isChatGPTImage(firstUrl)) return;
        const base = firstUrl.split('?')[0];
        if (seenURLs.has(base)) return;
        seenURLs.add(base);
        imageURLs.push(firstUrl);
        // 找到同一个 <picture> 中的 <img> 并提取
        const picture = source.closest('picture');
        const imgEl = picture ? picture.querySelector('img') : null;
        imageData.push({ url: firstUrl, base64: imgEl ? tryExtractBase64(imgEl) : null });
      });

      // ★ 从 background-image 收集
      section.querySelectorAll('[style]').forEach(el => {
        const bg = el.style.backgroundImage || '';
        const match = bg.match(/url\(["']?([^"')]+)["']?\)/);
        if (match && isChatGPTImage(match[1])) {
          const base = match[1].split('?')[0];
          if (!seenURLs.has(base)) {
            seenURLs.add(base);
            imageURLs.push(match[1]);
            imageData.push({ url: match[1], base64: null });
          }
        }
      });

      // 整体克隆 msgEl（保留所有子内容在原始顺序）
      let cloned = null;
      if (msgEl) {
        cloned = msgEl.cloneNode(true);
        // 清理交互元素
        cloned.querySelectorAll('button,[role="button"],[data-testid*="action"],[data-testid*="button"],form,input,textarea').forEach(e => e.remove());
        // ★ 移除所有 img 标签（克隆后的 src 是 blob: URL，无法匹配原始 URL）
        // 图片会在构建阶段从已下载的 base64 数据中单独添加
        cloned.querySelectorAll('img').forEach(e => e.remove());
      }

      collected.set(testid, {
        role,
        html: cloned ? cloned.innerHTML : '',
        imageURLs,
        imageData
      });
    });

    const maxScroll = container.scrollHeight - container.clientHeight;
    if (pos >= maxScroll) break;
    pos = Math.min(pos + viewHeight * 0.85, maxScroll);  // ★ 每步滚动 85%（原 70%）

    notifyProgress(`正在收集内容... (${collected.size} 条消息)`);
  }

  // 按 conversation-turn-N 的 N 排序
  const sorted = [...collected.entries()].sort((a, b) => {
    const numA = parseInt(a[0].replace('conversation-turn-', '')) || 0;
    const numB = parseInt(b[0].replace('conversation-turn-', '')) || 0;
    return numA - numB;
  });

  notifyProgress(`正在下载图片 (${sorted.length} 条消息)...`);

  // ★ 并行下载所有图片（提升速度）
  const allImageURLs = [];
  const urlIndexMap = new Map(); // src → index
  for (const [, { imageURLs }] of sorted) {
    for (const src of imageURLs) {
      if (!urlIndexMap.has(src)) {
        urlIndexMap.set(src, allImageURLs.length);
        allImageURLs.push(src);
      }
    }
  }

  console.log('[ChatGPT2PDF] 收集到图片数:', allImageURLs.length);
  if (allImageURLs.length > 0) {
    console.log('[ChatGPT2PDF] 示例 URL:', allImageURLs[0].substring(0, 120) + '...');
  }

  // ★ 检查 SAS 是否过期（最常见的 403 根因）
  if (allImageURLs.length > 0) {
    const sasCheck = checkSASExpiry(allImageURLs);
    if (sasCheck.expired.length > 0) {
      const sample = sasCheck.expired[0];
      console.warn(`[ChatGPT2PDF] ⚠️ 检测到 ${sasCheck.expired.length} 个图片 SAS 已过期！`);
      console.warn(`  过期时间: ${sample.expireTime.toISOString()}, 已过期 ${sample.expiredMinutes} 分钟`);
      console.warn(`  当前时间: ${new Date().toISOString()}`);

      // ★ 显示友好提示 + 刷新按钮，中止导出
      showSASExpiredWarning(sasCheck.expired.length, sample.expiredMinutes);
      _cancelled = true;
      return null;
    }
  }
  // ★ 使用收集阶段已提取的 base64（直接从 DOM <img> canvas 提取，无需下载！）
  const imageBase64Map = new Map();
  for (const [, { imageData }] of sorted) {
    for (const { url, base64 } of imageData) {
      if (base64 && !imageBase64Map.has(url)) {
        imageBase64Map.set(url, base64);
      }
    }
  }

  let downloadedCount = imageBase64Map.size;
  let failedCount = allImageURLs.length - downloadedCount;
  console.log(`[ChatGPT2PDF] DOM canvas 提取: 成功=${downloadedCount}, 待降级=${failedCount}`);

  if (_cancelled) return null;

  // 降级 1：在页面 MAIN world 中 fetch（origin=chatgpt.com，无 CORS 问题）
  if (failedCount > 0) {
    notifyProgress(`${downloadedCount} 张已提取，${failedCount} 张走页面 fetch...`);
    const failedURLs = allImageURLs.filter(src => !imageBase64Map.has(src));
    const pageMap = await fetchImagesInPageWorld(failedURLs);
    for (const [url, dataUrl] of pageMap) {
      imageBase64Map.set(url, dataUrl);
      downloadedCount++;
      failedCount--;
    }
    console.log(`[ChatGPT2PDF] MAIN world fetch 之后: 成功=${downloadedCount}, 仍失败=${failedCount}`);
  }

  // 降级 2：背景 service worker 下载
  if (failedCount > 0) {
    notifyProgress(`${downloadedCount} 张已提取，${failedCount} 张尝试 background 下载...`);
    const failedURLs = allImageURLs.filter(src => !imageBase64Map.has(src));
    const fallbackResults = await Promise.allSettled(
      failedURLs.map(src => fetchImageBase64(src))
    );
    failedURLs.forEach((src, i) => {
      if (fallbackResults[i].status === 'fulfilled') {
        imageBase64Map.set(src, fallbackResults[i].value);
        downloadedCount++;
        failedCount--;
      } else {
        imageBase64Map.set(src, null);
      }
    });
  }

  console.log(`[ChatGPT2PDF] 图片提取最终结果: 成功=${downloadedCount}, 失败=${failedCount}`);
  notifyProgress(`图片完成: ${downloadedCount}/${allImageURLs.length} 成功${failedCount > 0 ? ', ' + failedCount + ' 失败' : ''}`);

  notifyProgress('正在构建文档...');

  // 构建打印容器
  const wrapper = document.createElement('div');
  wrapper.id = '__chatgpt2pdf_print__';
  wrapper.style.cssText = [
    'position:fixed', 'top:0', 'left:0',
    'width:794px', 'background:#ffffff', 'color:#1a1a1a',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
    'font-size:14px', 'line-height:1.6',
    'padding:40px 48px', 'box-sizing:border-box',
    'z-index:999999', 'overflow:visible'
  ].join(';');

  let totalImagesAdded = 0;

  for (const [testid, { role, html, imageURLs }] of sorted) {
    // ★ 跳过空章节
    let meaningfulText = '';
    if (html) {
      // 提取纯文本，移除 ChatGPT UI 标签
      meaningfulText = html
        .replace(/<[^>]*>/g, ' ')          // 去标签
        .replace(/\bChatGPT\b/gi, '')      // 去 ChatGPT 品牌名
        .replace(/\bGPT-4o?\w*\b/gi, '')   // 去模型名
        .replace(/\s+/g, ' ').trim();
    }
    const hasContent = meaningfulText.length > 3; // 至少4个有效字符才算有内容
    const hasImages = imageURLs.length > 0;
    if (!hasContent && !hasImages) continue;

    const turnDiv = document.createElement('div');
    turnDiv.style.cssText = 'margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #f0f0f0;';

    // 角色标签
    const label = document.createElement('div');
    label.style.cssText = `font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px;color:${role === 'user' ? '#10a37f' : '#666'};`;
    label.textContent = role === 'user' ? '用户' : 'ChatGPT';
    turnDiv.appendChild(label);

    // 文本内容
    if (html && hasContent) {
      const contentDiv = document.createElement('div');
      contentDiv.style.cssText = role === 'user'
        ? 'background:#f0faf7;border-left:3px solid #10a37f;border-radius:0 8px 8px 0;padding:10px 14px;word-break:break-word;'
        : 'word-break:break-word;';
      contentDiv.innerHTML = html;

      applyInlineStyles(contentDiv);
      turnDiv.appendChild(contentDiv);
    }

    // ★ 图片处理：加载 → 压缩 → 转 JPEG data URL → 放小尺寸 <img>
    //   html2canvas 只看到小 JPEG（几十KB），不会崩溃
    for (const src of imageURLs) {
      const base64 = imageBase64Map.get(src);
      if (!base64) continue;

      const imgDiv = document.createElement('div');
      imgDiv.style.cssText = 'margin:12px 0;';

      try {
        // 1. 加载原始图片
        const loadedImg = await new Promise((resolve, reject) => {
          const tmpImg = new Image();
          tmpImg.onload = () => resolve(tmpImg);
          tmpImg.onerror = () => reject(new Error('图片加载失败'));
          tmpImg.src = base64;
          setTimeout(() => reject(new Error('图片加载超时')), 10000);
        });

        // 2. 等比压缩到 800px 内
        const MAX_DIM = 800;
        let w = loadedImg.naturalWidth;
        let h = loadedImg.naturalHeight;
        if (w > MAX_DIM) { h = Math.round(h * MAX_DIM / w); w = MAX_DIM; }
        if (h > MAX_DIM) { w = Math.round(w * MAX_DIM / h); h = MAX_DIM; }

        // 3. 画到临时 canvas → 导出 JPEG（85% 质量）
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = w;
        tmpCanvas.height = h;
        const ictx = tmpCanvas.getContext('2d');
        ictx.fillStyle = '#ffffff';
        ictx.fillRect(0, 0, w, h);
        ictx.drawImage(loadedImg, 0, 0, w, h);
        const jpegUrl = tmpCanvas.toDataURL('image/jpeg', 0.85);
        console.log(`[ChatGPT2PDF] 图片压缩: ${loadedImg.naturalWidth}x${loadedImg.naturalHeight} → ${w}x${h}, JPEG=${Math.round(jpegUrl.length/1024)}KB`);

        // 4. 放入小尺寸 <img>（html2canvas 只看到这个 JPEG）
        const img = document.createElement('img');
        img.src = jpegUrl;
        img.style.cssText = 'max-width:100%;height:auto;border-radius:8px;display:block;';
        img.width = w;
        img.height = h;
        imgDiv.appendChild(img);
        totalImagesAdded++;
      } catch (err) {
        console.warn('[ChatGPT2PDF] 图片处理失败:', src.substring(0, 60), err.message);
        const placeholder = document.createElement('div');
        placeholder.style.cssText = 'padding:20px;background:#f5f5f5;color:#999;text-align:center;border-radius:8px;';
        placeholder.textContent = '⚠️ 图片加载失败';
        imgDiv.appendChild(placeholder);
      }
      turnDiv.appendChild(imgDiv);
    }

    wrapper.appendChild(turnDiv);
  }

  console.log(`[ChatGPT2PDF] 构建完成: ${sorted.length} 个章节, ${totalImagesAdded} 张图片已添加到 wrapper`);
  notifyProgress(`构建文档完成: ${sorted.length} 章节, ${totalImagesAdded} 图片`);

  // 清除 oklch + 强制白底黑字
  stripOklchColors(wrapper);
  forceWhiteBackground(wrapper);
  wrapper.style.backgroundColor = '#ffffff';
  wrapper.style.color = '#1a1a1a';
  document.body.appendChild(wrapper);

  // wrapper 内的图片已在构建阶段压缩为 JPEG，无需等待
  await sleep(200);
  notifyProgress('正在逐段渲染...');

  // ★ 逐段渲染：每个 turnDiv 单独 html2canvas
  //   好处：1) 内存小（每次只渲染一段）2) 失败隔离（一段出错不影响其他）
  const turnDivs = Array.from(wrapper.children);
  const sectionCanvases = []; // {canvas, index}
  const oncloneSafeCSS = (doc) => {
    doc.querySelectorAll('style, link[rel="stylesheet"]').forEach(e => e.remove());
    const style = doc.createElement('style');
    style.textContent = `
      html, body { background: #ffffff !important; color: #1a1a1a !important; margin: 0 !important; padding: 0 !important; }
      #__chatgpt2pdf_print__ { background: #ffffff !important; color: #1a1a1a !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif !important;
        font-size: 14px !important; line-height: 1.6 !important; }
      #__chatgpt2pdf_print__ * { color: inherit !important; }
      #__chatgpt2pdf_print__ pre { background: #1e1e2e !important; color: #cdd6f4 !important;
        border-radius: 8px !important; padding: 14px 16px !important;
        font-family: "Courier New", Consolas, monospace !important; font-size: 12px !important;
        line-height: 1.55 !important; white-space: pre-wrap !important; word-break: break-all !important;
        margin: 10px 0 !important; display: block !important; overflow: visible !important; }
      #__chatgpt2pdf_print__ pre code { color: #cdd6f4 !important; background: transparent !important;
        padding: 0 !important; font-family: "Courier New", Consolas, monospace !important; font-size: 12px !important; }
      #__chatgpt2pdf_print__ code:not(pre code) { background: #f0f0f0 !important; border-radius: 3px !important;
        padding: 2px 5px !important; font-family: "Courier New", Consolas, monospace !important;
        font-size: 12px !important; color: #c7254e !important; }
      #__chatgpt2pdf_print__ blockquote { border-left: 4px solid #10a37f !important; margin: 10px 0 !important;
        padding: 8px 16px !important; background: #f0faf7 !important; color: #444 !important; }
      #__chatgpt2pdf_print__ a { color: #10a37f !important; text-decoration: underline !important; }
      #__chatgpt2pdf_print__ th { background: #f5f5f5 !important; font-weight: 600 !important; }
      #__chatgpt2pdf_print__ table { border-collapse: collapse !important; width: 100% !important; margin: 12px 0 !important; }
      #__chatgpt2pdf_print__ th, #__chatgpt2pdf_print__ td { border: 1px solid #ddd !important; padding: 7px 12px !important; }
      #__chatgpt2pdf_print__ img { max-width: 100% !important; height: auto !important;
        border-radius: 8px !important; display: block !important; }
    `;
    doc.head.appendChild(style);
  };

  for (let i = 0; i < turnDivs.length; i++) {
    if (_cancelled) break;
    const div = turnDivs[i];
    try {
      const c = await html2canvas(div, {
        scale: 2, useCORS: false, allowTaint: true,
        backgroundColor: '#ffffff', logging: false,
        onclone: oncloneSafeCSS
      });
      // 检查透明 canvas，叠加白底
      if (c.width > 0 && c.height > 0) {
        const ctx = c.getContext('2d');
        if (ctx) {
          const s = ctx.getImageData(Math.floor(c.width / 2), Math.min(10, Math.floor(c.height / 2)), 1, 1).data;
          if (s[3] < 10) {
            const wbg = document.createElement('canvas');
            wbg.width = c.width; wbg.height = c.height;
            const wc = wbg.getContext('2d');
            wc.fillStyle = '#ffffff'; wc.fillRect(0, 0, wbg.width, wbg.height);
            wc.drawImage(c, 0, 0);
            sectionCanvases.push(wbg);
          } else {
            sectionCanvases.push(c);
          }
        }
      }
      if (i % 5 === 0) notifyProgress(`渲染中 ${i + 1}/${turnDivs.length} 段...`);
    } catch (err) {
      console.warn(`[ChatGPT2PDF] 第 ${i + 1} 段渲染失败（跳过）:`, err.message);
      // 跳过失败段，不影响其他
    }
  }

  console.log(`[ChatGPT2PDF] 逐段渲染完成: ${sectionCanvases.length}/${turnDivs.length} 段成功`);
  wrapper.remove();
  return sectionCanvases; // ★ 返回 canvas 数组
}

// ─────────────────────────────────────────────
//  裁剪截图（去除浏览器 chrome：地址栏、工具栏等）
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  获取图片宽高（从 dataUrl）
// ─────────────────────────────────────────────
function getImageDimensions(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 1920, height: 1080 }); // 降级默认值
    img.src = dataUrl;
  });
}

async function cropScreenshot(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // ★ 裁剪到 main 元素（全视口宽度）
      const mainEl = document.querySelector('main') || document.body;
      const rect = mainEl.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      // 将 CSS 坐标转为截图的像素坐标
      const sx = Math.max(0, Math.floor(rect.left * dpr));
      const sy = Math.max(0, Math.floor(rect.top * dpr));
      const sw = Math.min(Math.ceil(rect.width * dpr), img.width - sx);
      const sh = Math.min(Math.ceil(rect.height * dpr), img.height - sy);

      // 如果裁剪区域太小（全屏模式），直接返回原图
      if (sw < img.width * 0.5 || sh < img.height * 0.5) {
        resolve(dataUrl);
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ═══════════════════════════════════════════════
//  模式2：截图模式
//  边滚动边 captureVisibleTab 逐屏截图
// ═══════════════════════════════════════════════
async function exportByScreenshotMode() {
  const viewH = window.innerHeight;
  const viewW = window.innerWidth;
  console.log(`[ChatGPT2PDF] 截图模式: viewH=${viewH}, viewW=${viewW}`);

  // ★ 隐藏侧边栏 + 非内容 UI，内容用全宽
  const hideStyle = document.createElement('style');
  hideStyle.id = '__chatgpt2pdf_hide__';
  hideStyle.textContent = `
    /* ═══ 隐藏侧边栏 ═══ */
    nav, aside, header, [role="navigation"], [role="banner"], [role="complementary"] {
      display: none !important;
    }
    [class*="sidebar"], [class*="Sidebar"] {
      display: none !important;
    }

    /* ═══ main 设为全视口宽度 ═══ */
    main {
      width: 100vw !important;
      max-width: 100vw !important;
      min-width: 100vw !important;
      margin: 0 !important;
      padding: 0 20px !important;
    }

    /* 消息气泡内部加宽 */
    section[data-testid^="conversation-turn-"] > div > div {
      max-width: 100% !important;
    }

    /* 隐藏分享页水印 */
    main p.text-xs.text-gray-500 { display:none !important; }
    /* 隐藏举报按钮 */
    main div.text-center.text-xs.font-semibold { display:none !important; }
    /* 隐藏浮动 tooltip/popover */
    [role="tooltip"], [data-radix-popper-content-wrapper] {
      display:none !important;
    }
    /* 隐藏 Google One Tap */
    #google-one-tap-anchor { display:none !important; }
  `;
  document.head.appendChild(hideStyle);

  // ★ JS 兑底：逐级遍历 main 的祖先元素，隐藏所有同级的侧边栏元素
  const hiddenSiblings = [];
  {
    let el = document.querySelector('main');
    if (el) {
      while (el && el !== document.body && el !== document.documentElement) {
        const parent = el.parentElement;
        if (parent) {
          for (const sibling of parent.children) {
            if (sibling !== el && sibling.tagName !== 'SCRIPT' && sibling.tagName !== 'STYLE') {
              const rect = sibling.getBoundingClientRect();
              // 只隐藏有实际宽度的左侧元素（侧边栏）
              if (rect.width > 50 && rect.left < el.getBoundingClientRect().left) {
                sibling.style.setProperty('display', 'none', 'important');
                hiddenSiblings.push(sibling);
                console.log(`[ChatGPT2PDF] 隐藏侧边栏: ${sibling.tagName}.${(sibling.className||'').toString().substring(0,40)} w=${Math.round(rect.width)}`);
              }
            }
          }
        }
        el = el.parentElement;
      }
    }
  }

  try {
    await sleep(600); // 等待布局重新计算

    const container = findScrollContainer();
    // ★ 判断是否是 window 全局滚动（documentElement / body 必须用 window.scrollTo）
    const useWindow = (container === document.documentElement || container === document.body);

    // 计算总高度和视口高度
    const totalScrollH = useWindow
      ? Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
      : container.scrollHeight;
    const viewHeight = useWindow ? window.innerHeight : container.clientHeight;

    console.log('[ChatGPT2PDF] 截图模式 - container:', container.tagName,
      'class:', (container.className || '').toString().substring(0, 60),
      'useWindow:', useWindow, 'viewH:', viewHeight, 'totalH:', totalScrollH);

    // 滚动到顶部
    notifyProgress('正在滚动到对话开头...');
    const scrollTo = (y) => {
      if (useWindow) window.scrollTo(0, y);
      else container.scrollTop = y;
    };
    const getScrollTop = () =>
      useWindow ? (window.scrollY || document.documentElement.scrollTop || 0) : container.scrollTop;

    for (let i = 0; i < 10; i++) {
      scrollTo(0);
      await sleep(200);
      if (getScrollTop() === 0) break;
    }
    if (_cancelled) return [];
    await sleep(500);

    const screenshots = [];
    let pos = 0;
    let lastScrollTop = -1;
    let safetyCounter = 0;
    const SAFETY_MAX = 200;

    if (viewHeight <= 50) {
      console.error('[ChatGPT2PDF] 视口过小', { viewHeight });
      notifyProgress('截图模式失败：视口尺寸异常');
      return [];
    }

    const maxScrollInitial = totalScrollH - viewHeight;

    // 即使页面已完全展开（不需要滚动），也至少截一屏
    if (maxScrollInitial <= 0) {
      console.warn('[ChatGPT2PDF] 页面已完全展开（无需滚动），只截一屏');
      if (_overlayEl) _overlayEl.style.visibility = 'hidden';
      await sleep(100);
      const raw = await captureTab();
      if (_overlayEl) _overlayEl.style.visibility = 'visible';
      const cropped = await cropScreenshot(raw);
      screenshots.push(cropped);
      return screenshots;
    }

    while (safetyCounter++ < SAFETY_MAX) {
      if (_cancelled) return screenshots;

      scrollTo(pos);
      await sleep(700);

      if (_overlayEl) _overlayEl.style.visibility = 'hidden';
      await sleep(100);

      const raw = await captureTab();
      if (_overlayEl) _overlayEl.style.visibility = 'visible';

      const cropped = await cropScreenshot(raw);
      screenshots.push(cropped);

      const actualScrollTop = getScrollTop();
      const currentTotalH = useWindow
        ? Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
        : container.scrollHeight;
      const currentMaxScroll = currentTotalH - viewHeight;

      console.log(`[ChatGPT2PDF] 截图 #${screenshots.length}: pos=${pos}, actualTop=${actualScrollTop}, maxScroll=${currentMaxScroll}, totalH=${currentTotalH}`);

      notifyProgress(`已截图第 ${screenshots.length} 屏...`);

      if (actualScrollTop >= currentMaxScroll - 5) break;
      if (actualScrollTop === lastScrollTop) {
        console.log('[ChatGPT2PDF] scrollTop 未变化，结束');
        break;
      }
      lastScrollTop = actualScrollTop;

      pos = Math.min(actualScrollTop + Math.floor(viewHeight * 0.9), currentMaxScroll);
    }

    return screenshots;
  } finally {
    hideStyle.remove();
    // 恢复隐藏的侧边栏
    for (const s of hiddenSiblings) {
      s.style.removeProperty('display');
    }
  }
}

// ═════════════════════════════════════════════
//  模式3：打印模式（浏览器原生 window.print）
// ═════════════════════════════════════════════
async function exportByPrintMode() {
  // 注入打印专用 CSS（仅 @media print 生效）
  const printStyle = document.createElement('style');
  printStyle.id = '__chatgpt2pdf_print_css__';
  printStyle.textContent = `
    @media print {
      /* 隐藏所有非内容 UI */
      header, nav, aside, footer:not(main footer),
      [role="banner"], [role="navigation"], [role="complementary"],
      button, [role="button"],
      [role="tooltip"], [data-radix-popper-content-wrapper],
      #google-one-tap-anchor,
      /* 隐藏侧边栏 */
      nav[class*="sidebar"], div[class*="sidebar"] {
        display: none !important;
      }

      /* 隐藏分享页水印 + 举报 */
      main p.text-xs.text-gray-500 { display: none !important; }
      main div.text-center.text-xs.font-semibold { display: none !important; }

      /* 页面设置 */
      @page {
        size: A4;
        margin: 15mm 12mm;
      }

      /* 主体样式 */
      html, body {
        background: white !important;
        color: #1a1a1a !important;
        font-size: 12pt !important;
        line-height: 1.6 !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      main {
        width: 100% !important;
        max-width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      /* 消息气泡 */
      section[data-testid^="conversation-turn-"] {
        page-break-inside: avoid;
        margin-bottom: 8pt;
      }
      section[data-testid^="conversation-turn-"] > div > div {
        max-width: 100% !important;
      }

      /* 标题 */
      h1 { font-size: 18pt; font-weight: 700; margin: 14pt 0 6pt; color: #111; }
      h2 { font-size: 15pt; font-weight: 700; margin: 12pt 0 5pt; color: #111; }
      h3 { font-size: 13pt; font-weight: 700; margin: 10pt 0 4pt; color: #111; }

      /* 代码块 */
      pre {
        background: #f5f5f5 !important;
        color: #1a1a1a !important;
        border: 1px solid #ddd !important;
        border-radius: 4px !important;
        padding: 8pt 10pt !important;
        font-family: "Courier New", Consolas, monospace !important;
        font-size: 9pt !important;
        line-height: 1.5 !important;
        white-space: pre-wrap !important;
        word-break: break-all !important;
        page-break-inside: avoid;
      }
      pre code {
        background: transparent !important;
        color: inherit !important;
        padding: 0 !important;
      }
      code:not(pre code) {
        background: #f0f0f0 !important;
        border-radius: 2px;
        padding: 1px 3px;
        font-size: 0.9em;
      }

      /* 表格 */
      table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
      th, td { border: 1px solid #ccc; padding: 5pt 8pt; font-size: 10pt; }
      th { background: #f5f5f5 !important; font-weight: 600; }

      /* 引用 */
      blockquote {
        border-left: 3pt solid #10a37f;
        margin: 8pt 0;
        padding: 6pt 12pt;
        color: #444;
      }

      /* 链接 */
      a { color: #10a37f !important; text-decoration: underline; }

      /* 图片 */
      img { max-width: 100% !important; height: auto !important; page-break-inside: avoid; }
    }
  `;
  document.head.appendChild(printStyle);

  // 等待 CSS 生效
  await sleep(300);

  // 触发浏览器打印对话框
  try {
    window.print();
  } catch (e) {
    console.error('[ChatGPT2PDF] window.print() 失败:', e);
  }

  // 打印完成后清理 CSS
  await sleep(1000);
  printStyle.remove();
}

// ─────────────────────────────────────────────
//  内联样式
// ─────────────────────────────────────────────
function applyInlineStyles(container) {
  const hs = { H1:'22px', H2:'19px', H3:'16px', H4:'15px', H5:'14px', H6:'13px' };
  container.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(el => {
    el.style.cssText += `font-size:${hs[el.tagName]||'14px'};font-weight:700;margin:16px 0 8px;color:#111;line-height:1.3;`;
  });
  container.querySelectorAll('p').forEach(el => { el.style.margin = el.style.margin || '6px 0'; el.style.lineHeight = '1.7'; });
  container.querySelectorAll('ul,ol').forEach(el => { el.style.cssText += 'margin:6px 0;padding-left:24px;'; });
  container.querySelectorAll('li').forEach(el => { el.style.cssText += 'margin:4px 0;line-height:1.6;'; });
  container.querySelectorAll('pre').forEach(el => {
    el.style.cssText = 'background:#1e1e2e;border-radius:8px;padding:14px 16px;font-family:"Courier New",Consolas,monospace;font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-all;margin:10px 0;color:#cdd6f4;display:block;overflow:visible;';
  });
  container.querySelectorAll('code').forEach(el => {
    el.style.cssText = el.closest('pre')
      ? 'font-family:"Courier New",Consolas,monospace;font-size:12px;color:#cdd6f4;background:transparent;padding:0;'
      : 'background:#f0f0f0;border-radius:3px;padding:2px 5px;font-family:"Courier New",Consolas,monospace;font-size:12px;color:#c7254e;';
  });
  container.querySelectorAll('blockquote').forEach(el => { el.style.cssText = 'border-left:4px solid #10a37f;margin:10px 0;padding:8px 16px;background:#f0faf7;color:#444;'; });
  container.querySelectorAll('table').forEach(el => { el.style.cssText = 'border-collapse:collapse;width:100%;margin:12px 0;font-size:13px;'; });
  container.querySelectorAll('th,td').forEach(el => { el.style.cssText = 'border:1px solid #ddd;padding:7px 12px;text-align:left;'; });
  container.querySelectorAll('th').forEach(el => { el.style.background = '#f5f5f5'; el.style.fontWeight = '600'; });
  container.querySelectorAll('img').forEach(el => { el.style.cssText = 'max-width:100%;height:auto;border-radius:8px;margin:10px 0;display:block;'; });
  container.querySelectorAll('hr').forEach(el => { el.style.cssText = 'border:none;border-top:1px solid #e0e0e0;margin:16px 0;'; });
  container.querySelectorAll('a').forEach(el => { el.style.color = '#10a37f'; el.style.textDecoration = 'underline'; });
  container.querySelectorAll('strong,b').forEach(el => { el.style.fontWeight = '700'; });
}

// ─────────────────────────────────────────────
//  去除 oklch 颜色（支持嵌套括号）
// ─────────────────────────────────────────────
function stripOklchColors(root) {
  // 支持 oklch(...) 包括内部含嵌套括号如 oklch(from ...)
  const re = /oklch\((?:[^()]*|\([^()]*\))*\)/gi;
  const walk = el => {
    if (!el || el.nodeType !== 1) return;
    const attr = el.getAttribute('style');
    if (attr && re.test(attr)) { re.lastIndex = 0; el.setAttribute('style', attr.replace(re, 'transparent')); }
    re.lastIndex = 0;
    const s = el.style;
    if (s) {
      ['color','backgroundColor','borderColor','borderTopColor','borderBottomColor','borderLeftColor','borderRightColor','fill','stroke'].forEach(p => {
        if (s[p]?.includes('oklch')) s[p] = p === 'color' ? '#1a1a1a' : 'transparent';
      });
    }
    for (const c of el.children) walk(c);
  };
  walk(root);
}

// ─────────────────────────────────────────────
//  强制白底黑字 + 清除所有深色背景（防止深色模式残留）
// ─────────────────────────────────────────────
function forceWhiteBackground(root) {
  // 保护列表：代码块和表格头保留自己的背景
  const PRESERVE_BG_TAGS = new Set(['PRE', 'CODE', 'TH']);
  const walk = el => {
    if (!el || el.nodeType !== 1) return;
    const tag = el.tagName;

    // 清除 class 属性（防止 html2canvas 使用 getComputedStyle 读到页面 CSS 中的深色背景）
    if (tag !== 'PRE' && tag !== 'CODE') {
      el.removeAttribute('class');
    }

    const s = el.style;
    if (s) {
      if (!PRESERVE_BG_TAGS.has(tag)) {
        // 暴力清除所有背景相关属性
        s.backgroundColor = 'transparent';
        s.background = '';
        s.backgroundImage = '';
        s.bgColor = '';
      }
      // 强制深色文字（代码块内保持浅色文字）
      const inCode = el.closest('pre') || el.closest('code');
      if (!inCode) {
        s.color = '#1a1a1a';
      }
    }
    for (const c of el.children) walk(c);
  };
  walk(root);
}

// ─────────────────────────────────────────────
//  主导出函数：生成 PDF
// ─────────────────────────────────────────────
async function exportToPDF(mode) {
  // ★ 检查第三方库
  ensureLibs();

  // 显示页面浮动进度条
  showOverlay('正在准备导出...');

  notifyProgress('正在准备导出...');
  const title = getConversationTitle();
  const filename = sanitizeFilename(title) + '.pdf';

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

  const PAGE_W = 210, PAGE_H = 297, MARGIN = 10;
  const HEADER_H = 12, FOOTER_H = 8;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const PRINTABLE_H = PAGE_H - HEADER_H - FOOTER_H;

  const addHeader = (pageNum) => {
    pdf.setDrawColor(16, 163, 127);
    pdf.setLineWidth(0.5);
    pdf.line(MARGIN, 8, MARGIN + 30, 8);
    pdf.setDrawColor(220, 220, 220);
    pdf.setLineWidth(0.3);
    pdf.line(MARGIN, 10, PAGE_W - MARGIN, 10);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    pdf.text(`Page ${pageNum}`, PAGE_W - MARGIN, 8, { align: 'right' });
  };

  const addFooter = () => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.setTextColor(150, 150, 150);
    const dateStr = new Date().toISOString().substring(0, 19).replace('T', ' ');
    pdf.text(`${dateStr} | ${window.location.href}`, MARGIN, PAGE_H - 4, { maxWidth: CONTENT_W });
  };

  let pageNum = 1;
  let isFirst = true;

  try {
    if (mode === 'screenshot') {
      // ── 截图模式 ──
      const screenshots = await exportByScreenshotMode();
      if (_cancelled || !screenshots.length) return { filename: '', pages: 0 };

      notifyProgress(`正在拼接 PDF (${screenshots.length} 页)...`);

      // ★ 标准 A4 竖版页面，截图按比例缩放适配
      const ssPageW = 297; // A4 横版宽度（mm）
      const ssPageH = 210; // A4 横版高度（mm）
      const ssPdf = new jsPDF({ unit: 'mm', format: [ssPageW, ssPageH], compress: true });

      // 计算截图在 A4 页面上的显示尺寸（保证不超出页面）
      const firstDims = await getImageDimensions(screenshots[0]);
      const imgRatio = firstDims.width / firstDims.height; // w/h
      const pageRatio = ssPageW / ssPageH; // A4 = 0.707
      let imgW, imgH, imgX, imgY;
      if (imgRatio >= pageRatio) {
        // 截图比 A4 更宽 → 按宽度适配
        imgW = ssPageW;
        imgH = ssPageW / imgRatio;
      } else {
        // 截图比 A4 更高 → 按高度适配
        imgH = ssPageH;
        imgW = ssPageH * imgRatio;
      }
      // 居中放置
      imgX = (ssPageW - imgW) / 2;
      imgY = (ssPageH - imgH) / 2;
      console.log(`[ChatGPT2PDF] 截图 PDF: A4(${ssPageW}x${ssPageH}mm), 图片=${Math.round(imgW)}x${Math.round(imgH)}mm @(${Math.round(imgX)},${Math.round(imgY)}), ${screenshots.length} 页`);

      for (let i = 0; i < screenshots.length; i++) {
        if (_cancelled) return { filename: '', pages: 0 };
        if (i > 0) ssPdf.addPage([ssPageW, ssPageH]);

        // 截图按比例缩放，居中放置
        ssPdf.addImage(screenshots[i], 'PNG', imgX, imgY, imgW, imgH);

        // 最小化 footer（右下角小字）
        ssPdf.setFont('helvetica', 'normal');
        ssPdf.setFontSize(6);
        ssPdf.setTextColor(180, 180, 180);
        ssPdf.text(`${i + 1} / ${screenshots.length}`, ssPageW - 3, ssPageH - 2, { align: 'right' });
        pageNum++;
      }

      notifyProgress('正在保存文件...');
      const ssBlob = ssPdf.output('blob');
      const ssUrl = URL.createObjectURL(ssBlob);
      const ssLink = document.createElement('a');
      ssLink.href = ssUrl; ssLink.download = filename; ssLink.click();
      setTimeout(() => URL.revokeObjectURL(ssUrl), 10000);
      showOverlayResult(filename, pageNum - 1);
      return { filename, pages: pageNum - 1 };
    } else {
      // ── 直读模式：逐段 canvas 分页 ──
      const sectionCanvases = await exportByReadMode();
      if (_cancelled || !sectionCanvases || !sectionCanvases.length) return { filename: '', pages: 0 };
      notifyProgress(`正在分页 (${sectionCanvases.length} 段)...`);

      for (const canvas of sectionCanvases) {
        if (_cancelled) break;
        const canvasW = canvas.width, canvasH = canvas.height;
        const pageCanvasH = (PRINTABLE_H / CONTENT_W) * canvasW;
        let yOffset = 0;

        while (yOffset < canvasH) {
          if (!isFirst) pdf.addPage();
          isFirst = false;
          addHeader(pageNum);

          const sliceH = Math.min(pageCanvasH, canvasH - yOffset);
          const slicePdfH = (sliceH / canvasW) * CONTENT_W;

          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = canvasW;
          sliceCanvas.height = Math.ceil(sliceH);
          sliceCanvas.getContext('2d').drawImage(canvas, 0, yOffset, canvasW, sliceH, 0, 0, canvasW, sliceH);

          pdf.addImage(sliceCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN, HEADER_H, CONTENT_W, slicePdfH);
          addFooter();

          yOffset += sliceH;
          pageNum++;
        }
      }
    }
  } catch (err) {
    // ★ 确保出错时清理
    const wrapper = document.getElementById('__chatgpt2pdf_print__');
    if (wrapper) wrapper.remove();
    const hide = document.getElementById('__chatgpt2pdf_hide__');
    if (hide) hide.remove();
    showOverlayError(err.message || '导出失败');
    throw err;
  }

  // 下载
  const blob = pdf.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  showOverlayResult(`✓ 导出完成！共 ${pageNum - 1} 页`);
  notifyProgress('');

  return { filename, pages: pageNum - 1 };
}
