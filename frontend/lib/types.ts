export type ItemType = "lost" | "found";
export type ItemStatus = "open" | "claimed" | "returned" | "closed";
export type Category =
  | "phone"
  | "electronics"
  | "wallet"
  | "bag"
  | "keys"
  | "documents"
  | "jewelry"
  | "clothing"
  | "pet"
  | "other";

export const CATEGORIES: Category[] = [
  "phone",
  "electronics",
  "wallet",
  "bag",
  "keys",
  "documents",
  "jewelry",
  "clothing",
  "pet",
  "other",
];

export type ItemImage = { id: number; url: string; thumbUrl: string; width: number; height: number };

export type Item = {
  id: number;
  type: ItemType;
  title: string;
  category: Category;
  description: string;
  location: string;
  approxLatitude: number | null;
  approxLongitude: number | null;
  distanceKm?: number;
  date: string;
  status: ItemStatus;
  ownershipQuestion: string | null;
  createdAt: string;
  updatedAt: string;
  images: ItemImage[];
  reporter: { displayName: string };
  // Owner/moderator view only
  latitude?: number | null;
  longitude?: number | null;
  moderationState?: "visible" | "removed";
  pendingClaims?: number;
};

export type Viewer = {
  isOwner: boolean;
  canModerate: boolean;
  claim: { id: number; status: ClaimStatus } | null;
  conversationId: number | null;
  hasReported?: boolean;
  pendingClaims?: number;
};

export type ClaimStatus = "pending" | "accepted" | "declined" | "withdrawn" | "revoked" | "superseded";

export type Claim = {
  id: number;
  itemId: number;
  status: ClaimStatus;
  claimant: { id: number; displayName: string };
  answer?: string;
  createdAt: string;
  decidedAt: string | null;
  conversationId: number | null;
};

export type User = {
  id: number;
  name: string | null;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  profileImage: string | null;
  phone: string | null;
  locale: string | null;
  role: "user" | "moderator" | "admin";
};

export type SearchResult = { items: Item[]; page: number; pageSize: number; total: number; totalPages: number };
