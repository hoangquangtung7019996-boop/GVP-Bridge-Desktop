/**
 * GVP Bridge — Passive Response Observer (PLAN_040)
 * 
 * READ-ONLY. Does NOT modify any requests or headers.
 * Monitors Grok API responses for video/image URLs and broadcasts them
 * to the content script context via CustomEvent('GVP_INTERCEPTOR_EVENT').
 * 
 * Events emitted:
 * - GVP_FETCH_VIDEO_PROMPT: { videoUrl, imageUrl, sourceUrl }
 * - GVP_FETCH_ERROR: { error, status }
 * - GVP_FETCH_READY: {}
 */

(function() {
  'use strict';

  const ORIGINAL_FETCH = window.fetch;

  /**
   * Broadcast event to content script (isolated world) via CustomEvent.
   */
  function broadcast(type, payload) {
    window.dispatchEvent(new CustomEvent('GVP_INTERCEPTOR_EVENT', {
      detail: { type, payload }
    }));
  }

  window.fetch = function(...args) {
    const request = new Request(...args);
    const url = request.url;

    // Only monitor generation-related endpoints
    const isConversationNew = url.includes('/rest/app-chat/conversations/new');
    const isVideoResult = url.includes('/get_video_generation_result');

    if (!isConversationNew && !isVideoResult) {
      return ORIGINAL_FETCH.apply(this, args);
    }

    return ORIGINAL_FETCH.apply(this, args).then(response => {
      // Clone to avoid consuming the body
      const clone = response.clone();
      
      clone.text().then(text => {
        try {
          // Extract video/image URLs from the response body via regex
          const videoMatch = text.match(/"videoUrl"\s*:\s*"([^"]+)"/);
          const imageMatch = text.match(/"imageUrl"\s*:\s*"([^"]+)"/);
          
          if (videoMatch || imageMatch) {
            broadcast('GVP_FETCH_VIDEO_PROMPT', {
              videoUrl: videoMatch ? videoMatch[1] : null,
              imageUrl: imageMatch ? imageMatch[1] : null,
              sourceUrl: url
            });
          }
        } catch (e) {
          // Silent — passive observer should never break the page
        }
      }).catch(() => {});

      return response;
    }).catch(err => {
      broadcast('GVP_FETCH_ERROR', {
        error: err.message || 'fetch_failed',
        status: 0
      });
      throw err; // Re-throw so the page's own error handling works
    });
  };

  broadcast('GVP_FETCH_READY', {});
  console.log('[GVP] Passive response observer loaded (PLAN_040)');
})();
