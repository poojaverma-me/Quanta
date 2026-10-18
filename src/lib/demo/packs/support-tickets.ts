import type { DemoPack } from "../types";

const BREACH = "100 * avg(sla_breached::INT)";

export const supportTickets: DemoPack = {
  id: "support_tickets",
  headers: ["ticket_id", "created_at", "closed_at", "status", "category", "severity", "department", "assigned_agent", "channel", "region", "resolution_hours", "sla_breached", "reopened", "csat_score"],
  profile: {
    table_name: "support_tickets",
    title: "IT Support Tickets",
    domain: "IT Service Management",
    columns: [
      { source_name: "ticket_id", name: "ticket_id", sql_type: "VARCHAR", role: "identifier", timestamp_format: null, strip_non_numeric: false, description: "Unique ticket reference" },
      { source_name: "created_at", name: "created_at", sql_type: "TIMESTAMP", role: "timestamp", timestamp_format: null, strip_non_numeric: false, description: "When the ticket was opened" },
      { source_name: "closed_at", name: "closed_at", sql_type: "TIMESTAMP", role: "timestamp", timestamp_format: null, strip_non_numeric: false, description: "When the ticket was resolved; empty while open" },
      { source_name: "status", name: "status", sql_type: "VARCHAR", role: "category", timestamp_format: null, strip_non_numeric: false, description: "Current workflow state" },
      { source_name: "category", name: "category", sql_type: "VARCHAR", role: "category", timestamp_format: null, strip_non_numeric: false, description: "Type of issue reported" },
      { source_name: "severity", name: "severity", sql_type: "VARCHAR", role: "category", timestamp_format: null, strip_non_numeric: false, description: "Business impact: Critical, High, Medium or Low" },
      { source_name: "department", name: "department", sql_type: "VARCHAR", role: "category", timestamp_format: null, strip_non_numeric: false, description: "Team that owns the ticket" },
      { source_name: "assigned_agent", name: "assigned_agent", sql_type: "VARCHAR", role: "category", timestamp_format: null, strip_non_numeric: false, description: "Engineer handling the ticket" },
      { source_name: "channel", name: "channel", sql_type: "VARCHAR", role: "category", timestamp_format: null, strip_non_numeric: false, description: "How the request came in" },
      { source_name: "region", name: "region", sql_type: "VARCHAR", role: "category", timestamp_format: null, strip_non_numeric: false, description: "Requester's region" },
      { source_name: "resolution_hours", name: "resolution_hours", sql_type: "DOUBLE", role: "metric", timestamp_format: null, strip_non_numeric: false, description: "Hours from creation to resolution" },
      { source_name: "sla_breached", name: "sla_breached", sql_type: "BOOLEAN", role: "boolean", timestamp_format: null, strip_non_numeric: false, description: "Whether the severity's SLA target was missed" },
      { source_name: "reopened", name: "reopened", sql_type: "BOOLEAN", role: "boolean", timestamp_format: null, strip_non_numeric: false, description: "Whether the ticket was reopened after closure" },
      { source_name: "csat_score", name: "csat_score", sql_type: "BIGINT", role: "metric", timestamp_format: null, strip_non_numeric: false, description: "Customer satisfaction rating, 1–5" },
    ],
    summary: [
      "This dataset is the ticket log of an IT service desk: 6,357 tickets opened between 1 March and 13 October 2026, one row per ticket, following each request from intake to resolution. Six departments share the work, from Application Support and Infrastructure Ops to Security Engineering, Data Platform, Billing Ops and Customer Success.",
      "The core measures are resolution_hours, the time from opening to resolution (21.1 hours on average, 14.1 hours at the median), and csat_score, a 1–5 satisfaction rating returned on roughly six in ten resolved tickets. Two flags describe service quality: sla_breached marks tickets that missed their severity's target (10.7% of resolved tickets), and reopened marks tickets that came back after closure (5.5%).",
      "Every ticket can be sliced by category, severity, owning department, assigned agent, intake channel and region, which makes it possible to separate where work comes from, how urgent it is, and who carries it.",
      "With seven months of history and both opened and closed timestamps, the data supports trend analysis of volume and speed, detection of spikes and recurring patterns, and a direct look at how speed and SLA performance shape customer satisfaction.",
    ],
    primary_metric: "resolution_hours",
    primary_timestamp: "created_at",
    key_dimensions: ["category", "department", "region"],
    heatmap_pair: ["department", "severity"],
    suggested_objectives: [
      "Identify department bottlenecks and what is driving them",
      "Detect anomalies and recurring ticket spikes",
      "What drives customer satisfaction, and where is it slipping?",
    ],
    suggested_questions: [
      "Which department has the highest average resolution time?",
      "On which day did we get the most Network tickets?",
      "What share of SLA breaches comes from Security Engineering?",
      "Which category has the lowest customer satisfaction?",
    ],
  },

  scenarios: [
    {
      id: "bottlenecks",
      objective: "Identify department bottlenecks and what is driving them",
      keywords: ["bottleneck", "department", "slow", "slowest", "resolution", "sla", "breach", "capacity", "team", "backlog", "delay"],
      steps: [
        { kind: "thinking", text: "I'll start with a baseline for every department — volume, resolution time, SLA breaches and CSAT — so outliers stand out against the organization-wide numbers." },
        {
          kind: "query",
          purpose: "Department baselines: volume, resolution time, SLA breaches, CSAT",
          sql: `SELECT department, count(*) AS tickets, round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct_of_tickets,
       round(avg(resolution_hours), 1) AS avg_hours, round(median(resolution_hours), 1) AS median_hours,
       count(*) FILTER (WHERE sla_breached) AS sla_breaches, round(${BREACH}, 1) AS breach_rate_pct, round(avg(csat_score), 2) AS avg_csat
FROM {t} GROUP BY 1 ORDER BY avg_hours DESC`,
        },
        { kind: "note", text: "Security Engineering is the clear outlier: **39.1 h** average resolution against **21.1 h** overall, and **386 of 667** SLA breaches (57.9%) from only 21.6% of tickets. Data Platform is second at 27.6 h. Next I'll look at what Security Engineering's queue is made of." },
        {
          kind: "query",
          purpose: "Security Engineering workload by category and severity",
          sql: `SELECT category, severity, count(*) AS tickets, round(avg(resolution_hours), 1) AS avg_hours, round(${BREACH}, 1) AS breach_rate_pct
FROM {t} WHERE department = 'Security Engineering' GROUP BY 1, 2 ORDER BY tickets DESC`,
        },
        { kind: "thinking", text: "Access & Permissions requests make up 73.5% of Security Engineering's queue and take 43.2 h on average. Routine access work is crowding out urgent work: Critical security tickets breach SLA 72.2% of the time versus 31.9% for Critical tickets elsewhere. Is this new, or has it always been like this?" },
        {
          kind: "query",
          purpose: "Monthly resolution time and SLA breaches for the two slowest departments",
          sql: `SELECT strftime(created_at, '%Y-%m') AS month, department, count(*) AS tickets, round(avg(resolution_hours), 1) AS avg_hours, round(${BREACH}, 1) AS breach_rate_pct
FROM {t} WHERE department IN ('Security Engineering', 'Data Platform') GROUP BY 1, 2 ORDER BY 2, 1`,
        },
        { kind: "note", text: "Two different stories. Security Engineering has sat between 36 and 45 h every month since March — a **chronic** bottleneck. Data Platform held at 20–27 h until August, then jumped to **48.7 h in September** and 47.5 h in October — a **new** backlog." },
        {
          kind: "query",
          purpose: "Long-tail tickets (over 72 hours) by department",
          sql: `SELECT department, count(*) FILTER (WHERE resolution_hours > 72) AS over_72h, round(100.0 * count(*) FILTER (WHERE resolution_hours > 72) / count(resolution_hours), 1) AS pct_over_72h
FROM {t} GROUP BY 1 ORDER BY over_72h DESC`,
        },
        { kind: "thinking", text: "Security Engineering also owns 162 of the 222 tickets that took more than three days. To rule out individual performance I'll check agents quickly — then write up." },
        {
          kind: "query",
          purpose: "Resolution time by assigned agent",
          sql: `SELECT assigned_agent, count(*) AS tickets, round(avg(resolution_hours), 1) AS avg_hours FROM {t} GROUP BY 1 ORDER BY avg_hours DESC`,
        },
        { kind: "note", text: "All 12 agents average between 20.1 and 22.3 h, so this is structural, not about individuals. Writing the report with three charts: breach share by department, the monthly trend for both bottlenecks, and breach rate by department and severity." },
      ],
      report: {
        title: "Department Bottlenecks: Security Engineering Is Structural, Data Platform Is New",
        executive_summary:
          "Security Engineering is the service desk's main bottleneck: it handles 21.6% of tickets but produces 57.9% of SLA breaches (386 of 667), averaging 39.1 hours to resolve against 21.1 hours overall. The cause is routine Access & Permissions work — 73.5% of its queue at 43.2 hours each — which leaves Critical security tickets breaching SLA 72.2% of the time. Data Platform is a newer problem: its average resolution time more than doubled, from 22.9 hours (March–August) to 48.4 hours since September, with breaches rising from 10.1% to 41.8%. Together the two departments account for 70% of all SLA breaches.",
        kpis: [
          { label: "Security Eng. share of SLA breaches", value: "57.9%", context: "386 of 667 breaches, from 21.6% of tickets", sentiment: "negative" },
          { label: "Security Eng. avg resolution", value: "39.1 h", context: "vs 21.1 h across all departments", sentiment: "negative" },
          { label: "Critical breach rate, Security Eng.", value: "72.2%", context: "vs 31.9% in other departments", sentiment: "negative" },
          { label: "Data Platform resolution since Sep", value: "48.4 h", context: "up from 22.9 h in March–August", sentiment: "negative" },
        ],
        findings: [
          { title: "Security Engineering owns most SLA breaches", detail: "386 of 667 SLA breaches (57.9%) come from a department that handles 21.6% of tickets. Its breach rate is 28.5%, against 0.4–6.1% for Billing Ops, Customer Success, Application Support and Infrastructure Ops.", severity: "high" },
          { title: "Routine access requests clog the security queue", detail: "1,010 Access & Permissions tickets (73.5% of the department's work) average 43.2 h, with a 33.0 h median. Low-severity security tickets wait longest of all at 66.0 h on average.", severity: "high" },
          { title: "Urgent security work misses its targets", detail: "Critical Security Engineering tickets breach SLA 72.2% of the time and High tickets 52.1%, compared with 31.9% for Critical tickets in every other department.", severity: "high" },
          { title: "Data Platform's backlog started in September", detail: "Average resolution was 20–27 h each month from March to August, then 48.7 h in September and 47.5 h in October. SLA breaches went from 10.1% to 41.8% over the same split.", severity: "medium" },
          { title: "Individual agents are not the cause", detail: "All 12 agents average between 20.1 and 22.3 h. The gaps come from queue mix and capacity, not from individual performance.", severity: "low" },
        ],
        charts: [
          {
            title: "SLA breaches by department",
            type: "hbar",
            sql: `SELECT department, count(*) FILTER (WHERE sla_breached) AS sla_breaches FROM {t} GROUP BY 1 ORDER BY 2 DESC`,
            x: "department",
            y: "sla_breaches",
            group: null,
            caption: "Security Engineering alone produces more breaches than all other departments combined.",
          },
          {
            title: "Average resolution hours by month",
            type: "line",
            sql: `SELECT date_trunc('month', created_at) AS month, department, round(avg(resolution_hours), 1) AS avg_resolution_hours
FROM {t} WHERE department IN ('Security Engineering', 'Data Platform', 'Application Support', 'Infrastructure Ops') GROUP BY 1, 2 ORDER BY 1`,
            x: "month",
            y: "avg_resolution_hours",
            group: "department",
            caption: "Security Engineering is consistently slow; Data Platform breaks away from the pack in September.",
          },
          {
            title: "SLA breach rate by department and severity",
            type: "heatmap",
            sql: `SELECT department, severity, round(${BREACH}, 1) AS breach_rate_pct FROM {t} WHERE sla_breached IS NOT NULL GROUP BY 1, 2`,
            x: "department",
            y: "breach_rate_pct",
            group: "severity",
            caption: "Brightest cells: Critical and High tickets in Security Engineering.",
          },
        ],
        recommendations: [
          { title: "Automate standard access requests", detail: "Move routine Access & Permissions requests to self-service or pre-approved workflows. They are 1,010 tickets averaging 43.2 h, and removing them frees Security Engineering for incidents.", impact: "high" },
          { title: "Protect a Critical/High lane in Security Engineering", detail: "Give a dedicated on-call rotation Critical and High security tickets only, with escalation at 50% of the SLA window. 72.2% of Critical tickets currently breach.", impact: "high" },
          { title: "Add temporary Data Platform capacity and triage the backlog", detail: "Resolution time has doubled since September. Borrow capacity for 4–6 weeks and review whether intake changed in late August.", impact: "high" },
          { title: "Review breach share by department weekly", detail: "Alert when any department's breach rate exceeds 15%, so the next bottleneck surfaces in weeks rather than months.", impact: "medium" },
        ],
      },
      checks: [
        { sql: `SELECT round(avg(resolution_hours), 1), count(*) FILTER (WHERE sla_breached), round(100.0 * count(*) FILTER (WHERE department = 'Security Engineering') / count(*), 1) FROM {t}`, expect: [21.1, 667, 21.6] },
        { sql: `SELECT round(avg(resolution_hours), 1), count(*) FILTER (WHERE sla_breached), round(${BREACH}, 1) FROM {t} WHERE department = 'Security Engineering'`, expect: [39.1, 386, 28.5] },
        { sql: `SELECT round(100.0 * count(*) FILTER (WHERE category = 'Access & Permissions') / count(*), 1), round(avg(resolution_hours) FILTER (WHERE category = 'Access & Permissions'), 1), round(median(resolution_hours) FILTER (WHERE category = 'Access & Permissions'), 1), count(*) FILTER (WHERE category = 'Access & Permissions') FROM {t} WHERE department = 'Security Engineering'`, expect: [73.5, 43.2, 33.0, 1010] },
        { sql: `SELECT round(100 * avg(sla_breached::INT) FILTER (WHERE department = 'Security Engineering' AND severity = 'Critical'), 1), round(100 * avg(sla_breached::INT) FILTER (WHERE department <> 'Security Engineering' AND severity = 'Critical'), 1), round(100 * avg(sla_breached::INT) FILTER (WHERE department = 'Security Engineering' AND severity = 'High'), 1), round(avg(resolution_hours) FILTER (WHERE department = 'Security Engineering' AND severity = 'Low'), 1) FROM {t}`, expect: [72.2, 31.9, 52.1, 66.0] },
        { sql: `SELECT round(avg(resolution_hours) FILTER (WHERE created_at < '2026-09-01'), 1), round(avg(resolution_hours) FILTER (WHERE created_at >= '2026-09-01'), 1), round(100 * avg(sla_breached::INT) FILTER (WHERE created_at < '2026-09-01'), 1), round(100 * avg(sla_breached::INT) FILTER (WHERE created_at >= '2026-09-01'), 1) FROM {t} WHERE department = 'Data Platform'`, expect: [22.9, 48.4, 10.1, 41.8] },
        { sql: `SELECT round(avg(resolution_hours) FILTER (WHERE strftime(created_at, '%Y-%m') = '2026-09'), 1), round(avg(resolution_hours) FILTER (WHERE strftime(created_at, '%Y-%m') = '2026-10'), 1) FROM {t} WHERE department = 'Data Platform'`, expect: [48.7, 47.5] },
        { sql: `SELECT round(100.0 * count(*) FILTER (WHERE sla_breached AND department IN ('Security Engineering', 'Data Platform')) / count(*) FILTER (WHERE sla_breached), 0) FROM {t}`, expect: [70] },
        { sql: `SELECT min(h), max(h) FROM (SELECT round(avg(resolution_hours), 1) AS h FROM {t} GROUP BY assigned_agent)`, expect: [20.1, 22.3] },
        { sql: `SELECT count(*) FILTER (WHERE resolution_hours > 72 AND department = 'Security Engineering'), count(*) FILTER (WHERE resolution_hours > 72) FROM {t}`, expect: [162, 222] },
      ],
    },

    {
      id: "anomalies",
      objective: "Detect anomalies and recurring ticket spikes",
      keywords: ["anomaly", "anomalies", "spike", "spikes", "recurring", "outage", "surge", "unusual", "pattern", "peak", "incident"],
      steps: [
        { kind: "thinking", text: "First I'll compare weekly volume against a typical week, then break down any week that stands out by day and category, and finally test for patterns that repeat by time of month or after specific dates." },
        {
          kind: "query",
          purpose: "Busiest weeks compared with the median week",
          sql: `WITH w AS (SELECT date_trunc('week', created_at) AS week, count(*) AS tickets FROM {t} WHERE created_at >= '2026-03-02' AND created_at < '2026-10-12' GROUP BY 1)
SELECT week::DATE AS week, tickets, round(tickets / (SELECT median(tickets) FROM w), 2) AS vs_median_week FROM w ORDER BY tickets DESC LIMIT 6`,
        },
        { kind: "note", text: "The week of **Aug 17** had **381 tickets**, 2.1× a median week (182). No other week goes above 1.5×. Breaking that week down by day and category." },
        {
          kind: "query",
          purpose: "Daily breakdown around the spike, Aug 14–22",
          sql: `SELECT created_at::DATE AS day, count(*) AS tickets, count(*) FILTER (WHERE category = 'Network') AS network,
       count(*) FILTER (WHERE category = 'Network' AND region = 'EMEA') AS network_emea,
       count(*) FILTER (WHERE category = 'Network' AND severity IN ('Critical', 'High')) AS network_critical_high
FROM {t} WHERE created_at >= '2026-08-14' AND created_at < '2026-08-23' GROUP BY 1 ORDER BY 1`,
        },
        { kind: "thinking", text: "Aug 17–20 brought 214 Network tickets, every one from EMEA and every one Critical or High. That's about 53 a day against a normal 3.6, so this is a regional outage, not organic demand. What did it cost in SLA and satisfaction?" },
        {
          kind: "query",
          purpose: "Outage tickets vs all other Network tickets",
          sql: `SELECT CASE WHEN created_at::DATE BETWEEN '2026-08-17' AND '2026-08-20' THEN 'Aug 17–20 outage' ELSE 'Rest of period' END AS period,
       count(*) AS tickets, round(${BREACH}, 1) AS sla_breach_pct, round(avg(csat_score), 2) AS avg_csat
FROM {t} WHERE category = 'Network' GROUP BY 1`,
        },
        { kind: "note", text: "Outage tickets breached SLA **33.6%** of the time against **2.2%** normally, and CSAT fell to 3.83 from 4.41. Now testing for recurring patterns: billing around the start of each month, and Performance after early September." },
        {
          kind: "query",
          purpose: "Billing tickets per weekday: first three days of the month vs the rest",
          sql: `SELECT CASE WHEN day(created_at) <= 3 THEN 'Days 1–3' ELSE 'Days 4+' END AS part_of_month, count(*) AS tickets,
       count(DISTINCT created_at::DATE) AS weekdays, round(count(*) / count(DISTINCT created_at::DATE), 1) AS per_weekday
FROM {t} WHERE category = 'Billing' AND dayofweek(created_at) NOT IN (0, 6) GROUP BY 1`,
        },
        {
          kind: "query",
          purpose: "Performance tickets per week since late July",
          sql: `SELECT date_trunc('week', created_at)::DATE AS week, count(*) AS performance_tickets FROM {t}
WHERE category = 'Performance' AND created_at >= '2026-07-27' AND created_at < '2026-10-12' GROUP BY 1 ORDER BY 1`,
        },
        { kind: "thinking", text: "Two recurring patterns confirmed. Billing runs at 15.2 tickets per weekday in the first three days of each month against 3.3 otherwise (4.6×). Performance tickets stepped up from roughly 25 a week to 55–67 a week starting the week of Sep 7 and haven't come down, which points to a regression shipped around Sep 8. One more check: does the weekend slow things down?" },
        {
          kind: "query",
          purpose: "Resolution time for weekend vs weekday tickets",
          sql: `SELECT CASE WHEN dayofweek(created_at) IN (0, 6) THEN 'Weekend' ELSE 'Weekday' END AS opened_on, count(*) AS tickets,
       round(avg(resolution_hours), 1) AS avg_hours, round(median(resolution_hours), 1) AS median_hours FROM {t} GROUP BY 1`,
        },
      ],
      report: {
        title: "Ticket Anomalies: One Regional Outage, Two Recurring Patterns",
        executive_summary:
          "Three spikes stand out in 6,357 tickets. The largest was a one-off: an EMEA network outage on Aug 17–20 generated 214 Network tickets, about 15× the normal daily rate. It pushed that week to 381 tickets (2.1× a median week), and outage tickets breached SLA 33.6% of the time against 2.2% normally. Two patterns recur. Billing tickets surge to 4.6× their usual daily level in the first three days of every month. Performance tickets have run at about 2.5× their earlier weekly level since the week of Sep 7, consistent with a regression from a release around Sep 8. The outage is over, but the billing cycle and the Performance regression are still active and can be planned for.",
        kpis: [
          { label: "Outage tickets, Aug 17–20", value: "214", context: "≈15× the normal daily Network volume", sentiment: "negative" },
          { label: "Peak week vs median week", value: "2.1×", context: "381 tickets vs 182", sentiment: "negative" },
          { label: "Billing surge, days 1–3", value: "4.6×", context: "15.2 vs 3.3 tickets per weekday", sentiment: "neutral" },
          { label: "Performance tickets since Sep 7", value: "2.5×", context: "≈62 a week vs ≈25 before", sentiment: "negative" },
        ],
        findings: [
          { title: "An EMEA network outage drove the largest spike", detail: "Aug 17–20 produced 214 Network tickets, 53.5 a day against a 3.6 baseline. All were from EMEA and all were Critical or High. Outage tickets breached SLA 33.6% of the time (2.2% normally) and averaged 3.83 CSAT against 4.41.", severity: "high" },
          { title: "Performance tickets stepped up and stayed up", detail: "Weekly Performance tickets ran 19–39 from late July through August, then 55–67 every week from Sep 7 onwards. The step change lines up with a release around Sep 8 and has not reverted.", severity: "high" },
          { title: "Billing tickets cluster at the start of each month", detail: "Billing averages 15.2 tickets per weekday on days 1–3 of the month against 3.3 on other weekdays, every month. It's a predictable 4.6× surge.", severity: "medium" },
          { title: "Weekend tickets wait longer", detail: "Tickets opened on weekends take 26.9 h on average (19.4 h median) against 20.2 h (13.5 h median) on weekdays.", severity: "low" },
        ],
        charts: [
          {
            title: "Tickets per day",
            type: "area",
            sql: `SELECT created_at::DATE AS day, count(*) AS tickets FROM {t} GROUP BY 1 ORDER BY 1`,
            x: "day",
            y: "tickets",
            group: null,
            caption: "The Aug 17–20 outage towers over every other day; the small monthly ripples are the billing cycle.",
          },
          {
            title: "Performance tickets per week",
            type: "line",
            sql: `SELECT date_trunc('week', created_at)::DATE AS week, count(*) AS performance_tickets FROM {t} WHERE category = 'Performance' AND created_at >= '2026-06-01' AND created_at < '2026-10-12' GROUP BY 1 ORDER BY 1`,
            x: "week",
            y: "performance_tickets",
            group: null,
            caption: "A step change from the week of Sep 7 that has not reverted.",
          },
          {
            title: "Billing tickets per weekday by day of month",
            type: "bar",
            sql: `SELECT CASE WHEN day(created_at) <= 3 THEN 'Day ' || day(created_at) WHEN day(created_at) <= 10 THEN 'Days 4–10' WHEN day(created_at) <= 20 THEN 'Days 11–20' ELSE 'Days 21–31' END AS day_of_month,
       round(count(*) / count(DISTINCT created_at::DATE), 1) AS billing_per_weekday
FROM {t} WHERE category = 'Billing' AND dayofweek(created_at) NOT IN (0, 6) GROUP BY 1 ORDER BY min(day(created_at))`,
            x: "day_of_month",
            y: "billing_per_weekday",
            group: null,
            caption: "Days 1–3 of each month carry several times the normal billing load.",
          },
        ],
        recommendations: [
          { title: "Find and fix the Performance regression from early September", detail: "Compare Performance tickets before and after the Sep 8 release by product area, and roll back or patch. It's adding about 37 extra tickets a week.", impact: "high" },
          { title: "Write an outage playbook for regional network incidents", detail: "Publish a status page and merge duplicate tickets automatically. In August, 214 tickets with a single cause broke SLA a third of the time.", impact: "high" },
          { title: "Staff Billing for the first three days of each month", detail: "Schedule extra Billing Ops and Customer Success cover on days 1–3, when volume runs 4.6× normal.", impact: "medium" },
          { title: "Add weekend coverage for the slowest queues", detail: "Weekend tickets take 6.7 h longer on average; a light weekend rotation would close most of the gap.", impact: "low" },
        ],
      },
      checks: [
        { sql: `WITH w AS (SELECT date_trunc('week', created_at) AS week, count(*) AS tickets FROM {t} WHERE created_at >= '2026-03-02' AND created_at < '2026-10-12' GROUP BY 1) SELECT max(tickets), median(tickets), round(max(tickets) / median(tickets), 1) FROM w`, expect: [381, 182, 2.1] },
        { sql: `SELECT count(*), count(*) FILTER (WHERE region = 'EMEA'), count(*) FILTER (WHERE severity IN ('Critical', 'High')), round(${BREACH}, 1), round(avg(csat_score), 2) FROM {t} WHERE category = 'Network' AND created_at::DATE BETWEEN '2026-08-17' AND '2026-08-20'`, expect: [214, 214, 214, 33.6, 3.83] },
        { sql: `SELECT round(${BREACH}, 1), round(avg(csat_score), 2) FROM {t} WHERE category = 'Network' AND NOT (created_at::DATE BETWEEN '2026-08-17' AND '2026-08-20')`, expect: [2.2, 4.41] },
        { sql: `WITH d AS (SELECT created_at::DATE AS d, count(*) FILTER (WHERE category = 'Network') AS n FROM {t} GROUP BY 1) SELECT round(avg(n) FILTER (WHERE d NOT BETWEEN '2026-08-17' AND '2026-08-20'), 1), round(avg(n) FILTER (WHERE d BETWEEN '2026-08-17' AND '2026-08-20'), 1) FROM d`, expect: [3.6, 53.5] },
        { sql: `SELECT round(count(*) FILTER (WHERE day(created_at) <= 3) / count(DISTINCT created_at::DATE) FILTER (WHERE day(created_at) <= 3), 1), round(count(*) FILTER (WHERE day(created_at) > 3) / count(DISTINCT created_at::DATE) FILTER (WHERE day(created_at) > 3), 1) FROM {t} WHERE category = 'Billing' AND dayofweek(created_at) NOT IN (0, 6)`, expect: [15.2, 3.3] },
        { sql: `WITH w AS (SELECT date_trunc('week', created_at)::DATE AS wk, count(*) AS n FROM {t} WHERE category = 'Performance' GROUP BY 1) SELECT round(avg(n) FILTER (WHERE wk BETWEEN '2026-07-27' AND '2026-08-31'), 0), round(avg(n) FILTER (WHERE wk BETWEEN '2026-09-07' AND '2026-10-05'), 0), min(n) FILTER (WHERE wk BETWEEN '2026-09-07' AND '2026-10-05'), max(n) FILTER (WHERE wk BETWEEN '2026-09-07' AND '2026-10-05'), min(n) FILTER (WHERE wk BETWEEN '2026-07-27' AND '2026-08-31'), max(n) FILTER (WHERE wk BETWEEN '2026-07-27' AND '2026-08-31') FROM w`, expect: [25, 62, 55, 67, 19, 39] },
        { sql: `SELECT round(avg(resolution_hours) FILTER (WHERE dayofweek(created_at) IN (0, 6)), 1), round(median(resolution_hours) FILTER (WHERE dayofweek(created_at) IN (0, 6)), 1), round(avg(resolution_hours) FILTER (WHERE dayofweek(created_at) NOT IN (0, 6)), 1), round(median(resolution_hours) FILTER (WHERE dayofweek(created_at) NOT IN (0, 6)), 1) FROM {t}`, expect: [26.9, 19.4, 20.2, 13.5] },
      ],
    },

    {
      id: "csat",
      objective: "What drives customer satisfaction, and where is it slipping?",
      keywords: ["csat", "satisfaction", "customer", "happy", "score", "experience", "rating", "reopen", "quality", "satisfied"],
      steps: [
        { kind: "thinking", text: "CSAT is a 1–5 rating on resolved tickets. I'll test the most likely driver first — how long the customer waited — and then check SLA misses, category, channel and the monthly trend." },
        {
          kind: "query",
          purpose: "CSAT by resolution-time band",
          sql: `SELECT CASE WHEN resolution_hours < 8 THEN '1 · under 8 h' WHEN resolution_hours < 24 THEN '2 · 8–24 h' WHEN resolution_hours < 72 THEN '3 · 24–72 h' ELSE '4 · over 72 h' END AS resolution_band,
       count(csat_score) AS rated_tickets, round(avg(csat_score), 2) AS avg_csat
FROM {t} WHERE csat_score IS NOT NULL GROUP BY 1 ORDER BY 1`,
        },
        { kind: "note", text: "A clean gradient: **4.46** under 8 h, 4.31 at 8–24 h, 4.02 at 24–72 h and **3.47** beyond three days. Waiting time is the main driver." },
        {
          kind: "query",
          purpose: "CSAT and reopen rate when the SLA is met vs missed",
          sql: `SELECT CASE WHEN sla_breached THEN 'SLA missed' ELSE 'SLA met' END AS sla, count(csat_score) AS rated_tickets, round(avg(csat_score), 2) AS avg_csat, round(100 * avg(reopened::INT), 1) AS reopen_rate_pct
FROM {t} WHERE sla_breached IS NOT NULL GROUP BY 1`,
        },
        {
          kind: "query",
          purpose: "Lowest-rated categories",
          sql: `SELECT category, department, count(csat_score) AS rated_tickets, round(avg(csat_score), 2) AS avg_csat FROM {t} GROUP BY 1, 2 ORDER BY avg_csat LIMIT 5`,
        },
        { kind: "thinking", text: "A missed SLA drops CSAT from 4.37 to 3.24 and raises reopens from 5.3% to 7.6%. The lowest-rated categories — Security Incident (3.69), Access & Permissions (3.98) and Data Request (4.20) — belong to the two slowest departments. Let me rule out the intake channel before concluding." },
        {
          kind: "query",
          purpose: "CSAT by intake channel",
          sql: `SELECT channel, count(csat_score) AS rated_tickets, round(avg(csat_score), 2) AS avg_csat FROM {t} GROUP BY 1 ORDER BY avg_csat DESC`,
        },
        {
          kind: "query",
          purpose: "CSAT by month",
          sql: `SELECT strftime(created_at, '%Y-%m') AS month, count(csat_score) AS rated_tickets, round(avg(csat_score), 2) AS avg_csat FROM {t} GROUP BY 1 ORDER BY 1`,
        },
        { kind: "note", text: "Channels sit within 4.20–4.26, so the front door isn't the issue. Monthly CSAT bottomed at **4.19 in August**, the outage month. Writing it up." },
      ],
      report: {
        title: "Satisfaction Tracks Speed: The Slowest Queues Drive the Lowest CSAT",
        executive_summary:
          "Customer satisfaction averages 4.25 out of 5 across 3,852 rated tickets, and it is driven by resolution time more than anything else. Tickets resolved within 8 hours score 4.46; those taking over 72 hours score 3.47. A missed SLA drops the average from 4.37 to 3.24 and raises the reopen rate from 5.3% to 7.6%. The lowest-rated categories — Security Incidents (3.69), Access & Permissions (3.98) and Data Requests (4.20) — are the work of the two slowest departments. Intake channel makes almost no difference (4.20–4.26), so the lever is speed in Security Engineering and Data Platform, not the front door.",
        kpis: [
          { label: "Average CSAT", value: "4.25", context: "3,852 rated tickets", sentiment: "neutral" },
          { label: "CSAT when SLA is missed", value: "3.24", context: "vs 4.37 when met", sentiment: "negative" },
          { label: "CSAT for tickets over 72 h", value: "3.47", context: "vs 4.46 under 8 h", sentiment: "negative" },
          { label: "Lowest-rated category", value: "3.69", context: "Security Incident", sentiment: "negative" },
        ],
        findings: [
          { title: "Speed is the main driver of satisfaction", detail: "Average CSAT falls steadily with resolution time: 4.46 under 8 h, 4.31 at 8–24 h, 4.02 at 24–72 h and 3.47 beyond 72 h.", severity: "high" },
          { title: "Missed SLAs cost more than a point of CSAT", detail: "Tickets that breached SLA average 3.24 against 4.37 when met, and are reopened 7.6% of the time against 5.3%.", severity: "high" },
          { title: "The lowest scores sit in the slowest queues", detail: "Security Incident (3.69) and Access & Permissions (3.98) belong to Security Engineering; Data Request (4.20) belongs to Data Platform. These are the two departments with the longest resolution times.", severity: "medium" },
          { title: "August was the weakest month", detail: "Monthly CSAT ranged from 4.19 to 4.32 and bottomed in August, the month of the EMEA network outage.", severity: "medium" },
          { title: "Intake channel doesn't matter", detail: "Portal, Email and Chat all average 4.24–4.26 and Phone 4.20, so redesigning intake would not move satisfaction.", severity: "low" },
        ],
        charts: [
          {
            title: "Average CSAT by resolution time",
            type: "bar",
            sql: `SELECT CASE WHEN resolution_hours < 8 THEN '< 8 h' WHEN resolution_hours < 24 THEN '8–24 h' WHEN resolution_hours < 72 THEN '24–72 h' ELSE '> 72 h' END AS resolution_band, round(avg(csat_score), 2) AS avg_csat
FROM {t} WHERE csat_score IS NOT NULL GROUP BY 1 ORDER BY min(resolution_hours)`,
            x: "resolution_band",
            y: "avg_csat",
            group: null,
            caption: "Every step up in waiting time costs satisfaction.",
          },
          {
            title: "Average CSAT by category",
            type: "hbar",
            sql: `SELECT category, round(avg(csat_score), 2) AS avg_csat FROM {t} GROUP BY 1 ORDER BY 2`,
            x: "category",
            y: "avg_csat",
            group: null,
            caption: "Security and data work trail the rest.",
          },
          {
            title: "Average CSAT by month",
            type: "line",
            sql: `SELECT date_trunc('month', created_at) AS month, round(avg(csat_score), 2) AS avg_csat FROM {t} GROUP BY 1 ORDER BY 1`,
            x: "month",
            y: "avg_csat",
            group: null,
            caption: "The August dip coincides with the regional network outage.",
          },
        ],
        recommendations: [
          { title: "Set a 24-hour target for access requests", detail: "Access & Permissions tickets average 43.2 h. Pulling them under 24 h would move them into the 4.31+ satisfaction band.", impact: "high" },
          { title: "Warn customers before an SLA is missed", detail: "Send proactive updates at 75% of the SLA window. Missed SLAs average 3.24 CSAT and get reopened more often.", impact: "high" },
          { title: "Follow up on reopened and low-scored tickets", detail: "Route any rating of 1–2 and every reopen to a team lead within a day, to recover the relationship and learn the root cause.", impact: "medium" },
          { title: "Keep channel investment flat", detail: "Satisfaction is the same across channels; spend on resolution capacity instead.", impact: "low" },
        ],
      },
      checks: [
        { sql: `SELECT round(avg(csat_score), 2), count(csat_score) FROM {t}`, expect: [4.25, 3852] },
        { sql: `SELECT round(avg(csat_score) FILTER (WHERE resolution_hours < 8), 2), round(avg(csat_score) FILTER (WHERE resolution_hours >= 8 AND resolution_hours < 24), 2), round(avg(csat_score) FILTER (WHERE resolution_hours >= 24 AND resolution_hours < 72), 2), round(avg(csat_score) FILTER (WHERE resolution_hours >= 72), 2) FROM {t}`, expect: [4.46, 4.31, 4.02, 3.47] },
        { sql: `SELECT round(avg(csat_score) FILTER (WHERE NOT sla_breached), 2), round(avg(csat_score) FILTER (WHERE sla_breached), 2), round(100 * avg(reopened::INT) FILTER (WHERE NOT sla_breached), 1), round(100 * avg(reopened::INT) FILTER (WHERE sla_breached), 1) FROM {t}`, expect: [4.37, 3.24, 5.3, 7.6] },
        { sql: `SELECT round(avg(csat_score) FILTER (WHERE category = 'Security Incident'), 2), round(avg(csat_score) FILTER (WHERE category = 'Access & Permissions'), 2), round(avg(csat_score) FILTER (WHERE category = 'Data Request'), 2) FROM {t}`, expect: [3.69, 3.98, 4.2] },
        { sql: `SELECT min(c), max(c) FROM (SELECT round(avg(csat_score), 2) AS c FROM {t} GROUP BY channel)`, expect: [4.2, 4.26] },
        { sql: `SELECT min(c), max(c), arg_min(m, c) FROM (SELECT strftime(created_at, '%Y-%m') AS m, round(avg(csat_score), 2) AS c FROM {t} GROUP BY 1)`, expect: [4.19, 4.32, "2026-08"] },
      ],
    },
  ],

  qa: [
    {
      question: "Which department has the highest average resolution time?",
      keywords: ["slowest", "department", "resolution time", "longest", "highest average", "takes longest"],
      sql: `SELECT department, round(avg(resolution_hours), 1) AS avg_resolution_hours FROM {t} GROUP BY 1 ORDER BY 2 DESC`,
      explanation: "Average resolution hours by department",
      answer: "**Security Engineering** is the slowest, averaging **39.1 hours** per ticket — nearly double the 21.1-hour overall average. Data Platform is next at 27.6 hours.",
      checks: [{ sql: `SELECT department, round(avg(resolution_hours), 1) FROM {t} GROUP BY 1 ORDER BY 2 DESC LIMIT 1`, expect: ["Security Engineering", 39.1] }],
    },
    {
      question: "On which day did we get the most Network tickets?",
      keywords: ["network", "most network", "network tickets", "busiest day", "outage"],
      sql: `SELECT created_at::DATE AS day, count(*) AS network_tickets FROM {t} WHERE category = 'Network' GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
      explanation: "Network tickets per day, busiest first",
      answer: "**August 18, 2026**, with **56** Network tickets. It was the peak of a four-day EMEA outage (Aug 17–20) that produced 214 Network tickets in total.",
      checks: [{ sql: `SELECT created_at::DATE::VARCHAR, count(*) FROM {t} WHERE category = 'Network' GROUP BY 1 ORDER BY 2 DESC LIMIT 1`, expect: ["2026-08-18", 56] }],
    },
    {
      question: "How many tickets were created yesterday?",
      keywords: ["yesterday", "latest day", "last day", "today", "most recent day", "created yesterday"],
      sql: `SELECT created_at::DATE AS day, count(*) AS tickets, count(*) FILTER (WHERE severity = 'Critical') AS critical FROM {t} WHERE created_at::DATE = (SELECT max(created_at)::DATE FROM {t}) GROUP BY 1`,
      explanation: "Tickets on the most recent day in the data",
      answer: "On **October 13, 2026** — the most recent day in the data — **43 tickets** were opened, 1 of them Critical.",
      checks: [{ sql: `SELECT count(*), count(*) FILTER (WHERE severity = 'Critical') FROM {t} WHERE created_at::DATE = DATE '2026-10-13'`, expect: [43, 1] }],
    },
    {
      question: "What was the most common category this month?",
      keywords: ["this month", "most common", "october", "top category", "category this month"],
      sql: `SELECT category, count(*) AS tickets FROM {t} WHERE date_trunc('month', created_at) = (SELECT date_trunc('month', max(created_at)) FROM {t}) GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
      explanation: "Ticket categories in the latest month",
      answer: "**Performance** leads October with **123 tickets** so far, ahead of Software Bug at 83. Performance volume has been running well above its earlier level since early September.",
      checks: [{ sql: `SELECT category, count(*) FROM {t} WHERE created_at >= '2026-10-01' GROUP BY 1 ORDER BY 2 DESC LIMIT 1`, expect: ["Performance", 123] }],
    },
    {
      question: "What share of SLA breaches comes from Security Engineering?",
      keywords: ["sla", "breach", "breaches", "security engineering", "share", "responsible", "causes", "who"],
      sql: `SELECT department, count(*) FILTER (WHERE sla_breached) AS sla_breaches, round(100.0 * count(*) FILTER (WHERE sla_breached) / sum(count(*) FILTER (WHERE sla_breached)) OVER (), 1) AS pct_of_breaches FROM {t} GROUP BY 1 ORDER BY 2 DESC`,
      explanation: "SLA breaches by department and share of the total",
      answer: "**57.9%**. Security Engineering accounts for **386 of 667** SLA breaches, even though it handles only about a fifth of all tickets.",
      checks: [{ sql: `SELECT count(*) FILTER (WHERE sla_breached AND department = 'Security Engineering'), count(*) FILTER (WHERE sla_breached), round(100.0 * count(*) FILTER (WHERE sla_breached AND department = 'Security Engineering') / count(*) FILTER (WHERE sla_breached), 1) FROM {t}`, expect: [386, 667, 57.9] }],
    },
    {
      question: "Which category has the lowest customer satisfaction?",
      keywords: ["lowest", "csat", "satisfaction", "worst", "unhappy", "category"],
      sql: `SELECT category, count(csat_score) AS rated, round(avg(csat_score), 2) AS avg_csat FROM {t} GROUP BY 1 ORDER BY 3`,
      explanation: "Average CSAT by category, lowest first",
      answer: "**Security Incident** tickets score lowest at **3.69** out of 5, followed by Access & Permissions at 3.98. Both are handled by Security Engineering, the slowest department.",
      checks: [{ sql: `SELECT category, round(avg(csat_score), 2) FROM {t} GROUP BY 1 ORDER BY 2 LIMIT 1`, expect: ["Security Incident", 3.69] }],
    },
    {
      question: "How many tickets are still open?",
      keywords: ["open", "still open", "backlog", "unresolved", "pending", "in progress"],
      sql: `SELECT status, count(*) AS tickets FROM {t} WHERE status <> 'Resolved' GROUP BY 1 ORDER BY 2 DESC`,
      explanation: "Tickets not yet resolved, by status",
      answer: "**104 tickets** are unresolved: 51 Open, 43 In Progress and 10 Waiting on Customer. Application Support holds the most at 49.",
      checks: [
        { sql: `SELECT count(*) FILTER (WHERE status <> 'Resolved'), count(*) FILTER (WHERE status = 'Open'), count(*) FILTER (WHERE status = 'In Progress'), count(*) FILTER (WHERE status = 'Waiting on Customer') FROM {t}`, expect: [104, 51, 43, 10] },
        { sql: `SELECT count(*) FROM {t} WHERE status <> 'Resolved' AND department = 'Application Support'`, expect: [49] },
      ],
    },
    {
      question: "Which region breaches SLA most often?",
      keywords: ["region", "sla", "breach", "emea", "geography"],
      sql: `SELECT region, count(*) AS tickets, round(100 * avg(sla_breached::INT), 1) AS breach_rate_pct FROM {t} GROUP BY 1 ORDER BY 3 DESC`,
      explanation: "SLA breach rate by region",
      answer: "**EMEA** has the highest SLA breach rate at **12.5%**, against 9.5% in North America. Much of the gap comes from the August network outage, which hit EMEA only.",
      checks: [{ sql: `SELECT round(100 * avg(sla_breached::INT) FILTER (WHERE region = 'EMEA'), 1), round(100 * avg(sla_breached::INT) FILTER (WHERE region = 'North America'), 1) FROM {t}`, expect: [12.5, 9.5] }],
    },
    {
      question: "How has Data Platform's resolution time changed recently?",
      keywords: ["data platform", "changed", "trend", "recently", "getting worse", "data request"],
      sql: `SELECT strftime(created_at, '%Y-%m') AS month, count(*) AS tickets, round(avg(resolution_hours), 1) AS avg_hours FROM {t} WHERE department = 'Data Platform' GROUP BY 1 ORDER BY 1`,
      explanation: "Data Platform resolution time by month",
      answer: "It has **more than doubled**. Data Platform averaged **22.9 hours** from March to August, then **48.4 hours** since September, with 48.7 hours in September alone.",
      checks: [{ sql: `SELECT round(avg(resolution_hours) FILTER (WHERE created_at < '2026-09-01'), 1), round(avg(resolution_hours) FILTER (WHERE created_at >= '2026-09-01'), 1) FROM {t} WHERE department = 'Data Platform'`, expect: [22.9, 48.4] }],
    },
    {
      question: "Which channel do most tickets come from?",
      keywords: ["channel", "portal", "email", "chat", "phone", "intake"],
      sql: `SELECT channel, count(*) AS tickets, round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct FROM {t} GROUP BY 1 ORDER BY 2 DESC`,
      explanation: "Tickets by intake channel",
      answer: "The **Portal** brings in the most: **2,596 tickets** (40.8%), followed by Email at 1,858 and Chat at 1,273. Phone is the smallest channel at 630.",
      checks: [{ sql: `SELECT count(*) FILTER (WHERE channel = 'Portal'), round(100.0 * count(*) FILTER (WHERE channel = 'Portal') / count(*), 1), count(*) FILTER (WHERE channel = 'Email'), count(*) FILTER (WHERE channel = 'Chat'), count(*) FILTER (WHERE channel = 'Phone') FROM {t}`, expect: [2596, 40.8, 1858, 1273, 630] }],
    },
  ],
};
