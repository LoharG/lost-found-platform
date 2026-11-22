"use strict";

// Moderator queue and actions. Every action writes an audit row in
// moderation_actions inside the same transaction as the change it records.

const express = require("express");
const { z } = require("zod");
const { withTransaction } = require("../db");
const { HttpError } = require("../middleware/errors");
const { requireModerator } = require("../middleware/security");
const { imagePaths } = require("../services/images");
const { ownerItem, displayName, timestamp } = require("../services/serializers");
const { loadItem, parseId, imagesFor } = require("../services/items");

function moderationRoutes({ pool, storage, notifier }) {
  const router = express.Router();
  router.use("/moderation", requireModerator);

  router.get("/moderation/queue", async (req, res) => {
    const status = z.enum(["open", "actioned", "dismissed"]).default("open").parse(req.query.status || undefined);
    const { rows } = await pool.query(
      `SELECT r.*, reporter.name AS reporter_name
       FROM listing_reports r LEFT JOIN users reporter ON reporter.id = r.reporter_id
       WHERE r.status = $1 ORDER BY r.created_at ASC, r.id ASC LIMIT 200`,
      [status]
    );
    const itemIds = [...new Set(rows.map((row) => row.item_id))];
    const items = itemIds.length
      ? (await pool.query("SELECT i.*, u.name AS user_name FROM items i LEFT JOIN users u ON u.id = i.user_id WHERE i.id = ANY($1)", [itemIds])).rows
      : [];
    const images = await imagesFor(pool, itemIds);
    const byItem = new Map(items.map((item) => [item.id, { item: ownerItem(item, images.get(item.id) || []), deleted: Boolean(item.deleted_at), reports: [] }]));
    for (const row of rows) {
      byItem.get(row.item_id)?.reports.push({
        id: Number(row.id),
        reason: row.reason,
        details: row.details,
        status: row.status,
        reporter: displayName(row.reporter_name),
        createdAt: timestamp(row.created_at),
      });
    }
    res.set("Cache-Control", "private, no-store").json({ entries: [...byItem.values()] });
  });

  router.get("/moderation/actions", async (req, res) => {
    const { rows } = await pool.query(
      `SELECT a.*, m.name AS moderator_name FROM moderation_actions a LEFT JOIN users m ON m.id = a.moderator_id
       ORDER BY a.created_at DESC, a.id DESC LIMIT 200`
    );
    res.json({
      actions: rows.map((row) => ({
        id: Number(row.id),
        action: row.action,
        itemId: row.item_id,
        reportId: row.report_id ? Number(row.report_id) : null,
        reason: row.reason,
        moderator: row.moderator_name,
        createdAt: timestamp(row.created_at),
      })),
    });
  });

  const reasonSchema = z.object({ reason: z.string().trim().min(3, "Give a short reason").max(500) }).strict();

  router.post("/moderation/items/:id/remove", async (req, res) => {
    const id = parseId(req.params.id, "Item ID");
    const { reason } = reasonSchema.parse(req.body || {});
    const result = await withTransaction(pool, async (db) => {
      const item = await loadItem(db, id, { forUpdate: true });
      if (!item || item.deleted_at) throw new HttpError(404, "Listing not found", "item_not_found");
      if (item.moderation_state === "removed") return { changed: false, notifications: [], imageIds: [] };
      await db.query("UPDATE items SET moderation_state = 'removed', updated_at = now() WHERE id = $1", [id]);
      await db.query(
        "UPDATE claims SET status = 'superseded', decided_at = now(), updated_at = now() WHERE item_id = $1 AND status = 'pending'",
        [id]
      );
      const reports = await db.query(
        "UPDATE listing_reports SET status = 'actioned', resolved_by = $2, resolved_at = now() WHERE item_id = $1 AND status = 'open' RETURNING id",
        [id, req.user.id]
      );
      const action = await db.query(
        "INSERT INTO moderation_actions (moderator_id, item_id, report_id, action, reason) VALUES ($1, $2, $3, 'remove_listing', $4) RETURNING id",
        [req.user.id, id, reports.rows[0]?.id || null, reason]
      );
      const notifications = item.user_id
        ? [
            await notifier.notify(db, {
              userId: item.user_id,
              type: "listing_removed",
              itemId: id,
              data: { reason },
              dedupeKey: `moderation:${action.rows[0].id}`,
            }),
          ]
        : [];
      const images = await db.query("SELECT id FROM item_images WHERE item_id = $1", [id]);
      return { changed: true, notifications, imageIds: images.rows.map((row) => row.id) };
    });
    // Image route now returns 404 for the public; purge any CDN copies too.
    await storage.invalidate(imagePaths(result.imageIds));
    await notifier.deliver(result.notifications);
    res.json({ ok: true, changed: result.changed });
  });

  router.post("/moderation/items/:id/restore", async (req, res) => {
    const id = parseId(req.params.id, "Item ID");
    const { reason } = reasonSchema.parse(req.body || {});
    const result = await withTransaction(pool, async (db) => {
      const item = await loadItem(db, id, { forUpdate: true });
      if (!item || item.deleted_at) throw new HttpError(404, "Listing not found", "item_not_found");
      if (item.moderation_state === "visible") return { changed: false, notifications: [] };
      await db.query("UPDATE items SET moderation_state = 'visible', updated_at = now() WHERE id = $1", [id]);
      const action = await db.query(
        "INSERT INTO moderation_actions (moderator_id, item_id, action, reason) VALUES ($1, $2, 'restore_listing', $3) RETURNING id",
        [req.user.id, id, reason]
      );
      const notifications = item.user_id
        ? [await notifier.notify(db, { userId: item.user_id, type: "listing_restored", itemId: id, data: {}, dedupeKey: `moderation:${action.rows[0].id}` })]
        : [];
      return { changed: true, notifications };
    });
    await notifier.deliver(result.notifications);
    res.json({ ok: true, changed: result.changed });
  });

  router.post("/moderation/reports/:id/dismiss", async (req, res) => {
    const id = parseId(req.params.id, "Report ID");
    const { reason } = reasonSchema.parse(req.body || {});
    const changed = await withTransaction(pool, async (db) => {
      const { rows } = await db.query(
        "UPDATE listing_reports SET status = 'dismissed', resolved_by = $2, resolved_at = now() WHERE id = $1 AND status = 'open' RETURNING item_id",
        [id, req.user.id]
      );
      if (!rows[0]) {
        const exists = await db.query("SELECT 1 FROM listing_reports WHERE id = $1", [id]);
        if (!exists.rowCount) throw new HttpError(404, "Report not found", "report_not_found");
        return false;
      }
      await db.query(
        "INSERT INTO moderation_actions (moderator_id, item_id, report_id, action, reason) VALUES ($1, $2, $3, 'dismiss_report', $4)",
        [req.user.id, rows[0].item_id, id, reason]
      );
      return true;
    });
    res.json({ ok: true, changed });
  });

  return router;
}

module.exports = { moderationRoutes };
