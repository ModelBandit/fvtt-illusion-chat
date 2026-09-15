import { findChatMessageElements } from "./effect-dom.mjs";

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

function apply(element, context) {
  context.shakeTargets ??= new Map();

  for (const effectTarget of context.getEffectTargets(element)) {
    const targetElement = effectTarget.element;
    if (context.shakeTargets.has(targetElement)) continue;

    const target = {
      element: targetElement,
      kind: effectTarget.kind,
      originalTransform: targetElement.style.transform,
      originalWillChange: targetElement.style.willChange,
      rgbClones: []
    };

    context.shakeTargets.set(targetElement, target);
    targetElement.classList.add(SHAKE_ACTIVE_CLASS);
    targetElement.style.willChange = "transform";
    syncRgbShadowClones(target);
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

      const x = randomOffset(context.tuning.shakeRange);
      const y = randomOffset(context.tuning.shakeRange);
      const baseTransform = target.originalTransform?.trim();
      const shakeTransform = `translate(${x}px, ${y}px)`;

      element.style.transform = baseTransform
        ? `${baseTransform} ${shakeTransform}`
        : shakeTransform;

      // RGB 잔상 레이어는 원본 Shake를 따라가면서 서로 다른 상대 흔들림을 가진다.
      for (const clone of target.rgbClones) {
        const shadowX = randomOffset(context.tuning.shakeShadowRange);
        const shadowY = randomOffset(context.tuning.shakeShadowRange);
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

  // Binary rewrites sender.textContent while it animates. That operation removes
  // child shadow clones from the sender DOM, so recreate detached clones instead
  // of trusting only the cached array length.
  const clonesDetached = target.rgbClones.some(clone => clone.parentElement !== content);
  if (target.rgbClones.length !== 2 || clonesDetached) {
    removeRgbShadowClones(target);
    target.rgbClones = [
      createRgbShadowClone(target, "red"),
      createRgbShadowClone(target, "cyan")
    ];
  }

  // Binary처럼 내부 DOM이 실시간으로 바뀌는 효과와 함께 써도
  // 오래된 문자열을 clone 안에 굳혀두지 않도록 현재 내용을 계속 복사한다.
  for (const clone of target.rgbClones) {
    syncCloneContents(content, clone);
  }
}

function createRgbShadowClone(target, channel) {
  const content = target.element;
  const clone = target.kind === "sender"
    ? document.createElement("span")
    : content.cloneNode(false);

  clone.removeAttribute("id");
  clone.setAttribute(RGB_CLONE_ATTR, channel);
  clone.setAttribute("aria-hidden", "true");
  clone.classList.add("spc-shake-rgb-clone", `spc-shake-rgb-clone-${target.kind}`);
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
