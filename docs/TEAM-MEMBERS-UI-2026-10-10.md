# Team members page redesign

`/team` follows the supplied Team Members design (sidebar navigation excluded): filter tabs with counts (All / Staff / Employees / Inactive), search, member rows (role, access bar, last sign-in, status) and a right-hand drawer (native `<dialog>`) for editing or adding members.

- UI only. All writes still go through the existing owner-only server actions (`addUser`, `updateUser`, `setUserActive`, `createCrew`, `updateCrew`); no schema, RLS or permission changes. Staff with the Team tab still see only their own row, read-only.
- Staff tab tiles exclude `requests` (owner-only in `hasTab()`, so it never granted staff access). Saving a staff account drops a stored `requests` value — no effect on access.
- Temporary passwords can be generated in the browser (16 chars, `crypto.getRandomValues`) and are shown in plain text so the admin can share them; the server still enforces the 12-character minimum.
- `team/crew-forms.tsx` removed (replaced by `team/team-board.tsx`); old `member-*` / `access-*` card CSS removed.
- Follow-up fix: the filter tab row showed a vertical scrollbar (1px overflow from a negative margin); it now hides overflow vertically and its scrollbar.

Validation: typecheck, lint and production build pass. Browser checks ran against a disposable database with synthetic accounts (edit tabs, create staff and employee logins, activation code display, reactivate, filters/search, staff read-only view, 375px width). Test database and credentials deleted afterwards.

Deployed to the office PC (http://localhost:3005). Backups with restore checks: `backups/before-team-ui-20261010-202517/`, `backups/before-team-tabs-fix-20261010-203108/`. Rollback (keeps live data):
```bash
docker tag motonorte-office-app:before-team-ui-20261010 motonorte-office-app:latest
docker compose --profile prod up -d app
```

Hand-off:
- [x] Implemented, checked and deployed
- [x] Live data unchanged by deploy (only sign-in rows changed)
- [ ] Team page checked by the Owner on the office network once the PC is back on 192.168.50.241
