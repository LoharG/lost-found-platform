"use strict";

// Ownership claims.
// - A claimant answers the reporter's ownership question privately.
// - Only the reporter can accept/decline; only the claimant can withdraw.
// - Concurrency: decisions lock the item row first, then the claim row, so two
//   accepts for different claims serialize and the second gets 409. Repeating
//   the same decision is idempotent and returns the current state.
// - Duplicate submissions hit a partial unique index (one pending claim per
//   claimant per item) and return the existing claim.

const express = require("express");
const { z } = require("zod");
const { withTransaction } = require("../db");
const { HttpError } = require("../middleware/errors");
const { requireUser } = require("../middleware/security");
const { displayName, timestamp } = require("../services/serializers");
const { loadItem, parseId, assertVisible } = require("../services/items");
const { ensureConversation } = require("./conversations");

function serializeClaim(row, { includeAnswer }) {
  return {
    id: Number(row.id),
    itemId: row.item_id,
    status: row.status,
    claimant: { id: row.claimant_id, displayName: displayName(row.claimant_name) },
    ...(includeAnswer ? { answer: row.answer } : {}),
    createdAt: timestamp(row.created_at),
    decidedAt: timestamp(row.decided_at),
    conversationId: row.conversation_id ? Number(row.conversation_id) : null,
  };
}

const CLAIM_SELECT = `
  SELECT c.*, u.name AS claimant_name, conv.id AS conversation_id
  FROM claims c
  JOIN users u ON u.id = c.claimant_id
  LEFT JOIN conversations conv ON conv.item_id = c.item_id AND conv.participant_id = c.claimant_id`;

