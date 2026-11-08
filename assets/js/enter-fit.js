/* ============================================================
   站主入口：整页恰好一屏，永远不出现滚动条

   视口装不下内容时，把 .door-grid 整块等比缩小（以中心为原点），
   而不是裁掉底部或让页面滚动。视图切换、登录提示文字变化、
   窗口 / 移动端地址栏变化、字体加载完成都会重新量一次。
   ============================================================ */

(function () {
  "use strict";

  var door = document.querySelector(".enter-page .door");
  var grid = document.querySelector(".door-grid");
  if (!door || !grid) return;

  var card = document.querySelector(".door-card");
  var pending = false;

  function fit() {
    pending = false;
    /* 先还原再量，拿到的始终是未经缩放的原始尺寸 */
    grid.style.transform = "none";

    var cs = getComputedStyle(door);
    var padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    var padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    var availH = door.clientHeight - padY;
    var availW = door.clientWidth - padX;
    var h = grid.offsetHeight;
    var w = grid.offsetWidth;
    if (!h || !w || availH <= 0 || availW <= 0) return;

    var k = Math.min(1, availH / h, availW / w);
    /* 留一点余量，规避亚像素四舍五入冒出 1px；极小窗口不至于缩到看不清 */
    k = Math.max(0.45, k < 1 ? k - 0.002 : 1);

    /* 布局从内容区顶部开始，把它精确移到内容区中心，再以自身中心等比缩放。
       translate 写在 scale 外面，位移不受缩放倍数影响。 */
    var shift = (availH - h) / 2;
    grid.style.transform = "translateY(" + shift.toFixed(1) + "px) scale(" + k.toFixed(4) + ")";
  }

  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(fit);
  }

  window.addEventListener("resize", schedule);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", schedule);
  window.addEventListener("load", schedule);
  document.addEventListener("kimon:auth", schedule);

  if (window.ResizeObserver) {
    var ro = new ResizeObserver(schedule);
    ro.observe(grid);
    if (card) ro.observe(card);
  }

  if (window.MutationObserver && card) {
    /* 视图 hidden 切换、提示语变化都会改变卡片高度 */
    new MutationObserver(schedule).observe(card, {
      attributes: true, attributeFilter: ["hidden"],
      childList: true, subtree: true, characterData: true
    });
  }

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);

  schedule();
})();
