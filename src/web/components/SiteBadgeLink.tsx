import React from 'react';
import { Link } from 'react-router-dom';
import ToneBadge from './ToneBadge.js';

type SiteBadgeLinkProps = {
  siteId?: number | null;
  siteName?: string | null;
  className?: string;
  badgeClassName?: string;
  badgeStyle?: React.CSSProperties;
};

export default function SiteBadgeLink({
  siteId,
  siteName,
  className = 'inline-flex',
  badgeClassName = 'muted',
  badgeStyle,
}: SiteBadgeLinkProps) {
  const label = String(siteName || '').trim() || '-';
  const normalizedSiteId = Number(siteId);

  if (!Number.isFinite(normalizedSiteId) || normalizedSiteId <= 0) {
    return (
      <ToneBadge tone={badgeClassName} style={badgeStyle}>
        {label}
      </ToneBadge>
    );
  }

  return (
    <Link to={`/sites?focusSiteId=${Math.trunc(normalizedSiteId)}`} className={className}>
      <ToneBadge tone={badgeClassName} style={badgeStyle}>
        {label}
      </ToneBadge>
    </Link>
  );
}
