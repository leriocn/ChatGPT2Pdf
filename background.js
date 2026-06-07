/**
 * ChatGPT to PDF - Background Service Worker
 * Developer: Jeffer SU
 * 负责：
 *   1. 截取当前可见标签页（captureVisibleTab）
 *   2. 跨域图片下载转 base64
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ★ 截图模式：popup 关闭后由 background 发起导出
  if (message.action === 'startExport') {
    const { tabId, mode } = message;
    // 等 popup 完全关闭后再发消息给 content script
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { action: 'exportPDF', mode }, (resp) => {
        if (chrome.runtime.lastError) {
          console.error('[ChatGPT2PDF] startExport 失败:', chrome.runtime.lastError.message);
        } else if (resp && !resp.success) {
          console.error('[ChatGPT2PDF] 导出失败:', resp.error);
        }
      });
    }, 600);
    sendResponse({ ok: true });
    return false;
  }

  // ★ 核心：截取当前标签页可见区域
  if (message.action === 'captureTab') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, dataUrl });
      }
    });
    return true;
  }

  if (message.action === 'fetchImage') {
    fetchImageAsBase64(message.url)
      .then(base64 => sendResponse({ success: true, data: base64 }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // ★ 在页面 MAIN world 中批量下载图片（利用页面 cookie 认证上下文）
  if (message.action === 'fetchImagesInPage') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: '无法获取 tab ID' });
      return false;
    }
    const urls = message.urls || [];
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (imageUrls) => {
        const results = {};
        const errors = [];
        for (const url of imageUrls) {
          try {
            const resp = await fetch(url, { credentials: 'omit', mode: 'cors' });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const blob = await resp.blob();
            const dataUrl = await new Promise((res, rej) => {
              const r = new FileReader();
              r.onloadend = () => res(r.result);
              r.onerror = () => rej(new Error('FileReader'));
              r.readAsDataURL(blob);
            });
            results[url] = dataUrl;
            console.log('[ChatGPT2PDF/page] fetch 成功:', url.substring(0, 80));
          } catch (e) {
            results[url] = null;
            errors.push({ url: url.substring(0, 80), err: e.message });
            console.warn('[ChatGPT2PDF/page] fetch 失败:', url.substring(0, 80), e.message);
          }
        }
        if (errors.length) console.warn('[ChatGPT2PDF/page] 共失败:', errors.length, errors);
        return results;
      },
      args: [urls]
    }).then(([result]) => {
      sendResponse({ success: true, results: result.result || {} });
    }).catch(err => {
      console.error('[ChatGPT2PDF] fetchImagesInPage 失败:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true; // 保持消息通道异步
  }

  // ★ 通知弹窗（截图模式 popup 关闭后仍可显示进度）
  if (message.action === 'showNotification') {
    try {
      chrome.notifications.create('', {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: message.title || 'ChatGPT to PDF',
        message: message.message || ''
      });
    } catch (e) {
      console.warn('[ChatGPT2PDF] 通知失败:', e.message);
    }
    sendResponse({ ok: true });
    return false;
  }
});

/**
 * 将图片 URL 转换为 base64 Data URL
 */
async function fetchImageAsBase64(url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      headers: { 'Accept': 'image/*,*/*' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || 'image/png';
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, uint8Array.subarray(i, i + chunkSize));
    }
    return `data:${contentType};base64,${btoa(binary)}`;
  } catch (error) {
    console.error('[ChatGPT2PDF] 图片下载失败:', url, error);
    throw error;
  }
}
