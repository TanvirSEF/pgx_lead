import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dealerForUser, errorResult, textResult } from "../supabase";

export default defineTool({
  name: "list_my_purchases",
  title: "List my purchased leads",
  description:
    "List leads the signed-in dealer has purchased, including the price paid, delivery status and the full lead details.",
  inputSchema: {
    limit: z.number().optional().describe("Maximum number of purchases to return (default 20, max 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const { supabase, dealer } = await dealerForUser(ctx);
    if (!dealer) return errorResult("No dealer account is linked to this user.");
    const take = Math.min(Math.max(limit ?? 20, 1), 100);

    const { data, error } = await supabase
      .from("purchases")
      .select(
        "id, price_paid, delivery_status, delivery_method, purchased_at, dealer_tier_at_purchase, leads(id, reference_code, first_name, last_name, email, phone, city, province, income, credit_range_min, credit_range_max, vehicle_preference, appointment_time, quality_grade, notes)",
      )
      .eq("dealer_id", dealer.id)
      .order("purchased_at", { ascending: false })
      .limit(take);

    if (error) return errorResult(error.message);
    return textResult({ count: data?.length ?? 0, purchases: data ?? [] });
  },
});
