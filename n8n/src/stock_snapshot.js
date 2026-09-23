// Loads the stock snapshot, served from the workflow's own cache.
// Fetching the file from GitHub on every search timed out on roughly one call in four,
// and each timeout made the agent tell a live caller it had no stock. The snapshot only
// changes once a day, so keep the last good copy and refresh it in the background of a
// later search; a slow or failed refresh never costs a caller their answer.
// Output: the snapshot object, or { error } when there has never been a good copy.

const cfg = $('Config').first().json;
const cache = $getWorkflowStaticData('global');

const FRESH_MS = 15 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const now = Date.now();
const usable = (s) => Boolean(s) && Array.isArray(s.vehicles) && s.vehicles.length > 0;

if (usable(cache.snapshot) && now - (cache.fetchedAt || 0) < FRESH_MS) {
  return [{ json: cache.snapshot }];
}

async function fetchSnapshot(timeout) {
  let body = await this.helpers.httpRequest({
    method: 'GET',
    url: cfg.inventory_url,
    timeout,
    json: true,
  });
  // raw.githubusercontent.com labels .json as text/plain, so it may arrive unparsed.
  if (typeof body === 'string') body = JSON.parse(body);
  if (!usable(body)) throw new Error('snapshot has no vehicles');
  return body;
}

// With a cached copy to fall back on, one short attempt is enough. With nothing cached
// the caller has no answer at all without this fetch, so try twice.
const attempts = usable(cache.snapshot) ? [3000] : [5000, 5000];
let error = '';
for (const timeout of attempts) {
  try {
    const fresh = await fetchSnapshot.call(this, timeout);
    cache.snapshot = fresh;
    cache.fetchedAt = now;
    return [{ json: fresh }];
  } catch (e) {
    error = String((e && e.message) || e).split('\n')[0].slice(0, 160);
  }
}

if (usable(cache.snapshot)) {
  // Serve the last good copy and try the refresh again in a minute.
  cache.fetchedAt = now - FRESH_MS + RETRY_MS;
  return [{ json: cache.snapshot }];
}

return [{ json: { error: error || 'stock snapshot unavailable' } }];
