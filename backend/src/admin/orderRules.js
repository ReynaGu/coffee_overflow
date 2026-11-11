'use strict';
// Pure order rules: shared by HTTP handlers and automated tests.
const transitions = Object.freeze({
  placed: ['processing', 'cancelled'],
  processing: ['fulfilled', 'cancelled'],
  fulfilled: [],
  cancelled: []
});
function transitionResult(from, to) {
  if (!Object.prototype.hasOwnProperty.call(transitions, from)) return {allowed:false, code:'INVALID_CURRENT_STATUS'};
  if (!Object.prototype.hasOwnProperty.call(transitions, to)) return {allowed:false, code:'INVALID_NEXT_STATUS'};
  if (from === to) return {allowed:true, changed:false, restoreInventory:false};
  if (!transitions[from].includes(to)) return {allowed:false, code:'INVALID_TRANSITION'};
  return {allowed:true, changed:true, restoreInventory:to==='cancelled'};
}
function toMoney(cents) { return `$${(Number(cents)/100).toFixed(2)}`; }
module.exports = { transitions, transitionResult, toMoney };
