import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getAccount from "./tools/get-account";
import listAvailableLeads from "./tools/list-available-leads";
import listMyPurchases from "./tools/list-my-purchases";
import listWalletTransactions from "./tools/list-wallet-transactions";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "mayax-lead-hub",
  title: "MayaX Lead Hub",
  version: "0.1.0",
  instructions:
    "Tools for MayaX Lead Hub, an automotive dealer lead marketplace. Callers act as the signed-in dealer. Use `get_account` for profile, subscription and wallet balance, `list_available_leads` to browse the marketplace (contact details are hidden until a lead is purchased), `list_my_purchases` for purchased leads with full contact details, and `list_wallet_transactions` for wallet activity.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [getAccount, listAvailableLeads, listMyPurchases, listWalletTransactions],
});
