import { cleanupHostIfEmpty, ensureHost, findChatMessageElements } from "./effect-dom.mjs";

const OVERLAY_CLASS = "spc-rgb-overlay";

function getVisualSource(element) {
  return element.querySelector(".message-content") ?? element.querySelector(".message-content-wrapper") ?? element;
}

function apply(element) {
  if (!ensureHost(element)) return;
  if (element.querySelector(`:scope > .${OVERLAY_CLASS}`)) return;

  const overlay = document.createElement("div");
  overlay.className = OVERLAY_CLASS;
  overlay.dataset.spcEffectOverlay = "rgbSplit";
  overlay.setAttribute("aria-hidden", "true");

  const source = getVisualSource(element);
  const snapshot = source.cloneNode(true);
  snapshot.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"));
  snapshot.classList.add("spc-rgb-snapshot");

  for (const channel of ["r", "g", "b"]) {
    const layer = document.createElement("div");
    layer.className = `spc-rgb-layer spc-rgb-${channel}`;
    layer.appendChild(snapshot.cloneNode(true));
    overlay.appendChild(layer);
  }

  element.appendChild(overlay);
}

function remove(element) {
  element.querySelectorAll(`:scope > .${OVERLAY_CLASS}`).forEach(node => node.remove());
  cleanupHostIfEmpty(element);
}

export const rgbSplitEffect = {
  start(context) {
    for (const messageId of context.messageIds) {
      for (const element of findChatMessageElements(messageId)) apply(element);
    }
  },
  stop(context) {
    for (const messageId of context.messageIds) {
      for (const element of findChatMessageElements(messageId)) remove(element);
    }
  },
  applyToElement: apply
};
