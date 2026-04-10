# PLAN_038: Fetch Harvester — Skeleton Template Capture & Replay

## Problem/Goal

All previous attempts to generate videos by fabricating API requests to Grok's `/conversations/new` endpoint have failed (Plans 012-037). Even with 31/31 header parity, the requests get blocked by Grok's anti-bot protections.

**New Discovery:** A legitimate fetch request copied from Chrome DevTools ("Copy as fetch") and pasted into the console hours later successfully generates a video. This proves the browser's runtime context (cookies, TLS session, JavaScript scope) validates the request — not individual headers.

**Goal:** Programmatically "harvest" the FULL request data (URL, method, all headers, full body) from one legitimate user-initiated video generation. Store it as a "Skeleton Template". When the Desktop App sends a new prompt, clone the template, swap only the prompt text and parentPostId, and fire the fetch from page context using `ORIGINAL_FETCH`.

**Debugging Mandate:** Every step must include overkill tagged console logging with prefixes: `[HARVESTER]`, `[SKELETON]`, `[CLONER]`, `[FETCH-REPLAY]`, `[WS-BRIDGE]`.

---

## Step 1: Add Skeleton Template Storage & Harvest Logic to gvpFetchInterceptor.js

**File:** `src-extension/injected/gvpFetchInterceptor.js`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```javascript
  // PLAN-037: Trace Synchronization
  // Keep track of the latest Sentry traces to ensure delegated fetches match the session context
  let lastTraceparent = null;
  let lastBaggage = null;
```