function claimRoutes({ pool, notifier, limits }) {
  const router = express.Router();

  router.post("/items/:id/claims", requireUser, limits.claim, async (req, res) => {
    const itemId = parseId(req.params.id, "Item ID");
    const { answer } = z.object({ answer: z.string().trim().min(1, "Please answer the question").max(1000) }).strict().parse(req.body || {});

    const result = await withTransaction(pool, async (db) => {
      const item = assertVisible(await loadItem(db, itemId, { forUpdate: true }), req.user);
      if (item.user_id === req.user.id) throw new HttpError(400, "You cannot claim your own listing", "own_listing");
      if (item.moderation_state !== "visible") throw new HttpError(410, "This listing is no longer available", "item_removed");
      if (item.status !== "open") throw new HttpError(409, "This listing is not accepting claims right now", "not_open");

      const inserted = await db.query(
        `INSERT INTO claims (item_id, claimant_id, answer) VALUES ($1, $2, $3)
         ON CONFLICT (item_id, claimant_id) WHERE status = 'pending' DO NOTHING
         RETURNING id`,
        [itemId, req.user.id, answer]
      );
      const conversation = await ensureConversation(db, item, req.user.id);
      let claimId = inserted.rows[0]?.id;
      const notifications = [];
      if (claimId) {
        notifications.push(
          await notifier.notify(db, {
            userId: item.user_id,
            type: "claim_received",
            itemId,
            data: { claimId: Number(claimId), conversationId: Number(conversation.id) },
            dedupeKey: `claim:${claimId}:received`,
          })
        );
      } else {
        const existing = await db.query(
          "SELECT id FROM claims WHERE item_id = $1 AND claimant_id = $2 AND status = 'pending'",
          [itemId, req.user.id]
        );
        claimId = existing.rows[0].id;
      }
      const { rows } = await db.query(`${CLAIM_SELECT} WHERE c.id = $1`, [claimId]);
      return { claim: rows[0], created: Boolean(inserted.rows[0]), notifications };
    });

    await notifier.deliver(result.notifications);
    res.status(result.created ? 201 : 200).json({ claim: serializeClaim(result.claim, { includeAnswer: true }), created: result.created });
  });

  // Reporter sees every claim (with answers); a claimant sees only their own.
  router.get("/items/:id/claims", requireUser, async (req, res) => {
    const itemId = parseId(req.params.id, "Item ID");
    const item = assertVisible(await loadItem(pool, itemId), req.user);
    const isOwner = item.user_id === req.user.id;
    const { rows } = await pool.query(
      `${CLAIM_SELECT} WHERE c.item_id = $1 ${isOwner ? "" : "AND c.claimant_id = $2"} ORDER BY c.created_at DESC, c.id DESC`,
      isOwner ? [itemId] : [itemId, req.user.id]
    );
    res.json({ claims: rows.map((row) => serializeClaim(row, { includeAnswer: true })) });
  });

  async function decide(req, action) {
    const claimId = parseId(req.params.id, "Claim ID");
    const lookup = await pool.query("SELECT item_id FROM claims WHERE id = $1", [claimId]);
    if (!lookup.rows[0]) throw new HttpError(404, "Claim not found", "claim_not_found");
    const itemId = lookup.rows[0].item_id;

    return withTransaction(pool, async (db) => {
      const item = await loadItem(db, itemId, { forUpdate: true });
      const { rows } = await db.query("SELECT * FROM claims WHERE id = $1 FOR UPDATE", [claimId]);
      const claim = rows[0];
      const isOwner = item && item.user_id === req.user.id;
      const isClaimant = claim.claimant_id === req.user.id;

      if (action === "withdraw" ? !isClaimant : !isOwner) {
        // Do not reveal claims to people who are not part of them.
        throw new HttpError(isOwner || isClaimant ? 403 : 404, isOwner || isClaimant ? "You cannot do that" : "Claim not found", isOwner || isClaimant ? "forbidden" : "claim_not_found");
      }
      if (!item || item.deleted_at) throw new HttpError(404, "This listing does not exist or was deleted", "item_not_found");

      const target = { accept: "accepted", decline: "declined", withdraw: "withdrawn" }[action];
      if (claim.status === target) return { claim, notifications: [], changed: false };
      if (claim.status !== "pending") {
        throw new HttpError(409, `This claim is already ${claim.status}`, "claim_not_pending", { status: claim.status });
      }
      if (action === "accept") {
        if (item.moderation_state !== "visible") throw new HttpError(409, "This listing was removed by a moderator", "item_removed");
        if (item.status !== "open") throw new HttpError(409, "Another claim was already accepted for this listing", "item_not_open");
      }

      const updated = await db.query(
        "UPDATE claims SET status = $1, decided_at = now(), updated_at = now() WHERE id = $2 RETURNING *",
        [target, claimId]
      );
      if (action === "accept") {
        await db.query("UPDATE items SET status = 'claimed', status_changed_at = now(), updated_at = now() WHERE id = $1", [itemId]);
      }

      const notifications = [];
      if (action === "withdraw") {
        notifications.push(
          await notifier.notify(db, {
            userId: item.user_id,
            type: "claim_update",
            itemId,
            data: { claimId, status: target },
            dedupeKey: `claim:${claimId}:${target}`,
          })
        );
      } else {
        notifications.push(
          await notifier.notify(db, {
            userId: claim.claimant_id,
            type: "claim_update",
            itemId,
            data: { claimId, status: target },
            dedupeKey: `claim:${claimId}:${target}`,
          })
        );
      }
      return { claim: updated.rows[0], notifications, changed: true };
    });
  }

  for (const action of ["accept", "decline", "withdraw"]) {
    router.post(`/claims/:id/${action}`, requireUser, limits.claim, async (req, res) => {
      const result = await decide(req, action);
      await notifier.deliver(result.notifications);
      const { rows } = await pool.query(`${CLAIM_SELECT} WHERE c.id = $1`, [result.claim.id]);
      res.json({ claim: serializeClaim(rows[0], { includeAnswer: true }), changed: result.changed });
    });
  }

  return router;
}

module.exports = { claimRoutes };
