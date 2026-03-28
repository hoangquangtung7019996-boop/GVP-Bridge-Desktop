/**
 * GVP Bridge - DOM Operations
 * Handles prompt injection and submit actions
 * Reference: gvp-tiptap-prosemirror-injection KI, REFERENCE_ReactAutomation.md
 */

import { findPromptEditor, findSubmitButton } from './selectors.js';

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
 * Full flow: inject prompt and submit
 * @param {string} text
 * @returns {Object} result
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
