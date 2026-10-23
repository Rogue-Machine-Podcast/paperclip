import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const load = (name) => import(pathToFileURL(`${root}/${name}`).href);
const { applyIssueExecutionPolicyTransition: transition, normalizeIssueExecutionPolicy } = await load('services/issue-execution-policy.js');
const { classifyIssueReviewPaths } = await load('services/recovery/issue-graph-liveness.js');
const { isExecutionParticipantUnavailable, getExecutionParticipantAvailability } = await load('services/issue-execution-participant-availability.js');
const coder = '11111111-1111-4111-8111-111111111111';
const reviewer = '22222222-2222-4222-8222-222222222222';
const watchdog = '33333333-3333-4333-8333-333333333333';
const policy = normalizeIssueExecutionPolicy({ stages: [{ type: 'review', participants: [{ type: 'agent', agentId: reviewer }] }] });
const state = { status: 'pending', currentStageId: policy.stages[0].id, currentStageIndex: 0,
  currentStageType: 'review', currentParticipant: { type: 'agent', agentId: reviewer },
  returnAssignee: { type: 'agent', agentId: coder }, completedStageIds: [], lastDecisionId: null,
  lastDecisionOutcome: null, changesRequestedCount: 2 };
const issue = { id: 'issue-1', companyId: 'company-1', status: 'in_review', assigneeAgentId: reviewer,
  assigneeUserId: null, executionState: state, executionPolicy: policy };
const facts = { companyId: 'company-1', issueId: 'issue-1', agentId: reviewer, agentStatus: 'error',
  hasActiveRun: false, hasQueuedWake: false, latestRun: { id: 'failed-run', status: 'failed', scheduledRetryAt: null } };
const input = { issue, policy, actor: { agentId: coder }, requestedStatus: 'in_progress',
  requestedAssigneePatch: {}, commentBody: 'Return for repair after failed dispatch.', participantAvailability: facts };
for (const actor of [coder, watchdog]) {
  const result = transition({ ...input, actor: { agentId: actor }, taskWatchdogScopeAllowed: actor === watchdog });
  assert.equal(result.patch.status, 'in_progress');
  assert.equal(result.patch.assigneeAgentId, coder);
  assert.equal(result.patch.assigneeUserId, null);
  assert.equal(result.patch.executionState.changesRequestedCount, 2);
  assert.equal(result.patch.executionState.status, 'changes_requested');
  assert.equal(result.patch.executionState.currentStageId, state.currentStageId);
  assert.deepEqual(result.participantUnavailableSendBack, { participantAgentId: reviewer, failedRunId: 'failed-run' });
  assert.equal(result.workflowControlledAssignment, true);
}
console.log('PASS send-back: return assignee and scoped watchdog; status=in_progress; assignee=return; changesRequestedCount=2; failedRunId=failed-run');
function rejected(label, patch, message) {
  assert.throws(() => transition({ ...input, ...patch }), error => error.status === 422 &&
    (message instanceof RegExp ? message.test(error.message) : error.message === message));
  console.log(`PASS ${label}: 422${typeof message === 'string' ? `; ${message}` : ''}`);
}
rejected('no comment', { commentBody: undefined }, /requires a comment/);
rejected('blank comment', { commentBody: '   ' }, /requires a comment/);
rejected('done', { requestedStatus: 'done' }, /Only the active reviewer or approver/);
rejected('unrelated agent without watchdog scope', { actor: { agentId: watchdog } }, /Only the active reviewer or approver/);
rejected('different assignee', { requestedAssigneePatch: { assigneeAgentId: watchdog } }, /Only the active reviewer or approver/);
const available = { ...facts, agentStatus: 'idle', latestRun: { id: 'success-run', status: 'succeeded', scheduledRetryAt: null } };
rejected('available participant', { participantAvailability: available }, 'Only the active reviewer or approver can advance the current execution stage');
for (const patch of [{ hasActiveRun: true }, { hasQueuedWake: true },
  { latestRun: { ...facts.latestRun, scheduledRetryAt: '2099-01-01' } }]) {
  rejected('continuation exists', { participantAvailability: { ...facts, ...patch } }, 'Only the active reviewer or approver can advance the current execution stage');
}
const agents = [{ id: reviewer, companyId: issue.companyId, status: 'idle', adapterType: 'codex_local', role: 'engineer' }];
const graphInput = { issues: [issue], relations: [], agents, participantAvailability: [facts], now: new Date('2026-10-23T12:00:00Z') };
assert.equal(classifyIssueReviewPaths(graphInput, issue).some(path => path.kind === 'execution_participant'), false);
assert.equal(classifyIssueReviewPaths({ ...graphInput, participantAvailability: [available] }, issue)
  .some(path => path.kind === 'execution_participant' && path.agentId === reviewer), true);
console.log('PASS classifyIssueReviewPaths: unavailable=no execution_participant; available=execution_participant');
assert.equal(isExecutionParticipantUnavailable(facts), true);
for (const value of [null, available, { ...facts, agentStatus: null }, { ...facts, hasActiveRun: true },
  { ...facts, hasQueuedWake: true }, { ...facts, latestRun: { ...facts.latestRun, scheduledRetryAt: '2099-01-01' } }]) {
  assert.equal(isExecutionParticipantUnavailable(value), false);
}
let queryIndex = 0;
const rows = [[{ status: 'error' }], [], [], [{ id: 'failed-run', status: 'failed', scheduledRetryAt: null }]];
const db = { select() { const index = queryIndex++; const chain = {
  from() { return chain; }, where() { return chain; }, orderBy() { return chain; },
  limit() { return Promise.resolve(rows[index]); }
}; return chain; } };
assert.deepEqual(await getExecutionParticipantAvailability(db, issue), facts);
assert.equal(await getExecutionParticipantAvailability(db, { ...issue, executionState: null }), null);
assert.equal(queryIndex, 4);
console.log('PASS availability helper: four issue-scoped queries return literal facts; no participant returns null');
const routes = await load('routes/issues.js');
assert.equal(typeof routes.issueRoutes, 'function');
console.log('PASS import routes/issues.js: issueRoutes is a function');
