import { findChatMessageElements } from "./effect-dom.mjs";

const SHAKE_RANGE = 6;
const SHADOW_RANGE = 3;
const SHAKE_ACTIVE_CLASS = "spc-shake-active";
const RGB_ACTIVE_CLASS = "spc-rgb-text-active";
const RGB_CLONE_ATTR = "data-spc-shake-rgb-clone";

export const shakingEffect = {
  start(context) {
    context.shakeTargets ??= new Map();

    for (const messageId of context.messageIds) {
      for (const element of findChatMessageElements(messageId)) {
        apply(element, context);
      }
    }

    startAnimation(context);
  },

  stop(context) {
    stopAnimation(context);

    for (const target of context.shakeTargets?.values?.() ?? []) {
      restoreTarget(target);
    }

    context.shakeTargets?.clear?.();
  },

  applyToElement(element, context) {
    apply(element, context);
  }
};

function getContentElement(element) {
  if (!(element instanceof HTMLElement)) return null;

  return element.querySelector(`.message-content:not([${RGB_CLONE_ATTR}])`)
    ?? element.querySelector(`.message-content-wrapper:not([${RGB_CLONE_ATTR}])`)
    ?? null;
}

function apply(element, context) {
  const content = getContentElement(element);
  if (!(content instanceof HTMLElement)) return;

  context.shakeTargets ??= new Map();

  // 같은 실제 채팅 DOM은 한 번만 등록한다.
  if (context.shakeTargets.has(content)) return;

  const target = {
    element: content,
    originalTransform: content.style.transform,
    originalWillChange: content.style.willChange,
    rgbClones: []
  };

  context.shakeTargets.set(content, target);

  // transform은 레이아웃 공간을 밀지 않는다.
  content.classList.add(SHAKE_ACTIVE_CLASS);
  content.style.willChange = "transform";

  syncRgbShadowClones(target);

  // 검열에서 실제 전송자 이름이 수정된 메시지만 헤더 이름에도 같은 Shake를 적용한다.
  const messageId = element.dataset.messageId;
  const senderTransition = context.messageTransitions?.[messageId];
  const sender = senderTransition?.senderNameModified
    ? element.querySelector(".message-sender")
    : null;
  if (sender instanceof HTMLElement && !context.shakeTargets.has(sender)) {
    const senderTarget = {
      element: sender,
      originalTransform: sender.style.transform,
      originalWillChange: sender.style.willChange,
      rgbClones: []
    };
    context.shakeTargets.set(sender, senderTarget);
    sender.classList.add(SHAKE_ACTIVE_CLASS);
    sender.style.willChange = "transform";
    syncRgbShadowClones(senderTarget);
  }
}

function startAnimation(context) {
  stopAnimation(context);

  const tick = () => {
    for (const [element, target] of context.shakeTargets?.entries?.() ?? []) {
      // Foundry 재렌더링으로 제거된 요소는 정리하고 등록 해제한다.
      if (!element.isConnected) {
        restoreTarget(target);
        context.shakeTargets.delete(element);
        continue;
      }

      // RGB가 뒤늦게 켜지거나 먼저 꺼져도 매 프레임 현재 상태에 맞춘다.
      syncRgbShadowClones(target);

      const x = randomOffset(SHAKE_RANGE);
      const y = randomOffset(SHAKE_RANGE);
      const baseTransform = target.originalTransform?.trim();
      const shakeTransform = `translate(${x}px, ${y}px)`;

      element.style.transform = baseTransform
        ? `${baseTransform} ${shakeTransform}`
        : shakeTransform;

      // RGB 잔상 레이어는 원본 Shake를 따라가면서 서로 다른 상대 흔들림을 가진다.
      for (const clone of target.rgbClones) {
        const shadowX = randomOffset(SHADOW_RANGE);
        const shadowY = randomOffset(SHADOW_RANGE);
        clone.style.transform = `translate(${shadowX}px, ${shadowY}px)`;
      }
    }

    context.shakeAnimationId = requestAnimationFrame(tick);
  };

  context.shakeAnimationId = requestAnimationFrame(tick);
}

function randomOffset(range) {
  return (Math.random() - 0.5) * range;
}

function syncRgbShadowClones(target) {
  const content = target?.element;
  if (!(content instanceof HTMLElement)) return;

  const rgbIsActive = content.classList.contains(RGB_ACTIVE_CLASS);

  if (!rgbIsActive) {
    removeRgbShadowClones(target);
    return;
  }

  if (target.rgbClones.length !== 2) {
    removeRgbShadowClones(target);
    target.rgbClones = [
      createRgbShadowClone(content, "red"),
      createRgbShadowClone(content, "cyan")
    ];
  }

  // Binary처럼 내부 DOM이 실시간으로 바뀌는 효과와 함께 써도
  // 오래된 문자열을 clone 안에 굳혀두지 않도록 현재 내용을 계속 복사한다.
  for (const clone of target.rgbClones) {
    syncCloneContents(content, clone);
  }
}

function createRgbShadowClone(content, channel) {
  const clone = content.cloneNode(false);

  clone.removeAttribute("id");
  clone.setAttribute(RGB_CLONE_ATTR, channel);
  clone.setAttribute("aria-hidden", "true");
  clone.classList.add("spc-shake-rgb-clone");
  clone.classList.remove(SHAKE_ACTIVE_CLASS, RGB_ACTIVE_CLASS);

  // clone 자체는 실제 레이아웃에 참여하지 않는다.
  content.appendChild(clone);
  return clone;
}

function syncCloneContents(source, clone) {
  const copiedNodes = [];

  for (const node of source.childNodes) {
    if (
      node instanceof HTMLElement
      && node.hasAttribute(RGB_CLONE_ATTR)
    ) {
      continue;
    }

    copiedNodes.push(node.cloneNode(true));
  }

  clone.replaceChildren(...copiedNodes);
}

function removeRgbShadowClones(target) {
  for (const clone of target?.rgbClones ?? []) {
    clone.remove();
  }

  if (target) target.rgbClones = [];
}

function stopAnimation(context) {
  if (!context.shakeAnimationId) return;

  cancelAnimationFrame(context.shakeAnimationId);
  context.shakeAnimationId = null;
}

function restoreTarget(target) {
  if (!(target?.element instanceof HTMLElement)) return;

  removeRgbShadowClones(target);
  target.element.classList.remove(SHAKE_ACTIVE_CLASS);
  target.element.style.transform = target.originalTransform;
  target.element.style.willChange = target.originalWillChange;
}
