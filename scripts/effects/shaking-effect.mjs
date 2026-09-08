import {
    findChatMessageElements,
    ensureHost
} from "./effect-dom.mjs";
// 상위 스크립트에서 사용하는 변수

// 객체 생성
export const shakingEffect = {
    start(context){
        context.targets ??= [];
        
        for (const messageId of context.messageIds){
            for (const element of findChatMessageElements(messageId)){
                apply(element, context);
            }
        }

        context.animationId = requestAnimationFrame((time) => animate(context, time));

    },

    stop(context){
        cancelAnimationFrame(context.animationId);

        for (const target of context.targets) {
            target.element.style.transform = target.originalTransform;
        }

        context.targets = [];
    },

    applyToElement(element, context){
        apply(element, context)
    }
}

function animate(context){
    for (const target of context.targets) {
        const x = (Math.random() - 0.5) * 6;
        const y = (Math.random() - 0.5) * 6;

        target.element.style.transform =
            `translate(${x}px, ${y}px)`;
    }

    context.animationId = requestAnimationFrame((time) => animate(context, time));
}

function apply(element, context) {
    if(element.querySelector(":scope > .spc-shake-clone"))
        return;

    const content = element.querySelector(".message-content");
    if (!content)
        return;

    context.targets ??= [];

    if (context.targets.some(target => target.element === content))
        return;

    context.targets.push({
        element: content,
        originalTransform: content.style.transform
    });
}