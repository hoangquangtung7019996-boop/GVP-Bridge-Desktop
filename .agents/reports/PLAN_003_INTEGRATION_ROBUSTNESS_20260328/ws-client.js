/**
 * GVP Bridge - WebSocket Client
 * Connects to desktop app on port 8765
 */

const WS_PORT = 8765;
const WS_URL = `ws://localhost:${WS_PORT}`;

class WSClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.connectionTimeout = 10000; // 10s connection timeout
    this.messageQueue = [];
    this.onMessageCallback = null;
    this.heartbeatInterval = null;
    this.heartbeatMs = 30000; // 30s heartbeat
    this.lastPongTime = 0;
    this.missedHeartbeats = 0;
    this.maxMissedHeartbeats = 3;
  }

  /**
   * Connect to desktop app WebSocket server
   * @returns {Promise<boolean>}
   */
  connect() {
    return new Promise((resolve) => {
      // Create timeout
      const timeoutId = setTimeout(() => {
        console.warn('[GVP Bridge] Connection timeout');
        if (this.ws) {
          this.ws.close();
        }
        resolve(false);
      }, this.connectionTimeout);

      try {
        this.ws = new WebSocket(WS_URL);

        this.ws.onopen = () => {
          clearTimeout(timeoutId);
          console.log('[GVP Bridge] WebSocket connected');
          this.connected = true;
          this.reconnectAttempts = 0;
          this.flushMessageQueue();
          this.startHeartbeat();
          resolve(true);
        };

        this.ws.onclose = () => {
          clearTimeout(timeoutId);
          console.log('[GVP Bridge] WebSocket disconnected');
          this.connected = false;
          this.stopHeartbeat();
          this.scheduleReconnect();
        };

        this.ws.onerror = (error) => {
          clearTimeout(timeoutId);
          console.error('[GVP Bridge] WebSocket error:', error);
          this.connected = false;
          resolve(false);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        clearTimeout(timeoutId);
        console.error('[GVP Bridge] Failed to create WebSocket:', error);
        resolve(false);
      }
    });
  }

  /**
   * Schedule reconnection attempt
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[GVP Bridge] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);

    setTimeout(() => {
      console.log(`[GVP Bridge] Reconnect attempt ${this.reconnectAttempts}`);
      this.connect();
    }, delay);
  }

  /**
   * Handle incoming message
   * @param {string} data
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      console.log('[GVP Bridge] Received:', message);

      if (message.type === 'pong') {
        this.handlePong();
        return;
      }

      if (this.onMessageCallback) {
        this.onMessageCallback(message);
      }
    } catch (error) {
      console.error('[GVP Bridge] Failed to parse message:', error);
    }
  }

  /**
   * Set message handler callback
   * @param {Function} callback
   */
  onMessage(callback) {
    this.onMessageCallback = callback;
  }

  /**
   * Send message to desktop app
   * @param {Object} message
   */
  send(message) {
    const payload = {
      ...message,
      timestamp: Date.now()
    };

    if (this.connected && this.ws) {
      this.ws.send(JSON.stringify(payload));
    } else {
      // Queue message for later
      this.messageQueue.push(payload);
    }
  }

  /**
   * Flush queued messages
   */
  flushMessageQueue() {
    while (this.messageQueue.length > 0 && this.connected) {
      const message = this.messageQueue.shift();
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Request prompt from desktop app
   * @param {string} imageId
   */
  requestPrompt(imageId) {
    this.send({
      type: 'prompt_request',
      payload: { imageId }
    });
  }

  /**
   * Notify desktop app of URL change
   * @param {string} url
   * @param {string|null} imageId
   */
  notifyUrlChange(url, imageId) {
    this.send({
      type: 'url_changed',
      payload: { url, imageId }
    });
  }

  /**
   * Send status update to desktop app
   * @param {string} status
   * @param {Object} details
   */
  sendStatus(status, details = {}) {
    this.send({
      type: 'status',
      payload: { status, ...details }
    });
  }

  /**
   * Disconnect WebSocket
   */
  disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  /**
   * Start heartbeat to detect stale connections
   */
  startHeartbeat() {
    this.stopHeartbeat();
    this.lastPongTime = Date.now();
    this.missedHeartbeats = 0;

    this.heartbeatInterval = setInterval(() => {
      if (!this.connected) {
        return;
      }

      // Check if we've missed too many heartbeats
      if (this.missedHeartbeats >= this.maxMissedHeartbeats) {
        console.warn('[GVP Bridge] Connection stale, reconnecting...');
        this.missedHeartbeats = 0;
        this.ws.close();
        return;
      }

      // Send ping
      this.missedHeartbeats++;
      this.send({ type: 'ping', payload: {} });
      console.log('[GVP Bridge] Ping sent (missed:', this.missedHeartbeats, ')');
    }, this.heartbeatMs);
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Handle pong response
   */
  handlePong() {
    this.lastPongTime = Date.now();
    this.missedHeartbeats = 0;
    console.log('[GVP Bridge] Pong received, connection healthy');
  }
}

// Export singleton instance
export const wsClient = new WSClient();
export default wsClient;
