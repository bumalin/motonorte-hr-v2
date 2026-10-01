import { redirect } from "next/navigation";
import { requireTab } from "@/lib/auth/session.ts";
import { periodStartOf, todayManila } from "@/lib/format.ts";

// /week?d=YYYY-MM-DD → that date's pay week (the "Go to week" picker; any past or future week)
export default async function WeekIndex({ searchParams }: PageProps<"/week">) {
  await requireTab("week");
  const d = (await searchParams).d;
  const day = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : todayManila();
  redirect(`/week/${periodStartOf(day)}`);
}
