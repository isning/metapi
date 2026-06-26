import { tr } from './i18n.js';
function normalizeReason(reason: string): string {
  return (reason || '').trim().toLowerCase();
}

export function resolveLoginErrorMessage(status: number, reason: string): string {
  const normalizedReason = normalizeReason(reason);
  if (status === 403 && normalizedReason.includes('ip not allowed')) {
    return tr('loginError.currentIpNotAdminAllowlist');
  }
  if (status === 401 || (status === 403 && normalizedReason.includes('invalid token'))) {
    return tr('loginError.invalidAdminToken');
  }
  if (status >= 500) {
    return tr('loginError.errorTryAgainLater');
  }
  return tr('loginError.loginFailedCheckStatus');
}
