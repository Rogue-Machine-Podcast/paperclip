import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { agents, agentWakeupRequests, heartbeatRuns } from "@paperclipai/db";
import { issueExecutionStateSchema } from "@paperclipai/shared";
export function isExecutionParticipantUnavailable(facts) {
    if (!facts || !facts.agentStatus || facts.hasActiveRun || facts.hasQueuedWake || facts.latestRun?.scheduledRetryAt) {
        return false;
    }
    return ["error", "terminated", "paused"].includes(facts.agentStatus) ||
        facts.latestRun?.status === "failed" || facts.latestRun?.status === "cancelled";
}
export async function getExecutionParticipantAvailability(db, issue) {
    const parsed = issueExecutionStateSchema.safeParse(issue.executionState);
    const state = parsed.success ? parsed.data : null;
    const participant = state?.status === "pending" ? state.currentParticipant : null;
    if (participant?.type !== "agent" || !participant.agentId)
        return null;
    const agentId = participant.agentId;
    const runIssueId = sql `coalesce(${heartbeatRuns.issueId}::text,
    ${heartbeatRuns.contextSnapshot} ->> 'issueId', ${heartbeatRuns.contextSnapshot} ->> 'taskId')`;
    const wakeIssueId = sql `coalesce(
    ${agentWakeupRequests.payload} ->> 'issueId', ${agentWakeupRequests.payload} ->> 'taskId',
    ${agentWakeupRequests.payload} -> '_paperclipWakeContext' ->> 'issueId',
    ${agentWakeupRequests.payload} -> '_paperclipWakeContext' ->> 'taskId')`;
    const runTarget = and(eq(heartbeatRuns.companyId, issue.companyId), eq(heartbeatRuns.agentId, agentId), eq(runIssueId, issue.id));
    const [agentRows, activeRows, wakeRows, latestRows] = await Promise.all([
        db.select({ status: agents.status }).from(agents)
            .where(and(eq(agents.companyId, issue.companyId), eq(agents.id, agentId))).limit(1),
        db.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
            .where(and(runTarget, inArray(heartbeatRuns.status, ["queued", "running", "scheduled_retry"]))).limit(1),
        db.select({ id: agentWakeupRequests.id }).from(agentWakeupRequests)
            .where(and(eq(agentWakeupRequests.companyId, issue.companyId), eq(agentWakeupRequests.agentId, agentId), eq(wakeIssueId, issue.id), inArray(agentWakeupRequests.status, ["queued", "deferred_issue_execution", "claimed"]))).limit(1),
        db.select({ id: heartbeatRuns.id, status: heartbeatRuns.status, scheduledRetryAt: heartbeatRuns.scheduledRetryAt })
            .from(heartbeatRuns).where(runTarget).orderBy(desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id)).limit(1),
    ]);
    return {
        companyId: issue.companyId, issueId: issue.id, agentId, agentStatus: agentRows[0]?.status ?? null,
        hasActiveRun: activeRows.length > 0, hasQueuedWake: wakeRows.length > 0, latestRun: latestRows[0] ?? null,
    };
}
