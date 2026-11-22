'use strict';
/** Adds ONLY unprivileged static admin UI routes to the existing loopback app.
 * The order APIs already use sessionGuards.requireAdmin in localIntegratedApp.
 * Serving a login page is not a grant of administrator privileges.
 */
const path = require('node:path');
const {createLocalIntegratedApp} = require('./localIntegratedApp');
const ROOT = path.resolve(__dirname, '../../..');
function createLocalAdminVisualApp({pool,origin}) {
  const app = createLocalIntegratedApp({pool,origin});
  app.get('/integration/admin/',(_req,res)=>res.sendFile(path.join(ROOT,'admin/integration-admin.html')));
  app.get('/integration/admin/ui.js',(_req,res)=>res.type('js').sendFile(path.join(ROOT,'admin/integration-admin.js')));
  app.get('/integration/admin/ui.css',(_req,res)=>res.type('css').sendFile(path.join(ROOT,'admin/integration-admin.css')));
  return app;
}
module.exports={createLocalAdminVisualApp};
