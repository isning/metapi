import { tr } from '../../i18n.js';
type VerifyResultLike = {
  success?: boolean;
  needsUserId?: boolean;
  invalidUserId?: boolean;
  message?: string | null;
} | null | undefined;

function normalizeMessageText(message: unknown): string {
  return typeof message === 'string' ? message.trim() : '';
}

export function isNetworkFailureMessage(message: unknown): boolean {
  const lowered = normalizeMessageText(message).toLowerCase();
  return lowered.includes('failed to fetch')
    || lowered.includes('fetch failed')
    || lowered.includes('networkerror')
    || lowered.includes('load failed');
}

export function isTimeoutFailureMessage(message: unknown): boolean {
  const lowered = normalizeMessageText(message).toLowerCase();
  return lowered.includes('timed out')
    || lowered.includes('timeout')
    || lowered.includes(tr('pages.helpers.accountVerifyFeedback.requestTimeout'));
}

export function normalizeVerifyFailureMessage(message: unknown): string {
  const text = normalizeMessageText(message);
  if (!text) return tr('pages.helpers.accountVerifyFeedback.authenticationFailed');
  const lowered = text.toLowerCase();
  if (isNetworkFailureMessage(text)) {
    return tr('pages.helpers.accountVerifyFeedback.metapiUnreachableCheckStatus');
  }
  if (lowered.includes('user id mismatch') || lowered.includes('does not match this token')) {
    return tr('pages.helpers.accountVerifyFeedback.idTokenCookieMatch');
  }
  return text;
}

export function buildVerifyFailureHint(result: VerifyResultLike): string | null {
  if (!result || result.success || result.needsUserId) return null;
  if (result.invalidUserId) {
    return tr('pages.helpers.accountVerifyFeedback.tokenNotLikelyUserIdMismatch');
  }
  if (isNetworkFailureMessage(result.message)) {
    return tr('pages.helpers.accountVerifyFeedback.tokenNotLikelyCheckMetapiSiteProxy');
  }
  if (isTimeoutFailureMessage(result.message)) {
    return tr('pages.helpers.accountVerifyFeedback.tokenNotLikelyTargetTimeout');
  }
  return tr('pages.accounts.checkToken');
}

export function buildAddAccountPrereqHint(result: VerifyResultLike): string {
  if (!result) {
    return tr('pages.helpers.accountVerifyFeedback.verifyTokenBeforeAdd');
  }
  if (result.success) return '';
  if (result.needsUserId) {
    return tr('pages.helpers.accountVerifyFeedback.enterUserIdBeforeAdd');
  }
  if (result.invalidUserId) {
    return tr('pages.helpers.accountVerifyFeedback.fixUserIdBeforeAdd');
  }
  if (isNetworkFailureMessage(result.message)) {
    return tr('pages.helpers.accountVerifyFeedback.verificationIncompleteCheckNetwork');
  }
  if (isTimeoutFailureMessage(result.message)) {
    return tr('pages.helpers.accountVerifyFeedback.verificationTimeoutCheckNetwork');
  }
  return tr('pages.helpers.accountVerifyFeedback.verifyTokenBeforeAdd');
}
