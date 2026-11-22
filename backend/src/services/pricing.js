"use strict";

// Single authoritative pricing table. Amounts are integer paise (INR).
// The platform collects only CONNECTION_FEE_PAISE; rewards are paid directly
// by the owner to the finder and are merely recorded here.
// Bump PRICING_VERSION whenever an amount changes: open agreements made under
// an older version must be re-accepted; accepted agreements keep their snapshot.

const CURRENCY = "INR";
const PRICING_VERSION = "2026-11-v1";
const TERMS_VERSION = "2026-11-v1";
const CONNECTION_FEE_PAISE = 10000; // ₹100

const CATEGORY_REWARD_PAISE = Object.freeze({
  phone: 50000,
  electronics: 50000,
  wallet: 30000,
  bag: 30000,
  keys: 30000,
  documents: 30000,
  jewelry: 50000,
  clothing: 30000,
  pet: 50000,
  other: 35000,
});

function rewardFor(category) {
  const amount = CATEGORY_REWARD_PAISE[category];
  if (!amount) {
    const error = new Error(`Unknown category: ${category}`);
    error.code = "unknown_category";
    throw error;
  }
  return amount;
}

function snapshotFor(category) {
  return {
    category,
    rewardPaise: rewardFor(category),
    feePaise: CONNECTION_FEE_PAISE,
    currency: CURRENCY,
    pricingVersion: PRICING_VERSION,
    termsVersion: TERMS_VERSION,
  };
}

function publicPricing() {
  return {
    currency: CURRENCY,
    pricingVersion: PRICING_VERSION,
    termsVersion: TERMS_VERSION,
    connectionFeePaise: CONNECTION_FEE_PAISE,
    categories: Object.entries(CATEGORY_REWARD_PAISE).map(([category, rewardPaise]) => ({ category, rewardPaise })),
  };
}

module.exports = { CURRENCY, PRICING_VERSION, TERMS_VERSION, CONNECTION_FEE_PAISE, CATEGORY_REWARD_PAISE, rewardFor, snapshotFor, publicPricing };
