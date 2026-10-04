# Checklist for the Chrome Web Store "Featured" badge / Featured バッジ申請チェックリスト

Google gives the Featured badge by hand to extensions that follow its best practices, offer an intuitive experience, respect privacy and have a clear listing. Publishers cannot pay for it. Ask for a review through the One Stop Support form (Chrome Web Store developer support → "My item" → request a Featured review).

## Product (done in v2.0.0)

- [x] Manifest V3, a service worker and no remote code.
- [x] Minimal permissions (`storage` and calendar.google.com only), with no new permission warnings on update.
- [x] Clear purpose, so it works without reading instructions: icons, a hover preview and empty slots that show what to do next.
- [x] Keyboard access: every button is focusable with an aria-label, `Esc` steps back, and there are command shortcuts.
- [x] Dark mode and `prefers-reduced-motion`.
- [x] Localised in English (default) and Japanese through `_locales`.
- [x] Privacy: nothing leaves the device. The policy is in `store/privacy-policy.md`.
- [x] Fails safely: it never makes up a time it cannot read, and it warns about a time-zone mismatch.

## Before you submit (manual)

- [ ] Run the real Google Calendar checks in the README, in English and Japanese Google Calendar.
- [ ] Take 5 screenshots at 1280×800 (see `listing.en.md`) in English, plus a Japanese set for the ja listing.
- [ ] Make the small promo tile (440×280) and the marquee (1400×560).
- [ ] Publish the privacy policy at a public URL (for example GitHub Pages) and add it to the developer dashboard.
- [ ] Fill in the privacy practices tab: no data collected, single purpose = "help schedule meetings from Google Calendar".
- [ ] Add the English listing as the default and Japanese as an extra language.
- [ ] Upload `schedule-assist-2.0.0.zip` (see the README for the zip command).
- [ ] After a few weeks with no issues and some reviews, request the Featured review through One Stop Support.

## Next phase ideas

- ✨ One-tap auto-suggest: fill the 3 slots with free times that fit both people's working hours.
- More languages (es, fr, de, pt-BR, zh-CN, ko). Each one needs a new `messages.json` and templates in `src/templates.js`.
