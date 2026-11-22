"use strict";

const express = require("express");
const { z } = require("zod");
const { withTransaction } = require("../db");
const { HttpError } = require("../middleware/errors");
const { requireUser } = require("../middleware/security");
const { parseUploads, storeImages, imagePaths } = require("../services/images");
const { publicItem, ownerItem } = require("../services/serializers");
const { findMatches, notifyMatches } = require("../services/matching");
const {
  TRANSITIONS,
  ITEM_SELECT,
  searchItems,
  imagesFor,
  loadItem,
  parseId,
  assertVisible,
  assertOwner,
  isModerator,
  itemInputSchema,
} = require("../services/items");

function itemRoutes({ pool, config, storage, notifier, limits, logger }) {
  const router = express.Router();
  const uploads = parseUploads(config.uploads);

  async function serializeOne(db, row, user) {
    const images = (await imagesFor(db, [row.id])).get(row.id) || [];
    const owner = user && row.user_id === user.id;
    return owner || isModerator(user) ? ownerItem(row, images) : publicItem(row, images);
  }

  // Viewer-specific context for the detail page (never part of public output).
  async function viewerContext(db, row, user) {
    if (!user) return { isOwner: false, canModerate: false, claim: null, conversationId: null };
    const isOwner = row.user_id === user.id;
    const [claim, conversation, report] = await Promise.all([
      isOwner
        ? null
        : db.query(
            "SELECT id, status, created_at FROM claims WHERE item_id = $1 AND claimant_id = $2 ORDER BY created_at DESC LIMIT 1",
            [row.id, user.id]
          ),
      isOwner ? null : db.query("SELECT id FROM conversations WHERE item_id = $1 AND participant_id = $2", [row.id, user.id]),
      db.query("SELECT 1 FROM listing_reports WHERE item_id = $1 AND reporter_id = $2 AND status = 'open'", [row.id, user.id]),
    ]);
    let pendingClaims = 0;
    if (isOwner) {
      const { rows } = await db.query("SELECT count(*)::int AS n FROM claims WHERE item_id = $1 AND status = 'pending'", [row.id]);
      pendingClaims = rows[0].n;
    }
    return {
      isOwner,
      canModerate: isModerator(user),
      claim: claim?.rows[0] ? { id: Number(claim.rows[0].id), status: claim.rows[0].status } : null,
      conversationId: conversation?.rows[0] ? Number(conversation.rows[0].id) : null,
      hasReported: report.rowCount > 0,
      pendingClaims,
    };
  }

  // ---------------------------------------------------------------------
  // Public browsing
  // ---------------------------------------------------------------------
  router.get("/items", async (req, res) => {
    const result = await searchItems(pool, req.query);
    const images = await imagesFor(pool, result.rows.map((row) => row.id));
    res.json({
      items: result.rows.map((row) => publicItem(row, images.get(row.id) || [])),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
    });
  });

  router.get("/stats", async (req, res) => {
    const { rows } = await pool.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE type = 'lost')::int AS lost,
             count(*) FILTER (WHERE type = 'found')::int AS found,
             count(*) FILTER (WHERE status = 'returned')::int AS returned
      FROM items WHERE deleted_at IS NULL AND moderation_state = 'visible'`);
    res.set("Cache-Control", "public, max-age=60").json(rows[0]);
  });

  router.get("/items/:id", async (req, res) => {
    const id = parseId(req.params.id, "Item ID");
    const row = assertVisible(await loadItem(pool, id), req.user);
    res.set("Cache-Control", "private, no-store");
    res.json({ item: await serializeOne(pool, row, req.user), viewer: await viewerContext(pool, row, req.user) });
  });

  // ---------------------------------------------------------------------
  // Owner listings
  // ---------------------------------------------------------------------
  router.get("/me/items", requireUser, async (req, res) => {
    const { rows } = await pool.query(
      `${ITEM_SELECT} WHERE i.user_id = $1 AND i.deleted_at IS NULL ORDER BY i.created_at DESC, i.id DESC LIMIT 200`,
      [req.user.id]
    );
    const images = await imagesFor(pool, rows.map((row) => row.id));
    const pending = await pool.query(
      `SELECT item_id, count(*)::int AS n FROM claims
       WHERE status = 'pending' AND item_id = ANY($1) GROUP BY item_id`,
      [rows.map((row) => row.id)]
    );
    const pendingByItem = new Map(pending.rows.map((row) => [row.item_id, row.n]));
    res.json({
      items: rows.map((row) => ({ ...ownerItem(row, images.get(row.id) || []), pendingClaims: pendingByItem.get(row.id) || 0 })),
    });
  });

  router.post("/items", requireUser, limits.report, limits.upload, uploads, async (req, res) => {
    const input = itemInputSchema({ partial: false }).parse(req.body || {});
    const files = req.files || [];
    const { images, keys } = await storeImages(files, { storage, uploads: config.uploads });

    let created;
    try {
      created = await withTransaction(pool, async (db) => {
        const { rows } = await db.query(
          `INSERT INTO items (type, name, category, description, location, date, latitude, longitude,
                              ownership_question, user_id, status, moderation_state)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', 'visible')
           RETURNING *`,
          [
            input.type,
            input.title,
            input.category,
            input.description || null,
            input.location,
            input.date,
            input.latitude ?? null,
            input.longitude ?? null,
            input.ownershipQuestion || null,
            req.user.id,
          ]
        );
        const item = rows[0];
        for (const [position, image] of images.entries()) {
          await db.query(
            `INSERT INTO item_images (item_id, storage_key, thumb_key, width, height, position)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [item.id, image.storageKey, image.thumbKey, image.width, image.height, position]
          );
        }
        const notifications = await notifyMatches(db, notifier, item);
        return { item, notifications };
      });
    } catch (error) {
      // Database write failed: remove the images we just stored.
      await storage.remove(keys).catch((cleanupError) => logger.error({ err: cleanupError }, "Image cleanup failed"));
      throw error;
    }

    await notifier.deliver(created.notifications);
    const row = await loadItem(pool, created.item.id);
    res.status(201).json({ item: await serializeOne(pool, row, req.user) });
  });

  router.patch("/items/:id", requireUser, limits.upload, uploads, async (req, res) => {
    const id = parseId(req.params.id, "Item ID");
    const input = itemInputSchema({ partial: true }).parse(req.body || {});
    const files = req.files || [];

    // Authorize before doing any image work.
    const existing = assertOwner(await loadItem(pool, id), req.user);
    if (existing.moderation_state === "removed") {
      throw new HttpError(409, "A removed listing cannot be edited", "item_removed");
    }

    const { images, keys } = await storeImages(files, { storage, uploads: config.uploads });
    let result;
    try {
      result = await withTransaction(pool, async (db) => {
        const item = assertOwner(await loadItem(db, id, { forUpdate: true }), req.user);
        const current = await db.query("SELECT id, storage_key, thumb_key FROM item_images WHERE item_id = $1", [id]);
        const removeIds = new Set(input.removeImageIds || []);
        const removing = current.rows.filter((image) => removeIds.has(Number(image.id)));
        if (removing.length !== removeIds.size) {
          throw new HttpError(400, "Some images to remove do not belong to this listing", "invalid_image_reference");
        }
        if (current.rows.length - removing.length + images.length > config.uploads.maxFiles) {
          throw new HttpError(400, `A listing can have at most ${config.uploads.maxFiles} images`, "too_many_images");
        }

        const columns = {
          type: input.type,
          name: input.title,
          category: input.category,
          description: input.description === undefined ? undefined : input.description || null,
          location: input.location,
          date: input.date,
          latitude: input.latitude,
          longitude: input.longitude,
          ownership_question: input.ownershipQuestion === undefined ? undefined : input.ownershipQuestion || null,
        };
        const sets = [];
        const params = [];
        for (const [column, value] of Object.entries(columns)) {
          if (value === undefined) continue;
          params.push(value);
          sets.push(`${column} = $${params.length}`);
        }
        if (sets.length) {
          params.push(id);
          await db.query(`UPDATE items SET ${sets.join(", ")}, updated_at = now() WHERE id = $${params.length}`, params);
        } else if (removing.length || images.length) {
          await db.query("UPDATE items SET updated_at = now() WHERE id = $1", [id]);
        }

        if (removing.length) {
          await db.query("DELETE FROM item_images WHERE id = ANY($1)", [removing.map((image) => image.id)]);
        }
        const { rows: maxRow } = await db.query(
          "SELECT COALESCE(max(position), -1) AS p FROM item_images WHERE item_id = $1",
          [id]
        );
        for (const [index, image] of images.entries()) {
          await db.query(
            `INSERT INTO item_images (item_id, storage_key, thumb_key, width, height, position)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, image.storageKey, image.thumbKey, image.width, image.height, maxRow[0].p + 1 + index]
          );
        }
        const updated = await loadItem(db, id, { forUpdate: true });
        const notifications = item.status === "open" ? await notifyMatches(db, notifier, updated) : [];
        return { removing, notifications };
      });
    } catch (error) {
      await storage.remove(keys).catch(() => {});
      throw error;
    }

    // Only after commit: delete replaced objects and purge CDN copies.
    if (result.removing.length) {
      await storage.remove(result.removing.flatMap((image) => [image.storage_key, image.thumb_key])).catch(() => {});
      await storage.invalidate(imagePaths(result.removing.map((image) => image.id)));
    }
    await notifier.deliver(result.notifications);
    res.json({ item: await serializeOne(pool, await loadItem(pool, id), req.user) });
  });

  router.delete("/items/:id", requireUser, async (req, res) => {
    const id = parseId(req.params.id, "Item ID");
    const removed = await withTransaction(pool, async (db) => {
      assertOwner(await loadItem(db, id, { forUpdate: true }), req.user);
      const { rows: images } = await db.query("DELETE FROM item_images WHERE item_id = $1 RETURNING id, storage_key, thumb_key", [id]);
      await db.query("UPDATE items SET deleted_at = now(), updated_at = now() WHERE id = $1", [id]);
      await db.query("UPDATE claims SET status = 'superseded', updated_at = now() WHERE item_id = $1 AND status = 'pending'", [id]);
      return images;
    });
    await storage.remove(removed.flatMap((image) => [image.storage_key, image.thumb_key])).catch(() => {});
    await storage.invalidate(imagePaths(removed.map((image) => image.id)));
    res.status(204).end();
  });

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------
  router.post("/items/:id/status", requireUser, async (req, res) => {
    const id = parseId(req.params.id, "Item ID");
    const { status } = z.object({ status: z.enum(["open", "returned", "closed"]) }).parse(req.body || {});

    const outcome = await withTransaction(pool, async (db) => {
      const item = assertOwner(await loadItem(db, id, { forUpdate: true }), req.user);
      if (item.moderation_state === "removed") throw new HttpError(409, "This listing was removed by a moderator", "item_removed");
      if (item.status === status) return { item, notifications: [], changed: false };
      if (!TRANSITIONS[item.status].includes(status)) {
        throw new HttpError(409, `A ${item.status} listing cannot be marked ${status}`, "invalid_transition", {
          from: item.status,
          allowed: TRANSITIONS[item.status],
        });
      }

      const notifications = [];
      const touched = [];
      if (status === "open" || status === "closed") {
        // Reopening/closing a claimed item revokes the accepted claim.
        const { rows } = await db.query(
          `UPDATE claims SET status = 'revoked', decided_at = now(), updated_at = now()
           WHERE item_id = $1 AND status = 'accepted' RETURNING id, claimant_id, status`,
          [id]
        );
        touched.push(...rows);
      }
      if (status === "returned" || status === "closed") {
        const { rows } = await db.query(
          `UPDATE claims SET status = 'superseded', decided_at = now(), updated_at = now()
           WHERE item_id = $1 AND status = 'pending' RETURNING id, claimant_id, status`,
          [id]
        );
        touched.push(...rows);
      }
      if (status === "returned") {
        const { rows } = await db.query("SELECT id, claimant_id FROM claims WHERE item_id = $1 AND status = 'accepted'", [id]);
        for (const claim of rows) {
          notifications.push(
            await notifier.notify(db, {
              userId: claim.claimant_id,
              type: "item_status",
              itemId: id,
              data: { status: "returned" },
              dedupeKey: `item:${id}:returned`,
            })
          );
        }
      }
      for (const claim of touched) {
        notifications.push(
          await notifier.notify(db, {
            userId: claim.claimant_id,
            type: "claim_update",
            itemId: id,
            data: { claimId: Number(claim.id), status: claim.status },
            dedupeKey: `claim:${claim.id}:${claim.status}`,
          })
        );
      }

      const { rows } = await db.query(
        "UPDATE items SET status = $1, status_changed_at = now(), updated_at = now() WHERE id = $2 RETURNING *",
        [status, id]
      );
      if (status === "open") notifications.push(...(await notifyMatches(db, notifier, rows[0])));
      return { item: rows[0], notifications, changed: true };
    });

    await notifier.deliver(outcome.notifications);
    res.json({ item: await serializeOne(pool, await loadItem(pool, id), req.user), changed: outcome.changed });
  });

  router.get("/items/:id/matches", requireUser, async (req, res) => {
    const id = parseId(req.params.id, "Item ID");
    assertOwner(await loadItem(pool, id), req.user);
    const matches = await findMatches(pool, id, 10);
    if (matches.length === 0) return res.json({ matches: [] });
    const { rows } = await pool.query(`${ITEM_SELECT} WHERE i.id = ANY($1)`, [matches.map((m) => m.id)]);
    const images = await imagesFor(pool, rows.map((row) => row.id));
    const byId = new Map(rows.map((row) => [row.id, row]));
    res.json({
      matches: matches
        .filter((match) => byId.has(match.id))
        .map((match) => ({
          score: Math.round(Number(match.score) * 100) / 100,
          item: publicItem(byId.get(match.id), images.get(match.id) || []),
        })),
    });
  });

  // ---------------------------------------------------------------------
  // Abuse reports
  // ---------------------------------------------------------------------
  router.post("/items/:id/reports", requireUser, limits.abuse, async (req, res) => {
    const id = parseId(req.params.id, "Item ID");
    const { reason, details } = z
      .object({
        reason: z.enum(["spam", "scam", "inappropriate", "personal_info", "duplicate", "other"]),
        details: z.string().trim().max(1000).optional(),
      })
      .strict()
      .parse(req.body || {});
    const item = assertVisible(await loadItem(pool, id), req.user);
    if (item.user_id === req.user.id) throw new HttpError(400, "You cannot report your own listing", "own_listing");

    const { rows } = await pool.query(
      `INSERT INTO listing_reports (item_id, reporter_id, reason, details)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (item_id, reporter_id) WHERE status = 'open' DO NOTHING
       RETURNING id`,
      [id, req.user.id, reason, details || null]
    );
    res.status(rows[0] ? 201 : 200).json({ ok: true, alreadyReported: !rows[0] });
  });

  return router;
}

module.exports = { itemRoutes };
