export type AnalyticsEvent =
  | "discovery_started"
  | "recommendation_viewed"
  | "recommendation_dismissed"
  | "sidequest_started"
  | "place_saved"
  | "itinerary_generated"
  | "directions_opened";
export interface AnalyticsProvider {
  track(
    event: AnalyticsEvent,
    properties: Record<string, string | number>,
  ): void;
}
let provider: AnalyticsProvider = { track() {} };
export function configureAnalytics(next: AnalyticsProvider) {
  provider = next;
}
export function track(
  event: AnalyticsEvent,
  properties: Record<string, string | number> = {},
) {
  provider.track(event, properties);
}
