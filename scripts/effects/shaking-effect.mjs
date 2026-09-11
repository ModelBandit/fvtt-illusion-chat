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
        context.cloneCount = 2;
        
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
            if(clone.isOriginal === true){
                clone.element.style.transform = clone.originalTransform;
            }
            else{
                clone.element.remove();
            }
        }

        context.clones = [];
    },

    applyToElement(element, context){
        apply(element, context)
    }
}

function animate(context){
    for (const clone of context.clones) {
        const x = (Math.random()-0.5) * 6;
        const y =  (Math.random()-0.5) * 6;

        clone.element.style.transform =
            `translate(${x}px, ${y}px)`;
    }

    context.animationId = requestAnimationFrame((time) => animate(context, time));
}

function apply(element, context) {
    if (!ensureHost(element))
        return;
    
    if (element.querySelector(".spc-shake-clone"))
        return;

    const content = element.querySelector(".message-content");
    if (!content)
        return;

    content.style.position = "relative";

    context.clones ??= [];
    context.clones.push({
        element: content,
        index: 0,
        isOriginal: true,
        originalTransform: content.style.transform
    });

    for(let i = 0; i < context.cloneCount; ++i){

        const clone = content.cloneNode(true);

        clone.style.transform = content.style.transform;
        
        clone.style.position = "absolute";
        clone.style.inset = "0";

        clone.classList.add("spc-shake-clone");
        content.appendChild(clone);

        context.clones.push({
            element: clone,
            index: context.clones.length,
            isOriginal: false
        });
    }
}