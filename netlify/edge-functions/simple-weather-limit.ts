/**
 * Netlify enforces this limit before this pass-through edge function runs.
 * It is per IP and domain, not a global provider-quota guarantee.
 * Rule activation and order must be verified in the deploy log and preview.
 */
export default function simpleWeatherLimit() {
  return undefined;
}

export const config = {
  path: '/api/weather/simple',
  rateLimit: {
    action: 'rate_limit',
    windowLimit: 3,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
  },
};
