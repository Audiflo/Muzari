# Bugs

- [ ] Lessen delays while reordering

- [ ] Use List Virtualization for song list so that having larger libraries doesn't cause lag on all songs
  - in short, loading only visible songs and not showing rest, but smartly loading the top and bottom (for ex. predictively loading on scrolling)

- [ ] Allow drag and drop to playlist from Home view

- [ ] Fix Help menu
  - [ ] On Home menu, when pressing Help, use different help guide

- [ ] Fix top bar on mobile

- [ ] fix some themes' visibility issues
  - light mode mostly fixed, re-check all

- [ ] some missed text that's supposed to be in i18n
  - Run `npm run i18n:extract` and `npm run i18n:check`
  - [ ] **Priority 1**: User-visible UI text (buttons, labels, user-facing error messages)
  - [ ] **Priority 2**: Status messages and user notifications
    - [ ] Processing status messages ("Processing X/Y songs...")
  - [ ] **Priority 3**: Debug/console logs (maybe leave in English or something)
    - [ ] Success notifications (cache operations, theme applications)
    - [ ] File picker warnings (unsupported formats, skipped files)
