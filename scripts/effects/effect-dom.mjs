export function findChatMessageElements(messageId) {
  if (!messageId) return [];
  const escaped = CSS.escape(messageId);
  return Array.from(document.querySelectorAll(
    `.message[data-message-id="${escaped}"], .chat-message[data-message-id="${escaped}"]`
  ));
}

export function ensureHost(element) {
  if (!(element instanceof HTMLElement)) return false;
  element.classList.add("spc-effect-host");
  return true;
}

export function cleanupHostIfEmpty(element) {
  if (!(element instanceof HTMLElement)) return;
  if (!element.querySelector(":scope > [data-spc-effect-overlay]")) {
    element.classList.remove("spc-effect-host");
  }
}

export function nextAnimationFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

export async function waitForPaint() {
  await nextAnimationFrame();
  await nextAnimationFrame();
}
