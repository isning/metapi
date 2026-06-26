import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import SectionHeading from '../../components/details/SectionHeading.js';
import { Card, CardContent } from '../../components/ui/card/index.js';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible/index.js';
import { Button } from '../../components/ui/button/index.js';
import ToneBadge from '../../components/ToneBadge.js';
import type { ModelDetailsView } from './modelDetailsView.js';
import { tr } from '../../i18n.js';

type ModelApiTabProps = {
  details: ModelDetailsView;
};

export default function ModelApiTab({ details }: ModelApiTabProps) {
  const endpoints = details.model.supportedEndpointTypes;
  const compatibility = details.routeFlow?.compatibilityPolicy;
  const reasoningTransport = compatibility?.resolved.reasoningHistory.transport ?? null;
  const policySections = [
    {
      title: tr('pages.models.modelApiTab.toolCallPolicy'),
      description: tr('pages.models.modelApiTab.toolCallPolicyDescription'),
    },
    {
      title: tr('pages.models.modelApiTab.payloadPolicy'),
      description: tr('pages.models.modelApiTab.payloadPolicyDescription'),
    },
  ];

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="p-3">
          <SectionHeading title={tr('pages.models.modelApiTab.surfaceCapabilities')} description={tr('pages.models.modelApiTab.surfaceCapabilitiesDescription')} />
          {endpoints.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {endpoints.map((endpoint) => <ToneBadge key={endpoint} tone="-success">{endpoint}</ToneBadge>)}
            </div>
          ) : (
            <EmptyStateBlock title={tr('pages.models.modelApiTab.noSurfaceMetadata')} description={tr('pages.models.modelApiTab.noSurfaceMetadataDescription')} />
          )}
        </CardContent>
      </Card>

      <Collapsible>
        <Card>
          <CardContent className="grid gap-3 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{tr('pages.models.modelApiTab.thinkingPolicy')}</div>
                <div className="text-xs text-muted-foreground">
                  {tr('pages.models.modelApiTab.thinkingPolicyDescription')}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {reasoningTransport ? <ToneBadge tone="-info">{reasoningTransport.mode}</ToneBadge> : null}
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline" size="sm">{tr('pages.models.modelApiTab.details')}</Button>
                </CollapsibleTrigger>
              </div>
            </div>
            <CollapsibleContent>
              {reasoningTransport ? (
                <div className="grid gap-3">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <PolicyValue label={tr('pages.models.modelApiTab.carrier')} value={reasoningTransport.mode} />
                    <PolicyValue label={tr('pages.models.modelApiTab.overflow')} value={reasoningTransport.overflow} />
                    <PolicyValue label={tr('pages.models.modelApiTab.maxReasoning')} value={`${Math.round(reasoningTransport.maxReasoningBytes / 1024 / 1024)} MiB`} />
                    <PolicyValue label={tr('pages.models.modelApiTab.openTag')} value={reasoningTransport.thinkTag.openTag} />
                    <PolicyValue label={tr('pages.models.modelApiTab.closeTag')} value={reasoningTransport.thinkTag.closeTag} />
                    <PolicyValue label={tr('pages.models.modelApiTab.toolCalls')} value={reasoningTransport.toolCallMessageBehavior} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <ToneBadge tone={reasoningTransport.applyTo.assistantHistory ? '-success' : '-muted'}>{tr('pages.models.modelApiTab.assistantHistory')}</ToneBadge>
                    <ToneBadge tone={reasoningTransport.applyTo.assistantToolCalls ? '-success' : '-muted'}>{tr('pages.models.modelApiTab.assistantToolCalls')}</ToneBadge>
                    <ToneBadge tone={reasoningTransport.applyTo.responseContinuation ? '-success' : '-muted'}>{tr('pages.models.modelApiTab.responseContinuation')}</ToneBadge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(compatibility?.layers || []).map((layer) => (
                      <ToneBadge key={layer.source} tone={layer.configured ? '-info' : '-muted'}>
                        {formatCompatibilityLayerSource(layer.source)}{layer.configured ? '' : ` ${tr('common.inherit')}`}
                      </ToneBadge>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyStateBlock title={tr('pages.models.modelApiTab.noResolvedPolicy')} description={tr('pages.models.modelApiTab.noResolvedPolicyDescription')} />
              )}
            </CollapsibleContent>
          </CardContent>
        </Card>
      </Collapsible>

      {policySections.map(({ title, description }) => (
        <Collapsible key={title}>
          <Card>
            <CardContent className="grid gap-3 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="text-xs text-muted-foreground">{description}</div>
                </div>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline" size="sm">{tr('pages.models.modelApiTab.details')}</Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <EmptyStateBlock title={tr('pages.models.modelApiTab.policyDetailsUnavailable')} description={tr('pages.models.modelApiTab.policyDetailsUnavailableDescription')} />
              </CollapsibleContent>
            </CardContent>
          </Card>
        </Collapsible>
      ))}
    </div>
  );
}

function formatCompatibilityLayerSource(source: string): string {
  if (source === 'site') return tr('common.site');
  if (source === 'account') return tr('common.account');
  if (source === 'token') return tr('components.notificationPanel.token');
  if (source === 'endpoint_policy') return tr('pages.models.modelApiTab.endpointPolicy');
  if (source === 'target') return tr('pages.models.modelApiTab.targetPolicy');
  return source;
}

function PolicyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}
