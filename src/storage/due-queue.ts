/**
 * The native delivery-queue capability (`claimDue`) shared by the memory and
 * Redis drivers. The drivers come from `@xtandard/kit`; this layer sits on their
 * extension points (ADR 0004): each driver only supplies the due keys to try,
 * and the per-delivery claim is a compare-and-swap on the delivery record, so a
 * delivery is never handed to two concurrent claimers.
 *
 * @module
 */

import type { CompareAndSwapKvStorage } from "@xtandard/kit/storage";
import { deliveryKey, dueKey, parseDueKey, ROOT, type DueEntry } from "../keys.ts";
import type { Delivery } from "../schema.ts";

/** Matches the due-index keys (`whk/{app}/due/…`) across all applications. */
export const DUE_KEY_RE = new RegExp(`^${ROOT}/[^/]+/due/`);

/** Input of {@link DeliveryQueueStorage.claimDue}. */
export interface ClaimDueInput {
  now: string;
  limit: number;
  leaseMs: number;
}

/**
 * Claim deliveries from `candidates` (due keys, chronological), up to `limit`.
 * Orphaned and terminal entries are swept; a delivery is claimable when
 * pending, or delivering with an expired lease. A claimed delivery gets
 * `status: "delivering"` with `leaseUntil = now + leaseMs`, and its due entry
 * moves to the lease expiry so a crashed claimer's work re-surfaces.
 */
export async function claimDueEntries(
  storage: CompareAndSwapKvStorage,
  candidates: Iterable<string>,
  input: ClaimDueInput,
): Promise<Delivery[]> {
  const nowMillis = Date.parse(input.now);
  const leaseExpiryMillis = nowMillis + input.leaseMs;
  const claimed: Delivery[] = [];
  for (const key of candidates) {
    if (claimed.length >= input.limit) break;
    const parsed = parseDueKey(key);
    if (!parsed || parsed.dueAtMillis > nowMillis) continue;
    const entry = await storage.getItem<DueEntry>(key);
    if (!entry) {
      await storage.removeItem(key); // stale index member with no backing key
      continue;
    }
    const dKey = deliveryKey(entry.app, entry.deliveryId);
    const delivery = await storage.getItem<Delivery>(dKey);
    // Orphaned or already-terminal entries are garbage — sweep them.
    if (!delivery || delivery.status === "succeeded" || delivery.status === "failed") {
      await storage.removeItem(key);
      continue;
    }
    // Claimable = pending, or delivering with an expired lease. A delivery with
    // an active lease was claimed elsewhere; its due entry already sits near the
    // lease expiry, so just skip it.
    const leaseExpired =
      delivery.status === "delivering" &&
      (!delivery.leaseUntil || Date.parse(delivery.leaseUntil) <= nowMillis);
    if (delivery.status !== "pending" && !leaseExpired) continue;

    const next: Delivery = {
      ...delivery,
      status: "delivering",
      leaseUntil: new Date(leaseExpiryMillis).toISOString(),
      updatedAt: input.now,
    };
    if (!(await storage.compareAndSwap({ key: dKey, expected: delivery, next }))) continue;
    await storage.removeItem(key);
    await storage.setItem(dueKey(entry.app, leaseExpiryMillis, entry.deliveryId), entry);
    claimed.push(next);
  }
  return claimed;
}
