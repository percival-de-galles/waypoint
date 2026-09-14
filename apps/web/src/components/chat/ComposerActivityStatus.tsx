import { Spinner } from "~/components/ui/spinner";
import { ThinkingOrb } from "thinking-orbs";

import { threadSyncLabel, type ThreadSyncPhase } from "../../threadSync";
import { ComposerBanner } from "./ComposerBanner";

export type ComposerActivityPhase = ThreadSyncPhase | "working";

function activityLabel(phase: ComposerActivityPhase): string {
  return phase === "working" ? "Agent is working..." : threadSyncLabel(phase);
}

export function ComposerActivityRow(props: {
  readonly phase: ComposerActivityPhase;
  readonly liveAgentCount?: number;
  readonly onOpenAgents?: () => void;
}) {
  const working = props.phase === "working";
  const label =
    working && props.liveAgentCount && props.liveAgentCount > 0
      ? `${props.liveAgentCount} ${props.liveAgentCount === 1 ? "agent" : "agents"} working...`
      : activityLabel(props.phase);
  const row = (
    <>
      <ComposerBanner.Icon>
        {working ? <ThinkingOrb aria-hidden paused size={20} state="working" /> : <Spinner />}
      </ComposerBanner.Icon>
      <ComposerBanner.Content>
        <span
          className="shrink-0 whitespace-nowrap text-muted-foreground"
          data-composer-sync-status={props.phase}
          role="status"
        >
          {label}
        </span>
      </ComposerBanner.Content>
    </>
  );
  return (
    <ComposerBanner.Row
      {...(working && props.onOpenAgents
        ? {
            render: <button type="button" />,
            "aria-label": `${label} Open agents.`,
            onClick: props.onOpenAgents,
          }
        : {})}
    >
      {row}
    </ComposerBanner.Row>
  );
}
