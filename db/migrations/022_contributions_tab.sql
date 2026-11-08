-- Government contributions get their own tab (/contributions) instead of a dashboard section and a Reports sub-page.
-- Staff who could see contributions through the Reports tab keep that access: they are given the new tab once here.
-- After this, tabs stay manually selected per person (no presets). Owners always have every tab.
alter table users drop constraint users_tabs_check;
alter table users add constraint users_tabs_check check(tabs <@ array['dashboard','week','employees','payroll','catalog','reports','contributions','settings','team','audit','mypay','profile','payslips','requests']);
update users set tabs=array_append(tabs,'contributions')
 where access_kind='office' and 'reports'=any(tabs) and not 'contributions'=any(tabs);
