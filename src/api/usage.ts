/**
 * usage.ts — the client's typed call against `GET /api/admin/usage`, the User Usage
 * dashboard (docs/USAGE_DASHBOARD.md). Admin-only: the server answers 403 for any
 * account without `users.isAdmin`.
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 this takes NO `token`: it goes through
 * src/api/http.ts, which resolves the Authorization header at call time.
 */
import { apiGet } from './http';
import type { UsageDashboard, UsageWindowDays } from '../../server/contracts/usage';

export type {
    UsageDashboard,
    UsageDay,
    UsageFeatureRow,
    UsageGameRow,
    UsageLanguageRow,
    UsageWindowDays,
} from '../../server/contracts/usage';
export { USAGE_WINDOWS, DEFAULT_USAGE_WINDOW } from '../../server/contracts/usage';

/** Fetch the dashboard for one window (`0` = all time). */
export function fetchUsageDashboard(days: UsageWindowDays): Promise<UsageDashboard> {
    return apiGet<UsageDashboard>('/api/admin/usage', { params: { days } });
}