**Replace With:**
```javascript
  // PLAN-037: Trace Synchronization
  // Keep track of the latest Sentry traces to ensure delegated fetches match the session context
  let lastTraceparent = null;
  let lastBaggage = null;

  // ============================================================================
  // PLAN-038: FETCH HARVESTER — Skeleton Template System
  // ============================================================================
  // 
  // CONCEPT: Capture the FULL request data from one successful user-initiated 
  // video generation. Store it as a "Skeleton Template". When the Desktop App
  // sends a new prompt, clone the template, swap only the prompt/imageId,
  // and fire using ORIGINAL_FETCH (which carries browser auth context).
  //
  // This mimics Chrome DevTools "Copy as fetch" programmatically.
  // ============================================================================

  /**
   * The harvested skeleton template. null = not yet captured.
   * Mirrors Chrome DevTools "Copy as fetch" structure exactly:
   * {
   *   url: string,                     // Full request URL
   *   method: string,                  // 'POST'
   *   headers: Record<string, string>, // Application-set headers (NOT cookie/user-agent/origin)
   *   body: object,                    // Parsed JSON body
   *   bodyRaw: string,                 // Original JSON string
   *   referrer: string,                // Top-level fetch option (NOT a header)
   *   mode: string,                    // 'cors'
   *   credentials: string,             // 'include' (tells browser to attach cookies)
   *   harvestedAt: number,             // Timestamp of capture
   *   responseStatus: number,          // HTTP status of the original response
   *   responseOk: boolean              // Whether response.ok was true
   * }
   */
  let skeletonTemplate = null;

  /** Whether harvesting is armed (waiting for next successful /new request) */
  let harvesterArmed = true;

  /** Count of harvested templates this session (for diagnostics) */
  let harvestCount = 0;

  /**
   * Deep-clone a headers object so mutations don't affect the template.
   * @param {Record<string, string>} hdrs
   * @returns {Record<string, string>}
   */
  function cloneHeaders(hdrs) {
    if (!hdrs || typeof hdrs !== 'object') return {};
    const clone = {};
    for (const key in hdrs) {
      if (Object.prototype.hasOwnProperty.call(hdrs, key)) {
        clone[key] = hdrs[key];
      }
    }
    return clone;
  }

  /**
   * Harvest a successful /conversations/new request as the Skeleton Template.
   * Called AFTER the response comes back 200 OK.
   * Captures the same structure as Chrome DevTools "Copy as fetch".
   *
   * @param {string} url - The request URL
   * @param {string} method - HTTP method
   * @param {Record<string, string>} headers - Serialized request headers
   * @param {string} bodyRaw - Raw JSON body string
   * @param {number} status - Response HTTP status
   * @param {boolean} ok - Response ok flag
   * @param {string} referrer - The fetch referrer option (top-level, NOT a header)
   * @param {string} fetchMode - The fetch mode option ('cors')
   * @param {string} fetchCredentials - The fetch credentials option ('include')
   */
  function harvestSkeleton(url, method, headers, bodyRaw, status, ok, referrer, fetchMode, fetchCredentials) {
    const TAG = '[HARVESTER]';

    console.log(`${TAG} ========================================`);
    console.log(`${TAG} 🎯 HARVEST TRIGGERED`);
    console.log(`${TAG} URL: ${url}`);
    console.log(`${TAG} Method: ${method}`);
    console.log(`${TAG} Response: ${status} (ok=${ok})`);
    console.log(`${TAG} Headers captured: ${headers ? Object.keys(headers).length : 0}`);
    console.log(`${TAG} Body length: ${bodyRaw ? bodyRaw.length : 0} chars`);
    console.log(`${TAG} Referrer: ${referrer || '(none)'}`);
    console.log(`${TAG} Mode: ${fetchMode || '(default)'}`);
    console.log(`${TAG} Credentials: ${fetchCredentials || '(default)'}`);
    console.log(`${TAG} ↑ These 3 are top-level fetch() options, NOT headers`);

    if (!ok || status !== 200) {
      console.warn(`${TAG} ⚠️ SKIPPING — Response was not 200 OK (status=${status}, ok=${ok})`);
      return;
    }

    if (!headers || Object.keys(headers).length === 0) {
      console.warn(`${TAG} ⚠️ SKIPPING — No headers captured`);
      return;
    }

    if (!bodyRaw) {
      console.warn(`${TAG} ⚠️ SKIPPING — No body captured`);
      return;
    }

    let bodyParsed;
    try {
      bodyParsed = JSON.parse(bodyRaw);
    } catch (e) {
      console.error(`${TAG} ❌ SKIPPING — Body is not valid JSON:`, e.message);
      return;
    }

    // Verify this is actually a video generation request (not an image edit or chat)
    const hasVideoGen = bodyParsed?.toolOverrides?.videoGen === true ||
                        bodyParsed?.responseMetadata?.modelConfigOverride?.modelMap?.videoGenModelConfig;
    
    if (!hasVideoGen) {
      console.warn(`${TAG} ⚠️ SKIPPING — Request does not appear to be a video generation (no videoGen toolOverride or videoGenModelConfig)`);
      console.warn(`${TAG} Body keys:`, Object.keys(bodyParsed));
      console.warn(`${TAG} toolOverrides:`, JSON.stringify(bodyParsed?.toolOverrides));
      return;
    }

    // Build the template — mirrors Chrome "Copy as fetch" structure exactly
    skeletonTemplate = {
      url: url,
      method: method,
      headers: cloneHeaders(headers),
      body: bodyParsed,
      bodyRaw: bodyRaw,
      referrer: referrer || '',
      mode: fetchMode || 'cors',
      credentials: fetchCredentials || 'include',
      harvestedAt: Date.now(),
      responseStatus: status,
      responseOk: ok
    };

    harvestCount++;

    console.log(`${TAG} ✅ SKELETON TEMPLATE CAPTURED SUCCESSFULLY`);
    console.log(`${TAG} Harvest #${harvestCount} this session`);
    console.log(`${TAG} Template URL: ${skeletonTemplate.url}`);
    console.log(`${TAG} Template headers (${Object.keys(skeletonTemplate.headers).length}):`);
    Object.entries(skeletonTemplate.headers).forEach(([k, v]) => {
      const displayVal = typeof v === 'string' && v.length > 60 ? v.substring(0, 60) + '...' : v;
      console.log(`${TAG}   ${k}: ${displayVal}`);
    });
    console.log(`${TAG} Template body.message: ${(bodyParsed.message || '').substring(0, 100)}...`);
    console.log(`${TAG} Template body.modelName: ${bodyParsed.modelName}`);
    console.log(`${TAG} Template body.toolOverrides:`, JSON.stringify(bodyParsed.toolOverrides));
    console.log(`${TAG} Template referrer: ${skeletonTemplate.referrer}`);
    console.log(`${TAG} Template mode: ${skeletonTemplate.mode}`);
    console.log(`${TAG} Template credentials: ${skeletonTemplate.credentials}`);
    console.log(`${TAG} ========================================`);

    // Notify content script (and thus Desktop) that template is ready
    postBridgeMessage('GVP_HARVESTER_TEMPLATE_READY', {
      harvestCount: harvestCount,
      headerCount: Object.keys(skeletonTemplate.headers).length,
      bodyLength: bodyRaw.length,
      url: url,
      timestamp: Date.now()
    });
  }

  /**
   * Clone the skeleton template, swap the prompt text and parentPostId,
   * and fire the fetch using ORIGINAL_FETCH.
   *
   * @param {string} newPrompt - The new prompt text to inject
   * @param {string} newImageId - The new parentPostId / imageId
   * @returns {Promise<void>}
   */
  async function cloneAndFire(newPrompt, newImageId) {
    const TAG_C = '[CLONER]';
    const TAG_F = '[FETCH-REPLAY]';

    console.log(`${TAG_C} ========================================`);
    console.log(`${TAG_C} 🔄 CLONE & FIRE INITIATED`);
    console.log(`${TAG_C} New prompt: "${newPrompt ? newPrompt.substring(0, 80) : '(none)'}..."`);
    console.log(`${TAG_C} New imageId: ${newImageId}`);
    console.log(`${TAG_C} Template exists: ${!!skeletonTemplate}`);

    if (!skeletonTemplate) {
      console.error(`${TAG_C} ❌ NO SKELETON TEMPLATE — Cannot fire. User must generate one video manually first.`);
      postBridgeMessage('GVP_HARVESTER_ERROR', {
        error: 'NO_TEMPLATE',
        message: 'No skeleton template captured yet. Generate one video manually first.',
        timestamp: Date.now()
      });
      return;
    }

    const templateAge = Date.now() - skeletonTemplate.harvestedAt;
    console.log(`${TAG_C} Template age: ${Math.round(templateAge / 1000)}s (${Math.round(templateAge / 60000)}min)`);

    // Step 1: Deep clone the body
    let clonedBody;
    try {
      clonedBody = JSON.parse(JSON.stringify(skeletonTemplate.body));
      console.log(`${TAG_C} ✅ Body deep-cloned successfully`);
    } catch (e) {
      console.error(`${TAG_C} ❌ Failed to deep-clone body:`, e.message);
      postBridgeMessage('GVP_HARVESTER_ERROR', {
        error: 'CLONE_FAILED',
        message: 'Failed to clone template body: ' + e.message,
        timestamp: Date.now()
      });
      return;
    }

    // Step 2: Swap the prompt text in the message field
    const originalMessage = clonedBody.message || '';
    console.log(`${TAG_C} Original message: "${originalMessage.substring(0, 100)}..."`);

    // The message field format is: "<image_url> <prompt_text> --mode=custom"
    // We need to replace the prompt part while keeping the image URL and mode flag
    const imageUrl = newImageId
      ? `https://imagine-public.x.ai/imagine-public/share-images/${newImageId}.png`
      : '';

    if (newPrompt && imageUrl) {
      clonedBody.message = `${imageUrl} ${newPrompt} --mode=custom`;
    } else if (newPrompt) {
      // No imageId — just use the prompt with mode flag
      clonedBody.message = `${newPrompt} --mode=custom`;
    } else if (imageUrl) {
      // No prompt — use a placeholder
      clonedBody.message = `${imageUrl} . --mode=custom`;
    }
    console.log(`${TAG_C} New message: "${clonedBody.message.substring(0, 100)}..."`);

    // Step 3: Update parentPostId in videoGenModelConfig
    if (newImageId && clonedBody.responseMetadata?.modelConfigOverride?.modelMap?.videoGenModelConfig) {
      const oldId = clonedBody.responseMetadata.modelConfigOverride.modelMap.videoGenModelConfig.parentPostId;
      clonedBody.responseMetadata.modelConfigOverride.modelMap.videoGenModelConfig.parentPostId = newImageId;
      console.log(`${TAG_C} Swapped parentPostId: ${oldId} → ${newImageId}`);
    } else {
      console.warn(`${TAG_C} ⚠️ Could not find videoGenModelConfig.parentPostId in cloned body`);
    }

    // Step 4: Clone headers and update dynamic fields
    const clonedHeaders = cloneHeaders(skeletonTemplate.headers);
    const newBodyString = JSON.stringify(clonedBody);
    
    // Generate a fresh x-xai-request-id (this MUST be unique per request)
    const freshRequestId = generateXaiRequestId();
    clonedHeaders['x-xai-request-id'] = freshRequestId;
    console.log(`${TAG_C} Fresh x-xai-request-id: ${freshRequestId}`);

    // NOTE: Do NOT set 'content-length' — it's a FORBIDDEN header in fetch().
    // The browser calculates it automatically from the body.
    console.log(`${TAG_C} Body length (browser will set content-length): ${newBodyString.length}`);

    // Update traceparent and baggage if we have fresher ones
    if (lastTraceparent) {
      clonedHeaders['traceparent'] = lastTraceparent;
      console.log(`${TAG_C} Updated traceparent from live capture`);
    }
    if (lastBaggage) {
      clonedHeaders['baggage'] = lastBaggage;
      console.log(`${TAG_C} Updated baggage from live capture`);
    }

    // NOTE: Do NOT set 'referer' in headers — it's a FORBIDDEN header in fetch().
    // Instead, we pass it as a top-level 'referrer' fetch option (see Step 6 below).
    // Also do NOT set 'cookie', 'origin', 'user-agent' — browser handles all of these.
    const newReferrer = newImageId
      ? `https://grok.com/imagine/post/${newImageId}`
      : skeletonTemplate.referrer;
    console.log(`${TAG_C} Referrer (top-level fetch option): ${newReferrer}`);

    console.log(`${TAG_C} ✅ Clone complete. Final headers (${Object.keys(clonedHeaders).length}):`);
    Object.entries(clonedHeaders).forEach(([k, v]) => {
      const displayVal = typeof v === 'string' && v.length > 60 ? v.substring(0, 60) + '...' : v;
      console.log(`${TAG_C}   ${k}: ${displayVal}`);
    });
    console.log(`${TAG_C} Final body (${newBodyString.length} chars): ${newBodyString.substring(0, 200)}...`);

    // Step 5: Remove forbidden/pseudo-headers that fetch() doesn't accept
    // HTTP/2 pseudo-headers + browser-managed headers
    const forbiddenHeaders = [
      ':authority', ':method', ':path', ':scheme',   // HTTP/2 pseudo-headers
      'content-length',                               // Browser calculates
      'cookie',                                       // credentials: 'include' handles this
      'origin',                                       // Browser sets for CORS
      'referer',                                      // Use 'referrer' fetch option instead
      'user-agent',                                   // Browser sets automatically
      'accept-encoding',                              // Browser sets automatically
      'host',                                         // Browser sets from URL
      'connection'                                    // Browser manages
    ];
    for (const fh of forbiddenHeaders) {
      if (clonedHeaders[fh]) {
        console.log(`${TAG_C} Removing forbidden/browser-managed header: ${fh}`);
        delete clonedHeaders[fh];
      }
    }

    // Step 6: Fire the cloned fetch — mirrors Chrome "Copy as fetch" structure
    console.log(`${TAG_F} ========================================`);
    console.log(`${TAG_F} 🚀 FIRING CLONED FETCH (Copy-as-fetch replica)`);
    console.log(`${TAG_F} URL: ${skeletonTemplate.url}`);
    console.log(`${TAG_F} Method: ${skeletonTemplate.method}`);
    console.log(`${TAG_F} Headers: ${Object.keys(clonedHeaders).length}`);
    console.log(`${TAG_F} Referrer: ${newReferrer}`);
    console.log(`${TAG_F} Mode: ${skeletonTemplate.mode}`);
    console.log(`${TAG_F} Credentials: ${skeletonTemplate.credentials}`);
    console.log(`${TAG_F} Body: ${newBodyString.length} chars`);
    console.log(`${TAG_F} Template age: ${Math.round(templateAge / 1000)}s`);

    try {
      const response = await ORIGINAL_FETCH(skeletonTemplate.url, {
        method: skeletonTemplate.method,
        headers: clonedHeaders,
        referrer: newReferrer,
        body: newBodyString,
        mode: skeletonTemplate.mode,
        credentials: skeletonTemplate.credentials
      });

      console.log(`${TAG_F} 📡 RESPONSE RECEIVED`);
      console.log(`${TAG_F} Status: ${response.status} ${response.statusText}`);
      console.log(`${TAG_F} OK: ${response.ok}`);
      console.log(`${TAG_F} Type: ${response.type}`);
      console.log(`${TAG_F} Redirected: ${response.redirected}`);

      // Log response headers
      const respHeaders = {};
      response.headers.forEach((value, key) => {
        respHeaders[key] = value;
      });
      console.log(`${TAG_F} Response headers:`, JSON.stringify(respHeaders));

      if (!response.ok) {
        console.error(`${TAG_F} ❌ FETCH FAILED — Status ${response.status}`);
        // Try to read error body
        try {
          const errorText = await response.clone().text();
          console.error(`${TAG_F} Error body (first 500 chars): ${errorText.substring(0, 500)}`);
          postBridgeMessage('GVP_HARVESTER_ERROR', {
            error: 'FETCH_FAILED',
            status: response.status,
            statusText: response.statusText,
            body: errorText.substring(0, 500),
            timestamp: Date.now()
          });
        } catch (readErr) {
          console.error(`${TAG_F} Could not read error body:`, readErr.message);
        }
        console.log(`${TAG_F} ========================================`);
        return;
      }

      console.log(`${TAG_F} ✅ FETCH SUCCEEDED — 200 OK! Processing response stream...`);

      // Process the streaming response for progress/completion
      try {
        const cloned = response.clone();
        processResponseBody(cloned, {
          url: skeletonTemplate.url,
          requestId: `harvester_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
        }).catch(e => {
          console.error(`${TAG_F} Stream processing error:`, e.message);
        });
        console.log(`${TAG_F} Stream processing started in background`);
      } catch (cloneErr) {
        console.error(`${TAG_F} Failed to clone response for stream processing:`, cloneErr.message);
      }

      // Notify content script of success
      postBridgeMessage('GVP_HARVESTER_FIRE_RESULT', {
        success: true,
        status: response.status,
        prompt: newPrompt ? newPrompt.substring(0, 100) : '',
        imageId: newImageId,
        timestamp: Date.now()
      });

      console.log(`${TAG_F} ========================================`);

    } catch (fetchError) {
      console.error(`${TAG_F} ❌ FETCH THREW EXCEPTION:`, fetchError.message);
      console.error(`${TAG_F} Stack:`, fetchError.stack);
      postBridgeMessage('GVP_HARVESTER_ERROR', {
        error: 'FETCH_EXCEPTION',
        message: fetchError.message,
        timestamp: Date.now()
      });
      console.log(`${TAG_F} ========================================`);
    }
  }
```

---

## Step 2: Wire Harvesting into the Fetch Wrapper Response Path

**File:** `src-extension/injected/gvpFetchInterceptor.js`
**Action:** MODIFY_EXISTING

This adds the harvest call AFTER the response is received and confirmed 200 OK for `/conversations/new`.

**Find Exact Block:**
```javascript
    if (isTarget) {
      log('Processing /conversations/new response', {
        url,
        status: response?.status,
        ok: response?.ok,
        type: response?.type
      });

      try {
        postBridgeMessage('GVP_FETCH_CONVERSATION_REQUEST', {
          id: bridgeId,
          url,
          method,
          headers: capturedHeaders,
          body: typeof requestInit?.body === 'string' ? requestInit.body : null,
          status: response?.status,
          ok: response?.ok
        });
      } catch (bridgeError) {
        log('Failed to post bridge conversation request', { error: bridgeError?.message }, 'warn');
      }
```

**Replace With:**
```javascript
    if (isTarget) {
      log('Processing /conversations/new response', {
        url,
        status: response?.status,
        ok: response?.ok,
        type: response?.type
      });

      // PLAN-038: HARVEST the skeleton template from successful video generation requests
      // Captures the same data as Chrome DevTools "Copy as fetch":
      // headers from init.headers, body from init.body,
      // referrer/mode/credentials from top-level init options
      if (harvesterArmed && response?.ok && response?.status === 200) {
        const bodyForHarvest = typeof requestInit?.body === 'string' ? requestInit.body : null;
        if (bodyForHarvest && capturedHeaders) {
          console.log('[HARVESTER] 🎯 Successful /new response detected — attempting harvest...');
          // Capture top-level fetch options (these are NOT in headers)
          const harvReferrer = requestInit?.referrer || (typeof Request !== 'undefined' && input instanceof Request ? input.referrer : '') || '';
          const harvMode = requestInit?.mode || (typeof Request !== 'undefined' && input instanceof Request ? input.mode : 'cors') || 'cors';
          const harvCredentials = requestInit?.credentials || (typeof Request !== 'undefined' && input instanceof Request ? input.credentials : 'include') || 'include';
          harvestSkeleton(url, method, capturedHeaders, bodyForHarvest, response.status, response.ok, harvReferrer, harvMode, harvCredentials);
        } else {
          console.warn('[HARVESTER] ⚠️ 200 OK but missing body or headers for harvest',
            { hasBody: !!bodyForHarvest, hasHeaders: !!capturedHeaders });
        }
      }

      try {
        postBridgeMessage('GVP_FETCH_CONVERSATION_REQUEST', {
          id: bridgeId,
          url,
          method,
          headers: capturedHeaders,
          body: typeof requestInit?.body === 'string' ? requestInit.body : null,
          status: response?.status,
          ok: response?.ok
        });
      } catch (bridgeError) {
        log('Failed to post bridge conversation request', { error: bridgeError?.message }, 'warn');
      }
```

---

## Step 3: Add GVP_HARVESTER_FIRE Command Listener

**File:** `src-extension/injected/gvpFetchInterceptor.js`
**Action:** MODIFY_EXISTING

This adds a CustomEvent listener that the content script will fire when the Desktop sends a "generate via harvester" command.

**Find Exact Block:**
```javascript
  // PLAN-032: Robust CustomEvent listener for delegated generation
  window.addEventListener('GVP_EXECUTE_DIRECT_GEN', (event) => {
```

**Replace With:**
```javascript
  // PLAN-038: Harvester fire command — clone template and fire
  window.addEventListener('GVP_HARVESTER_FIRE', (event) => {
    const detail = event.detail || {};
    const { prompt, imageId } = detail;
    
    console.log('[WS-BRIDGE] 📨 GVP_HARVESTER_FIRE received from content script');
    console.log('[WS-BRIDGE] Prompt:', prompt ? prompt.substring(0, 80) + '...' : '(none)');
    console.log('[WS-BRIDGE] ImageId:', imageId);
    console.log('[WS-BRIDGE] Template status:', skeletonTemplate ? 'READY ✅' : 'NOT CAPTURED ❌');
    
    cloneAndFire(prompt || '', imageId || '');
  }, false);

  // PLAN-038: Harvester status query — check if template is ready
  window.addEventListener('GVP_HARVESTER_STATUS', (event) => {
    console.log('[SKELETON] 📋 Status query received');
    postBridgeMessage('GVP_HARVESTER_STATUS_RESPONSE', {
      hasTemplate: !!skeletonTemplate,
      harvestCount: harvestCount,
      templateAge: skeletonTemplate ? Date.now() - skeletonTemplate.harvestedAt : null,
      headerCount: skeletonTemplate ? Object.keys(skeletonTemplate.headers).length : 0,
      templateUrl: skeletonTemplate ? skeletonTemplate.url : null,
      timestamp: Date.now()
    });
  }, false);

  // PLAN-032: Robust CustomEvent listener for delegated generation
  window.addEventListener('GVP_EXECUTE_DIRECT_GEN', (event) => {
```

---

## Step 4: Add Harvester Event Handling in Content Script

**File:** `src-extension/content.bundle.js`
**Action:** MODIFY_EXISTING

Add handling for the new harvester bridge events in the `setupOGInterceptorListener` function.

**Find Exact Block:**
```javascript
        // Interceptor ready signal
        case 'GVP_FETCH_READY': {
          debug('[OG Interceptor] Fetch interceptor is ready');
          break;
        }
        
        default:
          // Ignore other message types
          break;
      }
```

**Replace With:**
```javascript
        // Interceptor ready signal
        case 'GVP_FETCH_READY': {
          debug('[OG Interceptor] Fetch interceptor is ready');
          break;
        }

        // PLAN-038: Harvester template captured successfully
        case 'GVP_HARVESTER_TEMPLATE_READY': {
          const { harvestCount, headerCount, bodyLength } = payload || {};
          console.log(`[HARVESTER] ✅ TEMPLATE READY — Harvest #${harvestCount}, ${headerCount} headers, ${bodyLength} chars body`);
          // Notify Desktop App
          wsClient.send({
            type: 'harvester_template_ready',
            payload: {
              harvestCount,
              headerCount,
              bodyLength,
              timestamp: Date.now()
            }
          });
          break;
        }

        // PLAN-038: Harvester fire result
        case 'GVP_HARVESTER_FIRE_RESULT': {
          const { success, status: fireStatus, prompt: firedPrompt, imageId: firedImageId } = payload || {};
          console.log(`[FETCH-REPLAY] ${success ? '✅ SUCCESS' : '❌ FAILED'} — Status: ${fireStatus}`);
          wsClient.send({
            type: 'harvester_fire_result',
            payload: {
              success,
              status: fireStatus,
              prompt: firedPrompt,
              imageId: firedImageId,
              timestamp: Date.now()
            }
          });
          break;
        }

        // PLAN-038: Harvester error
        case 'GVP_HARVESTER_ERROR': {
          const { error: harvErr, message: harvMsg, status: harvStatus } = payload || {};
          console.error(`[HARVESTER] ❌ ERROR: ${harvErr} — ${harvMsg || ''} (status=${harvStatus || 'N/A'})`);
          wsClient.send({
            type: 'harvester_error',
            payload: {
              error: harvErr,
              message: harvMsg,
              status: harvStatus,
              timestamp: Date.now()
            }
          });
          break;
        }

        // PLAN-038: Harvester status response
        case 'GVP_HARVESTER_STATUS_RESPONSE': {
          const { hasTemplate, harvestCount: hc, templateAge, headerCount: thc } = payload || {};
          console.log(`[SKELETON] Status: template=${hasTemplate ? 'READY' : 'NONE'}, harvests=${hc}, age=${templateAge ? Math.round(templateAge/1000) + 's' : 'N/A'}, headers=${thc}`);
          wsClient.send({
            type: 'harvester_status',
            payload: payload
          });
          break;
        }
        
        default:
          // Ignore other message types
          break;
      }
```

---

## Step 5: Add Harvester Mode to handlePromptResponse

**File:** `src-extension/content.bundle.js`
**Action:** MODIFY_EXISTING

Update `handlePromptResponse` to support a new `harvesterMode` flag from the Desktop. When set, instead of DOM clicking or the old direct API, it dispatches `GVP_HARVESTER_FIRE` to the page context.

**Find Exact Block:**
```javascript
  async function handlePromptResponse(payload) {
    const { prompt, imageId, previewMode } = payload;

    // Update interception state from desktop
    interceptGenerations = !!previewMode;
    debug('[handlePromptResponse] Intercept generations:', interceptGenerations);

    // PREVIEW MODE: Direct API call instead of UI interaction
    if (interceptGenerations) {
      debug('[handlePromptResponse] PREVIEW MODE - sending direct generation request');
      lastAction = 'Preview: Direct API request';
      sendDirectGenerationRequest(imageId, prompt);
      return;
    }
```

**Replace With:**
```javascript
  async function handlePromptResponse(payload) {
    const { prompt, imageId, previewMode, harvesterMode } = payload;

    // Update interception state from desktop
    interceptGenerations = !!previewMode;
    debug('[handlePromptResponse] Intercept generations:', interceptGenerations);
    debug('[handlePromptResponse] Harvester mode:', !!harvesterMode);

    // HARVESTER MODE: Clone skeleton template and fire
    if (harvesterMode) {
      console.log('[WS-BRIDGE] 📨 HARVESTER MODE — Dispatching GVP_HARVESTER_FIRE to page context');
      console.log('[WS-BRIDGE] Prompt:', prompt ? prompt.substring(0, 80) + '...' : '(none)');
      console.log('[WS-BRIDGE] ImageId:', imageId);
      lastAction = `Harvester: Firing cloned fetch for ${imageId ? imageId.substring(0, 8) + '...' : 'no-image'}`;
      
      window.dispatchEvent(new CustomEvent('GVP_HARVESTER_FIRE', {
        detail: {
          prompt: prompt || '',
          imageId: imageId || ''
        }
      }));
      
      // Send immediate status back
      wsClient.sendStatus('harvester_fired', {
        imageId,
        promptLength: prompt ? prompt.length : 0
      });
      return;
    }

    // PREVIEW MODE: Direct API call instead of UI interaction
    if (interceptGenerations) {
      debug('[handlePromptResponse] PREVIEW MODE - sending direct generation request');
      lastAction = 'Preview: Direct API request';
      sendDirectGenerationRequest(imageId, prompt);
      return;
    }
```

---

## Step 6: Add harvesterMode Flag to Desktop Backend

**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

Add `harvester_mode` to AppState and the Tauri commands.

**Find Exact Block:**
```rust
pub struct AppState {
    pub current_prompt: String,
    pub connection_count: u32,
    pub last_status: String,
    pub last_url: String,
    pub last_image_id: String,
    pub preview_mode: bool,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            current_prompt: String::new(),
            connection_count: 0,
            last_status: "Ready".to_string(),
            last_url: String::new(),
            last_image_id: String::new(),
            preview_mode: false,
        }
    }
}
```

**Replace With:**
```rust
pub struct AppState {
    pub current_prompt: String,
    pub connection_count: u32,
    pub last_status: String,
    pub last_url: String,
    pub last_image_id: String,
    pub preview_mode: bool,
    pub harvester_mode: bool,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            current_prompt: String::new(),
            connection_count: 0,
            last_status: "Ready".to_string(),
            last_url: String::new(),
            last_image_id: String::new(),
            preview_mode: false,
            harvester_mode: false,
        }
    }
}
```

---

## Step 7: Add Tauri Commands for Harvester Mode

**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
/// Get preview mode
#[tauri::command]
fn get_preview_mode(state: tauri::State<Arc<Mutex<AppState>>>) -> Result<bool, String> {
    let s = state.lock();
    Ok(s.preview_mode)
}
```

**Replace With:**
```rust
/// Get preview mode
#[tauri::command]
fn get_preview_mode(state: tauri::State<Arc<Mutex<AppState>>>) -> Result<bool, String> {
    let s = state.lock();
    Ok(s.preview_mode)
}

/// Set harvester mode
#[tauri::command]
fn set_harvester_mode(enabled: bool, state: tauri::State<Arc<Mutex<AppState>>>) -> Result<bool, String> {
    let mut s = state.lock();
    s.harvester_mode = enabled;
    println!("[GVP Desktop] Harvester mode: {}", enabled);
    Ok(enabled)
}

/// Get harvester mode
#[tauri::command]
fn get_harvester_mode(state: tauri::State<Arc<Mutex<AppState>>>) -> Result<bool, String> {
    let s = state.lock();
    Ok(s.harvester_mode)
}
```

---

## Step 8: Register New Commands and Wire Harvester Mode into WS prompt_response

**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
        .invoke_handler(tauri::generate_handler![
            set_prompt,
            get_prompt,
            get_status,
            clear_prompt,
            set_preview_mode,
            get_preview_mode,
        ])
```

**Replace With:**
```rust
        .invoke_handler(tauri::generate_handler![
            set_prompt,
            get_prompt,
            get_status,
            clear_prompt,
            set_preview_mode,
            get_preview_mode,
            set_harvester_mode,
            get_harvester_mode,
        ])
```

---

## Step 9: Include harvesterMode in WS prompt_response Messages

**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

There are TWO places where `prompt_response` is sent: in `preview_card_clicked` and in `prompt_request`. Both need `harvesterMode`.

**Find Exact Block (First — inside preview_card_clicked):**
```rust
                            "preview_card_clicked" => {
                                let image_id = payload["imageId"].as_str().unwrap_or("");
                                println!("[GVP Desktop] Preview card clicked: {}", image_id);
                                
                                // Get current prompt and preview mode
                                let prompt = {
                                    let s = state.lock();
                                    s.current_prompt.clone()
                                };
                                let preview_mode = {
                                    let s = state.lock();
                                    s.preview_mode
                                };
                                
                                // Send prompt response (will trigger direct API call in extension)
                                let response = serde_json::json!({
                                    "type": "prompt_response",
                                    "payload": {
                                        "prompt": prompt,
                                        "imageId": image_id,
                                        "previewMode": preview_mode
                                    },
                                    "timestamp": chrono_timestamp()
                                });
```

**Replace With:**
```rust
                            "preview_card_clicked" => {
                                let image_id = payload["imageId"].as_str().unwrap_or("");
                                println!("[GVP Desktop] Preview card clicked: {}", image_id);
                                
                                // Get current prompt, preview mode, and harvester mode
                                let (prompt, preview_mode, harvester_mode) = {
                                    let s = state.lock();
                                    (s.current_prompt.clone(), s.preview_mode, s.harvester_mode)
                                };
                                
                                // Send prompt response (will trigger harvester or direct API in extension)
                                let response = serde_json::json!({
                                    "type": "prompt_response",
                                    "payload": {
                                        "prompt": prompt,
                                        "imageId": image_id,
                                        "previewMode": preview_mode,
                                        "harvesterMode": harvester_mode
                                    },
                                    "timestamp": chrono_timestamp()
                                });
```

---

## Step 10: Include harvesterMode in Second prompt_response (prompt_request handler)

**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
                            "prompt_request" => {
                                let image_id = payload["imageId"].as_str().unwrap_or("");

                                // Store image ID
                                {
                                     let mut s = state.lock();
                                     s.last_image_id = image_id.to_string();
                                }

                                // Get current prompt
                                let prompt = {
                                    let s = state.lock();
                                    s.current_prompt.clone()
                                };

                                // Get preview mode
                                let preview_mode = {
                                    let s = state.lock();
                                    s.preview_mode
                                };

                                // Send prompt response
                                let response = serde_json::json!({
                                    "type": "prompt_response",
                                    "payload": {
                                        "prompt": prompt,
                                        "imageId": image_id,
                                        "previewMode": preview_mode
                                    },
                                    "timestamp": chrono_timestamp()
                                });
```

**Replace With:**
```rust
                            "prompt_request" => {
                                let image_id = payload["imageId"].as_str().unwrap_or("");

                                // Store image ID
                                {
                                     let mut s = state.lock();
                                     s.last_image_id = image_id.to_string();
                                }

                                // Get current prompt, preview mode, and harvester mode
                                let (prompt, preview_mode, harvester_mode) = {
                                    let s = state.lock();
                                    (s.current_prompt.clone(), s.preview_mode, s.harvester_mode)
                                };

                                // Send prompt response
                                let response = serde_json::json!({
                                    "type": "prompt_response",
                                    "payload": {
                                        "prompt": prompt,
                                        "imageId": image_id,
                                        "previewMode": preview_mode,
                                        "harvesterMode": harvester_mode
                                    },
                                    "timestamp": chrono_timestamp()
                                });
```

---

## Step 11: Handle New WS Message Types in Backend (harvester events)

**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
                            // Extension reports generation result
                            "generation_result" => {
                                println!("[GVP Desktop] Received generation_result");
                                // Forward directly to frontend
                                let _ = app_handle.emit("generation-result", payload);
                            }

                            _ => {
                                println!("[GVP Desktop] Unknown message type: {}", msg_type);
                            }
```

**Replace With:**
```rust
                            // Extension reports generation result
                            "generation_result" => {
                                println!("[GVP Desktop] Received generation_result");
                                // Forward directly to frontend
                                let _ = app_handle.emit("generation-result", payload);
                            }

                            // PLAN-038: Harvester template is ready
                            "harvester_template_ready" => {
                                println!("[GVP Desktop] ✅ Harvester template captured! Headers: {}, Body: {} chars",
                                    payload["headerCount"].as_u64().unwrap_or(0),
                                    payload["bodyLength"].as_u64().unwrap_or(0)
                                );
                                let _ = app_handle.emit("harvester-template-ready", payload);
                            }

                            // PLAN-038: Harvester fire result
                            "harvester_fire_result" => {
                                let success = payload["success"].as_bool().unwrap_or(false);
                                println!("[GVP Desktop] Harvester fire result: success={}", success);
                                let _ = app_handle.emit("harvester-fire-result", payload);
                            }

                            // PLAN-038: Harvester error
                            "harvester_error" => {
                                let error = payload["error"].as_str().unwrap_or("unknown");
                                let msg = payload["message"].as_str().unwrap_or("");
                                println!("[GVP Desktop] ❌ Harvester error: {} — {}", error, msg);
                                let _ = app_handle.emit("harvester-error", payload);
                            }

                            // PLAN-038: Harvester status query response
                            "harvester_status" => {
                                println!("[GVP Desktop] Harvester status: template={}",
                                    payload["hasTemplate"].as_bool().unwrap_or(false)
                                );
                                let _ = app_handle.emit("harvester-status", payload);
                            }

                            _ => {
                                println!("[GVP Desktop] Unknown message type: {}", msg_type);
                            }
```

---

## Step 12: Add Harvester Mode Toggle to Desktop UI

**File:** `src-desktop/components/PromptInput.tsx`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```typescript
    const [prompt, setPrompt] = createSignal('');
    const [isLoading, setIsLoading] = createSignal(false);
    const [previewMode, setPreviewMode] = createSignal(false);
    let textareaRef: HTMLTextAreaElement | undefined;
```

**Replace With:**
```typescript
    const [prompt, setPrompt] = createSignal('');
    const [isLoading, setIsLoading] = createSignal(false);
    const [previewMode, setPreviewMode] = createSignal(false);
    const [harvesterMode, setHarvesterMode] = createSignal(false);
    let textareaRef: HTMLTextAreaElement | undefined;
```

---

## Step 13: Load Harvester Mode on Mount

**File:** `src-desktop/components/PromptInput.tsx`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```typescript
    onMount(() => {
        // Load existing prompt and preview mode on mount
        Promise.all([
            invoke<string>('get_prompt'),
            invoke<boolean>('get_preview_mode')
        ]).then(([savedPrompt, savedPreviewMode]) => {
            if (savedPrompt) {
                setPrompt(savedPrompt);
                adjustHeight();
            }
            setPreviewMode(savedPreviewMode);
        }).catch(console.error);
    });
```

**Replace With:**
```typescript
    const handleToggleHarvester = async () => {
        const newState = !harvesterMode();
        setHarvesterMode(newState);
        try {
            await invoke('set_harvester_mode', { enabled: newState });
            // When harvester mode is on, turn off preview mode (they're mutually exclusive)
            if (newState && previewMode()) {
                setPreviewMode(false);
                await invoke('set_preview_mode', { enabled: false });
            }
        } catch (error) {
            console.error('Failed to toggle harvester mode:', error);
            setHarvesterMode(!newState);
        }
    };

    onMount(() => {
        // Load existing prompt, preview mode, and harvester mode on mount
        Promise.all([
            invoke<string>('get_prompt'),
            invoke<boolean>('get_preview_mode'),
            invoke<boolean>('get_harvester_mode')
        ]).then(([savedPrompt, savedPreviewMode, savedHarvesterMode]) => {
            if (savedPrompt) {
                setPrompt(savedPrompt);
                adjustHeight();
            }
            setPreviewMode(savedPreviewMode);
            setHarvesterMode(savedHarvesterMode);
        }).catch(console.error);
    });
```

---

## Step 14: Add Harvester Toggle UI Element

**File:** `src-desktop/components/PromptInput.tsx`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```tsx
                    <label class="preview-toggle" title="Intercept and display generations instead of auto-submitting">
                        <input 
                            type="checkbox" 
                            checked={previewMode()} 
                            onChange={handleTogglePreview} 
                        />
                        <span>Preview Mode</span>
                    </label>
```

**Replace With:**
```tsx
                    <label class="preview-toggle" title="Intercept and display generations instead of auto-submitting">
                        <input 
                            type="checkbox" 
                            checked={previewMode()} 
                            onChange={handleTogglePreview} 
                        />
                        <span>Preview Mode</span>
                    </label>
                    <label class="preview-toggle" title="Use harvested fetch template for video generation (requires one manual generation first)" style={{"margin-left": "8px", "border-left": "1px solid rgba(255,255,255,0.2)", "padding-left": "8px"}}>
                        <input 
                            type="checkbox" 
                            checked={harvesterMode()} 
                            onChange={handleToggleHarvester} 
                        />
                        <span>🎯 Harvester</span>
                    </label>
```

---

## Verification Plan

After implementation, verify the following sequence:

1. **Build & Load Extension:** Reload the extension in Chrome (`chrome://extensions`). Open DevTools console on `grok.com`.
2. **Check Interceptor Install:** Look for `[GVP Interceptor v1.21.18] ✅ Fetch interceptor installed` in console.
3. **Generate One Video Manually:** Use Grok normally to generate a video. Watch for `[HARVESTER] 🎯 HARVEST TRIGGERED` and `[HARVESTER] ✅ SKELETON TEMPLATE CAPTURED SUCCESSFULLY` in the console.
4. **Verify Template Logged:** All headers and body fields should be printed to console. Check header count matches a native request (expect 20-31 headers).
5. **Enable Harvester Mode:** Toggle the "🎯 Harvester" checkbox in the Desktop App.
6. **Click a Gallery Card:** Click any image in the Grok gallery. Watch for:
   - `[WS-BRIDGE] 📨 HARVESTER MODE` in extension console
   - `[CLONER] 🔄 CLONE & FIRE INITIATED` in page console
   - `[FETCH-REPLAY] 🚀 FIRING CLONED FETCH` in page console
   - `[FETCH-REPLAY] 📡 RESPONSE RECEIVED` with status
7. **Success Case:** If status 200, watch for `[FETCH-REPLAY] ✅ FETCH SUCCEEDED` and stream processing.
8. **Failure Case:** If status 403/400/etc, read the error body logged at `[FETCH-REPLAY] Error body`. This tells us exactly what Grok rejected.

---

## Rollback Plan

If the Fetch Harvester approach fails:
- The extension's Normal Mode (DOM clicking via `injectAndSubmitAsync`) is completely untouched by this plan.
- Simply turn off "🎯 Harvester" mode in the Desktop App to revert to DOM clicking.
- No code removal needed — the harvester is opt-in via flag only.
