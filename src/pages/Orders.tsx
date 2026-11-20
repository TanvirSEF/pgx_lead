import { useState, useEffect, useCallback } from "react";
import {
  Package,
  CheckCircle2,
  Clock,
  XCircle,
  RefreshCw,
  Search,
  Eye,
  Send,
  Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import OrderDetailModal from "@/components/OrderDetailModal";

interface LeadDetail {
  reference_code: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  buyer_type: string | null;
  credit_range_min: number | null;
  credit_range_max: number | null;
  income: number | null;
  city: string | null;
  province: string | null;
  vehicle_preference: string | null;
  vehicle_mileage: number | null;
  vehicle_price: number | null;
  documents: string[] | null;
  document_files: { name: string; path: string }[] | null;
  ai_score: number | null;
  quality_grade: string | null;
  price: number;
  notes: string | null;
  appointment_time: string | null;
  trade_in: boolean | null;
  trade_in_vehicle: string | null;
  has_bankruptcy: boolean | null;
}

interface OrderRow {
  id: string;
  price_paid: number;
  purchased_at: string;
  delivery_status: string;
  delivery_method: string | null;
  dealer_tier_at_purchase: string | null;
  lead_id: string;
  leads: LeadDetail | null;
}

const deliveryStatusConfig: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  delivered: { icon: CheckCircle2, color: "text-success", label: "Delivered" },
  pending: { icon: Clock, color: "text-warning", label: "Pending" },
  failed: { icon: XCircle, color: "text-destructive", label: "Failed" },
  retrying: { icon: RefreshCw, color: "text-cyan", label: "Retrying" },
};

const gradeBadge: Record<string, string> = {
  "A+": "bg-gold/20 text-gold border-gold/30",
  A: "bg-primary/20 text-primary border-primary/30",
  B: "bg-cyan/20 text-cyan border-cyan/30",
  C: "bg-muted text-muted-foreground border-border",
};

const Orders = () => {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [dealerId, setDealerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [flushing, setFlushing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<OrderRow | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { toast } = useToast();

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data: dealer } = await supabase
      .from("dealers")
      .select("id")
      .eq("user_id", session.user.id)
      .single();

    if (!dealer) return;
    setDealerId(dealer.id);

    const { data } = await supabase
      .from("purchases")
      .select(`
        id, price_paid, purchased_at, delivery_status, delivery_method, dealer_tier_at_purchase, lead_id,
        leads(reference_code, first_name, last_name, phone, email, buyer_type, credit_range_min, credit_range_max, income, city, province, vehicle_preference, vehicle_mileage, vehicle_price, documents, document_files, ai_score, quality_grade, price, notes, appointment_time, trade_in, trade_in_vehicle, has_bankruptcy)
      `)
      .eq("dealer_id", dealer.id)
      .order("purchased_at", { ascending: false });

    setOrders((data as unknown as OrderRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleFlushPending = async () => {
    if (!dealerId) return;
    setFlushing(true);
    try {
      const { data, error } = await supabase.functions.invoke("process-autopay", {
        body: { flush_pending: true, dealer_id: dealerId },
      });
      if (error) throw error;

      const flushed = data?.flushed ?? 0;
      const failed = data?.failed ?? 0;
      if (flushed > 0) {
        toast({
          title: "Webhooks Delivered ✓",
          description: `Successfully sent ${flushed} lead${flushed > 1 ? "s" : ""} to your webhook${failed > 0 ? ` (${failed} failed)` : ""}.`,
        });
        await load();
      } else if (failed > 0) {
        toast({
          title: "Webhook Delivery Failed",
          description: `${failed} lead(s) failed delivery. Please verify your Webhook URL in Settings.`,
          variant: "destructive",
        });
        await load();
      } else {
        toast({
          title: "No Pending Leads",
          description: data?.message || "All purchased leads have already been delivered.",
        });
      }
    } catch (err: any) {
      toast({
        title: "Dispatch Failed",
        description: err?.message || "Could not dispatch pending leads to webhook.",
        variant: "destructive",
      });
    } finally {
      setFlushing(false);
    }
  };

  const pendingCount = orders.filter((o) => o.delivery_status === "pending").length;

  const filtered = orders.filter((o) => {
    if (statusFilter !== "all" && o.delivery_status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const lead = o.leads;
      return (
        lead?.reference_code?.toLowerCase().includes(q) ||
        lead?.first_name?.toLowerCase().includes(q) ||
        lead?.last_name?.toLowerCase().includes(q) ||
        lead?.city?.toLowerCase().includes(q) ||
        lead?.province?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totalSpent = orders.reduce((s, o) => s + Number(o.price_paid), 0);

  if (loading) {
    return (
      <div className="p-6 space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="h-64 bg-card rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Orders</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Your purchase history — {orders.length} leads · ${totalSpent.toFixed(2)} invested
          </p>
        </div>
        {pendingCount > 0 && (
          <Button
            onClick={handleFlushPending}
            disabled={flushing}
            className="gap-2 bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 shrink-0"
          >
            {flushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send {pendingCount} Pending Lead{pendingCount > 1 ? "s" : ""} to Webhook
          </Button>
        )}
      </div>

      {pendingCount > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-amber-500/20 text-amber-400 shrink-0">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-amber-300 text-sm">
                {pendingCount} AutoPay lead{pendingCount > 1 ? "s" : ""} backed up & pending webhook delivery
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                These leads were purchased via AutoPay and have not yet been posted to your webhook endpoint. Click the button to dispatch them all immediately.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleFlushPending}
            disabled={flushing}
            className="gap-2 shrink-0 bg-amber-500 hover:bg-amber-600 text-black font-medium"
          >
            {flushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Dispatch All Now
          </Button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, ref code, location..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-card border-border"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px] bg-card border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="retrying">Retrying</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="glass-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>Reference</TableHead>
              <TableHead>Lead Name</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Grade</TableHead>
              <TableHead>Price Paid</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                  {orders.length === 0 ? "No orders yet. Visit the marketplace to purchase your first lead!" : "No orders match your filters."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((order) => {
                const lead = order.leads;
                const status = deliveryStatusConfig[order.delivery_status] ?? deliveryStatusConfig.pending;
                const StatusIcon = status.icon;

                return (
                  <TableRow key={order.id} className="border-border transition-colors cursor-pointer hover:bg-muted/30" onClick={() => setSelectedOrder(order)}>
                    <TableCell>
                      <span className="font-mono text-sm text-foreground">{lead?.reference_code ?? "—"}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-foreground">
                        {lead ? `${lead.first_name} ${lead.last_name}` : "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {lead?.city && lead?.province ? `${lead.city}, ${lead.province}` : "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {lead?.quality_grade && (
                        <Badge className={cn("text-[10px] px-1.5 py-0 border", gradeBadge[lead.quality_grade] ?? "bg-muted text-muted-foreground border-border")}>
                          {lead.quality_grade}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-semibold text-foreground">${Number(order.price_paid).toFixed(2)}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <StatusIcon className={cn("h-3.5 w-3.5", status.color)} />
                        <span className={cn("text-xs", status.color)}>{status.label}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {new Date(order.purchased_at).toLocaleDateString()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <OrderDetailModal
        order={selectedOrder}
        open={!!selectedOrder}
        onOpenChange={(open) => { if (!open) setSelectedOrder(null); }}
      />
    </div>
  );
};

export default Orders;
