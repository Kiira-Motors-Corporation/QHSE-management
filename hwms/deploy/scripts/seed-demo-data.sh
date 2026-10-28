#!/usr/bin/env bash
#
# Seed synthetic dashboard data into a local development stack.
#
# The dashboard derives every figure from records, so an empty stack shows nine
# indicators reading No data. This script writes January through the current
# month of this year, so the dashboard has something to show:
#
#   metrics        monthly returns (surveillance, lost days, headcount and the
#                  four attributed safety figures)
#   occupational   monthly plans with confirmed disease counts, industrial
#                  hygiene events and readings evaluated against the limit in
#                  force, ergonomic assessments and their corrective actions
#
# Every row it writes is marked as demonstration data (recorded_by or
# entered_by 'demo-seed', and a source note saying so), and anything somebody
# entered by hand is left alone: an existing monthly return or plan for a month
# is never overwritten. Re-running the script replaces its own rows only.
#
# The current month's near-miss count is deliberately left empty, so the
# dashboard also shows what a figure that has not arrived yet looks like.
#
# Never run this against anything but a local development stack.
#
# Usage:
#   ./deploy/scripts/seed-demo-data.sh            write the demonstration data
#   ./deploy/scripts/seed-demo-data.sh --remove   delete it again

set -euo pipefail

cd "$(dirname "$0")/../.."

die() { printf '\nError: %s\n' "$1" >&2; exit 1; }

command -v docker >/dev/null || die "docker is required."
docker compose ps --status running --services 2>/dev/null | grep -qx postgres \
  || die "the postgres service is not running. Start the stack with: make up"

psql_in() {
  docker compose exec -T postgres sh -c "psql -v ON_ERROR_STOP=1 -q -U \"\$POSTGRES_USER\" -d $1"
}

if [ "${1:-}" = "--remove" ]; then
  psql_in metrics <<'SQL'
delete from monthly_return where entered_by = 'demo-seed';
SQL
  psql_in occupational <<'SQL'
delete from hygiene_monitoring_event where recorded_by = 'demo-seed';
delete from ergonomic_assessment where recorded_by = 'demo-seed';
delete from health_wellness_plan where recorded_by = 'demo-seed';
SQL
  echo "Demonstration data removed. Records entered by hand were not touched."
  exit 0
fi

[ -z "${1:-}" ] || die "unknown option '$1'. Use --remove to delete the demonstration data."

# One row per calendar month. Only January through the current month are
# written; the rest are there so the script keeps working later in the year.
#
#   m    month number
#   sch  surveillance scheduled      done  surveillance completed     (OH1)
#   occ  confirmed occupational disease cases                         (OH2)
#   elig hygiene readings in the plan  ok  readings within the limit  (OH3)
#   due  corrective actions falling due  ontime  closed on time       (OH4)
#   fat, tri, inj, nm  the four attributed safety figures              (S1–S4)
#   lost health-related lost days    hc  month-end headcount          (S5)
MONTHS="(values
  ( 1, 52, 50, 0, 20, 19, 12, 11, 0, 1, 0, 162, 168.9, 412),
  ( 2, 40, 39, 0, 20, 18, 15, 14, 0, 0, 0, 171, 157.3, 414),
  ( 3, 41, 39, 1, 24, 23, 12, 12, 0, 2, 1, 188, 182.2, 414),
  ( 4, 50, 49, 0, 20, 20, 14, 13, 0, 1, 1, 195, 216.3, 416),
  ( 5, 54, 51, 0, 22, 21, 13, 13, 0, 0, 0, 204, 195.5, 416),
  ( 6, 62, 60, 0, 20, 19, 12, 11, 0, 0, 0, 199, 150.1, 417),
  ( 7, 49, 46, 0, 24, 22, 11, 10, 0, 1, 0, 210, 163.0, 418),
  ( 8, 44, 42, 0, 20, 20, 12, 10, 0, 3, 2, 221, 192.3, 418),
  ( 9, 50, 47, 0, 22, 21, 14, 12, 0, 0, 0, 207, 180.6, 420),
  (10, 50, 46, 0, 38, 37, 13, 11, 0, 2, 1, 214, 168.0, 420),
  (11, 48, 46, 0, 20, 19, 12, 11, 0, 0, 0, 205, 172.2, 421),
  (12, 30, 29, 0, 16, 16, 10, 10, 0, 0, 0, 190, 130.5, 421)
) as m(m, sch, done, occ, elig, ok, due, ontime, fat, tri, inj, nm, lost, hc)"

