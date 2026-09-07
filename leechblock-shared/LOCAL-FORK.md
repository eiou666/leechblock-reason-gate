# Local shared reason-gate fork

Base: LeechBlock NG 1.7.3 by James Anderson, excluding Chrome Web Store `_metadata`. Current local fork: **1.7.3.6**.

This is an independent local modification, not an official LeechBlock release. Original source notices are retained. LeechBlock source is licensed under the [Mozilla Public License 2.0](https://mozilla.org/MPL/2.0/); bundled third-party libraries retain their own notices. Upstream: https://www.proginosko.com/leechblock/.

Modified files: `background.js`, `blocked.js`, `content.js`, `ticker.js`, `manifest.json`. New functional files: `shared-session.js` and `reason-gate.html`. Configuration UI and permission list are unchanged. The store public key/update URL are removed so loading this directory creates a separate extension rather than replacing the installed original.

Base background.js SHA256:
`9D374ADA58DA78720A2E5F347E15B18D4D38252D2E7864E1398CAF4490AF488F`

Local changes:

- Set-wide grants in `chrome.storage.session`, partitioned by normal/private browsing.
- Shared fixed deadlines across tabs, subdomains and entry routes; restored before checking URLs after worker suspension.
- Cap at schedule group boundaries, preserve the continuous overnight group, respect other block sets and lockdown.
- Route configured legacy localhost reason gates to the bundled `reason-gate.html`, eliminating the HTTP server dependency. Validate the exact extension page URL when accepting shared grants. Move legacy gate/error tabs to the bundled page on startup without issuing grants; resume already-open gates when a matching grant exists.
- Fresh installs seed the user's two 30/5-minute rule groups. Existing settings are preserved except for the documented one-time countdown display migration.
- Default `showTimer1` and `showTimer2` to false and migrate these switches once in existing local or sync options, only where those sets still use the local reason gate. Persist the patch and its marker together, preserve other values and later explicit display choices, and keep timer/expiry logic unchanged. Global timer defaults retain upstream values.
- Handle gate messages during cold startup and absent opener records safely.
- Merge reason input and waiting on one page. The local gate button remains visible but disabled for 5 seconds (or the configured longer delay); no numeric countdown or reload transition. Clicking or pressing Enter after the deadline validates the reason and invokes the existing shared grant handler. Shift+Enter inserts a newline; IME confirmation and held keys do not submit. The bundled `reason-gate.html` loads `blocked.js` directly; no local server is required. The served `../lb-custom/reason-gate.html` remains only for compatibility. Native non-inline blocking pages retain their original countdown behavior.
- Handle synchronous and asynchronous message failures after extension reloads, retire invalidated content listeners and stale overlays, and keep disconnected reason pages blocked. Await a single offscreen ticker creation before sending options and reuse existing offscreen documents after worker restarts. Transient missing receivers can recover; unexpected failures remain visible as warnings. Reload the extension and refresh already-open pages to replace old scripts. This follows the [Chrome offscreen lifecycle guidance](https://developer.chrome.com/docs/extensions/reference/api/offscreen#maintain_the_lifecycle_of_an_offscreen_document).

Grant records remain local and contain only a configuration signature and timestamps, not browsing URLs or reason text. No new network endpoints or permissions were added. Local builds do not automatically receive Chrome Web Store security/feature updates; upstream updates need manual review and reapplication of this patch.

Installation, behavior, limitations and rollback are documented in `../GLOBAL-GATE.md`. Automated tests are in `../scripts/test-shared-session.cjs`.
