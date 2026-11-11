import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const publicCall = readFileSync(
  new URL('../web/src/app/call/[contactId]/CallClientView.tsx', import.meta.url),
  'utf8',
);
const panelCall = readFileSync(
  new URL('../web/src/components/call/CallPanel.tsx', import.meta.url),
  'utf8',
);

test('public call UI cannot convert connection failures into a fake active call', () => {
  assert.doesNotMatch(publicCall, /sandbox mode|Still allow active demonstration/);
  assert.doesNotMatch(publicCall, /confirmation SMS has been sent|bekræftelse på SMS/);
  assert.match(publicCall, /waiting for agent|waiting_for_agent/);
  assert.match(publicCall, /setStage\('error'\)/);
});

test('browser microphone has one owner and agent readiness is required', () => {
  assert.doesNotMatch(publicCall, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(publicCall, /TrackSubscribed/);
  assert.match(publicCall, /AGENT_TIMEOUT|agentTimeout|agent timeout/);
  assert.match(panelCall, /waiting_for_agent/);
});

test('failed call attempts are marked missed rather than left ringing', () => {
  assert.match(publicCall, /\/api\/livekit\/abandon/);
  assert.match(panelCall, /\/api\/livekit\/abandon/);
});

test('call attempts no longer construct reusable room names in the browser', () => {
  assert.doesNotMatch(publicCall, /roomName:\s*`\$\{tenant\.slug\}_call_\$\{contact\.id\}`/);
  assert.doesNotMatch(panelCall, /const roomName = `\$\{tenantSlug\}_call_\$\{contactId\}`/);
});