# The months to write: this year, January to now.
SELECTED="select m.*, to_char(make_date(extract(year from current_date)::int, m.m, 1), 'YYYY-MM') as period,
                 make_date(extract(year from current_date)::int, m.m, 1) as first_day,
                 m.m = extract(month from current_date)::int as is_current
          from $MONTHS
          where m.m <= extract(month from current_date)::int"

psql_in metrics <<SQL
begin;

insert into monthly_return (
    period, health_related_lost_days, headcount, surveillance_scheduled, surveillance_completed,
    health_source_note, fatalities, total_recordable_incidents, total_recordable_injuries,
    reportable_near_misses, safety_source_note, entered_by)
select period, lost, hc, sch, done,
       'Synthetic demonstration data (seed-demo-data.sh), not from the HR portal.',
       fat, tri, inj,
       -- The current month's near misses have not "arrived" yet.
       case when is_current then null else nm end,
       'Synthetic demonstration data (seed-demo-data.sh), not from Workplace Safety.',
       'demo-seed'
from ($SELECTED) s
on conflict (period) do update set
    health_related_lost_days   = excluded.health_related_lost_days,
    headcount                  = excluded.headcount,
    surveillance_scheduled     = excluded.surveillance_scheduled,
    surveillance_completed     = excluded.surveillance_completed,
    health_source_note         = excluded.health_source_note,
    fatalities                 = excluded.fatalities,
    total_recordable_incidents = excluded.total_recordable_incidents,
    total_recordable_injuries  = excluded.total_recordable_injuries,
    reportable_near_misses     = excluded.reportable_near_misses,
    safety_source_note         = excluded.safety_source_note,
    updated_at                 = now()
-- A return somebody entered is never overwritten.
where monthly_return.entered_by = 'demo-seed';

commit;
SQL

psql_in occupational <<SQL
begin;

-- Replace this script's own rows; leave everything else alone.
delete from hygiene_monitoring_event where recorded_by = 'demo-seed';
delete from ergonomic_assessment where recorded_by = 'demo-seed';

insert into health_wellness_plan (
    period, hygiene_events_planned, ergonomic_assessments_planned,
    confirmed_occupational_diseases, recorded_by)
select period, 4, (due + 1) / 2, occ, 'demo-seed'
from ($SELECTED) s
on conflict (period) do update set
    hygiene_events_planned          = excluded.hygiene_events_planned,
    ergonomic_assessments_planned   = excluded.ergonomic_assessments_planned,
    confirmed_occupational_diseases = excluded.confirmed_occupational_diseases,
    updated_at                      = now()
where health_wellness_plan.recorded_by = 'demo-seed';

-- The reference limits as the admin service seeds them. Copied onto each
-- reading, as the occupational service does, because a reading keeps the limit
-- that was in force on its date.
create temporary table seed_limit (
    position int, limit_reference_id uuid, parameter text, limit_applied numeric,
    unit text, averaging_period text, monitoring_context text, standard_family text,
    location text, instrument text
) on commit drop;

insert into seed_limit values
    (0, '22222222-2222-4222-8222-000000000001', 'PM2.5', 25, 'µg/m³', '24 hours',
        'indoor-workplace', 'Indoor air quality reference', 'Paint shop', 'Particle counter PC-1'),
    (1, '22222222-2222-4222-8222-000000000002', 'PM10', 50, 'µg/m³', '24 hours',
        'indoor-workplace', 'Indoor air quality reference', 'Body shop', 'Particle counter PC-1'),
    (2, '22222222-2222-4222-8222-000000000003', 'Noise · day', 85, 'dB(A)', '8-hour shift',
        'occupational-exposure', 'Occupational exposure reference', 'Assembly line A', 'Sound level meter SLM-2'),
    (3, '22222222-2222-4222-8222-000000000004', 'Noise · night', 55, 'dB(A)', 'Night-time',
        'ambient', 'Ambient noise reference', 'Site perimeter', 'Sound level meter SLM-2');

-- One monitoring event per parameter per month.
create temporary table seed_event on commit drop as
select gen_random_uuid() as event_id, s.period, s.first_day + (7 + l.position * 4) as event_date,
       l.position, l.location, l.instrument
