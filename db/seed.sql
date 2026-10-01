-- seed.sql — FAKE development data only. Never load into production.
-- Users are not seeded (password hashes come from `npm run create-user`).
-- Mirrors fixture defaults so the dev week (Oct 5–11, 2026) reproduces fixture F07.

begin;

insert into employees (id, code, full_name, rest_day, hire_date) values
  ('00000000-0000-0000-0000-00000000a001', 'S001', 'Ana Reyes (sample)',       'sun', '2025-01-01'),
  ('00000000-0000-0000-0000-00000000a002', 'S002', 'Ben Cruz (sample)',        'sun', '2025-01-01'),
  ('00000000-0000-0000-0000-00000000a003', 'T001', 'Carlo Santos (sample)',    'sun', '2025-01-01'),
  ('00000000-0000-0000-0000-00000000a004', 'M001', 'Dan Garcia (sample)',      'sun', '2025-01-01'),
  ('00000000-0000-0000-0000-00000000a005', 'M002', 'Eli Mendoza (sample)',     'sun', '2025-01-01'),
  ('00000000-0000-0000-0000-00000000a006', 'M003', 'Fe Villanueva (sample)',   'sun', '2025-01-01');

insert into employee_private (employee_id, tin, sss_no, philhealth_no, pagibig_no, bank_account_no)
select id, '000-000-000-' || right(code, 3), '00-0000000-' || right(code, 1), '00-000000000-0', '0000-0000-0000', '0000000' || right(code, 3)
from employees;

insert into pay_terms (employee_id, effective_from, position, daily_rate, status)
select id, '2025-01-01', p::position_t, r, 'approved'
from employees join (values ('S001','staff',55000), ('S002','staff',55000), ('T001','technician',75000),
                            ('M001','mechanic',65000), ('M002','mechanic',70000), ('M003','mechanic',60000)) v(c, p, r)
  on v.c = employees.code;

insert into catalog_jobs (id, code, name) values
  ('00000000-0000-0000-0000-00000000b001', 'TBC',   'Throttle Body Cleaning'),
  ('00000000-0000-0000-0000-00000000b002', 'CHAIN', 'Chain Clean & Adjust (sample)'),
  ('00000000-0000-0000-0000-00000000b003', 'CARB',  'Carburetor Cleaning (sample)');

insert into catalog_amounts (job_id, effective_from, amount) values
  ('00000000-0000-0000-0000-00000000b001', '2026-01-01', 15000),
  ('00000000-0000-0000-0000-00000000b002', '2026-01-01', 10000),
  ('00000000-0000-0000-0000-00000000b003', '2026-01-01', 20000);

insert into holidays (date, name, type) values
  ('2026-12-25', 'Christmas Day (sample)', 'regular'),
  ('2026-12-30', 'Rizal Day (sample)',     'regular');

-- Dev week Oct 5–11, 2026: everyone F Mon–Sat, R Sunday
insert into attendance (employee_id, date, status)
select e.id, d::date, case when extract(isodow from d) = 7 then 'R' else 'F' end::day_status_t
from employees e, generate_series('2026-10-05'::date, '2026-10-11'::date, interval '1 day') d;

-- Tuesday pool: 2× TBC + 3× CHAIN = ₱600 → ₱200 per mechanic (fixture F07)
insert into job_log (date, job_id, qty, work_order_ref, plate_no) values
  ('2026-10-06', '00000000-0000-0000-0000-00000000b001', 2, 'WO-0001', 'ABC 1234'),
  ('2026-10-06', '00000000-0000-0000-0000-00000000b002', 3, 'WO-0002', 'XYZ 5678');

commit;
