'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {replaceOnce,patchCart,patchConfig,patchSiteUi,patchLoginHtml}=require('./phase3UiPatches');
test('exact replacement preserves unrelated code',()=>assert.equal(replaceOnce('abc xyz','abc','123','test'),'123 xyz'));
test('rejects missing anchor',()=>assert.throws(()=>replaceOnce('abc','zzz','x','test'),/refused/));
test('rejects repeated anchor',()=>assert.throws(()=>replaceOnce('abc abc','abc','x','test'),/refused/));
test('preview config hides unavailable options without disabling API',()=>{
  const x=patchConfig('window.COFFEE_CART_CONFIG={USE_API:true,SEED_DEMO_CART:false};');
  assert.match(x,/HIDE_PROTOTYPE_ADD_BOX:true/);assert.match(x,/HIDE_DEMO_DISCOUNTS:true/);assert.match(x,/USE_API:true/);
});
test('cart patch retains core checkout code',()=>{
  const source='  function addBoxHtml() {\n    const opts = catalog.map((p) =>\n  let appliedCode = read(CODE_KEY, null); // e.g. "COFFEE10"\n<p class="text-xs text-muted mt-3 mb-0">Tax is calculated after any discount.</p>\nfetch("/api/orders")';
  const patched=patchCart(source);assert.match(patched,/HIDE_PROTOTYPE_ADD_BOX/);assert.match(patched,/HIDE_DEMO_DISCOUNTS/);assert.match(patched,/fetch\("\/api\/orders"\)/);
});
test('cart patch rejects second application',()=>{
  const source='  function addBoxHtml() {\n    const opts = catalog.map((p) =>\n  let appliedCode = read(CODE_KEY, null); // e.g. "COFFEE10"\n<p class="text-xs text-muted mt-3 mb-0">Tax is calculated after any discount.</p>';
  assert.throws(()=>patchCart(patchCart(source)),/refused/);
});
test('banner no longer misstates size of Phase 2 catalog',()=>{
  const s="document.addEventListener('DOMContentLoaded',async()=>{\n    const banner="+'LOCAL INTEGRATION TEST — synthetic accounts, one fixture coffee product, no payments';
  const out=patchSiteUi(s);assert.match(out,/synthetic accounts and catalog/);assert.doesNotMatch(out,/one fixture coffee product/);
});
test('login stylesheet is appended, not replacing old styles',()=>{
  const out=patchLoginHtml('<link rel="stylesheet" href="/unified/login.css">');
  assert.match(out,/login.css/);assert.match(out,/phase3-login.css/);
});
