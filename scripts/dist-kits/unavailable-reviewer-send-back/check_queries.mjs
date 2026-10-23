import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { userInfo } from 'node:os';

const root = process.argv[2];
const load = name => import(name);
const { Column, SQL, is } = await load('drizzle-orm');
const { PgDatabase, PgDialect } = await load('drizzle-orm/pg-core');
const { companies, agents, agentWakeupRequests, heartbeatRuns } = await load('@paperclipai/db');
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

if (process.argv[3]) {
  assert.match(process.argv[3], /\/rog1333-pg-[^/]+\/data$/);
  const postgres = (await load('postgres')).default;
  const { drizzle } = await load('drizzle-orm/postgres-js');
  const { migrate } = await load('drizzle-orm/postgres-js/migrator');
  const client = postgres({ host: '127.0.0.1', port: Number(process.argv[4]), database: 'postgres',
    user: userInfo().username, max: 1, connect_timeout: 5, onnotice() {} });
  const db = drizzle(client);
  try {
    const [{ data_directory: dataDirectory }] = await client`show data_directory`;
    assert.equal(dataDirectory, process.argv[3], 'refuse migrations unless connected to the fresh scratch cluster');
    const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.resolve('@paperclipai/db')));
    await migrate(db, { migrationsFolder });
    const columns = await client`select column_name from information_schema.columns where table_name = 'heartbeat_runs' and column_name in ('issue_id','native_issue_id')`;
    assert.deepEqual(columns.map(row => row.column_name), ['native_issue_id']);
    const [{ count }] = await client`select count(*)::int as count from drizzle.__drizzle_migrations`;
    console.log(`PASS scratch PostgreSQL: ${count} installed 2026.1005.0 migrations applied; native_issue_id exists; issue_id absent`);
    const otherCompany = '55555555-5555-4555-8555-555555555555';
    const otherAgent = '66666666-6666-4666-8666-666666666666';
    const otherIssue = '77777777-7777-4777-8777-777777777777';
    const failedRun = '88888888-8888-4888-8888-888888888888';
    await db.insert(companies).values([{ id: companyId, name: 'Scratch A', issuePrefix: 'SCA' },
      { id: otherCompany, name: 'Scratch B', issuePrefix: 'SCB' }]);
    await db.insert(agents).values([{ id: agentId, companyId, name: 'Scratch reviewer', status: 'error' },
      { id: otherAgent, companyId: otherCompany, name: 'Scratch decoy', status: 'idle' }]);
    const empty = { companyId, issueId, agentId, agentStatus: 'error', hasActiveRun: false, hasQueuedWake: false, latestRun: null };
    assert.deepEqual(await getExecutionParticipantAvailability(db, issue), empty);
    for (const patch of [{ companyId: otherCompany }, { agentId: otherAgent }, { nativeIssueId: otherIssue }]) {
      await db.insert(heartbeatRuns).values({ companyId, agentId, nativeIssueId: issueId, status: 'running', ...patch });
      await db.insert(agentWakeupRequests).values({ companyId, agentId, source: 'test', status: 'queued',
        payload: { issueId: patch.nativeIssueId ?? issueId }, ...Object.fromEntries(Object.entries(patch).filter(([key]) => key !== 'nativeIssueId')) });
    }
    assert.deepEqual(await getExecutionParticipantAvailability(db, issue), empty);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    for (const runScope of [{ nativeIssueId: issueId }, { contextSnapshot: { issueId } }, { contextSnapshot: { taskId: issueId } }]) {
      await db.insert(heartbeatRuns).values({ id: failedRun, companyId, agentId, status: 'failed', ...runScope });
      assert.deepEqual(await getExecutionParticipantAvailability(db, issue), {
        ...empty, latestRun: { id: failedRun, status: 'failed', scheduledRetryAt: null },
      });
      await db.delete(heartbeatRuns);
    }
    for (const status of ['queued', 'running', 'scheduled_retry']) {
      await db.insert(heartbeatRuns).values({ id: failedRun, companyId, agentId, nativeIssueId: issueId, status });
      assert.deepEqual(await getExecutionParticipantAvailability(db, issue), {
        ...empty, hasActiveRun: true, latestRun: { id: failedRun, status, scheduledRetryAt: null },
      });
      await db.delete(heartbeatRuns);
    }
    for (const payload of [{ issueId }, { taskId: issueId }, { _paperclipWakeContext: { issueId } }, { _paperclipWakeContext: { taskId: issueId } }]) {
      for (const status of ['queued', 'deferred_issue_execution', 'claimed']) {
        await db.insert(agentWakeupRequests).values({ companyId, agentId, source: 'test', status, payload });
        assert.deepEqual(await getExecutionParticipantAvailability(db, issue), { ...empty, hasQueuedWake: true });
        await db.delete(agentWakeupRequests);
      }
    }
    const retryAt = new Date('2099-01-01T00:00:00Z');
    await db.insert(heartbeatRuns).values({ id: failedRun, companyId, agentId, nativeIssueId: issueId,
      status: 'failed', scheduledRetryAt: retryAt });
    const retryFacts = await getExecutionParticipantAvailability(db, issue);
    assert.equal(new Date(retryFacts.latestRun.scheduledRetryAt).toISOString(), '2099-01-01T00:00:00.000Z');
    assert.equal(retryFacts.hasActiveRun, false);
    assert.equal(await getExecutionParticipantAvailability(db, { ...issue, executionState: null }), null);
    console.log('PASS scratch database availability: all four queries execute; literal facts, company/agent/issue isolation, native and context run fallbacks, all four wake fallbacks, active statuses, retry timestamp, and no participant');
  } finally {
    await client.end({ timeout: 5 });
  }
}
