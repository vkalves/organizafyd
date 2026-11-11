# Stories with Link extension v0.8.1

The original uploaded v0.7.0 package used Instagram session cookies, browser-wide
persistent declarativeNetRequest rules and private mobile publishing endpoints.
Those mechanisms are removed entirely, rather than adjusted to impersonate a
client or conceal automated activity. Source is now version controlled in
`extensions/storys-com-link/`; the public download contains only those files.

## Behavior

Clicking the toolbar action opens an extension-local editor. It processes a
user-selected image in memory, exports JPEG 1080×1920, and copies a validated
HTTP(S) link or an optional label on explicit user action. The link marker is a
DOM preview overlay, never baked into the exported JPEG or described as clickable.
The user adds the native Link sticker and confirms publication in Instagram.
There is no account connection, publishing bridge, upload, cookie access, injected
script, host permission, request modification, scheduling or Highlights creation.
The extension CSP blocks outbound connections. No credentials or preparation data
are stored. Clipboard failures and invalid/oversized/undecodable images are shown
without claiming success.

Meta's content publishing documentation/reference was consulted on 2026-11-09:
https://developers.facebook.com/docs/instagram-platform/content-publishing/
https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/
Direct requests were rate limited (HTTP 429). No current official supported Link
sticker publishing API was confirmed; this release therefore does not claim an
API substitute for native sticker creation. Publishing ordinary Stories through
Avança's existing official integration remains a separate feature.

## Upgrade matters

An uploaded ZIP cannot remotely update an unpacked installed extension. Remove
v0.7.0 and older from every browser/profile first, close all browser windows and
restart. Removal clears the old extension's active network rules; restarting also
unloads previously injected tab scripts. Install v0.8.1 from a new permanent
folder only after removing old copies. Installing both versions keeps the old
extension operational. The website and bundled instructions make this explicit.
This change does not recover restricted accounts or guarantee against Meta flags.

## Rebuild and checks

```
python scripts/package-story-link-extension.py
python scripts/package-story-link-extension.py --check
node scripts/test-story-link-extension.mjs
```

The ZIP uses fixed metadata, sorted explicit contents and no untracked files.
Run the package check before publishing; a different source/package fails it.
A browser check should load the unpacked extension, assert zero network access,
export a user image, verify JPEG dimensions and pixel independence from the link
preview, check unsafe link rejection and clipboard error states, and open the
editor through the toolbar action without any Instagram login.

Validation in this managed environment: 258 application tests, production build,
source/package contract checks and 360/1280px site download checks passed. Browser
checks on the unchanged editor served over localhost with its manifest CSP passed:
invalid/corrupt image and unsafe URL rejection, clipboard success/failure, JPEG
export dimensions, separation of link preview from exported pixels, responsive
layout and no outbound requests. Unpacked MV3 installation was attempted with both
system Chromium 156 and Playwright Chromium 141, but enterprise policy reported
"Loading of unpacked extensions is disabled by the administrator." Consequently,
actual browser extension installation/toolbar activation could not be verified
here; the background action is covered by the isolated Node test. No browser
policy was changed or bypassed.
