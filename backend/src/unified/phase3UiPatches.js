'use strict';
/** Exact, reversible Phase 3 UI-only patches. No database or API changes. */
function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0 || text.indexOf(before, first + before.length) !== -1) {
    throw Error(`Phase 3 refused: ${label} source anchor missing or repeated`);
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}
function patchCart(source) {
  let s = replaceOnce(source,
    '  function addBoxHtml() {\n    const opts = catalog.map((p) =>',
    "  function addBoxHtml() {\n    if (CONFIG.HIDE_PROTOTYPE_ADD_BOX) return '';\n    const opts = catalog.map((p) =>",
    'prototype cart control');
  s = replaceOnce(s,
    '  let appliedCode = read(CODE_KEY, null); // e.g. "COFFEE10"',
    '  let appliedCode = CONFIG.HIDE_DEMO_DISCOUNTS ? null : read(CODE_KEY, null); // Demo discounts are never accepted by unified checkout',
    'saved demo discount');
  s = replaceOnce(s,
    '<p class="text-xs text-muted mt-3 mb-0">Tax is calculated after any discount.</p>',
    '<p class="text-xs text-muted mt-3 mb-0">${CONFIG.HIDE_DEMO_DISCOUNTS ? "Final prices and tax are verified by the server at checkout." : "Tax is calculated after any discount."}</p>',
    'cart tax note');
  return s;
}
function patchConfig(source) {
  return replaceOnce(source,
    'USE_API:true,SEED_DEMO_CART:false};',
    'USE_API:true,SEED_DEMO_CART:false,HIDE_PROTOTYPE_ADD_BOX:true,HIDE_DEMO_DISCOUNTS:true};',
    'local preview configuration');
}
function patchSiteUi(source) {
  let s=replaceOnce(source,
    "document.addEventListener('DOMContentLoaded',async()=>{\n    const banner=",
    "document.addEventListener('DOMContentLoaded',async()=>{\n    document.head.appendChild(tag('link',{rel:'stylesheet',href:'/unified/phase3-polish.css'}));\n    if(document.getElementById('cart-root')){\n      const intro=document.querySelector('main section .lead');\n      if(intro && intro.textContent.includes('apply a discount code')) intro.textContent='Review your items and place a test order. No real payment is collected.';\n    }\n    const banner=",
    'unified site initialization');
  s=replaceOnce(s,
    'LOCAL INTEGRATION TEST — synthetic accounts, one fixture coffee product, no payments',
    'LOCAL INTEGRATION TEST — synthetic accounts and catalog; no real payments',
    'test-environment banner');
  return s;
}
function patchLoginHtml(source) {
  return replaceOnce(source,
    '<link rel="stylesheet" href="/unified/login.css">',
    '<link rel="stylesheet" href="/unified/login.css">\n<link rel="stylesheet" href="/unified/phase3-login.css">',
    'login stylesheet');
}
module.exports={replaceOnce,patchCart,patchConfig,patchSiteUi,patchLoginHtml};
