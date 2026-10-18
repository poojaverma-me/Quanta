/**
 * Synthetic enterprise dataset generator.
 *
 *   npm run generate-data
 *
 * Writes three CSVs to public/samples/. Generation is seeded, so the output is
 * identical on every run. Each dataset has a few planted patterns (bottlenecks,
 * spikes, correlations) so the analytics agent and the eval suite have known
 * "ground truth" to find. They are listed in PLANTED below and in the README.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "public", "samples");
// Fixed window so the files are reproducible. The last day is 2026-10-13.
const START = Date.UTC(2026, 2, 1); // 2026-03-01
const END = Date.UTC(2026, 9, 14); // exclusive
const DAY = 86_400_000;
const HOUR = 3_600_000;

// ---------- seeded helpers ----------
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rand = mulberry32(42);
const between = (a: number, b: number) => a + rand() * (b - a);
const int = (a: number, b: number) => Math.floor(between(a, b + 1));
const chance = (p: number) => rand() < p;
function pick<T>(items: readonly T[], weights?: readonly number[]): T {
  if (!weights) return items[Math.floor(rand() * items.length)];
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
/** Log-normal-ish positive value with the given median. */
function skewed(median: number, spread = 0.6) {
  const u1 = Math.max(rand(), 1e-9);
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return median * Math.exp(z * spread);
}
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const pad = (n: number) => String(n).padStart(2, "0");
const isoDateTime = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
const usDate = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
};
const isoZ = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");

