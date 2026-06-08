/**
 * ChatGPT to PDF - Content Script (v3)
 * Developer: Jeffer SU
 *
 * 两种导出模式：
 *   1. 直读模式：提取 DOM 内容构建完整 HTML，整体渲染后切割分页
 *   2. 截图模式：边滚动边截图，所见即所得
 *
 * 策略：收集全部内容 → 构建 HTML → 渲染成 canvas → 切割分页生成 PDF
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
const _ = (key, ...args) => args.length ? chrome.i18n.getMessage(key, args) : chrome.i18n.getMessage(key);
const {
  assertCompleteRender,
  collectConversationSnapshots
} = window.ChatGPT2PdfReadModeCore || {};
// ─────────────────────────────────────────────
//  消息监听
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'cancelExport') {
    _cancelled = true;
    const wrapper = document.getElementById('__chatgpt2pdf_print__');
    if (wrapper) wrapper.remove();
    document.getElementById('__chatgpt2pdf_read_document__')?.remove();
    document.getElementById('__chatgpt2pdf_read_print_css__')?.remove();
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
  return /chatgpt\.com\/(c|share)\//.test(window.location.href) || /chatgpt\.com\/g\/[^/]+\/c\//.test(window.location.href);
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
  return _('defaultTitle', [new Date().toISOString().substring(0, 10)]);
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
      <button class="cg2p-cancel">${_('cancel')}</button>
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
  _overlayEl.querySelector('.cg2p-cancel').textContent = _('close');
  _overlayEl.querySelector('.cg2p-cancel').onclick = hideOverlay;
  setTimeout(hideOverlay, 4000);
}

function showOverlayError(text) {
  if (!_overlayEl) return;
  _overlayEl.querySelector('.cg2p-spinner').style.display = 'none';
  _overlayEl.querySelector('.cg2p-text').textContent = '❌ ' + text;
  _overlayEl.querySelector('.cg2p-text').style.color = '#c62828';
  _overlayEl.querySelector('.cg2p-cancel').textContent = _('close');
  _overlayEl.querySelector('.cg2p-cancel').onclick = hideOverlay;
  setTimeout(hideOverlay, 6000);
}

// ★ SAS 过期警告：显示提示 + 刷新按钮
function showSASExpiredWarning(count, minutes) {
  if (!_overlayEl) showOverlay('');
  _overlayEl.querySelector('.cg2p-spinner').style.display = 'none';
  const textEl = _overlayEl.querySelector('.cg2p-text');
  textEl.innerHTML = '⚠️ <b>' + _('sasExpired', [String(count)]) + '</b>' + _('sasExpiredDetail', [String(minutes)]) + '<br><span style="font-size:12px;color:#888">' + _('sasExpiredHelp') + '</span>';
  textEl.style.color = '#b45309';

  // 把取消按钮改为“刷新页面”按钮
  const btn = _overlayEl.querySelector('.cg2p-cancel');
  btn.textContent = '🔄 ' + _('refreshPage');
  btn.style.cssText = 'width:100%;padding:8px;border:none;border-radius:8px;background:#10a37f;color:#fff;font-size:13px;font-weight:600;cursor:pointer;margin-top:4px;';
  btn.onmouseover = () => btn.style.background = '#0d8c6d';
  btn.onmouseout = () => btn.style.background = '#10a37f';
  btn.onclick = () => { location.reload(); };

  // 再加一个“取消”链接
  const cancelLink = document.createElement('div');
  cancelLink.style.cssText = 'text-align:center;margin-top:6px;';
  cancelLink.innerHTML = '<a href="#" style="font-size:11px;color:#999;">' + _('cancelBtn') + '</a>';
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
          notifyProgress(_('windowNotVisible', [String(retries)]));
          setTimeout(() => captureTab(retries - 1).then(resolve, reject), delay);
        } else {
          reject(new Error(errMsg || _('screenshotFailed')));
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
      else reject(new Error(resp?.error || _('imageLoadFailed')));
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
  if (!window.html2canvas) throw new Error(_('libNotLoaded', ['html2canvas']));
  if (!window.jspdf) throw new Error(_('libNotLoaded', ['jsPDF']));
  if (!collectConversationSnapshots || !assertCompleteRender) throw new Error('read-mode-core.js 未加载，请刷新页面重试');
}

// ═══════════════════════════════════════════════
//  模式1：直读模式
//  边滚动边收集整个 section 的完整内容（含图片位置）
//  按 data-testid 排序去重
// ═══════════════════════════════════════════════
async function exportByReadMode() {
  // ★ 先滚动到顶部，确保虚拟滚动加载全部内容
  notifyProgress(_('rollingToTop'));
  window.scrollTo(0, 0);
  const container = findScrollContainer();
  const useWindow = (container === document.documentElement || container === document.body);
  const scrollTo = (y) => {
    if (useWindow) window.scrollTo(0, y);
    else container.scrollTop = y;
  };
  for (let i = 0; i < 15; i++) {
    scrollTo(0);
    window.scrollTo(0, 0);
    await sleep(300);
    const st = useWindow ? (window.scrollY || document.documentElement.scrollTop || 0) : container.scrollTop;
    if (st === 0) break;
  }
  await sleep(1500); // 等待虚拟滚动/懒加载内容恢复

  // ★ 快速预扫描：先检查图片 SAS 是否过期
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

  notifyProgress(_('collectingContent'));

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
      if (!window.__cg2p_canvas_warned) {
        console.warn('[ChatGPT2PDF] canvas 提取失败（tainted）:', e.name, e.message, '→ 将走 fetch 降级');
        window.__cg2p_canvas_warned = true;
      }
      return null;
    }
  }

  const hashText = value => {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  };

  const getVisibleTurns = () => {
    const turnEls = Array.from(document.querySelectorAll(
      'section[data-testid^="conversation-turn-"], article[data-testid^="conversation-turn-"]'
    ));
    if (turnEls.length > 0) return turnEls;

    const fallback = new Set();
    document.querySelectorAll('[data-message-author-role]').forEach(msgEl => {
      fallback.add(msgEl.closest('section, article, [data-testid^="conversation-turn-"]') || msgEl);
    });
    return Array.from(fallback);
  };

  const snapshotTurn = (section, visibleIndex) => {
    const msgEl = section.matches?.('[data-message-author-role]')
      ? section
      : section.querySelector('[data-message-author-role]');
    const role = msgEl?.getAttribute('data-message-author-role') || 'assistant';

    const imageURLs = [];
    const imageData = [];
    const seenURLs = new Set();

    section.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || img.src || '';
      const isLargeMessageImage = !img.closest('button,[role="button"]')
        && img.naturalWidth >= 64 && img.naturalHeight >= 64;
      const isInlineMessageImage = src.startsWith('blob:') || src.startsWith('data:image/');
      const isRemoteMessageImage = /^https?:/i.test(src);
      if ((!isChatGPTImage(src) && !(isLargeMessageImage && (isInlineMessageImage || isRemoteMessageImage)))
          || img.closest('[class*="blur"]')) return;
      const base = src.split('?')[0];
      if (seenURLs.has(base)) return;
      seenURLs.add(base);
      imageURLs.push(src);
      imageData.push({ url: src, base64: src.startsWith('data:image/') ? src : tryExtractBase64(img) });
    });

    section.querySelectorAll('source[srcset]').forEach(source => {
      const srcset = source.getAttribute('srcset') || '';
      const firstUrl = srcset.split(',')[0].trim().split(/\s+/)[0];
      if (!isChatGPTImage(firstUrl)) return;
      const base = firstUrl.split('?')[0];
      if (seenURLs.has(base)) return;
      seenURLs.add(base);
      imageURLs.push(firstUrl);
      const imgEl = source.closest('picture')?.querySelector('img');
      imageData.push({ url: firstUrl, base64: imgEl ? tryExtractBase64(imgEl) : null });
    });

    section.querySelectorAll('[style]').forEach(el => {
      const match = (el.style.backgroundImage || '').match(/url\(["']?([^"')]+)["']?\)/);
      if (!match || !isChatGPTImage(match[1])) return;
      const base = match[1].split('?')[0];
      if (seenURLs.has(base)) return;
      seenURLs.add(base);
      imageURLs.push(match[1]);
      imageData.push({ url: match[1], base64: null });
    });

    const cloned = (msgEl || section).cloneNode(true);
    const canonicalImageURLs = new Map(imageURLs.map(url => [url.split('?')[0], url]));
    cloned.querySelectorAll('button,[role="button"],[data-testid*="action"],[data-testid*="button"],form,input,textarea').forEach(e => e.remove());
    cloned.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || img.src || '';
      const canonical = canonicalImageURLs.get(src.split('?')[0]);
      if (canonical) img.setAttribute('data-cg2p-src', canonical);
    });
    cloned.querySelectorAll('source[srcset]').forEach(source => {
      const srcset = source.getAttribute('srcset') || '';
      const firstUrl = srcset.split(',')[0].trim().split(/\s+/)[0];
      const img = source.closest('picture')?.querySelector('img');
      const canonical = canonicalImageURLs.get(firstUrl.split('?')[0]);
      if (img && canonical) img.setAttribute('data-cg2p-src', canonical);
    });
    cloned.querySelectorAll('img:not([data-cg2p-src])').forEach(img => img.remove());

    const textContent = cloned.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (textContent.length === 0 && imageURLs.length === 0) return null;

    const stableId = section.getAttribute('data-testid')
      || section.getAttribute('data-message-id')
      || msgEl?.getAttribute('data-message-id')
      || `cg2p-${role}-${hashText(`${textContent}|${imageURLs.join('|')}`)}`;
    const orderMatch = stableId.match(/conversation-turn-(\d+)/);

    return {
      id: stableId,
      order: orderMatch ? Number(orderMatch[1]) : Number.MAX_SAFE_INTEGER,
      discoveryIndex: visibleIndex,
      role,
      html: cloned.innerHTML,
      textLength: textContent.length,
      imageURLs,
      imageData
    };
  };

  const scrollContainer = findScrollContainer();
  const useWin = (scrollContainer === document.documentElement || scrollContainer === document.body);
  const viewH = useWin ? window.innerHeight : scrollContainer.clientHeight;
  const scrollToY = (y) => {
    if (useWin) window.scrollTo(0, y);
    else scrollContainer.scrollTop = y;
  };
  const getScrollY = () => useWin ? (window.scrollY || document.documentElement.scrollTop || 0) : scrollContainer.scrollTop;
  const getMaxScrollY = () => {
    const totalH = useWin ? Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) : scrollContainer.scrollHeight;
    return Math.max(0, totalH - viewH);
  };

  const collected = await collectConversationSnapshots({
    getVisibleTurns,
    snapshotTurn,
    getPosition: getScrollY,
    getMaxPosition: getMaxScrollY,
    getViewportHeight: () => viewH,
    scrollTo: scrollToY,
    wait: sleep,
    isCancelled: () => _cancelled,
    onProgress: ({ count, position, maxPosition }) => {
      console.log(`[ChatGPT2PDF] 滚动收集: ${count} 个 turn, ${Math.round(position)}/${Math.round(maxPosition)}`);
      notifyProgress(_('collectingProgress', [String(count)]));
    }
  });
  if (!collected || _cancelled) return null;

  // 按 conversation-turn-N 的 N 排序
  const sorted = [...collected.entries()].sort((a, b) => {
    return a[1].order - b[1].order;
  });
  if (sorted.length === 0) {
    throw new Error('未采集到任何对话内容，已停止导出');
  }

  console.log(`[ChatGPT2PDF] 实际收集到 ${sorted.length} 个非空 turn`);

  notifyProgress(_('downloadingImages', [String(sorted.length)]));

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
    notifyProgress(_('fetchInPage', [String(downloadedCount), String(failedCount)]));
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
    notifyProgress(_('fetchInBackground', [String(downloadedCount), String(failedCount)]));
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
  notifyProgress(_('imagesComplete', [String(downloadedCount), String(allImageURLs.length), failedCount > 0 ? _('imagesFailedSuffix', [String(failedCount)]) : '']));
  if (failedCount > 0) {
    throw new Error(`${failedCount} 张图片无法读取，已停止导出以避免生成不完整 PDF`);
  }

  notifyProgress(_('buildingDoc'));

  let totalImagesAdded = 0;
  const turnDivs = [];
  const expectedImageCount = sorted.reduce((sum, [, turn]) => sum + turn.imageURLs.length, 0);

  const createCompressedImage = async base64 => {
    const loadedImg = await new Promise((resolve, reject) => {
      const tmpImg = new Image();
      const timer = setTimeout(() => reject(new Error(_('imageLoadFailed'))), 10000);
      tmpImg.onload = () => {
        clearTimeout(timer);
        resolve(tmpImg);
      };
      tmpImg.onerror = () => {
        clearTimeout(timer);
        reject(new Error(_('imageLoadFailed')));
      };
      tmpImg.src = base64;
    });

    const MAX_DIM = 800;
    let w = loadedImg.naturalWidth;
    let h = loadedImg.naturalHeight;
    if (w > MAX_DIM) { h = Math.round(h * MAX_DIM / w); w = MAX_DIM; }
    if (h > MAX_DIM) { w = Math.round(w * MAX_DIM / h); h = MAX_DIM; }

    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = w;
    tmpCanvas.height = h;
    const ictx = tmpCanvas.getContext('2d');
    ictx.fillStyle = '#ffffff';
    ictx.fillRect(0, 0, w, h);
    ictx.drawImage(loadedImg, 0, 0, w, h);

    const img = document.createElement('img');
    img.src = tmpCanvas.toDataURL('image/jpeg', 0.85);
    img.style.cssText = 'max-width:100%;height:auto;border-radius:8px;display:block;';
    img.width = w;
    img.height = h;
    return img;
  };

  const replaceImageWithCleanBlock = (originalImg, replacementImg, contentRoot) => {
    let replaceTarget = originalImg;
    let parent = originalImg.parentElement;

    while (parent && parent !== contentRoot) {
      const text = (parent.textContent || '').replace(/\s+/g, ' ').trim();
      const imageCount = parent.querySelectorAll('img').length;
      const preservesStructure = parent.matches('td,th,li,table,pre,code,blockquote');
      if (text || imageCount !== 1 || preservesStructure) break;
      replaceTarget = parent;
      parent = parent.parentElement;
    }

    const imageBlock = document.createElement('div');
    imageBlock.className = 'cg2p-image-block';
    imageBlock.dataset.cg2pImageBlock = 'true';
    imageBlock.style.cssText = 'display:block;width:100%;height:auto;min-height:0;max-height:none;margin:10px 0;padding:0;position:static;transform:none;aspect-ratio:auto;overflow:visible;';
    imageBlock.appendChild(replacementImg);
    replaceTarget.replaceWith(imageBlock);
  };

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
    const hasContent = meaningfulText.length > 0; // 只要有文本就保留（避免短内容被过滤）
    const hasImages = imageURLs.length > 0;
    if (!hasContent && !hasImages) continue;

    const turnDiv = document.createElement('div');
    turnDiv.dataset.cg2pTurnId = testid;
    turnDiv.style.cssText = 'margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #f0f0f0;';

    // 角色标签
    const label = document.createElement('div');
    label.style.cssText = `font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px;color:${role === 'user' ? '#10a37f' : '#666'};`;
    label.textContent = role === 'user' ? _('roleUser') : _('roleAssistant');
    turnDiv.appendChild(label);

    // 文本内容（图片保留在原始位置）
    if (html && hasContent) {
      const contentDiv = document.createElement('div');
      contentDiv.style.cssText = role === 'user'
        ? 'background:#f0faf7;border-left:3px solid #10a37f;border-radius:0 8px 8px 0;padding:10px 14px;word-break:break-word;'
        : 'word-break:break-word;';
      contentDiv.innerHTML = html;

      // ★ 替换原始位置的 img src 为已下载的 base64（并压缩）
      const imgs = Array.from(contentDiv.querySelectorAll('img[data-cg2p-src]'));
      const placedImageURLs = new Set();
      for (const img of imgs) {
        const src = img.getAttribute('data-cg2p-src');
        if (placedImageURLs.has(src)) {
          img.remove();
          continue;
        }
        const base64 = imageBase64Map.get(src);
        if (!base64) throw new Error(`${_('imageLoadFailed')}: ${src.substring(0, 80)}`);
        try {
          replaceImageWithCleanBlock(img, await createCompressedImage(base64), contentDiv);
          placedImageURLs.add(src);
          totalImagesAdded++;
        } catch (err) {
          console.warn('[ChatGPT2PDF] 图片处理失败:', src.substring(0, 60), err.message);
          throw new Error(`${_('imageLoadFailed')}: ${src.substring(0, 80)}`);
        }
      }

      // background-image 或无法映射到原位置的图片，追加到当前消息末尾，确保不丢图
      for (const src of imageURLs) {
        if (placedImageURLs.has(src)) continue;
        const base64 = imageBase64Map.get(src);
        if (!base64) throw new Error(`${_('imageLoadFailed')}: ${src.substring(0, 80)}`);
        const imgDiv = document.createElement('div');
        imgDiv.className = 'cg2p-image-block';
        imgDiv.dataset.cg2pImageBlock = 'true';
        imgDiv.style.cssText = 'display:block;width:100%;height:auto;min-height:0;max-height:none;margin:10px 0;padding:0;position:static;transform:none;aspect-ratio:auto;overflow:visible;';
        try {
          imgDiv.appendChild(await createCompressedImage(base64));
          contentDiv.appendChild(imgDiv);
          totalImagesAdded++;
        } catch (err) {
          console.warn('[ChatGPT2PDF] 图片处理失败:', src.substring(0, 60), err.message);
          throw new Error(`${_('imageLoadFailed')}: ${src.substring(0, 80)}`);
        }
      }

      applyInlineStyles(contentDiv);
      turnDiv.appendChild(contentDiv);
    } else if (hasImages) {
      // 纯图片回复（无文本）：按顺序添加图片
      for (const src of imageURLs) {
        const base64 = imageBase64Map.get(src);
        if (!base64) throw new Error(`${_('imageLoadFailed')}: ${src.substring(0, 80)}`);
        const imgDiv = document.createElement('div');
        imgDiv.className = 'cg2p-image-block';
        imgDiv.dataset.cg2pImageBlock = 'true';
        imgDiv.style.cssText = 'display:block;width:100%;height:auto;min-height:0;max-height:none;margin:10px 0;padding:0;position:static;transform:none;aspect-ratio:auto;overflow:visible;';
        try {
          imgDiv.appendChild(await createCompressedImage(base64));
          totalImagesAdded++;
        } catch (err) {
          console.warn('[ChatGPT2PDF] 图片处理失败:', src.substring(0, 60), err.message);
          throw new Error(`${_('imageLoadFailed')}: ${src.substring(0, 80)}`);
        }
        turnDiv.appendChild(imgDiv);
      }
    }

    turnDivs.push(turnDiv);
  }

  if (totalImagesAdded !== expectedImageCount) {
    throw new Error(`图片完整性校验失败：应导出 ${expectedImageCount} 张，实际处理 ${totalImagesAdded} 张`);
  }
  assertCompleteRender(sorted.map(([id]) => id), turnDivs.map(div => div.dataset.cg2pTurnId));
  console.log(`[ChatGPT2PDF] 构建完成: ${turnDivs.length} 个章节, ${totalImagesAdded} 张图片`);
  notifyProgress(_('docBuilt', [String(turnDivs.length), String(totalImagesAdded)]));

  return createSelectableReadDocument(turnDivs);
}

async function createSelectableReadDocument(turnDivs) {
  const oldDocument = document.getElementById('__chatgpt2pdf_read_document__');
  if (oldDocument) oldDocument.remove();
  document.getElementById('__chatgpt2pdf_read_print_css__')?.remove();

  const readDocument = document.createElement('main');
  readDocument.id = '__chatgpt2pdf_read_document__';
  readDocument.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff;color:#1a1a1a;padding:20px 36px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.65;';

  turnDivs.forEach(turn => {
    const clone = turn.cloneNode(true);
    clone.classList.add('cg2p-turn');
    clone.style.removeProperty('height');
    clone.style.removeProperty('min-height');
    clone.style.removeProperty('max-height');
    clone.style.removeProperty('position');
    clone.style.removeProperty('transform');
    clone.querySelectorAll('*').forEach(el => {
      if (el.tagName !== 'IMG') {
        el.style.removeProperty('height');
        el.style.removeProperty('min-height');
        el.style.removeProperty('max-height');
      }
      el.style.removeProperty('position');
      el.style.removeProperty('top');
      el.style.removeProperty('right');
      el.style.removeProperty('bottom');
      el.style.removeProperty('left');
      el.style.removeProperty('transform');
      el.style.removeProperty('translate');
      el.style.removeProperty('flex');
      el.style.removeProperty('flex-grow');
      el.style.removeProperty('flex-basis');
      el.style.removeProperty('align-self');
      el.style.removeProperty('margin-top');
      el.style.removeProperty('margin-bottom');
    });
    readDocument.appendChild(clone);
  });

  stripOklchColors(readDocument);
    forceWhiteBackground(readDocument);
    Array.from(readDocument.children).forEach(turn => turn.classList.add('cg2p-turn'));
    readDocument.querySelectorAll('[data-cg2p-image-block="true"]').forEach(block => block.classList.add('cg2p-image-block'));
  document.body.appendChild(readDocument);

  const printStyle = document.createElement('style');
  printStyle.id = '__chatgpt2pdf_read_print_css__';
  printStyle.textContent = `
    @media print {
      @page { size: A4; margin: 12mm 12mm 14mm; }
      html, body { background: #fff !important; color: #1a1a1a !important; margin: 0 !important; padding: 0 !important; }
      body > *:not(#__chatgpt2pdf_read_document__) { display: none !important; }
      #__chatgpt2pdf_read_document__ {
        display: block !important; position: static !important; width: auto !important;
        margin: 0 !important; padding: 0 !important; overflow: visible !important;
      }
      #__chatgpt2pdf_read_document__ .cg2p-turn {
        display: block !important; position: static !important; height: auto !important;
        min-height: 0 !important; max-height: none !important; margin: 0 0 12pt !important;
        padding: 0 0 10pt !important; break-before: auto !important; break-after: auto !important;
        page-break-before: auto !important; page-break-after: auto !important; break-inside: auto !important;
      }
      #__chatgpt2pdf_read_document__ .cg2p-turn *:not(img) {
        position: static !important; height: auto !important; min-height: 0 !important; max-height: none !important;
        transform: none !important; translate: none !important; flex-grow: 0 !important; flex-basis: auto !important;
      }
      #__chatgpt2pdf_read_document__ p,
      #__chatgpt2pdf_read_document__ li,
      #__chatgpt2pdf_read_document__ blockquote { orphans: 2; widows: 2; }
      #__chatgpt2pdf_read_document__ pre,
      #__chatgpt2pdf_read_document__ table { break-inside: auto !important; page-break-inside: auto !important; }
      #__chatgpt2pdf_read_document__ img {
        display: block !important; position: static !important; max-width: 100% !important;
        max-height: 245mm !important; width: auto !important; height: auto !important;
        margin: 8pt auto !important; object-fit: contain !important; break-inside: avoid !important;
        page-break-inside: avoid !important;
      }
      #__chatgpt2pdf_read_document__ .cg2p-image-block,
      #__chatgpt2pdf_read_document__ .cg2p-image-block * {
        position: static !important; width: auto !important; height: auto !important;
        min-height: 0 !important; max-height: none !important; aspect-ratio: auto !important;
        padding-top: 0 !important; padding-bottom: 0 !important; transform: none !important;
        flex: none !important; overflow: visible !important;
      }
      #__chatgpt2pdf_read_document__ .cg2p-image-block {
        display: block !important; width: 100% !important; margin: 8pt 0 !important; padding: 0 !important;
      }
    }
  `;
  document.head.appendChild(printStyle);

  await document.fonts?.ready;
  await sleep(300);
  const estimatedPages = Math.max(1, Math.ceil(readDocument.scrollHeight / 1030));
  notifyProgress(_('savingFile'));

  if (_overlayEl) _overlayEl.style.display = 'none';
  try {
    window.print();
  } finally {
    if (_overlayEl) _overlayEl.style.display = '';
    printStyle.remove();
    readDocument.remove();
  }

  return { selectable: true, pages: estimatedPages };
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
    /* 隐藏底部免责声明 */
    main div[class*="text-xs"][class*="text-center"],
    main p[class*="text-xs"][class*="text-center"],
    main > div:last-child [class*="text-xs"],
    main > div:last-of-type [class*="text-xs"] {
      display:none !important;
    }
    /* 隐藏浮动 tooltip/popover */
    [role="tooltip"], [data-radix-popper-content-wrapper] {
      display:none !important;
    }
    /* 隐藏 Google One Tap */
    #google-one-tap-anchor { display:none !important; }
  `;
  document.head.appendChild(hideStyle);

  // ★ JS 精确隐藏底部输入框/Composer（避免 CSS 误伤内容）
  const hiddenComposers = [];
  {
    const composerSelectors = [
      'form[data-testid*="composer"]',
      'form[data-testid*="prompt"]',
      '[data-testid*="composer"]',
      '[data-testid="composer-container"]',
      '[data-testid="composer-root"]',
      '#prompt-textarea',
      'main > div:last-child form',
      'main > div:last-of-type form',
      'footer form',
    ];
    const candidates = new Set();
    composerSelectors.forEach(sel => {
      try {
        document.querySelectorAll(sel).forEach(el => candidates.add(el));
      } catch (e) { /* 忽略非法选择器 */ }
    });
    const viewportH = window.innerHeight;
    candidates.forEach(el => {
      const rect = el.getBoundingClientRect();
      // 只隐藏位于视口底部 35% 区域内的元素
      if (rect.top > viewportH * 0.65) {
        el.style.setProperty('display', 'none', 'important');
        hiddenComposers.push(el);
        console.log(`[ChatGPT2PDF] 隐藏底部输入框: ${el.tagName}.${(el.className||'').toString().substring(0,40)} top=${Math.round(rect.top)}`);
      }
    });
  }

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
    notifyProgress(_('rollingToTop'));
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
      notifyProgress(_('screenshotViewportError'));
      return [];
    }

    const maxScrollInitial = totalScrollH - viewHeight;

    // 即使页面已完全展开（不需要滚动），也至少截一屏
    if (maxScrollInitial <= 0) {
      console.warn('[ChatGPT2PDF] 页面已完全展开（无需滚动），只截一屏');
      if (_overlayEl) _overlayEl.style.display = 'none';
      await sleep(150);
      const raw = await captureTab();
      if (_overlayEl) _overlayEl.style.display = '';
      await sleep(50);
      const cropped = await cropScreenshot(raw);
      screenshots.push(cropped);
      return screenshots;
    }

    while (safetyCounter++ < SAFETY_MAX) {
      if (_cancelled) return screenshots;

      scrollTo(pos);
      await sleep(700);

      if (_overlayEl) _overlayEl.style.display = 'none';
      await sleep(150);

      const raw = await captureTab();
      if (_overlayEl) _overlayEl.style.display = '';
      await sleep(50);

      const cropped = await cropScreenshot(raw);
      screenshots.push(cropped);

      const actualScrollTop = getScrollTop();
      const currentTotalH = useWindow
        ? Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
        : container.scrollHeight;
      const currentMaxScroll = currentTotalH - viewHeight;

      console.log(`[ChatGPT2PDF] 截图 #${screenshots.length}: pos=${pos}, actualTop=${actualScrollTop}, maxScroll=${currentMaxScroll}, totalH=${currentTotalH}`);

      notifyProgress(_('screenshotProgress', [String(screenshots.length)]));

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
    // 恢复隐藏的底部输入框
    for (const c of hiddenComposers) {
      c.style.removeProperty('display');
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
  showOverlay(_('preparingExport'));

  notifyProgress(_('preparingExport'));
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

      notifyProgress(_('assemblingPDF', [String(screenshots.length)]));

      // ★ 标准 A4 横版页面，截图按比例缩放适配
      const ssPageW = 297; // A4 横版宽度（mm）
      const ssPageH = 210; // A4 横版高度（mm）
      const ssPdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });

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
        if (i > 0) ssPdf.addPage('a4', 'landscape');

        // 截图按比例缩放，居中放置
        ssPdf.addImage(screenshots[i], 'PNG', imgX, imgY, imgW, imgH);

        // 最小化 footer（右下角小字）
        ssPdf.setFont('helvetica', 'normal');
        ssPdf.setFontSize(6);
        ssPdf.setTextColor(180, 180, 180);
        ssPdf.text(`${i + 1} / ${screenshots.length}`, ssPageW - 3, ssPageH - 2, { align: 'right' });
        pageNum++;
      }

      notifyProgress(_('savingFile'));
      const ssBlob = ssPdf.output('blob');
      const ssUrl = URL.createObjectURL(ssBlob);
      const ssLink = document.createElement('a');
      ssLink.href = ssUrl; ssLink.download = filename; ssLink.click();
      setTimeout(() => URL.revokeObjectURL(ssUrl), 10000);
      showOverlayResult(filename, pageNum - 1);
      return { filename, pages: pageNum - 1 };
    } else {
      // ── 直读模式：重建连续 HTML，由浏览器生成带可复制文字层的 PDF ──
      const readResult = await exportByReadMode();
      if (_cancelled || !readResult) return { filename: '', pages: 0 };
      showOverlayResult('✓ ' + _('exportComplete', [String(readResult.pages)]));
      notifyProgress('');
      return { filename, pages: readResult.pages };
    }
  } catch (err) {
    // ★ 确保出错时清理
    const wrapper = document.getElementById('__chatgpt2pdf_print__');
    if (wrapper) wrapper.remove();
    document.getElementById('__chatgpt2pdf_read_document__')?.remove();
    document.getElementById('__chatgpt2pdf_read_print_css__')?.remove();
    const hide = document.getElementById('__chatgpt2pdf_hide__');
    if (hide) hide.remove();
    showOverlayError(err.message || _('exportFailedShort'));
    throw err;
  }

  // 下载
  const blob = pdf.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  showOverlayResult('✓ ' + _('exportComplete', [String(pageNum - 1)]));
  notifyProgress('');

  return { filename, pages: pageNum - 1 };
}
