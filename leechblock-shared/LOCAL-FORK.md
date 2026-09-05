# Local shared reason-gate fork

Base: LeechBlock NG 1.7.3 by James Anderson, copied from this computer's installed extension on 2026-09-05, excluding Chrome Web Store `_metadata`.

This is an independent local modification, not an official LeechBlock release. Original source notices are retained. LeechBlock source is licensed under the [Mozilla Public License 2.0](https://mozilla.org/MPL/2.0/); bundled third-party libraries retain their own notices. Upstream: https://www.proginosko.com/leechblock/.

Modified files: `background.js`, `blocked.js`, `manifest.json`. New functional file: `shared-session.js`. Configuration UI and permission list are unchanged. The store public key/update URL are removed so loading this directory creates a separate extension rather than replacing the installed original.

Base background.js SHA256:
`9D374ADA58DA78720A2E5F347E15B18D4D38252D2E7864E1398CAF4490AF488F`

Local changes:

- Set-wide grants in `chrome.storage.session`, partitioned by normal/private browsing.
- Shared fixed deadlines across tabs, subdomains and entry routes; restored before checking URLs after worker suspension.
- Cap at schedule group boundaries, preserve the continuous overnight group, respect other block sets and lockdown.
- Resume already-open local gate pages without issuing or extending grants.
- Fresh installs seed the user's two 30/5-minute rule groups. Existing settings are not overwritten.
- Handle gate messages during cold startup and absent opener records safely.
- Version 1.7.3.2: merge reason input and waiting on one page. The local gate button remains visible but disabled for 5 seconds (or the configured longer delay); no numeric countdown or reload transition. Clicking after the deadline validates the reason and invokes the existing shared grant handler. The served `../lb-custom/reason-gate.html` supplies static markup; the extension's content script owns both validation and timing. Existing non-inline blocking pages retain their original countdown behavior.

Grant records remain local and contain only a configuration signature and timestamps, not browsing URLs or reason text. No new network endpoints or permissions were added. Local builds do not automatically receive Chrome Web Store security/feature updates; upstream updates need manual review and reapplication of this patch.

Installation, behavior, limitations and rollback are documented in `../GLOBAL-GATE.md`. Automated tests are in `../scripts/test-shared-session.cjs`.
