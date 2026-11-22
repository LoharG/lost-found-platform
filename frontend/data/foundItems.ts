import { Item } from "../types/item";

export const foundItems: Pick<Item, "id" | "name" | "location" | "date">[] = [
  {
    id: 1,
    name: "Wallet",
    location: "Hinjewadi Phase 1",
    date: "27 July 2026",
  },
  {
    id: 2,
    name: "Laptop Bag",
    location: "Pimpri Station",
    date: "26 July 2026",
  },
];