/** A single budget shared by all initial-load services. Never await enrichment. */
export const LOAD_BUDGET = {
  area: 3500,
  live: 4000,
  photo: 4500,
  weather: 4500,
  maximum: 10000,
} as const;
