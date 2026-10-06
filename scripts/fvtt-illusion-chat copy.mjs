
const MODULE_ROOT = "modules/fvtt-illusion-1-chat";

Hooks.once("init", async () => {
  let sharedData = globalThis.fvttIllusion.sharedData;
  const moduleInfo = await globalThis.fvttIllusion.loadFile(MODULE_ROOT, "module", "json");
  for(const key of Object.keys(moduleInfo))
  {
    sharedData.moduleInfo.chat[key] = moduleInfo[key];
  }


  console.log(sharedData.moduleInfo.chat);

  game.settings.register(sharedData.moduleInfo.chat.id, "key", {
    name: "asd",
    hint: "FVTTILLUSION.CHAT.settings.durationHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
});