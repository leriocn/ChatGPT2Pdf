/**
 * ChatGPT to PDF - Popup Script
 * Developer: Jeffer SU
 */

const exportBtn = document.getElementById('exportBtn');
const cancelBtn = document.getElementById('cancelBtn');
const pageTitle = document.getElementById('pageTitle');
const pageUrl = document.getElementById('pageUrl');
const pageInfo = document.getElementById('pageInfo');
const unsupportedMsg = document.getElementById('unsupportedMsg');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');
const successMsg = document.getElementById('successMsg');
const successText = document.getElementById('successText');
const errorMsg = document.getElementById('errorMsg');
const errorText = document.getElementById('errorText');

/**
 * 初始化：获取当前页面信息
 */
async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const url = tab.url || '';
    const isSupported = url.includes('chatgpt.com/c/') || url.includes('chatgpt.com/share/');

    if (!isSupported) {
      pageInfo.style.display = 'none';
      unsupportedMsg.style.display = 'flex';
      exportBtn.disabled = true;
      return;
    }

    // 显示 URL 类型
    const urlType = url.includes('/share/') ? '（分享对话）' : '（自有对话）';

    // 向 content.js 获取页面信息
    try {
      const response = await sendMessageToTab(tab.id, { action: 'getPageInfo' });
      if (response) {
        pageTitle.textContent = response.title || tab.title || '未知标题';
        pageUrl.textContent = shortenUrl(url) + ' ' + urlType;
        exportBtn.disabled = false;
      } else {
        // content script 尚未注入，尝试注入
        await injectContentScript(tab.id);
        const retryResp = await sendMessageToTab(tab.id, { action: 'getPageInfo' });
        if (retryResp) {
          pageTitle.textContent = retryResp.title || tab.title || '未知标题';
          pageUrl.textContent = shortenUrl(url) + ' ' + urlType;
          exportBtn.disabled = false;
        } else {
          pageTitle.textContent = tab.title?.replace(/\s*[-–|]\s*ChatGPT\s*$/i, '') || '当前对话';
          pageUrl.textContent = shortenUrl(url) + ' ' + urlType;
          exportBtn.disabled = false;
        }
      }
    } catch (e) {
      // content script 未就绪，直接用 tab.title
      pageTitle.textContent = tab.title?.replace(/\s*[-–|]\s*ChatGPT\s*$/i, '') || '当前对话';
      pageUrl.textContent = shortenUrl(url) + ' ' + urlType;
      exportBtn.disabled = false;
    }

  } catch (err) {
    console.error('[ChatGPT2PDF Popup] 初始化失败:', err);
    pageTitle.textContent = '初始化失败';
    exportBtn.disabled = true;
  }
}

/**
 * 向指定 tab 发送消息（带超时）
 */
function sendMessageToTab(tabId, message, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), timeout);
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(response);
        }
      });
    } catch (e) {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/**
 * 手动注入 content script（用于页面刷新后）
 */
async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['libs/html2canvas.min.js', 'libs/jspdf.umd.min.js', 'content.js']
    });
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (e) {
    console.warn('[ChatGPT2PDF Popup] 注入 content script 失败:', e);
  }
}

/**
 * 缩短 URL 显示
 */
function shortenUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname;
    if (path.length > 35) {
      return u.hostname + path.substring(0, 15) + '...' + path.substring(path.length - 10);
    }
    return u.hostname + path;
  } catch {
    return url.substring(0, 50);
  }
}

/**
 * 显示状态
 */
function showStatus(message) {
  hideAllMessages();
  statusText.textContent = message;
  statusEl.style.display = 'block';
  exportBtn.disabled = true;
  exportBtn.classList.add('loading');
  cancelBtn.style.display = 'block';
}

/**
 * 显示成功
 */
function showSuccess(message) {
  hideAllMessages();
  successText.textContent = message;
  successMsg.style.display = 'flex';
  exportBtn.disabled = false;
  exportBtn.classList.remove('loading');
  cancelBtn.style.display = 'none';
}

/**
 * 显示错误
 */
function showError(message) {
  hideAllMessages();
  errorText.textContent = message;
  errorMsg.style.display = 'flex';
  exportBtn.disabled = false;
  exportBtn.classList.remove('loading');
  cancelBtn.style.display = 'none';
}

/**
 * 隐藏所有消息
 */
function hideAllMessages() {
  statusEl.style.display = 'none';
  successMsg.style.display = 'none';
  errorMsg.style.display = 'none';
}

/**
 * 监听来自 content.js 的进度更新
 */
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'progressUpdate') {
    if (message.message) {
      showStatus(message.message);
    }
  }
});

/**
 * 导出按钮点击处理
 */
exportBtn.addEventListener('click', async () => {
  try {
    const mode = document.querySelector('input[name="exportMode"]:checked')?.value || 'read';
    showStatus('正在连接页面...');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showError('无法获取当前标签页');
      return;
    }

    // 截图模式 / 打印模式：通过 background 发起导出后关闭 popup（避免遮挡截图/打印）
    if (mode === 'screenshot' || mode === 'print') {
      // 确保 content script 已注入
      let testResp = await sendMessageToTab(tab.id, { action: 'getPageInfo' });
      if (!testResp) {
        showStatus('正在注入脚本...');
        await injectContentScript(tab.id);
      }
      // 通过 background 发送命令，popup 即将关闭
      chrome.runtime.sendMessage({ action: 'startExport', tabId: tab.id, mode });
      showStatus('截图模式已启动，请等待完成...');
      // 关闭 popup，让浏览器页面完全可见
      setTimeout(() => window.close(), 300);
      return;
    }

    // 直读模式：popup 保持打开
    let response = await sendMessageToTab(tab.id, { action: 'exportPDF', mode }, 120000);

    if (response === null) {
      // content script 未响应，尝试注入后重试
      showStatus('正在注入脚本...');
      await injectContentScript(tab.id);
      response = await sendMessageToTab(tab.id, { action: 'exportPDF', mode }, 120000);
    }

    if (response === null) {
      showError('页面响应超时，请刷新页面后重试');
      return;
    }

    if (response.success) {
      const pages = response.pages || 1;
      showSuccess(`导出成功！共 ${pages} 页 → ${response.filename}`);
    } else {
      showError('导出失败：' + (response.error || '未知错误'));
    }

  } catch (err) {
    console.error('[ChatGPT2PDF Popup] 导出出错:', err);
    showError('发生错误：' + err.message);
  }
});

// 初始化
init();

/**
 * 取消导出按钮
 */
cancelBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { action: 'cancelExport' });
  }
  cancelBtn.style.display = 'none';
  showError('导出已取消');
});
