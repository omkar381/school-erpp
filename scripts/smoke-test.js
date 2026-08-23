#!/usr/bin/env node
/**
 * End-to-end smoke test against a running API.
 *
 * Exercises the security-critical paths that unit tests cannot fully prove:
 * real authentication, real RBAC denial, real tenant isolation and the shape of
 * the success and error envelopes.
 *
 *   node scripts/smoke-test.js
 */

const BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.schoolId ? { 'X-School-Id': options.schoolId } : {}),
      ...(options.headers || {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, body: json, headers: response.headers };
}

/**
 * Signs in, backing off when the auth rate limiter kicks in.
 *
 * The limiter is deliberately strict (10 attempts a minute), so running this
 * suite repeatedly will hit it. Treating a 429 as a hard failure would make
 * every later assertion fail on a missing token and hide the real result.
 */
/**
 * Waits until the auth rate limiter has a free slot, so a repeated run of this
 * suite starts from a clean window instead of measuring the limiter.
 */
async function settleRateLimit() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const probe = await call('/auth/login', {
      method: 'POST',
      body: { identifier: 'ratelimit-probe@invalid.local', password: 'not-a-real-password' },
    });
    if (probe.status !== 429) return;
    await new Promise((resolve) => setTimeout(resolve, 20_000));
  }
}

