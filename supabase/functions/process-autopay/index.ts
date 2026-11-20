// @ts-nocheck
declare const Deno: any;
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function fireDealerWebhook(
  admin: any,
  dealer: { id: string; webhook_url: string | null; webhook_secret: string | null; dealership_name?: string },
  lead: any,
  purchaseId: string,
  pricePaid: number,
): Promise<boolean> {
  const url = (dealer.webhook_url || "").trim();
  if (!url) return false;

  // Idempotency check: if this purchase already had a successful webhook delivery, skip sending again
  const { data: existingLog } = await admin
    .from("delivery_logs")
    .select("id")
    .eq("purchase_id", purchaseId)
    .eq("channel", "webhook")
    .eq("success", true)
    .limit(1)
    .maybeSingle();

  if (existingLog) {
    console.log(`[WEBHOOK] Purchase ${purchaseId} already successfully delivered. Skipping duplicate dispatch.`);
    await admin.from("purchases").update({ delivery_status: "delivered", delivery_method: "webhook" }).eq("id", purchaseId);
    return true;
  }

  const payload = {
    first_name: lead.first_name ?? "",
    last_name: lead.last_name ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    city: lead.city ?? "",
    province: lead.province ?? "",
    income: lead.income ?? "",
    credit_range_min: lead.credit_range_min ?? "",
    credit_range_max: lead.credit_range_max ?? "",
    vehicle_preference: lead.vehicle_preference ?? "",
    trade_in: !!lead.trade_in,
    "trade_in vehicle": lead.trade_in_vehicle ?? "",
    bankruptcy: lead.has_bankruptcy ? "yes" : "",
    notes: lead.notes ?? "",
  };
  const body = JSON.stringify(payload);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "MayaX-Webhook/1.0",
    "X-MayaX-Event": "lead.purchased",
    "X-MayaX-Reference": lead.reference_code ?? "",
  };
  if (dealer.webhook_secret) {
    try {
      headers["X-MayaX-Signature"] = `sha256=${await hmacSha256Hex(dealer.webhook_secret, body)}`;
    } catch (_) { /* ignore signing errors */ }
  }

  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [0, 1000, 2000];

  let success = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt - 1] > 0) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1]));
    }

    let responseCode: number | null = null;
    let errorDetails: string | null = null;
    let attemptSuccess = false;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
      responseCode = res.status;
      attemptSuccess = res.ok;
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        errorDetails = txt.slice(0, 500);
      }
    } catch (err) {
      errorDetails = (err as Error).message?.slice(0, 500) || "Webhook request failed";
    } finally {
      clearTimeout(timeout);
    }

    const summary = `lead.purchased ${lead.reference_code ?? ""} (attempt ${attempt}/${MAX_ATTEMPTS})`;
    await admin.from("delivery_logs").insert({
      purchase_id: purchaseId,
      channel: "webhook",
      endpoint: url,
      success: attemptSuccess,
      response_code: responseCode,
      error_details: errorDetails,
      payload_summary: summary,
    });

    if (attemptSuccess) {
      success = true;
      break;
    }
  }

  if (success) {
    await admin.from("purchases").update({ delivery_status: "delivered", delivery_method: "webhook" }).eq("id", purchaseId);
  } else {
    await admin.from("purchases").update({ delivery_status: "failed", delivery_method: "webhook" }).eq("id", purchaseId);
  }

  return success;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    let reqBody: any = {};
    try {
      if (req.method === "POST") {
        reqBody = await req.json();
      }
    } catch (_) {
      // ignore JSON parse errors
    }

    // MODE: FLUSH PENDING WEBHOOKS ONLY
    // Useful for flushing backlogged leads without purchasing new ones
    if (reqBody?.flush_pending === true) {
      let query = admin
        .from("purchases")
        .select(`
          id,
          price_paid,
          delivery_status,
          dealer_id,
          dealers (id, webhook_url, webhook_secret, dealership_name),
          leads (id, reference_code, first_name, last_name, phone, email, city, province, income, credit_range_min, credit_range_max, vehicle_preference, trade_in, trade_in_vehicle, has_bankruptcy, notes)
        `)
        .eq("delivery_status", "pending");

      if (reqBody.dealer_id) {
        query = query.eq("dealer_id", reqBody.dealer_id);
      }

      const { data: pendingPurchases, error: pendingErr } = await query.order("purchased_at", { ascending: true });

      if (pendingErr) {
        return new Response(JSON.stringify({ error: pendingErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let flushed = 0;
      let failed = 0;
      const details: any[] = [];

      for (const p of (pendingPurchases || [])) {
        const dealer = Array.isArray(p.dealers) ? p.dealers[0] : p.dealers;
        const lead = Array.isArray(p.leads) ? p.leads[0] : p.leads;

        if (!dealer?.webhook_url || !lead) {
          details.push({ purchase_id: p.id, skipped: "No webhook URL configured or missing lead" });
          continue;
        }

        const success = await fireDealerWebhook(admin, dealer, lead, p.id, Number(p.price_paid || 0));
        if (success) {
          flushed++;
          details.push({ purchase_id: p.id, lead_ref: lead.reference_code, status: "delivered" });
        } else {
          failed++;
          details.push({ purchase_id: p.id, lead_ref: lead.reference_code, status: "failed" });
        }
      }

      return new Response(
        JSON.stringify({
          message: `Flushed ${flushed} pending webhooks (${failed} failed, ${pendingPurchases?.length ?? 0} total found)`,
          flushed,
          failed,
          total: pendingPurchases?.length ?? 0,
          details,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date();
    const currentDay = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][now.getDay()];
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const todayStr = now.toISOString().split("T")[0];
    const periodStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

    // Fetch all enabled autopay settings
    const { data: allSettings, error: settingsErr } = await admin
      .from("autopay_settings")
      .select("*")
      .eq("enabled", true);

    if (settingsErr) {
      return new Response(JSON.stringify({ error: settingsErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!allSettings || allSettings.length === 0) {
      return new Response(JSON.stringify({ message: "No active autopay settings", processed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all available leads
    const { data: availableLeads, error: leadsErr } = await admin
      .from("leads")
      .select("*")
      .eq("sold_status", "available")
      .order("ai_score", { ascending: false });

    if (leadsErr || !availableLeads) {
      return new Response(JSON.stringify({ error: leadsErr?.message ?? "Failed to fetch leads" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Array<{
      dealer_id: string;
      purchased: number;
      pending_flushed: number;
      skipped: string;
      errors: string[];
    }> = [];

    for (const ap of allSettings) {
      const dealerResult = { dealer_id: ap.dealer_id, purchased: 0, pending_flushed: 0, skipped: "", errors: [] as string[] };

      // Get dealer info (including webhook configuration)
      const { data: dealer } = await admin
        .from("dealers")
        .select("id, wallet_balance, subscription_tier, webhook_url, webhook_secret, dealership_name, email, notification_email")
        .eq("id", ap.dealer_id)
        .single();

      if (!dealer) {
        dealerResult.errors.push("Dealer not found");
        results.push(dealerResult);
        continue;
      }

      // Check active days
      const activeDays = (ap.active_days as string[]) ?? [];
      if (activeDays.length > 0 && !activeDays.includes(currentDay)) {
        dealerResult.skipped = "Not an active day";
        // Even if not active day for new buying, flush any pending backlogged webhooks if URL is set
        if (dealer.webhook_url) {
          const { data: backlog } = await admin
            .from("purchases")
            .select("id, price_paid, lead_id, delivery_status, leads (*)")
            .eq("dealer_id", dealer.id)
            .eq("delivery_status", "pending");
          if (backlog && backlog.length > 0) {
            for (const item of backlog) {
              const lead = Array.isArray(item.leads) ? item.leads[0] : item.leads;
              if (lead) {
                const ok = await fireDealerWebhook(admin, dealer, lead, item.id, Number(item.price_paid || 0));
                if (ok) dealerResult.pending_flushed++;
              }
            }
          }
        }
        results.push(dealerResult);
        continue;
      }

      // Check time window
      const startTime = ap.start_time ?? "00:00";
      const endTime = ap.end_time ?? "23:59";
      if (currentTime < startTime || currentTime > endTime) {
        dealerResult.skipped = "Outside active hours";
        // Also flush any pending backlogged webhooks if URL is set
        if (dealer.webhook_url) {
          const { data: backlog } = await admin
            .from("purchases")
            .select("id, price_paid, lead_id, delivery_status, leads (*)")
            .eq("dealer_id", dealer.id)
            .eq("delivery_status", "pending");
          if (backlog && backlog.length > 0) {
            for (const item of backlog) {
              const lead = Array.isArray(item.leads) ? item.leads[0] : item.leads;
              if (lead) {
                const ok = await fireDealerWebhook(admin, dealer, lead, item.id, Number(item.price_paid || 0));
                if (ok) dealerResult.pending_flushed++;
              }
            }
          }
        }
        results.push(dealerResult);
        continue;
      }

      // Check tier eligibility (elite or vip only)
      const { data: activeSub } = await admin
        .from("subscriptions")
        .select("tier, delay_hours, leads_per_month")
        .eq("dealer_id", dealer.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const effectiveTier = activeSub?.tier ?? dealer.subscription_tier;
      if (effectiveTier !== "elite" && effectiveTier !== "vip") {
        dealerResult.skipped = "Tier not eligible (requires Elite or VIP)";
        results.push(dealerResult);
        continue;
      }

      const delayHours = activeSub?.delay_hours ?? (effectiveTier === "vip" ? 0 : 6);
      const leadsLimit = activeSub?.leads_per_month ?? null;

      // Count today's autopay purchases to enforce leads_per_day
      const maxPerDay = ap.leads_per_day ?? 10;
      const todayStart = `${todayStr}T00:00:00.000Z`;
      const todayEnd = `${todayStr}T23:59:59.999Z`;

      const { count: todayCount } = await admin
        .from("purchases")
        .select("id", { count: "exact", head: true })
        .eq("dealer_id", dealer.id)
        .eq("delivery_method", "autopay")
        .gte("purchased_at", todayStart)
        .lte("purchased_at", todayEnd);

      const purchasedToday = todayCount ?? 0;
      if (purchasedToday >= maxPerDay) {
        dealerResult.skipped = `Daily limit reached (${purchasedToday}/${maxPerDay})`;
        results.push(dealerResult);
        continue;
      }

      const remaining = maxPerDay - purchasedToday;

      // Check monthly usage
      let currentMonthUsage = 0;
      if (leadsLimit !== null) {
        const { data: usageRow } = await admin
          .from("dealer_subscription_usage")
          .select("leads_used")
          .eq("dealer_id", dealer.id)
          .eq("period_start", periodStart)
          .maybeSingle();
        currentMonthUsage = usageRow?.leads_used ?? 0;
        if (currentMonthUsage >= leadsLimit) {
          dealerResult.skipped = `Monthly limit reached (${currentMonthUsage}/${leadsLimit})`;
          results.push(dealerResult);
          continue;
        }
      }

      // Filter leads matching dealer criteria
      let matchingLeads = availableLeads.filter((lead) => {
        if (lead.sold_status !== "available") return false;

        // Delay check
        if (delayHours > 0) {
          const leadAge = (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60);
          if (leadAge < delayHours) return false;
        }

        // Price range filter
        const price = Number(lead.price);
        if (ap.price_range_min != null && price < Number(ap.price_range_min)) return false;
        if (ap.price_range_max != null && price > Number(ap.price_range_max)) return false;

        // Credit score filter
        if (ap.credit_score_min != null && lead.credit_range_min != null && lead.credit_range_min < ap.credit_score_min) return false;
        if (ap.credit_score_max != null && lead.credit_range_max != null && lead.credit_range_max > ap.credit_score_max) return false;

        // Income filter
        const leadIncome = Number(lead.income ?? 0);
        if (ap.income_min != null && leadIncome < Number(ap.income_min)) return false;
        if (ap.income_max != null && leadIncome > Number(ap.income_max)) return false;

        // Province filter
        if (ap.state && lead.province && lead.province !== ap.state) return false;

        // City filter
        if (ap.city && lead.city && !lead.city.toLowerCase().includes(ap.city.toLowerCase())) return false;

        // Vehicle search filter
        if (ap.vehicle_search && lead.vehicle_preference) {
          const pref = lead.vehicle_preference.toLowerCase();
          if (!pref.includes(ap.vehicle_search.toLowerCase())) return false;
        }

        return true;
      });

      // Limit to remaining daily quota & monthly quota
      let maxToBuy = remaining;
      if (leadsLimit !== null) {
        maxToBuy = Math.min(maxToBuy, leadsLimit - currentMonthUsage);
      }
      matchingLeads = matchingLeads.slice(0, maxToBuy);

      let currentBalance = Number(dealer.wallet_balance);
      let purchased = 0;

      for (const lead of matchingLeads) {
        const price = Number(lead.price);
        if (currentBalance < price) {
          dealerResult.errors.push("Insufficient balance");
          break;
        }

        // Atomically mark as sold
        const { error: updateErr } = await admin
          .from("leads")
          .update({
            sold_status: "sold",
            sold_to_dealer_id: dealer.id,
            sold_at: new Date().toISOString(),
          })
          .eq("id", lead.id)
          .eq("sold_status", "available");

        if (updateErr) continue;

        // Mark in-memory
        lead.sold_status = "sold";

        currentBalance -= price;
        await admin.from("dealers").update({ wallet_balance: currentBalance }).eq("id", dealer.id);

        await admin.from("wallet_transactions").insert({
          dealer_id: dealer.id,
          type: "autopay",
          amount: -price,
          balance_after: currentBalance,
          description: `AutoPay: purchased lead ${lead.reference_code}`,
          reference_id: lead.id,
        });

        const { data: purchaseRow } = await admin
          .from("purchases")
          .insert({
            dealer_id: dealer.id,
            lead_id: lead.id,
            price_paid: price,
            dealer_tier_at_purchase: effectiveTier,
            delivery_status: dealer.webhook_url ? "pending" : "delivered",
            delivery_method: dealer.webhook_url ? "webhook" : "autopay",
          })
          .select("id")
          .single();

        // Immediately fire dealer webhook if configured (non-blocking for purchase validity)
        if (purchaseRow?.id && dealer.webhook_url) {
          try {
            await fireDealerWebhook(admin, dealer, lead, purchaseRow.id, price);
          } catch (webhookErr) {
            console.error(`[WEBHOOK] Unexpected error firing webhook for purchase ${purchaseRow.id}:`, (webhookErr as Error).message);
          }
        }

        purchased++;
      }

      // Flush any backlogged pending webhooks for this dealer from prior runs
      if (dealer.webhook_url) {
        const { data: backloggedPurchases } = await admin
          .from("purchases")
          .select("id, price_paid, lead_id, delivery_status, leads (*)")
          .eq("dealer_id", dealer.id)
          .eq("delivery_status", "pending");

        if (backloggedPurchases && backloggedPurchases.length > 0) {
          console.log(`AutoPay: Flushing ${backloggedPurchases.length} backlogged pending purchases for dealer ${dealer.dealership_name || dealer.id}`);
          for (const item of backloggedPurchases) {
            const lead = Array.isArray(item.leads) ? item.leads[0] : item.leads;
            if (lead) {
              const ok = await fireDealerWebhook(admin, dealer, lead, item.id, Number(item.price_paid || 0));
              if (ok) dealerResult.pending_flushed++;
            }
          }
        }
      }

      // Update monthly usage
      if (purchased > 0 && leadsLimit !== null) {
        const { data: existingUsage } = await admin
          .from("dealer_subscription_usage")
          .select("id, leads_used")
          .eq("dealer_id", dealer.id)
          .eq("period_start", periodStart)
          .maybeSingle();

        if (existingUsage) {
          await admin
            .from("dealer_subscription_usage")
            .update({ leads_used: existingUsage.leads_used + purchased })
            .eq("id", existingUsage.id);
        } else if (leadsLimit) {
          await admin.from("dealer_subscription_usage").insert({
            dealer_id: dealer.id,
            period_start: periodStart,
            leads_used: purchased,
            leads_limit: leadsLimit,
          });
        }
      }

      dealerResult.purchased = purchased;
      results.push(dealerResult);
      if (purchased > 0 || dealerResult.pending_flushed > 0) {
        console.log(`AutoPay: dealer ${dealer.id} purchased ${purchased} leads, flushed ${dealerResult.pending_flushed} pending webhooks`);
      }
    }

    const totalPurchased = results.reduce((s, r) => s + r.purchased, 0);
    const totalFlushed = results.reduce((s, r) => s + r.pending_flushed, 0);
    return new Response(
      JSON.stringify({
        processed: allSettings.length,
        total_purchased: totalPurchased,
        total_pending_flushed: totalFlushed,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("process-autopay error:", (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
