'use strict';
/** Applied only by the localhost unified server, before the team's cart scripts. */
window.COFFEE_UNIFIED_PREVIEW=true;
window.COFFEE_CART_CONFIG={...(window.COFFEE_CART_CONFIG||{}),API_BASE:window.location.origin,USE_API:true,SEED_DEMO_CART:false,HIDE_PROTOTYPE_ADD_BOX:true,HIDE_DEMO_DISCOUNTS:true};
