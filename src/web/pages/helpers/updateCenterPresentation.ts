import {
  compareStableVersions,
  isSameImageTarget,
  resolveUpdateReminderCandidate,
  type UpdateHelperRuntimeLike,
  type UpdateVersionCandidateLike,
} from '../../../shared/updateCenterReminder.js';

import { tr } from '../../i18n.js';
export type UpdateDeployState = {
  kind: 'disabled' | 'missing' | 'helper-unhealthy' | 'same-version' | 'same-image' | 'new-version' | 'new-digest' | 'available';
  badgeTone: string;
  badgeLabel: string;
  reason: string;
  canDeploy: boolean;
  highlight: boolean;
};

export type UpdateReminder = {
  label: string;
  badgeTone: string;
  detail: string;
  highlight: boolean;
};

function normalizeString(value?: string | null): string {
  return String(value || '').trim();
}

function normalizeDigest(value?: string | null): string {
  const digest = normalizeString(value);
  return /^sha256:[a-f0-9]{64}$/i.test(digest) ? digest.toLowerCase() : '';
}

export function describeGitHubDeployState(input: {
  enabled: boolean;
  helperHealthy: boolean;
  helperError?: string | null;
  currentVersion?: string | null;
  helperImageTag?: string | null;
  candidate: UpdateVersionCandidateLike | null | undefined;
}): UpdateDeployState {
  if (!input.enabled) {
    return {
      kind: 'disabled',
      badgeTone: 'muted',
      badgeLabel: tr('pages.helpers.updateCenterPresentation.stopped'),
      reason: tr('pages.helpers.updateCenterPresentation.sourceDisabledEnableToCheck'),
      canDeploy: false,
      highlight: false,
    };
  }

  const candidateVersion = normalizeString(input.candidate?.normalizedVersion);
  const candidateTag = normalizeString(input.candidate?.tagName || candidateVersion);
  if (!candidateVersion && !candidateTag) {
    return {
      kind: 'missing',
      badgeTone: 'warning',
      badgeLabel: tr('pages.helpers.updateCenterPresentation.noVersionFound'),
      reason: tr('pages.helpers.updateCenterPresentation.sourceHasNoDeployableVersion'),
      canDeploy: false,
      highlight: false,
    };
  }

  if (!input.helperHealthy) {
    return {
      kind: 'helper-unhealthy',
      badgeTone: 'warning',
      badgeLabel: tr('pages.helpers.updateCenterPresentation.helper'),
      reason: input.helperError || tr('pages.helpers.updateCenterPresentation.deployHelperUnhealthy'),
      canDeploy: false,
      highlight: false,
    };
  }

  const candidateTargetVersion = candidateVersion || candidateTag;
  const versionCompare = compareStableVersions(input.currentVersion, candidateTargetVersion);
  const helperVersionCompare = compareStableVersions(input.helperImageTag, candidateTargetVersion);
  if (versionCompare === 0 || helperVersionCompare === 0 || helperVersionCompare === 1) {
    return {
      kind: 'same-version',
      badgeTone: 'muted',
      badgeLabel: tr('pages.helpers.updateCenterPresentation.currentlyRunning'),
      reason: helperVersionCompare === 1
        ? tr('pages.helpers.updateCenterPresentation.helperAlreadyNewerThanGithubStable')
        : tr('pages.helpers.updateCenterPresentation.versionAlreadyRunning'),
      canDeploy: false,
      highlight: false,
    };
  }

  if (versionCompare === -1) {
    return {
      kind: 'new-version',
      badgeTone: 'success',
      badgeLabel: tr('pages.helpers.updateCenterPresentation.newVersionFound'),
      reason: tr('pages.helpers.updateCenterPresentation.stableVersionNewerThanCurrent'),
      canDeploy: true,
      highlight: true,
    };
  }

  return {
    kind: 'available',
    badgeTone: 'info',
    badgeLabel: tr('pages.helpers.updateCenterPresentation.deployable'),
    reason: tr('pages.helpers.updateCenterPresentation.versionAvailableUseHelper'),
    canDeploy: true,
    highlight: false,
  };
}