async function login(identifier, password, attempt = 1) {
  const response = await call('/auth/login', {
    method: 'POST',
    body: { identifier, password },
  });

  if (response.status === 429 && attempt <= 3) {
    const waitMs = 20_000 * attempt;
    console.log(`  ..    rate limited signing in as ${identifier}; waiting ${waitMs / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return login(identifier, password, attempt + 1);
  }

  return response;
}

function section(title) {
  console.log(`\n${title}`);
  console.log('-'.repeat(60));
}

async function run() {
  console.log('\nSchool ERP Platform — API smoke test');
  console.log('='.repeat(60));

  // -------------------------------------------------------------------------
  section('Authentication');

  // These probes deliberately send bad credentials, which counts against the
  // auth rate limiter. Back off first so the limiter does not answer instead of
  // the credential check.
  await settleRateLimit();

  const badLogin = await call('/auth/login', {
    method: 'POST',
    body: { identifier: 'admin@greenfield.edu', password: 'WrongPassword1' },
  });
  check('wrong password is rejected with 401', badLogin.status === 401, `got ${badLogin.status}`);
  check(
    'error envelope has success/message/code',
    badLogin.body?.success === false && !!badLogin.body?.message && !!badLogin.body?.code,
    JSON.stringify(badLogin.body).slice(0, 120),
  );
  check(
    'invalid-credential error does not reveal whether the account exists',
    badLogin.body?.code === 'INVALID_CREDENTIALS' &&
      !/not found|no such user|unknown user/i.test(badLogin.body?.message ?? ''),
    badLogin.body?.message,
  );

  const unknownUser = await call('/auth/login', {
    method: 'POST',
    body: { identifier: 'nobody@nowhere.test', password: 'WrongPassword1' },
  });
  check(
    'unknown account returns the same code as a wrong password',
    unknownUser.body?.code === badLogin.body?.code,
    `${unknownUser.body?.code} vs ${badLogin.body?.code}`,
  );

  const validation = await call('/auth/login', { method: 'POST', body: { identifier: 'x' } });
  check('missing field returns 422', validation.status === 422, `got ${validation.status}`);
  check(
    'validation error lists offending fields',
    Array.isArray(validation.body?.errors) && validation.body.errors.length > 0,
    JSON.stringify(validation.body?.errors ?? []).slice(0, 120),
  );

  const adminLogin = await login('admin@greenfield.edu', 'Admin@123');
  check('school admin can sign in', adminLogin.status === 200, `got ${adminLogin.status}`);
  check(
    'success envelope has success/data/message',
    adminLogin.body?.success === true && !!adminLogin.body?.data && !!adminLogin.body?.message,
  );
  check(
    'custom response message is applied',
    adminLogin.body?.message === 'Signed in successfully',
    adminLogin.body?.message,
  );

  const adminToken = adminLogin.body?.data?.tokens?.accessToken;
  const adminSchoolId = adminLogin.body?.data?.user?.schoolId;
  check('access token issued', typeof adminToken === 'string' && adminToken.length > 40);
  check(
    'password hash is never returned',
    !JSON.stringify(adminLogin.body).toLowerCase().includes('passwordhash'),
  );
  check(
    'admin principal carries granular permissions',
    Array.isArray(adminLogin.body?.data?.user?.permissions) &&
      adminLogin.body.data.user.permissions.length > 100,
    `${adminLogin.body?.data?.user?.permissions?.length} permissions`,
  );

  const noToken = await call('/students');
  check('protected route rejects anonymous access', noToken.status === 401, `got ${noToken.status}`);

  const badToken = await call('/students', { token: 'not-a-real-token' });
  check('protected route rejects a forged token', badToken.status === 401, `got ${badToken.status}`);

  // -------------------------------------------------------------------------
  section('Response envelope and pagination');

  const students = await call('/students?page=1&limit=5', { token: adminToken });
  check('admin can list students', students.status === 200, `got ${students.status}`);
  check(
    'list is paginated with meta',
    students.body?.data?.meta?.total > 0 && students.body.data.meta.limit === 5,
    JSON.stringify(students.body?.data?.meta),
  );
  check(
    'page size is honoured',
    students.body?.data?.items?.length === 5,
    `got ${students.body?.data?.items?.length}`,
  );
  check(
    'student rows carry enrollment and guardian',
    !!students.body?.data?.items?.[0]?.enrollment &&
      !!students.body?.data?.items?.[0]?.primaryGuardian,
  );

  const overLimit = await call('/students?limit=9999', { token: adminToken });
  check('page size above the cap is rejected', overLimit.status === 422, `got ${overLimit.status}`);

  const badSort = await call('/students?sortBy=passwordHash', { token: adminToken });
  check(
    'unknown sort column falls back safely instead of erroring',
    badSort.status === 200,
    `got ${badSort.status}`,
  );

  // -------------------------------------------------------------------------
  section('Authorization (RBAC)');

  const teacherLogin = await login('ramesh.iyer@greenfield.edu', 'Teacher@123');
  check('teacher can sign in', teacherLogin.status === 200, `got ${teacherLogin.status}`);
  const teacherToken = teacherLogin.body?.data?.tokens?.accessToken;

  const teacherReadsStudents = await call('/students?limit=2', { token: teacherToken });
  check(
    'teacher may read students',
    teacherReadsStudents.status === 200,
    `got ${teacherReadsStudents.status}`,
  );

  const teacherCreatesStudent = await call('/students', {
    token: teacherToken,
    method: 'POST',
    body: {
      firstName: 'Test',
      dateOfBirth: '2015-01-01',
      gender: 'MALE',
      admissionDate: '2026-04-01',
      classId: '00000000-0000-4000-8000-000000000000',
      sectionId: '00000000-0000-4000-8000-000000000000',
    },
  });
  check(
    'teacher may NOT create a student',
    teacherCreatesStudent.status === 403,
    `got ${teacherCreatesStudent.status}`,
  );
  check(
    'permission denial states the missing permission code',
    teacherCreatesStudent.body?.code === 'MISSING_PERMISSION',
    teacherCreatesStudent.body?.code,
  );

  const teacherReadsAudit = await call('/audit-logs', { token: teacherToken });
  check(
    'teacher may NOT read audit logs',
    teacherReadsAudit.status === 403,
    `got ${teacherReadsAudit.status}`,
  );

  // Resolve a real parent account rather than depending on an environment
  // variable, so the test is self-contained against any seeded database.
  const guardians = await call('/guardians?limit=1&hasLogin=true', { token: adminToken });
  const parentEmail =
    process.env.SMOKE_PARENT_EMAIL ?? guardians.body?.data?.items?.[0]?.email;

  const parentLogin = parentEmail
    ? await login(parentEmail, 'Parent@123')
    : { status: 0, body: null };
  const parentToken = parentLogin.body?.data?.tokens?.accessToken;
  check(
    'parent can sign in',
    parentLogin.status === 200,
    parentEmail ? `got ${parentLogin.status}` : 'no guardian with a login was found',
  );

  if (parentToken) {
    const parentReadsAllStudents = await call('/students', { token: parentToken });
    check(
      'parent may NOT list the whole student roll',
      parentReadsAllStudents.status === 403,
      `got ${parentReadsAllStudents.status}`,
    );

    const children = await call('/guardians/my-children', { token: parentToken });
    check('parent can read their own children', children.status === 200, `got ${children.status}`);
    check(
      'children payload includes attendance and dues',
      Array.isArray(children.body?.data) &&
        children.body.data.length > 0 &&
        'outstandingAmount' in children.body.data[0],
      JSON.stringify(children.body?.data?.[0] ?? {}).slice(0, 140),
    );
  }

  // -------------------------------------------------------------------------
  section('Tenant isolation');

  const superLogin = await login('superadmin@schoolerp.local', 'SuperAdmin@123');
  check('super admin can sign in', superLogin.status === 200, `got ${superLogin.status}`);
  const superToken = superLogin.body?.data?.tokens?.accessToken;

  const schools = await call('/schools', { token: superToken });
  check('super admin can list schools', schools.status === 200, `got ${schools.status}`);

  const adminListsSchools = await call('/schools', { token: adminToken });
  check(
    'school admin may NOT list every school on the platform',
    adminListsSchools.status === 403,
    `got ${adminListsSchools.status}`,
  );

  // A school user supplying another tenant's id must be ignored, not honoured.
  const forgedTenant = await call('/students?limit=3', {
    token: adminToken,
    schoolId: '11111111-1111-4111-8111-111111111111',
  });
  check(
    'X-School-Id from a school user is ignored, not honoured',
    forgedTenant.status === 200 && forgedTenant.body?.data?.meta?.total > 0,
    `status ${forgedTenant.status}, total ${forgedTenant.body?.data?.meta?.total}`,
  );

  const currentSchool = await call('/schools/current', { token: adminToken });
  check(
    'admin sees only their own school',
    currentSchool.body?.data?.id === adminSchoolId,
    `${currentSchool.body?.data?.id} vs ${adminSchoolId}`,
  );

  // -------------------------------------------------------------------------
  section('Domain reads');

  const classes = await call('/academics/classes', { token: adminToken });
  check('classes list loads', classes.status === 200, `got ${classes.status}`);
  check(
    'classes carry sections with headcounts',
    classes.body?.data?.items?.[0]?.sections?.length > 0 &&
      typeof classes.body.data.items[0].studentCount === 'number',
  );

  const attendanceOverview = await call(
    `/attendance/overview?date=${new Date().toISOString().slice(0, 10)}`,
    { token: adminToken },
  );
  check(
    'attendance overview responds',
    [200, 404].includes(attendanceOverview.status),
    `got ${attendanceOverview.status}`,
  );

  const notFound = await call('/students/00000000-0000-4000-8000-000000000000', {
    token: adminToken,
  });
  check('missing record returns 404', notFound.status === 404, `got ${notFound.status}`);
  check('404 uses the error envelope', notFound.body?.code === 'NOT_FOUND', notFound.body?.code);

  const badUuid = await call('/students/not-a-uuid', { token: adminToken });
  check('malformed id is rejected as 400', badUuid.status === 400, `got ${badUuid.status}`);

  // -------------------------------------------------------------------------
  section('Session lifecycle');

  const refreshToken = adminLogin.body?.data?.tokens?.refreshToken;
  const refreshed = await call('/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
  });
  check('refresh token can be exchanged', refreshed.status === 200, `got ${refreshed.status}`);
  check(
    'refresh returns a NEW refresh token (rotation)',
    refreshed.body?.data?.tokens?.refreshToken !== refreshToken,
  );

  // Replaying the consumed token must be treated as theft.
  const replay = await call('/auth/refresh', { method: 'POST', body: { refreshToken } });
  check('replayed refresh token is rejected', replay.status === 401, `got ${replay.status}`);
  check(
    'replay is reported as token reuse',
    replay.body?.code === 'REFRESH_TOKEN_REUSED',
    replay.body?.code,
  );

  // The family was revoked by the replay, so the rotated token must also die.
  const afterRevoke = await call('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: refreshed.body?.data?.tokens?.refreshToken },
  });
  check(
    'token family is revoked after a replay is detected',
    afterRevoke.status === 401,
    `got ${afterRevoke.status}`,
  );

  // -------------------------------------------------------------------------
  section('Infrastructure');

  const health = await fetch('http://localhost:4000/health');
  const healthBody = await health.json();
  check('health endpoint is unauthenticated', health.status === 200);
  check(
    'health skips the response envelope',
    healthBody.status === 'ok' && healthBody.success === undefined,
    JSON.stringify(healthBody).slice(0, 100),
  );
  check('health reports the database as up', healthBody.components?.database?.status === 'up');

  const withRequestId = await call('/students?limit=1', { token: adminToken });
  check('every response carries a request id', !!withRequestId.headers.get('x-request-id'));
  check('security headers are present', !!health.headers.get('x-content-type-options'));

  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(60));
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const failure of failures) {
      console.log(`   - ${failure.name}${failure.detail ? `: ${failure.detail}` : ''}`);
    }
  }
  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error('\nSmoke test crashed:', error.message);
  process.exit(1);
});
