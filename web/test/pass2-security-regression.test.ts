import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signMediaUploadToken, verifyMediaUploadToken } from '../src/lib/media/tokens';
import { signReviewToken, verifyReviewToken } from '../src/lib/review/tokens';

process.env.SESSION_SECRET ||= '024e8d23c9bd203300bcb3ae2e4e075507305f2b1b63f2cc7d776650ee76a7fe';

const read = (relPath: string) => readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');

test('Pass 2 Security: /api/media/file/[id] enforces strict token validation and path containment', () => {
  const code = read('src/app/api/media/file/[id]/route.ts');

  // Must call verifyMediaUploadToken when session is absent
  assert.match(code, /verifyMediaUploadToken\(token\)/);
  // Must verify tenant and contact match
  assert.match(code, /verified\.tenantId !== row\.tenant_id/);
  assert.match(code, /verified\.contactId !== row\.contact_id/);
  // Must return 401 on missing auth and 403 on invalid token
  assert.match(code, /jsonError\('Unauthorized access to media', 401\)/);
  assert.match(code, /jsonError\('Forbidden: invalid or expired media token', 403\)/);
  // Must protect against path traversal
  assert.match(code, /path\.resolve\(row\.file_path\)/);
  assert.match(code, /resolvedPath\.startsWith\(allowedBase \+ path\.sep\)/);
  // Must include X-Content-Type-Options: nosniff
  assert.match(code, /'X-Content-Type-Options': 'nosniff'/);
});

test('Pass 2 Security: POST /api/quote/estimate strictly rejects unauthenticated callers with 401', () => {
  const code = read('src/app/api/quote/estimate/route.ts');

  // Must check session and return 401 before processing
  assert.match(code, /const session = await apiSession\(\);/);
  assert.match(code, /if \(!session\) return jsonError\('Unauthorized', 401\);/);
});

test('Pass 2 Security: POST /api/review/token strictly rejects unauthenticated callers with 401', () => {
  const code = read('src/app/api/review/token/route.ts');

  assert.match(code, /const session = await apiSession\(\);/);
  assert.match(code, /if \(!session\) return jsonError\('Unauthorized', 401\);/);
});

test('Pass 2 Security: POST /api/media/token strictly rejects unauthenticated callers with 401', () => {
  const code = read('src/app/api/media/token/route.ts');

  assert.match(code, /const session = await apiSession\(\);/);
  assert.match(code, /if \(!session\) return jsonError\('Unauthorized', 401\);/);
});

test('Pass 2 Token Verification: fake, tampered or expired media tokens return null', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const contactId = '00000000-0000-0000-0000-000000000002';

  // Fake tokens
  assert.equal(verifyMediaUploadToken('fake'), null);
  assert.equal(verifyMediaUploadToken('1'), null);
  assert.equal(verifyMediaUploadToken('invalid.token.here'), null);
  assert.equal(verifyMediaUploadToken(''), null);

  // Mint valid token
  const validToken = signMediaUploadToken(tenantId, contactId, 3600);
  const verified = verifyMediaUploadToken(validToken);
  assert.ok(verified);
  assert.equal(verified.tenantId, tenantId);
  assert.equal(verified.contactId, contactId);

  // Tampered payload
  const [enc, sig] = validToken.split('.');
  assert.equal(verifyMediaUploadToken(`tampered.${sig}`), null);
  // Tampered signature
  assert.equal(verifyMediaUploadToken(`${enc}.00000000000000000000000000000000`), null);

  // Expired token (negative TTL)
  const expiredToken = signMediaUploadToken(tenantId, contactId, -100);
  assert.equal(verifyMediaUploadToken(expiredToken), null);
});

test('Pass 2 Token Verification: fake, tampered or expired review tokens return null', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const contactId = '00000000-0000-0000-0000-000000000002';

  // Fake tokens
  assert.equal(verifyReviewToken('fake'), null);
  assert.equal(verifyReviewToken('1'), null);
  assert.equal(verifyReviewToken('invalid.token.here'), null);
  assert.equal(verifyReviewToken(''), null);

  // Mint valid token
  const validToken = signReviewToken(tenantId, contactId, 3600);
  const verified = verifyReviewToken(validToken);
  assert.ok(verified);
  assert.equal(verified.tenantId, tenantId);
  assert.equal(verified.contactId, contactId);

  // Tampered payload
  const [enc, sig] = validToken.split('.');
  assert.equal(verifyReviewToken(`tampered.${sig}`), null);
  // Tampered signature
  assert.equal(verifyReviewToken(`${enc}.00000000000000000000000000000000`), null);

  // Expired token
  const expiredToken = signReviewToken(tenantId, contactId, -100);
  assert.equal(verifyReviewToken(expiredToken), null);
});