function toCsv(rows: Record<string, string | number | boolean | null>[]) {
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

/** Business-hours-weighted timestamp on a given day. */
function timeOnDay(dayStart: number) {
  const hour = pick([...Array(24).keys()], [1, 1, 1, 1, 1, 2, 3, 5, 8, 10, 10, 9, 8, 9, 10, 9, 8, 6, 4, 3, 2, 2, 1, 1]);
  return dayStart + hour * HOUR + int(0, 59) * 60_000 + int(0, 59) * 1000;
}

// ---------- 1. IT & customer support tickets ----------
function supportTickets() {
  rand = mulberry32(1001);
  const categories = ["Network", "Hardware", "Software Bug", "Access & Permissions", "Billing", "Data Request", "Security Incident", "Performance"] as const;
  const catWeights = [14, 10, 20, 18, 10, 9, 6, 13];
  const deptFor: Record<(typeof categories)[number], string> = {
    Network: "Infrastructure Ops",
    Hardware: "Infrastructure Ops",
    "Software Bug": "Application Support",
    "Access & Permissions": "Security Engineering",
    Billing: "Billing Ops",
    "Data Request": "Data Platform",
    "Security Incident": "Security Engineering",
    Performance: "Application Support",
  };
  const deptMedianHours: Record<string, number> = {
    "Infrastructure Ops": 9,
    "Application Support": 14,
    "Security Engineering": 31, // planted bottleneck
    "Billing Ops": 7,
    "Data Platform": 18,
    "Customer Success": 6,
  };
  const sevMult = { Critical: 0.45, High: 0.75, Medium: 1, Low: 1.5 };
  const regions = ["North America", "EMEA", "APAC", "LATAM"];
  const channels = ["Portal", "Email", "Chat", "Phone"];
  const agents = ["A. Rivera", "B. Chen", "C. Okafor", "D. Patel", "E. Novak", "F. Haddad", "G. Silva", "H. Kim", "I. Larsen", "J. Mensah", "K. Sato", "L. Moreau"];

  const rows: Record<string, string | number | null>[] = [];
  let id = 100001;
  for (let day = START; day < END; day += DAY) {
    const date = new Date(day);
    const dow = date.getUTCDay();
    const weekend = dow === 0 || dow === 6;
    let base = weekend ? 11 : 27;
    // gentle growth across the period
    base *= 1 + ((day - START) / (END - START)) * 0.25;
    const n = Math.round(base * between(0.8, 1.2));

    // Planted spike: regional network outage, 2026-08-17 .. 2026-08-20, EMEA.
    const outage = day >= Date.UTC(2026, 7, 17) && day <= Date.UTC(2026, 7, 20);
    // Planted spike: billing tickets cluster on days 1-3 of each month.
    const monthStart = date.getUTCDate() <= 3;
    // Planted trend: performance tickets jump after the 2026-09-08 release.
    const postRelease = day >= Date.UTC(2026, 8, 8);
    const extra: (typeof categories)[number][] = [];
    if (outage) for (let i = 0; i < int(45, 60); i++) extra.push("Network");
    if (monthStart && !weekend) for (let i = 0; i < int(10, 16); i++) extra.push("Billing");
    if (postRelease) for (let i = 0; i < int(4, 9); i++) extra.push("Performance");

    const todays: (typeof categories)[number][] = [...extra];
    for (let i = 0; i < n; i++) todays.push(pick(categories, catWeights));

    for (const category of todays) {
      const created = timeOnDay(day);
      let severity = pick(["Critical", "High", "Medium", "Low"] as const, [6, 20, 49, 25]);
      if (outage && category === "Network") severity = pick(["Critical", "High"] as const, [60, 40]);
      if (category === "Security Incident") severity = pick(["Critical", "High", "Medium"] as const, [30, 45, 25]);
      let department = deptFor[category];
      if (category === "Billing" && chance(0.3)) department = "Customer Success";
      const region = outage && category === "Network" ? "EMEA" : pick(regions, [42, 30, 18, 10]);

      let hours = skewed(deptMedianHours[department], 0.65) * sevMult[severity];
      if (weekend) hours *= 1.35;
      // Data Platform backlog grows from August onward.
      if (department === "Data Platform" && day >= Date.UTC(2026, 7, 1)) hours *= 1 + (day - Date.UTC(2026, 7, 1)) / (45 * DAY);
      if (outage && category === "Network") hours *= 1.8;
      hours = Math.max(0.2, hours);

      const closedAt = created + hours * HOUR;
      const isOpen = closedAt > END - DAY * 0.5 || (day > END - 10 * DAY && chance(0.15));
      const slaHours = { Critical: 8, High: 24, Medium: 72, Low: 120 }[severity];

      // CSAT falls as resolution time rises.
      let csat: number | null = null;
      if (!isOpen && chance(0.62)) {
        const score = 4.7 - Math.log1p(hours / slaHours) * 1.4 + between(-0.8, 0.8);
        csat = Math.min(5, Math.max(1, Math.round(score)));
      }

      rows.push({
        ticket_id: `TCK-${id++}`,
        created_at: isoDateTime(created),
        closed_at: isOpen ? "" : isoDateTime(closedAt),
        status: isOpen ? pick(["Open", "In Progress", "Waiting on Customer"], [40, 45, 15]) : "Resolved",
        category,
        severity,
        department,
        assigned_agent: pick(agents),
        channel: pick(channels, [40, 30, 20, 10]),
        region,
        resolution_hours: isOpen ? "" : round(hours, 1),
        sla_breached: isOpen ? "" : hours > slaHours ? "Yes" : "No",
        reopened: !isOpen && chance(hours > 48 ? 0.14 : 0.05) ? "TRUE" : "FALSE",
        csat_score: csat,
      });
    }
  }
  return rows;
}

// ---------- 2. SaaS subscription churn ----------
function saasChurn() {
  rand = mulberry32(2002);
  const plans = ["Starter", "Growth", "Business", "Enterprise"] as const;
  const planPrice = { Starter: 29, Growth: 79, Business: 189, Enterprise: 540 };
  const industries = ["Retail", "Healthcare", "Fintech", "Manufacturing", "Education", "Media", "Logistics", "Software"];
  const regions = ["North America", "EMEA", "APAC", "LATAM"];
  const acq = ["Organic Search", "Paid Ads", "Partner", "Outbound Sales", "Referral", "Product Hunt"];
  const rows: Record<string, string | number | null>[] = [];
  const signupStart = Date.UTC(2025, 0, 1);
  for (let i = 0; i < 2600; i++) {
    const plan = pick(plans, [42, 31, 19, 8]);
    const cycle = plan === "Enterprise" ? pick(["Annual", "Monthly"], [85, 15]) : pick(["Monthly", "Annual"], [65, 35]);
    const signup = signupStart + Math.floor(rand() * (END - 60 * DAY - signupStart));
    const region = pick(regions, [45, 28, 18, 9]);
    const seats = plan === "Starter" ? int(1, 5) : plan === "Growth" ? int(5, 25) : plan === "Business" ? int(20, 120) : int(100, 900);
    const activation = Math.min(1, Math.max(0.05, between(0.15, 1.0) * (plan === "Starter" ? 0.85 : 1)));
    const mau = Math.max(1, Math.round(seats * activation));
    const discount = cycle === "Annual" ? 0.83 : 1;
    const mrr = round(planPrice[plan] * (plan === "Starter" ? 1 : Math.max(1, seats / 5)) * discount * between(0.9, 1.1), 2);
    const tickets90 = Math.max(0, Math.round(skewed(2 + (1 - activation) * 6, 0.7)));

    // churn hazard: monthly Starter, low activation, many tickets
    let p = 0.12;
    if (plan === "Starter") p += 0.14;
    if (cycle === "Monthly") p += 0.08;
    if (activation < 0.3) p += 0.22;
    if (tickets90 > 8) p += 0.1;
    if (plan === "Enterprise") p -= 0.08;
    const churned = chance(Math.max(0.02, p));
    let churnDate: number | null = null;
    let reason = "";
    if (churned) {
      churnDate = signup + int(30, Math.max(31, Math.floor((END - DAY - signup) / DAY))) * DAY;
      reason = pick(["Price", "Missing Features", "Competitor", "Poor Onboarding", "Budget Cuts"], [24, 20, 16, 22, 18]);
      if (activation < 0.3 && chance(0.5)) reason = "Poor Onboarding";
    }
    // Planted: Q3 competitor wave in EMEA Growth accounts.
    if (!churned && plan === "Growth" && region === "EMEA" && chance(0.35)) {
      churnDate = Date.UTC(2026, 6, 1) + int(0, 91) * DAY;
      if (churnDate > signup + 30 * DAY) reason = "Competitor";
      else churnDate = null;
    }
    const isChurned = churnDate !== null;
    const lastLogin = isChurned ? churnDate! - int(3, 40) * DAY : END - int(1, activation > 0.5 ? 6 : 35) * DAY;
    const nps = Math.min(10, Math.max(0, Math.round(between(3, 9) + activation * 2 - (tickets90 > 8 ? 2 : 0) - (isChurned ? 2 : 0))));

    rows.push({
      customer_id: `CUS-${String(50000 + i)}`,
      company_name: `${pick(["Blue", "North", "Bright", "Vertex", "Summit", "Atlas", "Nimbus", "Cedar", "Harbor", "Pioneer", "Quantum", "Lumen"])} ${pick(["Labs", "Systems", "Health", "Logistics", "Retail Co", "Analytics", "Partners", "Works", "Group", "Digital"])}`,
      signup_date: usDate(signup),
      plan,
      billing_cycle: cycle,
      region,
      industry: pick(industries),
      acquisition_channel: pick(acq, [28, 22, 14, 16, 14, 6]),
      seats,
      monthly_active_users: mau,
      mrr_usd: mrr,
      support_tickets_90d: tickets90,
      nps_score: nps,
      last_login_date: usDate(Math.max(signup, lastLogin)),
      churned: isChurned ? "Yes" : "No",
      churn_date: isChurned ? usDate(churnDate!) : "",
      churn_reason: isChurned ? reason : "",
    });
  }
  return rows;
}

// ---------- 3. E-commerce fulfillment ----------
function ecommerce() {
  rand = mulberry32(3003);
  const warehouses = ["Reno NV", "Memphis TN", "Columbus OH", "Allentown PA", "Ontario CA"];
  const carriers = ["UPS", "FedEx", "USPS", "DHL", "OnTrac"];
  const cats = ["Electronics", "Home & Kitchen", "Apparel", "Beauty", "Sports & Outdoors", "Toys", "Books", "Grocery"];
  const catValue = { Electronics: 220, "Home & Kitchen": 85, Apparel: 60, Beauty: 38, "Sports & Outdoors": 95, Toys: 45, Books: 24, Grocery: 52 } as Record<string, number>;
  const states = ["CA", "TX", "NY", "FL", "IL", "PA", "OH", "GA", "NC", "WA", "AZ", "MA", "NJ", "VA", "CO", "TN"];
  const rows: Record<string, string | number | null>[] = [];
  let id = 700001;
  const start = Date.UTC(2026, 3, 1);
  for (let day = start; day < END; day += DAY) {
    const n = Math.round(between(30, 46) * (new Date(day).getUTCDay() === 1 ? 1.3 : 1));
    for (let i = 0; i < n; i++) {
      const ordered = timeOnDay(day);
      const warehouse = pick(warehouses, [20, 26, 20, 18, 16]);
      const carrier = pick(carriers, [30, 26, 22, 10, 12]);
      const category = pick(cats, [16, 18, 17, 10, 10, 8, 9, 12]);
      const method = pick(["Standard", "Expedited", "Overnight"], [70, 22, 8]);
      let fulfil = skewed(16, 0.5);
      // Planted: Memphis staffing shortage from 2026-09-01.
      if (warehouse === "Memphis TN" && day >= Date.UTC(2026, 8, 1)) fulfil *= 2.6;
      if (method === "Overnight") fulfil *= 0.4;
      const shipped = ordered + fulfil * HOUR;
      const promisedDays = { Standard: 5, Expedited: 3, Overnight: 1 }[method]!;
      let transit = Math.max(1, Math.round(skewed(promisedDays * 0.7, 0.35)));
      if (carrier === "OnTrac") transit += chance(0.45) ? int(1, 3) : 0; // planted late carrier
      const delivered = shipped + transit * DAY;
      const totalDays = (delivered - ordered) / DAY;
      const late = totalDays > promisedDays + 1;
      let status = delivered < END ? "Delivered" : shipped < END ? "In Transit" : "Processing";
      if (chance(0.025)) status = "Cancelled";
      let returnReason = "";
      if (status === "Delivered" && chance(category === "Electronics" ? 0.16 : category === "Apparel" ? 0.12 : 0.04)) {
        status = "Returned";
        returnReason = category === "Electronics" ? pick(["Defective", "Not as Described", "Changed Mind"], [50, 30, 20]) : pick(["Wrong Size", "Changed Mind", "Damaged in Transit", "Not as Described"], [category === "Apparel" ? 55 : 5, 25, 15, 15]);
      }
      const units = pick([1, 1, 1, 2, 2, 3, 4, 6]);
      rows.push({
        order_id: `ORD-${id++}`,
        order_timestamp: isoZ(ordered),
        ship_timestamp: status === "Processing" || status === "Cancelled" ? "" : isoZ(shipped),
        delivery_timestamp: status === "Delivered" || status === "Returned" ? isoZ(delivered) : "",
        warehouse,
        carrier,
        shipping_method: method,
        product_category: category,
        units,
        order_value_usd: round(skewed(catValue[category], 0.45) * units, 2),
        customer_state: pick(states),
        fulfillment_hours: status === "Processing" || status === "Cancelled" ? "" : round(fulfil, 1),
        transit_days: status === "Delivered" || status === "Returned" ? transit : "",
        delivered_late: status === "Delivered" || status === "Returned" ? (late ? "Yes" : "No") : "",
        status,
        return_reason: returnReason,
      });
    }
  }
  return rows;
}

mkdirSync(OUT_DIR, { recursive: true });
const datasets = [
  ["support_tickets.csv", supportTickets()],
  ["saas_churn.csv", saasChurn()],
  ["ecommerce_fulfillment.csv", ecommerce()],
] as const;
for (const [name, rows] of datasets) {
  writeFileSync(path.join(OUT_DIR, name), toCsv(rows));
  console.log(`wrote public/samples/${name}  (${rows.length.toLocaleString()} rows, ${Object.keys(rows[0]).length} columns)`);
}