from ($SELECTED) s cross join seed_limit l;

insert into hygiene_monitoring_event (event_id, period, event_date, location, instrument, notes, recorded_by)
select event_id, period, event_date, location, instrument,
       'Synthetic demonstration data (seed-demo-data.sh).', 'demo-seed'
from seed_event;

-- The month's readings spread across its four events. The first "ok" readings
-- sit under the limit and the rest above it, so the month's compliance is
-- exactly ok ÷ elig; each value varies deterministically below or above.
insert into hygiene_reading (
    reading_id, event_id, period, reading_date, location, instrument, parameter, value,
    limit_reference_id, limit_applied, unit, averaging_period, monitoring_context,
    standard_family, standard_version, compliance, kpi_eligible, recorded_by)
select gen_random_uuid(), e.event_id, s.period, e.event_date, l.location, l.instrument, l.parameter,
       round(case when r.n <= s.ok
                  then l.limit_applied * (0.55 + (abs(hashtext(s.period || r.n)) % 35) / 100.0)
                  else l.limit_applied * (1.04 + (abs(hashtext(s.period || r.n)) % 18) / 100.0)
             end, 1),
       l.limit_reference_id, l.limit_applied, l.unit, l.averaging_period, l.monitoring_context,
       l.standard_family, '',
       case when r.n <= s.ok then 'within' else 'outside' end,
       true, 'demo-seed'
from ($SELECTED) s
cross join lateral generate_series(1, s.elig) as r(n)
join seed_limit l on l.position = (r.n - 1) % 4
join seed_event e on e.period = s.period and e.position = l.position;

-- Ergonomic assessments, two corrective actions each, falling due in the month
-- they were raised. The first "ontime" actions closed before their due date;
-- of the rest, one closed late and any others are still open.
create temporary table seed_assessment on commit drop as
select gen_random_uuid() as assessment_id, s.period, s.first_day + (2 + a.k) as assessed_on, a.k,
       (array['Paint booth 2', 'Chassis line station 4', 'Upholstery bench', 'Quality office desk 3',
              'Battery pack line', 'Stores forklift bay', 'Welding cell 1', 'Design studio desk 7'])[1 + (a.k % 8)]
           as workstation,
       case when a.k % 3 = 0 then 'Office' else 'Industrial' end as work_type,
       (array['Partially compliant', 'Non-compliant', 'Partially compliant'])[1 + (a.k % 3)] as outcome
from ($SELECTED) s
cross join lateral generate_series(0, (s.due + 1) / 2 - 1) as a(k);

insert into ergonomic_assessment (
    assessment_id, period, assessed_on, workstation, work_type, assessor, outcome, findings, recorded_by)
select assessment_id, period, assessed_on, workstation, work_type, 'Demo assessor', outcome,
       'Synthetic demonstration data (seed-demo-data.sh).', 'demo-seed'
from seed_assessment;

insert into corrective_action (
    action_id, assessment_id, description, owner, due_date, status, closed_on, evidence)
select gen_random_uuid(), a.assessment_id,
       (array['Raise work surface to elbow height', 'Provide anti-fatigue matting',
              'Replace chair with adjustable task chair', 'Add lift assist for panels',
              'Rotate tasks every two hours', 'Reposition monitor to eye level'])[1 + (x.n % 6)],
       'Line supervisor',
       s.first_day + least(10 + x.n, 22) as due,
       case when x.n <= s.ontime or x.n = s.ontime + 1 then 'Closed' else 'Open' end,
       case when x.n <= s.ontime then s.first_day + least(10 + x.n, 22) - 2
            when x.n = s.ontime + 1 then s.first_day + least(10 + x.n, 22) + 2
       end,
       case when x.n <= s.ontime + 1 then 'Synthetic demonstration data.' else '' end
from ($SELECTED) s
cross join lateral generate_series(1, s.due) as x(n)
join seed_assessment a on a.period = s.period and a.k = (x.n - 1) / 2;

commit;
SQL

months=$(psql_in metrics <<'SQL'
\pset tuples_only on
select count(*) from monthly_return where entered_by = 'demo-seed';
SQL
)
printf 'Demonstration data written for %s month(s) of %s.\n' "$(echo "$months" | tr -d '[:space:]')" "$(date +%Y)"
echo "Open the dashboard as a manager or director to see it. Remove it with: $0 --remove"
