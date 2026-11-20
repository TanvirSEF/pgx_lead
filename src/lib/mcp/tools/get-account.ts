import { defineTool } from "@lovable.dev/mcp-js";
import { dealerForUser, errorResult, textResult } from "../supabase";

export default defineTool({
  name: "get_account",
  title: "Get my dealer account",
  description:
    "Return the signed-in dealer's profile, approval status, subscription tier and current wallet balance.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const { supabase, dealer } = await dealerForUser(ctx);
    if (!dealer) return errorResult("No dealer account is linked to this user.");

    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("tier, status, billing_cycle, price, leads_per_month, delay_hours, start_date, end_date, auto_renew")
      .eq("dealer_id", dealer.id)
      .eq("status", "active")
      .maybeSingle();

    return textResult({ dealer, active_subscription: subscription ?? null });
  },
});
