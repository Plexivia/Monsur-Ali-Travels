import { apiClient } from './api-client';

const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGES = 50; // hard stop: 10,000 cases

/**
 * Fetches every case file matching `params` by walking the server's pagination
 * instead of relying on a single hardcoded limit. The boards and counters need
 * the complete set, and the API caps `limit` at 500 per request.
 *
 * @param {object} params   extra query params (search, status, caseType, ...)
 * @param {object} options  { pageSize, sortBy, sortOrder, signal }
 * @returns {Promise<{ cases: Array, total: number, truncated: boolean }>}
 */
export async function fetchAllCases(params = {}, options = {}) {
  const pageSize = Math.min(500, Math.max(1, options.pageSize || DEFAULT_PAGE_SIZE));
  const sortBy = options.sortBy || 'updatedAt';
  const sortOrder = options.sortOrder || 'desc';

  const collected = [];
  let page = 1;
  let total = 0;
  let totalPages = 1;

  do {
    const res = await apiClient.get('/api/v1/client/cases', {
      params: { ...params, page, limit: pageSize, sortBy, sortOrder },
      signal: options.signal,
    });

    const body = res.data || {};
    const chunk = body.data || body.cases || (Array.isArray(body) ? body : []);
    const list = Array.isArray(chunk) ? chunk : [];
    collected.push(...list);

    const pagination = body.pagination || {};
    total = Number(pagination.total ?? pagination.totalCount ?? collected.length) || collected.length;
    totalPages = Number(pagination.totalPages) || (list.length < pageSize ? page : page + 1);

    // No pagination metadata and a short page means we reached the end
    if (list.length < pageSize) break;

    page += 1;
  } while (page <= totalPages && page <= MAX_PAGES);

  return {
    cases: collected,
    total: total || collected.length,
    truncated: page > MAX_PAGES && collected.length < total,
  };
}
