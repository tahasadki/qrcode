// test-call.mjs — Playwright test: two peers connect via call.html
// Usage: npx playwright test test-call.mjs --headed
// Or:    node test-call.mjs (standalone)

import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8080';
const ROOM = 'playwright-test-' + Date.now();
const URL = `${BASE}/call.html?room=${ROOM}`;
const TIMEOUT = 30000;

// Grant fake camera/mic permissions
const contextOptions = {
  permissions: ['camera', 'microphone'],
  // Use fake media devices so no real hardware is needed
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--allow-file-access-from-files',
    ],
  },
};

async function main() {
  console.log('🧪 Testing WebRTC call with room:', ROOM);
  console.log('   URL:', URL);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  });

  const context1 = await browser.newContext({
    permissions: ['camera', 'microphone'],
  });
  const context2 = await browser.newContext({
    permissions: ['camera', 'microphone'],
  });

  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  // Collect console logs
  const logs1 = [];
  const logs2 = [];
  page1.on('console', msg => {
    const text = msg.text();
    if (text.includes('[call.js]')) logs1.push(text);
  });
  page2.on('console', msg => {
    const text = msg.text();
    if (text.includes('[call.js]')) logs2.push(text);
  });

  // Catch page errors
  page1.on('pageerror', err => console.error('Page1 error:', err.message));
  page2.on('pageerror', err => console.error('Page2 error:', err.message));

  console.log('\n1️⃣  Opening Page 1 (will become host)...');
  await page1.goto(URL);
  
  // Wait for local video to appear
  await page1.waitForFunction(() => {
    const v = document.getElementById('localVideo');
    return v && v.srcObject && v.srcObject.getTracks().length > 0;
  }, { timeout: TIMEOUT });
  console.log('   ✅ Page 1: Local video acquired');

  // Wait a moment for the offer to be created and sent to Firestore
  await page1.waitForTimeout(2000);

  console.log('\n2️⃣  Opening Page 2 (will become guest)...');
  await page2.goto(URL);

  // Wait for local video
  await page2.waitForFunction(() => {
    const v = document.getElementById('localVideo');
    return v && v.srcObject && v.srcObject.getTracks().length > 0;
  }, { timeout: TIMEOUT });
  console.log('   ✅ Page 2: Local video acquired');

  // Wait for both to reach ICE connected/completed state
  console.log('\n⏳ Waiting for ICE connection...');

  const waitForConnected = (page, label) => {
    return page.waitForFunction(() => {
      const el = document.getElementById('connStateDisplay');
      const text = el ? el.textContent : '';
      return text === 'connected' || text === 'completed';
    }, { timeout: TIMEOUT }).then(() => {
      console.log(`   ✅ ${label}: ICE connected`);
    });
  };

  try {
    await Promise.all([
      waitForConnected(page1, 'Page 1'),
      waitForConnected(page2, 'Page 2'),
    ]);
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    
    // Dump state for debugging
    const state1 = await page1.evaluate(() => ({
      connState: document.getElementById('connStateDisplay')?.textContent,
      statusText: document.getElementById('statusText')?.textContent,
    }));
    const state2 = await page2.evaluate(() => ({
      connState: document.getElementById('connStateDisplay')?.textContent,
      statusText: document.getElementById('statusText')?.textContent,
    }));
    console.log('   Page 1 state:', state1);
    console.log('   Page 2 state:', state2);
    console.log('\n   Page 1 logs:');
    logs1.forEach(l => console.log('     ', l));
    console.log('\n   Page 2 logs:');
    logs2.forEach(l => console.log('     ', l));
    
    await browser.close();
    process.exit(1);
  }

  // Check remote video is showing
  const hasRemoteVideo1 = await page1.evaluate(() => {
    const v = document.getElementById('remoteVideo');
    return v && v.style.display !== 'none' && v.srcObject !== null;
  });
  const hasRemoteVideo2 = await page2.evaluate(() => {
    const v = document.getElementById('remoteVideo');
    return v && v.style.display !== 'none' && v.srcObject !== null;
  });

  console.log(`\n🎥 Remote video visible — Page 1: ${hasRemoteVideo1}, Page 2: ${hasRemoteVideo2}`);

  // Check status shows connected
  const status1 = await page1.evaluate(() => document.getElementById('statusText')?.textContent);
  const status2 = await page2.evaluate(() => document.getElementById('statusText')?.textContent);
  console.log(`📊 Status — Page 1: "${status1}", Page 2: "${status2}"`);

  // Print signaling logs
  console.log('\n📋 Page 1 signaling logs:');
  logs1.forEach(l => console.log('  ', l));
  console.log('\n📋 Page 2 signaling logs:');
  logs2.forEach(l => console.log('  ', l));

  // Final result
  const success = hasRemoteVideo1 && hasRemoteVideo2;
  console.log(success
    ? '\n✅ TEST PASSED: Both peers connected and see remote video!'
    : '\n❌ TEST FAILED: Remote video not showing on both peers.');

  await browser.close();
  process.exit(success ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
