// Pay-terms form fields shared by createEmployee and addTermsChange (position, daily rate, daily allowance).
import * as z from "zod";
import { parsePesos, POSITION_KEYS } from "./format.ts";

export const TermsFields = z.object({
  position: z.enum(POSITION_KEYS),
  daily_rate: z.string().transform((v, ctx) => {
    const c = parsePesos(v);
    if (c === null || c <= 0) { ctx.addIssue({ code: "custom", message: "Enter a daily rate like 650 or 650.00" }); return z.NEVER; }
    if (c > 10000000) { ctx.addIssue({ code: "custom", message: "Daily rate can't exceed ₱100,000" }); return z.NEVER; }
    return c;
  }),
  daily_allowance: z.string().optional().transform((v, ctx) => {
    if (!v || v.trim() === "") return 0;
    const c = parsePesos(v);
    if (c === null) { ctx.addIssue({ code: "custom", message: "Enter an allowance like 100 or 100.00 (or leave blank)" }); return z.NEVER; }
    if (c > 1000000) { ctx.addIssue({ code: "custom", message: "Daily allowance can't exceed ₱10,000" }); return z.NEVER; }
    return c;
  }),
});
