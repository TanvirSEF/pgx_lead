import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dealerForUser, errorResult, textResult } from "../supabase";

export default defineTool({
  name: "list_wallet_transactions",
  title: "List wallet transactions",
  description:
    "List the signed-in dealer's wallet activity (top-ups, lead purchases, refunds) with the running balance, plus the current balance.",
  inputSchema: {
    limit: z.number().optional().describe("Maximum number of transactions to return (default 25, max 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const { supabase, dealer } = await dealerForUser(ctx);
    if (!dealer) return errorResult("No dealer account is linked to this user.");
    const take = Math.min(Math.max(limit ?? 25, 1), 100);

    const { data, error } = await supabase
      .from("wallet_transactions")
      .select("id, type, amount, balance_after, description, reference_id, created_at")
      .eq("dealer_id", dealer.id)
      .order("created_at", { ascending: false })
      .limit(take);

    if (error) return errorResult(error.message);
    return textResult({
      current_balance: dealer.wallet_balance,
      count: data?.length ?? 0,
      transactions: data ?? [],
    });
  },
});
