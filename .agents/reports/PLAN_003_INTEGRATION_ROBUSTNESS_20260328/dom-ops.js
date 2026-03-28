import { findPromptEditor, findSubmitButton, waitForEditor, waitForSubmitButton } from './selectors.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY_MS: 200,
  SUBMIT_DELAY_MS: 150,
  EDITOR_WAIT_TIMEOUT_MS: 5000
};

/**
 * Inject text into the prompt editor
 * Uses synthetic events for React/TipTap compatibility
 * @param {string} text
 * @returns {boolean} success
 */
export function injectPrompt(text) {
  const editor = findPromptEditor();

  if (!editor) {
    console.error('[GVP Bridge] Prompt editor not found');
    return false;
  }

  try {
    // Focus the editor first
    editor.focus();

    // Clear existing content
    editor.textContent = '';

    // Create input event for React
    const inputEvent = new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text
    });

    // Set the text content
    editor.textContent = text;

    // Dispatch input event to trigger React re-render
    editor.dispatchEvent(inputEvent);

    // Also dispatch a change event for good measure
    const changeEvent = new Event('change', { bubbles: true });
    editor.dispatchEvent(changeEvent);

    console.log('[GVP Bridge] Prompt injected:', text.substring(0, 50) + '...');
    return true;
  } catch (error) {
    console.error('[GVP Bridge] Failed to inject prompt:', error);
    return false;
  }
}

/**
 * Alternative injection using document.execCommand
 * Fallback for some React versions
 * @param {string} text
 * @returns {boolean} success
 */
export function injectPromptFallback(text) {
  const editor = findPromptEditor();

  if (!editor) {
    return false;
  }

  try {
    editor.focus();

    // Select all and delete
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);

    // Insert new text
    document.execCommand('insertText', false, text);

    return true;
  } catch (error) {
    console.error('[GVP Bridge] Fallback injection failed:', error);
    return false;
  }
}

/**
 * Inject with TipTap paragraph wrapping
 * For ProseMirror editors that need <p> tags
 * @param {string} text
 * @returns {boolean} success
 */
export function injectPromptWithParagraphs(text) {
  const editor = findPromptEditor();
  if (!editor) return false;

  try {
    editor.focus();
    
    // Wrap lines in <p> tags for TipTap
    const pWrapped = text
      .split('\n')
      .map(line => `<p>${line || '<br>'}</p>`)
      .join('');
    
    editor.innerHTML = pWrapped;
    
    // Dispatch input event
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text
    }));
    
    return true;
  } catch (error) {
    console.error('[GVP Bridge] Paragraph injection failed:', error);
    return false;
  }
}

/**
 * Sleep utility
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Inject with retry logic
 * @param {string} text
 * @param {number} maxAttempts
 * @returns {Promise<{success: boolean, attempts: number, error: string|null}>}
 */
export async function injectWithRetry(text, maxAttempts = CONFIG.MAX_RETRY_ATTEMPTS) {
  const result = {
    success: false,
    attempts: 0,
    error: null
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    result.attempts = attempt;
    console.log(`[GVP Bridge] Injection attempt ${attempt}/${maxAttempts}`);

    // Wait for editor on each attempt
    const editor = await waitForEditor(CONFIG.EDITOR_WAIT_TIMEOUT_MS);
    
    if (!editor) {
      result.error = 'Editor not found';
      await sleep(CONFIG.RETRY_DELAY_MS * attempt);
      continue;
    }

    // Try primary method
    if (injectPrompt(text)) {
      result.success = true;
      console.log('[GVP Bridge] Primary injection successful');
      return result;
    }

    // Try fallback method
    if (injectPromptFallback(text)) {
      result.success = true;
      console.log('[GVP Bridge] Fallback injection successful');
      return result;
    }

    // Try paragraph method
    if (injectPromptWithParagraphs(text)) {
      result.success = true;
      console.log('[GVP Bridge] Paragraph injection successful');
      return result;
    }

    console.warn(`[GVP Bridge] Attempt ${attempt} failed`);
    await sleep(CONFIG.RETRY_DELAY_MS * attempt);
  }

  result.error = `Failed after ${maxAttempts} attempts`;
  return result;
}

/**
 * Press Enter key in the editor
 * @returns {boolean} success
 */
export function pressEnter() {
  const editor = findPromptEditor();

  if (!editor) {
    return false;
  }

  try {
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });

    editor.dispatchEvent(enterEvent);

    // Also dispatch keyup for completeness
    const enterUpEvent = new KeyboardEvent('keyup', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });

    editor.dispatchEvent(enterUpEvent);

    console.log('[GVP Bridge] Enter key pressed');
    return true;
  } catch (error) {
    console.error('[GVP Bridge] Failed to press Enter:', error);
    return false;
  }
}

/**
 * Click the submit/send button
 * @returns {boolean} success
 */
export function clickSubmit() {
  const button = findSubmitButton();

  if (!button) {
    console.error('[GVP Bridge] Submit button not found');
    return false;
  }

  try {
    // Try native click first
    button.click();

    console.log('[GVP Bridge] Submit button clicked');
    return true;
  } catch (error) {
    console.error('[GVP Bridge] Failed to click submit:', error);
    return false;
  }
}

/**
 * Submit the prompt (try Enter first, then button click)
 * @returns {boolean} success
 */
export function submitPrompt() {
  // Try Enter key first
  if (pressEnter()) {
    return true;
  }

  // Fallback to button click
  return clickSubmit();
}

/**
 * Full flow: inject prompt and submit (async version)
 * @param {string} text
 * @returns {Promise<{injected: boolean, submitted: boolean, error: string|null, attempts: number}>}
 */
export async function injectAndSubmitAsync(text) {
  const result = {
    injected: false,
    submitted: false,
    error: null,
    attempts: 0
  };

  // Inject with retry
  const injectResult = await injectWithRetry(text);
  result.attempts = injectResult.attempts;

  if (!injectResult.success) {
    result.error = injectResult.error;
    return result;
  }

  result.injected = true;
  console.log('[GVP Bridge] Prompt injected successfully');

  // Wait before submitting
  await sleep(CONFIG.SUBMIT_DELAY_MS);

  // Wait for submit button
  const submitButton = await waitForSubmitButton(2000);
  
  if (submitButton) {
    // Try to find the button again to ensure we have the latest reference
    const btn = findSubmitButton();
    if (btn) {
      btn.click();
      result.submitted = true;
    }
  } else {
    // Try Enter key as fallback
    result.submitted = pressEnter();
  }

  if (!result.submitted) {
    result.error = 'Failed to submit prompt';
  } else {
    console.log('[GVP Bridge] Prompt submitted successfully');
  }

  return result;
}

/**
 * Full flow: inject prompt and submit (legacy sync version)
 * @param {string} text
 * @returns {Object} result
 * @deprecated Use injectAndSubmitAsync instead
 */
export function injectAndSubmit(text) {
  const result = {
    injected: false,
    submitted: false,
    error: null
  };

  // Inject prompt
  result.injected = injectPrompt(text);

  if (!result.injected) {
    result.injected = injectPromptFallback(text);
  }

  if (!result.injected) {
    result.error = 'Failed to inject prompt';
    return result;
  }

  // Small delay before submitting
  setTimeout(() => {
    result.submitted = submitPrompt();

    if (!result.submitted) {
      result.error = 'Failed to submit prompt';
    }
  }, 100);

  return result;
}
