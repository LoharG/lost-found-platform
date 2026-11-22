"use strict";

// Explicit response shapes. Public output is built field-by-field from an
// allow-list so new database columns never leak by accident. Reporter email,
// phone number, precise coordinates, claim answers and message content are
// never part of a public shape.

function displayName(name) {
  if (!name) return "Community member";
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

// ~1.1 km precision: enough for "near me" browsing, not enough to find a door.
function approximate(coordinate) {
  return coordinate === null || coordinate === undefined ? null : Math.round(Number(coordinate) * 100) / 100;
}

function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function timestamp(value) {
  return value ? new Date(value).toISOString() : null;
}

function publicImage(image) {
  return {
    id: Number(image.id),
    url: `/api/images/${image.id}`,
    thumbUrl: `/api/images/${image.id}/thumb`,
    width: image.width,
    height: image.height,
  };
}

function publicItem(row, images = []) {
  return {
    id: row.id,
    type: row.type,
    title: row.name,
    category: row.category,
    description: row.description || "",
    location: row.location,
    approxLatitude: approximate(row.latitude),
    approxLongitude: approximate(row.longitude),
    distanceKm: row.distance_km === undefined || row.distance_km === null ? undefined : Math.round(row.distance_km * 10) / 10,
    date: isoDate(row.date),
    status: row.status,
    ownershipQuestion: row.ownership_question || null,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    images: images.map(publicImage),
    reporter: { displayName: displayName(row.user_name) },
  };
}

// The owner sees their own listing with precise coordinates and moderation state.
function ownerItem(row, images = []) {
  return {
    ...publicItem(row, images),
    latitude: row.latitude,
    longitude: row.longitude,
    moderationState: row.moderation_state,
  };
}

function selfUser(row) {
  return {
    id: row.id,
    name: row.name,
    displayName: displayName(row.name),
    email: row.email,
    emailVerified: row.email_verified,
    profileImage: row.profile_image,
    phone: row.mobile_number,
    locale: row.locale,
    role: row.role,
    createdAt: timestamp(row.created_at),
  };
}

module.exports = { displayName, publicItem, ownerItem, publicImage, selfUser, isoDate, timestamp };
