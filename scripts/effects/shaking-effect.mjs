import {
    findChatMessageElements,
    ensureHost,
    cleanupHostIfEmpty
} from "./effect-dom.mjs";
// 상위 스크립트에서 사용하는 변수

// 객체 생성
export const shakingEffect = {
    start(context){
        context.clones ??= [];
        context.cloneCount = 3;
        
        for (const messageId of context.messageIds){
            for (const element of findChatMessageElements(messageId)){
                apply(element, context);
            }
        }

        context.animationId = requestAnimationFrame((time) => animate(context, time));

    },

    stop(context){
        cancelAnimationFrame(context.animationId);

        for (const clone of context.clones) {
            if(clone.isOriginal == true)
                continue;
            clone.element.remove();
        }

        context.clones = [];
    },

    applyToElement(element, context){
        apply(element, context)
    }
}

function animate(context){
    for (const clone of context.clones) {
        const x = (Math.random() - 0.5) * 6;
        const y = (Math.random() - 0.5) * 6;

        clone.element.style.transform =
            `translate(${x}px, ${y}px)`;
    }

    context.animationId = requestAnimationFrame((time) => animate(context, time));
}

function apply(element, context) {
    if (!ensureHost(element))
        return;

    if(element.querySelector(":scope > .spc-shake-clone"))
        return;

    const content = element.querySelector(".message-content");
    if (!content)
        return;

    content.style.position = "relative";


    context.clones ??= [];
    context.clones.push({
        element: content,
        index: 0,
        isOriginal: true
    });

    for(let i = 0; i < context.cloneCount; ++i){
        const clone = content.cloneNode(true);
        
        clone.classList.add("spc-shake-clone");

        content.appendChild(clone);

        context.clones.push({
            element: clone,
        index: context.clones.length
        });
    }
}