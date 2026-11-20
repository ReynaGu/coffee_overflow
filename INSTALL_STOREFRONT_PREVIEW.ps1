# Coffee Overflow - local storefront bridge installer (feature-branch only)
# Only patches products.html and assets/js/cart.js. Does not touch backend, .env, or MySQL.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSCommandPath
$cartPath = Join-Path $repo 'assets\js\cart.js'
$productsPath = Join-Path $repo 'products.html'
$bridgePath = Join-Path $repo 'assets\js\storefront-products.js'
$gitHead = Join-Path $repo '.git\HEAD'
if (-not (Test-Path -LiteralPath $gitHead)) { throw 'Not a cloned GitHub repository root: .git\HEAD missing.' }
$head = [IO.File]::ReadAllText($gitHead).Trim()
if ($head -ne 'ref: refs/heads/feature/hudson-admin-order-management') {
  throw "Wrong branch. Switch GitHub Desktop to feature/hudson-admin-order-management first. Current HEAD: $head"
}
foreach ($p in @($cartPath,$productsPath,$bridgePath)) {
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing file: $p. Copy the patch files to the repository root first." }
}
$cart = [IO.File]::ReadAllText($cartPath)
$products = [IO.File]::ReadAllText($productsPath)
$scriptTag = '<script src="./assets/js/cart.js"></script>'
$bridgeTag = '<script src="./assets/js/storefront-products.js"></script>'
if ($products.Contains($bridgeTag) -or $cart.Contains('COFFEE_OVERFLOW_STORE_BRIDGE_V1')) {
  throw 'Storefront bridge already installed in this working copy. No files changed.'
}
foreach ($needle in @('USE_API: false,','SEED_DEMO_CART: true,',
  'catalog = (await res.json()).map(fromApiRow);',
  '  function fromApiRow(row) {','  async function loadCatalog() {')) {
  if (-not $cart.Contains($needle)) { throw "Cart file differs from the reviewed version. Could not find: $needle. No files changed." }
}
if (-not $products.Contains($scriptTag)) { throw 'Expected cart.js script tag missing from products.html. No files changed.' }
if ($products.IndexOf($scriptTag) -ne $products.LastIndexOf($scriptTag)) {
  throw 'Found an unexpected number of cart.js script tags. No files changed.'
}
$start = $cart.IndexOf('  function fromApiRow(row) {', [StringComparison]::Ordinal)
$end = $cart.IndexOf('  async function loadCatalog() {', $start, [StringComparison]::Ordinal)
if ($start -lt 0 -or $end -le $start) { throw 'Unexpected cart source boundaries. No files changed.' }
$newMapping = @'
  // COFFEE_OVERFLOW_STORE_BRIDGE_V1: match the local MySQL view's integer-cent fields.
  function fromApiRow(row) {
    const f = FIELD_MAP;
    const regular = Number(row.price_cents);
    const sale = row.sale_price_cents == null ? null : Number(row.sale_price_cents);
    const image = String(row.image || '');
    return {
      id: String(row[f.id]),
      name: String(row.name || 'Unnamed product'),
      image: image.startsWith('/assets/') ? '.' + image : (image.startsWith('https://') ? image : NO_IMAGE),
      price: Number.isSafeInteger(regular) && regular > 0 ? regular : 0,
      salePrice: Number.isSafeInteger(sale) && sale > 0 && sale < regular ? sale : null,
      stock: Math.max(0, Number(row.stock) || 0)
    };
  }

'@
$newCart = $cart.Substring(0,$start) + $newMapping + $cart.Substring($end)
$newCart = $newCart.Replace('USE_API: false,','USE_API: true,')
$newCart = $newCart.Replace('SEED_DEMO_CART: true,','SEED_DEMO_CART: false,')
$newCart = $newCart.Replace('catalog = (await res.json()).map(fromApiRow);',
  'catalog = (await res.json()).filter(row => Number(row.active) !== 0).map(fromApiRow);')
$newProducts = $products.Replace($scriptTag, $scriptTag + "`r`n  " + $bridgeTag)
# Save original teammate files OUTSIDE GitHub's working tree to avoid accidental commits.
$backup = Join-Path $env:TEMP ('coffee_overflow_storefront_backup_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
Copy-Item -LiteralPath $cartPath -Destination (Join-Path $backup 'cart.js.original')
Copy-Item -LiteralPath $productsPath -Destination (Join-Path $backup 'products.html.original')
$utf8 = [System.Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($cartPath,$newCart,$utf8)
[IO.File]::WriteAllText($productsPath,$newProducts,$utf8)
Write-Host 'SUCCESS: Added the MySQL storefront bridge to your feature branch.' -ForegroundColor Green
Write-Host 'Modified: products.html and assets/js/cart.js'
Write-Host 'Backups saved OUTSIDE the repository:' $backup
Write-Host 'No backend code, .env, MySQL data, or main branch was changed.'
Write-Host 'Open http://localhost:5174/products.html with the Express backend running on port 3000.'
