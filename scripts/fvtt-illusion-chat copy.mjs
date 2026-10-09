
const MODULE_ROOT = "modules/fvtt-illusion-1-chat";

Hooks.once("fvtt-illusion-core.lateinit", async () => {
  let sharedData = globalThis.fvttIllusion.sharedData;
  const moduleInfo = await globalThis.fvttIllusion.loadFile(MODULE_ROOT, "module", "json");
  globalThis.fvttIllusion.buildObject(sharedData.moduleInfo.chat, moduleInfo);

  const effect = sharedData.langBase.chat.effect;
  const effectKey = Object.keys(effect);
  // console.log(sharedData.moduleInfo.chat);
  for(const key of effectKey)
  {
    game.settings.register(sharedData.moduleInfo.chat.id, key, {
      name: effect[key].name,
      hint: effect[key].hint,
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });
  }

});