# Hudson — Coffee Overflow / MySQL Storefront Preview

**This package targets the GitHub branch `feature/hudson-admin-order-management` after the merge of `main` at commit `c9f7207e`.** It DOES NOT include or overwrite teammates' original frontend or cart files. A narrowly scoped installer edits two existing files **inside your feature branch only**.

## Quick install

1. Open GitHub Desktop and confirm **Current Branch = feature/hudson-admin-order-management** with **No local changes**.
2. Unzip this package; copy all contents to the **root of your cloned `coffee_overflow` folder**. New files only; do not overwrite other files.
3. In File Explorer open your cloned `coffee_overflow` folder, click the address bar, type `cmd`, press Enter.
4. Run:

   ```cmd
   powershell -NoProfile -ExecutionPolicy Bypass -File ".\INSTALL_STOREFRONT_PREVIEW.ps1"
   ```

5. You should see a green **SUCCESS** message. The script refuses to run on the `main` or backup branch or when the expected original files are different.

## Launch

- Start MySQL80 service (you've already configured it).
- Start team Express backend by opening Command Prompt in `backend` and running `npm start` (port 3000).
- Launch the admin preview with `START_ADMIN_PREVIEW_WINDOWS.bat` or `set ADMIN_PREVIEW_PORT=5174` and `node admin\preview-server.js`.
- Open the storefront at **http://localhost:5174/products.html** (or port 5173 if that's your admin preview port).
- For the cart use **http://localhost:5174/cart.html**.

**The full checkout is still demo-only and writes orders to browser localStorage, NOT MySQL.** Don't report it as completed order integration.

## Test and commit

- Check that Sunrise House Blend appears with your actual MySQL stock and pricing.
- The Roaster Reserve Blend you previously marked **Visible: No** will correctly not appear until you turn visibility back on in the admin dashboard.
- Test searching, sorting, sale filtering, Add to Cart, and cart totals.
- Run `node --test assets/js/storefront-products.test.js` in the repository root.
- Check GitHub Desktop for **two modified teammate files**: `products.html` and `assets/js/cart.js`, plus new files from this package. Review with Hannah and Jalen before merging into `main`.
- **Do not commit if `.env`, `node_modules`, or unintended original files appear.**

Detailed technical notes: `docs/LOCAL_STOREFRONT_INTEGRATION_V1.md`.
