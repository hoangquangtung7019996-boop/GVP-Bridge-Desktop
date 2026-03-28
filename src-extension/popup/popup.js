/**
 * GVP Bridge - Popup UI Controller
 */

let debugLogs = [];

const wsStatusDot = document.querySelector('#ws-status .status-dot');
const wsStatusText = document.getElementById('ws-status-text');
const desktopStatus = document.getElementById('desktop-status');
const currentUrl = document.getElementById('current-url');
const lastAction = document.getElementById('last-action');
const debugLog = document.getElementById('debug-log');
const logCount = document.getElementById('log-count');

const btnConnect = document.getElementById('btn-connect');
const btnReload = document.getElementById('btn-reload');
const btnClear = document.getElementById('btn-clear');

function log(message, type = 'info') {
  const time = new Date().toLocaleTimeString();
  debugLogs.push({ time, message, type });
  if (debugLogs.length > 100) debugLogs.shift();
  renderLogs();
  saveLogs();
}

function renderLogs() {
  debugLog.innerHTML = debugLogs.map(e => `
    <div class="log-entry">
      <span class="log-time">${e.time}</span>
      <span class="log-${e.type}">${e.message}</span>
    </div>
  `).join('');
  logCount.textContent = `${debugLogs.length} entries`;
  debugLog.scrollTop = debugLog.scrollHeight;
}

function saveLogs() {
  chrome.storage.local.set({ debugLogs: debugLogs.slice(-50) });
}

async function loadLogs() {
  const data = await chrome.storage.local.get('debugLogs');
  if (data.debugLogs) {
    debugLogs = data.debugLogs;
    renderLogs();
  }
}

function updateStatus(connected, text) {
  wsStatusDot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  wsStatusText.textContent = text || (connected ? 'Connected' : 'Disconnected');
}

async function queryTabStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { log('No active tab', 'warn'); return; }
    
    const url = new URL(tab.url);
    currentUrl.textContent = url.hostname + url.pathname.substring(0, 20);
    currentUrl.title = tab.url;
    
    if (!tab.url.includes('grok.com')) {
      log('Not on grok.com - extension inactive', 'warn');
      updateStatus(false, 'Wrong site');
      desktopStatus.textContent = 'Navigate to grok.com';
      return;
    }
    
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'get_status' });
      if (response) {
        updateStatus(response.connected, response.connected ? 'Connected' : 'Disconnected');
        desktopStatus.textContent = response.desktopStatus || 'Unknown';
        lastAction.textContent = response.lastAction || 'None';
        log(`Status: ${response.connected ? 'Connected' : 'Disconnected'}`, response.connected ? 'success' : 'warn');
      }
    } catch (e) {
      log('Content script not responding', 'error');
      updateStatus(false, 'No response');
      desktopStatus.textContent = 'Refresh page';
    }
  } catch (error) {
    log(`Error: ${error.message}`, 'error');
  }
}

async function sendConnect() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url.includes('grok.com')) {
      log('Navigate to grok.com first', 'warn');
      return;
    }
    await chrome.tabs.sendMessage(tab.id, { type: 'force_connect' });
    log('Connect command sent', 'info');
  } catch (error) {
    log(`Connect failed: ${error.message}`, 'error');
  }
}

async function reloadAndRefresh() {
  log('Reloading extension...', 'info');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.runtime.reload();
  if (tab) chrome.tabs.reload(tab.id);
}

btnConnect.addEventListener('click', sendConnect);
btnReload.addEventListener('click', reloadAndRefresh);
btnClear.addEventListener('click', () => {
  debugLogs = [];
  renderLogs();
  saveLogs();
  log('Log cleared', 'info');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'status_update') {
    updateStatus(message.connected, message.statusText);
    desktopStatus.textContent = message.desktopStatus || 'Unknown';
    log(message.log || 'Status update', message.logType || 'info');
  }
  sendResponse({ received: true });
});

async function init() {
  await loadLogs();
  log('Popup opened', 'info');
  await queryTabStatus();
}

init();
