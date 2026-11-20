import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "list_available_leads",
  title: "List available leads",
  description:
    "Browse leads currently available in the marketplace. Contact details stay hidden until a lead is purchased. Supports filtering by province, city, quality grade and price range.",
  inputSchema: {
    province: z.string().optional().describe("Filter by province, e.g. Ontario."),
    city: z.string().optional().describe("Filter by city (partial match)."),
    quality_grade: z.string().optional().describe("Filter by grade, e.g. A+, A, B+."),
    max_price: z.number().optional().describe("Only leads at or below this price."),
    limit: z.number().optional().describe("Maximum number of leads to return (default 20, max 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ province, city, quality_grade, max_price, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const supabase = supabaseForUser(ctx);
    const take = Math.min(Math.max(limit ?? 20, 1), 100);

    let query = supabase
      .from("leads")
      .select(
        "id, reference_code, price, quality_grade, ai_score, city, province, income, credit_range_min, credit_range_max, vehicle_preference, vehicle_price, vehicle_mileage, trade_in, buyer_type, appointment_time, created_at",
      )
      .eq("sold_status", "available")
      .order("created_at", { ascending: false })
      .limit(take);

    if (province) query = query.ilike("province", `%${province}%`);
    if (city) query = query.ilike("city", `%${city}%`);
    if (quality_grade) query = query.eq("quality_grade", quality_grade);
    if (typeof max_price === "number") query = query.lte("price", max_price);

    const { data, error } = await query;
    if (error) return errorResult(error.message);
    return textResult({ count: data?.length ?? 0, leads: data ?? [] });
  },
});
