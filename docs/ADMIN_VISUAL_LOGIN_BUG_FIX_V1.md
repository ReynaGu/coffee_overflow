# Coffee Overflow — Admin visual sign-in fix V1

Fixes `Sign-in failed: can't access property "reset", event.currentTarget is null` in Firefox.

## Cause
`event.currentTarget` is valid during the synchronous submit-handler dispatch, but is reset to `null` by the time the asynchronous login `await` resolves. The login HTTP request may have succeeded already.

## Fix
The handler now captures the form element before its first `await` and uses the saved element to reset the form afterward.

## Install (feature/hudson-checkout-integration ONLY)
1. Extract ZIP. Stop if anything other than `admin/integration-admin.js` is offered for replacement.
2. Copy the included `admin/integration-admin.js` to the `admin/` folder in your Coffee Overflow checkout and replace that exact file.
3. From repository root: `node --check admin/integration-admin.js`.
4. Keep the local admin visual server running on port 5178. Reload the admin page with Ctrl+Shift+R and sign in again with the synthetic admin account and test password. If login previously succeeded, this new sign-in sets the fresh CSRF token needed for writes.
5. Confirm dashboard shows the test order. Do not clean up yet; inspect and test status changes first.

This is a frontend-only fix. It does not change any Express route, MySQL records, credentials, `.env`, teammates’ code, or GitHub main. Do not commit until the visual flow has been tested.
