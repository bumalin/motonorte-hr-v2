-- Dedicated team screen; existing user tab selections stay unchanged.
alter table users drop constraint users_tabs_check;
alter table users add constraint users_tabs_check check(tabs <@ array['dashboard','week','employees','payroll','catalog','reports','settings','team','audit']);
