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

type ModelApiTabProps = {
  details: ModelDetailsView;
};

export default function ModelApiTab({ details }: ModelApiTabProps) {
  const endpoints = details.model.supportedEndpointTypes;
  const compatibility = details.routeFlow?.compatibilityPolicy;
  const reasoningTransport = compatibility?.resolved.reasoningHistory.transport ?? null;

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="p-3">
          <SectionHeading title="Surface capabilities" description="Downstream API surfaces currently inferred from marketplace metadata." />
          {endpoints.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {endpoints.map((endpoint) => <ToneBadge key={endpoint} tone="-success">{endpoint}</ToneBadge>)}
            </div>
          ) : (
            <EmptyStateBlock title="No surface metadata" description="Endpoint support is unknown for this model." />
          )}
        </CardContent>
      </Card>

      <Collapsible>
        <Card>
          <CardContent className="grid gap-3 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">Thinking policy</div>
                <div className="text-xs text-muted-foreground">
                  Effective thinking/reasoning carrier resolved from site, account, token, endpoint, and target policy layers.
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {reasoningTransport ? <ToneBadge tone="-info">{reasoningTransport.mode}</ToneBadge> : null}
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline" size="sm">Details</Button>
                </CollapsibleTrigger>
              </div>
            </div>
            <CollapsibleContent>
              {reasoningTransport ? (
                <div className="grid gap-3">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <PolicyValue label="Carrier" value={reasoningTransport.mode} />
                    <PolicyValue label="Overflow" value={reasoningTransport.overflow} />
                    <PolicyValue label="Max reasoning" value={`${Math.round(reasoningTransport.maxReasoningBytes / 1024 / 1024)} MiB`} />
                    <PolicyValue label="Open tag" value={reasoningTransport.thinkTag.openTag} />
                    <PolicyValue label="Close tag" value={reasoningTransport.thinkTag.closeTag} />
                    <PolicyValue label="Tool calls" value={reasoningTransport.toolCallMessageBehavior} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <ToneBadge tone={reasoningTransport.applyTo.assistantHistory ? '-success' : '-muted'}>assistant history</ToneBadge>
                    <ToneBadge tone={reasoningTransport.applyTo.assistantToolCalls ? '-success' : '-muted'}>assistant tool calls</ToneBadge>
                    <ToneBadge tone={reasoningTransport.applyTo.responseContinuation ? '-success' : '-muted'}>response continuation</ToneBadge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(compatibility?.layers || []).map((layer) => (
                      <ToneBadge key={layer.source} tone={layer.configured ? '-info' : '-muted'}>
                        {layer.source}{layer.configured ? '' : ' default'}
                      </ToneBadge>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyStateBlock title="No resolved policy" description="Load route-flow data to inspect the effective upstream compatibility policy." />
              )}
            </CollapsibleContent>
          </CardContent>
        </Card>
      </Collapsible>

      {[
        ['Tool-call policy', 'Tool-call compatibility and invalid-toolcall hardening will be displayed here.'],
        ['Payload mutation policy', 'Graph filters and endpoint payload rules will be summarized here.'],
      ].map(([title, description]) => (
        <Collapsible key={title}>
          <Card>
            <CardContent className="grid gap-3 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="text-xs text-muted-foreground">{description}</div>
                </div>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline" size="sm">Details</Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <EmptyStateBlock title="Policy details pending" description="This section is ready for the backend ModelDetailsView compatibility contract." />
              </CollapsibleContent>
            </CardContent>
          </Card>
        </Collapsible>
      ))}
    </div>
  );
}

function PolicyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}
