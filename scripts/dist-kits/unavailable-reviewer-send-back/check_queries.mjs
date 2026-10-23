import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const load = name => import(name);
const { Column, SQL, is } = await load('drizzle-orm');
const { PgDatabase, PgDialect } = await load('drizzle-orm/pg-core');
const { heartbeatRuns } = await load('@paperclipai/db');
const { getExecutionParticipantAvailability } = await import(pathToFileURL(`${root}/services/issue-execution-participant-availability.js`).href);
const dialect = new PgDialect();
const builder = new PgDatabase(dialect, {});
const companyId = '11111111-1111-4111-8111-111111111111';
const agentId = '22222222-2222-4222-8222-222222222222';
const issueId = '33333333-3333-4333-8333-333333333333';
const issue = { id: issueId, companyId, executionState: {
  status: 'pending', currentStageId: '44444444-4444-4444-8444-444444444444', currentStageIndex: 0, currentStageType: 'review',
  currentParticipant: { type: 'agent', agentId }, returnAssignee: { type: 'agent', agentId },
  completedStageIds: [], lastDecisionId: null, lastDecisionOutcome: null, changesRequestedCount: 0,
} };
const queries = [];
function checkInterpolation(chunk) {
  assert.notEqual(chunk, undefined, 'undefined SQL interpolation in availability predicate');
  if (Array.isArray(chunk)) chunk.forEach(checkInterpolation);
  else if (is(chunk, SQL)) chunk.queryChunks.forEach(checkInterpolation);
  else if (is(chunk, Column)) {
    assert.equal(typeof chunk.name, 'string');
    assert.notEqual(chunk.table, undefined);
  }
}
const capture = { select(fields) {
  for (const column of Object.values(fields)) assert.equal(is(column, Column), true, 'selected column must exist');
  const query = builder.select(fields);
  const from = query.from.bind(query);
  query.from = table => {
    const select = from(table);
    const limit = select.limit.bind(select);
    select.limit = count => {
      limit(count);
      checkInterpolation(select.config.where);
      select.config.orderBy?.forEach(checkInterpolation);
      const rendered = dialect.sqlToQuery(select.getSQL());
      assert.doesNotMatch(rendered.sql, /\(\s*::|,\s*::|coalesce\(\s*,|\bundefined\b/);
      queries.push(rendered);
      return Promise.resolve([]);
    };
    return select;
  };
  return query;
} };
assert.equal(heartbeatRuns.issueId, undefined);
assert.equal(heartbeatRuns.nativeIssueId.name, 'native_issue_id');
assert.deepEqual(await getExecutionParticipantAvailability(capture, issue), {
  companyId, issueId, agentId, agentStatus: null, hasActiveRun: false, hasQueuedWake: false, latestRun: null,
});
assert.equal(queries.length, 4);
for (const index of [1, 3]) {
  assert.match(queries[index].sql, /coalesce\("heartbeat_runs"\."native_issue_id"::text,/);
  assert.match(queries[index].sql, /'issueId'/);
  assert.match(queries[index].sql, /'taskId'/);
}
console.log('PASS live-schema SQL: 4/4 queries rendered with installed PgDialect and @paperclipai/db; all interpolated columns defined; no empty interpolation or (::');

export { load, root, issue, companyId, agentId, issueId, getExecutionParticipantAvailability };
