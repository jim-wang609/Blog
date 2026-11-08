/* ============================================================
   启动引导 —— 每个页面 <head> 里、任何内容渲染之前执行

   同步取一次 /api/bootstrap：
     成功 → 把数据交给 remote.js 的 applyBootstrap 渲染
     失败 → 立刻整页跳到 offline.html，后面的脚本根本不会执行

   offline.html 自己不引这个脚本，避免循环跳转。
   ============================================================ */

(function () {
  "use strict";
  var K = window.KIMON || {};
  if (typeof K.probe !== "function") return;   /* config.js 没加载时不做任何猜测 */

  var result = K.probe();
  if (!result || typeof result !== "object") {
    K.goOffline(String(result || "无法连接后端"));
    return;
  }
  K.bootstrap = result;
})();