export function describeDockerDeployState(input: {
  enabled: boolean;
  helperHealthy: boolean;
  helperError?: string | null;
  currentVersion?: string | null;
  helper: UpdateHelperRuntimeLike | null | undefined;
  candidate: UpdateVersionCandidateLike | null | undefined;
}): UpdateDeployState {
  if (!input.enabled) {
    return {
      kind: 'disabled',
      badgeTone: 'muted',
      badgeLabel: tr('pages.helpers.updateCenterPresentation.stopped'),
      reason: tr('pages.helpers.updateCenterPresentation.sourceDisabledEnableToCheck'),
      canDeploy: false,
      highlight: false,
    };
  }

  const candidateVersion = normalizeString(input.candidate?.normalizedVersion);
  const candidateTag = normalizeString(input.candidate?.tagName || candidateVersion);
  const candidateDigest = normalizeDigest(input.candidate?.digest);
  if (!candidateVersion && !candidateTag) {
    return {
      kind: 'missing',
      badgeTone: 'warning',
      badgeLabel: tr('pages.helpers.updateCenterPresentation.noVersionFound'),
      reason: tr('pages.helpers.updateCenterPresentation.sourceHasNoDeployableVersion'),
      canDeploy: false,
      highlight: false,
    };
  }

  if (!input.helperHealthy) {
    return {
      kind: 'helper-unhealthy',
      badgeTone: 'warning',
      badgeLabel: tr('pages.helpers.updateCenterPresentation.helper'),
      reason: input.helperError || tr('pages.helpers.updateCenterPresentation.deployHelperUnhealthy'),
      canDeploy: false,
      highlight: false,
    };
  }

  if (isSameImageTarget(input.helper, { tag: candidateTag, digest: candidateDigest })) {
    return {
      kind: 'same-image',
      badgeTone: 'muted',
      badgeLabel: tr('pages.helpers.updateCenterPresentation.currentlyRunning'),
      reason: tr('pages.helpers.updateCenterPresentation.imageAlreadyRunning'),
      canDeploy: false,
      highlight: false,
    };
  }

  const candidateTargetVersion = candidateVersion || candidateTag;
  const helperVersionCompare = compareStableVersions(input.helper?.imageTag, candidateTargetVersion);
  if (helperVersionCompare === 1) {
    return {
      kind: 'same-version',
      badgeTone: 'muted',
      badgeLabel: tr('pages.helpers.updateCenterPresentation.currentlyRunning'),
      reason: tr('pages.helpers.updateCenterPresentation.helperAlreadyNewerThanCandidate'),
      canDeploy: false,
      highlight: false,
    };
  }

  const versionCompare = compareStableVersions(input.currentVersion, candidateTargetVersion);
  if (versionCompare === -1 && (helperVersionCompare == null || helperVersionCompare === -1)) {
    return {
      kind: 'new-version',
      badgeTone: 'success',
      badgeLabel: tr('pages.helpers.updateCenterPresentation.newVersionFound'),
      reason: tr('pages.helpers.updateCenterPresentation.dockerHubNewerVersionDeployable'),
      canDeploy: true,
      highlight: true,
    };
  }

  const helperDigest = normalizeDigest(input.helper?.imageDigest);
  const hasSameStableTag = isSameImageTarget(
    {
      imageTag: input.helper?.imageTag,
      imageDigest: null,
    },
    {
      tag: candidateTag,
      digest: null,
    },
  );
  if (candidateDigest && helperDigest && hasSameStableTag && helperDigest !== candidateDigest) {
    return {
      kind: 'new-digest',
      badgeTone: 'success',
      badgeLabel: tr('pages.helpers.updateCenterPresentation.digest'),
      reason: tr('pages.helpers.updateCenterPresentation.tagSameDigestChanged'),
      canDeploy: true,
      highlight: true,
    };
  }

  return {
    kind: 'available',
    badgeTone: 'info',
    badgeLabel: tr('pages.helpers.updateCenterPresentation.deployable'),
    reason: tr('pages.helpers.updateCenterPresentation.versionAvailableUseHelper'),
    canDeploy: true,
    highlight: false,
  };
}

export function buildUpdateReminder(input: {
  currentVersion?: string | null;
  helper: UpdateHelperRuntimeLike | null | undefined;
  githubRelease: UpdateVersionCandidateLike | null | undefined;
  dockerHubTag: UpdateVersionCandidateLike | null | undefined;
}): UpdateReminder {
  const hasGitHubCandidate = Boolean(normalizeString(
    input.githubRelease?.displayVersion
      || input.githubRelease?.normalizedVersion
      || input.githubRelease?.tagName,
  ));
  const hasDockerCandidate = Boolean(normalizeString(
    input.dockerHubTag?.displayVersion
      || input.dockerHubTag?.normalizedVersion
      || input.dockerHubTag?.tagName
      || input.dockerHubTag?.digest,
  ));
  if (!hasGitHubCandidate && !hasDockerCandidate) {
    return {
      label: tr('pages.helpers.updateCenterPresentation.unableCheckUpdates'),
      badgeTone: 'muted',
      detail: tr('pages.helpers.updateCenterPresentation.info'),
      highlight: false,
    };
  }

  const candidate = resolveUpdateReminderCandidate({
    currentVersion: input.currentVersion,
    helper: input.helper,
    githubRelease: input.githubRelease,
    dockerHubTag: input.dockerHubTag,
  });
  if (candidate) {
    return {
      label: candidate.kind === 'new-digest' ? tr('pages.helpers.updateCenterPresentation.digest') : tr('pages.helpers.updateCenterPresentation.newVersionFound'),
      badgeTone: 'success',
      detail: candidate.kind === 'new-digest'
        ? tr('pages.helpers.updateCenterPresentation.dockerHubAliasDigestDeployable')
        : candidate.source === 'github-release'
          ? `${tr('pages.helpers.updateCenterPresentation.githubStableDeployablePrefix')}${normalizeString(input.githubRelease?.displayVersion || input.githubRelease?.normalizedVersion)}${tr('pages.helpers.updateCenterPresentation.githubStableDeployableSuffix')}`
          : `${tr('pages.helpers.updateCenterPresentation.dockerHubDeployablePrefix')}${normalizeString(input.dockerHubTag?.displayVersion || input.dockerHubTag?.normalizedVersion)}${tr('pages.helpers.updateCenterPresentation.dockerHubDeployableSuffix')}`,
      highlight: true,
    };
  }

  return {
    label: tr('pages.helpers.updateCenterPresentation.alreadyUpToDate'),
    badgeTone: 'muted',
    detail: tr('pages.helpers.updateCenterPresentation.currentVersionMatchesTarget'),
    highlight: false,
  };
}
