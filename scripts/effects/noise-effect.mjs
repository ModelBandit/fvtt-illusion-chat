import { cleanupHostIfEmpty, ensureHost, findChatMessageElements } from "./effect-dom.mjs";

const OVERLAY_CLASS = "spc-noise-overlay";

function apply(element) {
  if (!ensureHost(element)) return;
  if (element.querySelector(`:scope > .${OVERLAY_CLASS}`)) return;
  const overlay = document.createElement("div");
  overlay.className = OVERLAY_CLASS;
  overlay.dataset.spcEffectOverlay = "noise";
  overlay.setAttribute("aria-hidden", "true");
  element.appendChild(overlay);
}
function remove(element) {
  element.querySelectorAll(`:scope > .${OVERLAY_CLASS}`).forEach(node => node.remove());
  cleanupHostIfEmpty(element);
}
export const noiseEffect = {
  start(context) { for (const id of context.messageIds) for (const el of findChatMessageElements(id)) apply(el); },
  stop(context) { for (const id of context.messageIds) for (const el of findChatMessageElements(id)) remove(el); },
  applyToElement: apply
};
