import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { revokeDelegation } from "@/lib/hire/revoke-delegation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/hires/[id]/revoke — one-click revoke of a delegation.
 *
 * Body: { wallet } — the connected wallet (must match the delegation's user_id,
 * so a user can only revoke their own hires).
 *
 * Reuses the shared revokeDelegation (Altana Keystore revokeKey, signed by the
 * agent's admin key server-side). Returns the real revoke tx hash + the
 * isValidKey true→false proof. Supabase status updated to 'revoked'.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = String(params.id);
  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const wallet = String(body.wallet ?? "");
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: "wallet (0x address) required" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data: del, error } = await admin.from("delegations").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!del) return NextResponse.json({ error: "delegation not found" }, { status: 404 });

  // only the owner can revoke their own hire
  if (del.user_id?.toLowerCase() !== wallet.toLowerCase()) {
    return NextResponse.json({ error: "not your hire — cannot revoke" }, { status: 403 });
  }
  if (del.status !== "active") {
    return NextResponse.json({ error: `delegation is ${del.status}, not active` }, { status: 409 });
  }

  const result = await revokeDelegation(del);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "revoke failed" }, { status: 500 });
  }
  return NextResponse.json(
    { ok: true, id, tx: result.tx, isValidBefore: result.isValidBefore, isValidAfter: result.isValidAfter, status: "revoked" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
