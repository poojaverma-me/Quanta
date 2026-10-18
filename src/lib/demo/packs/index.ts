import type { DemoPack } from "../types";
import { ecommerce } from "./ecommerce";
import { saasChurn } from "./saas-churn";
import { supportTickets } from "./support-tickets";

/** Pre-computed analyses for the three sample datasets. */
export const DEMO_PACKS: DemoPack[] = [supportTickets, saasChurn, ecommerce];
