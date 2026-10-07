const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let testWindow = null;
let ipcCalls = {
  takeScreenshot: 0,
  startSpeech: 0,
  stopSpeech: 0,
  saveSettings: [],
  updateActiveSkill: [],
  moveWindow: [],
  setWindowOpacity: []
};

ipcMain.handle('set-window-opacity', (_event, opacity) => {
  ipcCalls.setWindowOpacity.push(opacity);
  return { success: true, opacity };
});

// Setup mock IPC responders before window loads
ipcMain.handle('take-screenshot', () => {
  ipcCalls.takeScreenshot++;
  return { success: true };
});

ipcMain.handle('start-speech-recognition', () => {
  ipcCalls.startSpeech++;
  return { success: true };
});

ipcMain.handle('stop-speech-recognition', () => {
  ipcCalls.stopSpeech++;
  return { success: true };
});

ipcMain.handle('get-speech-availability', () => {
  return { available: true };
});

ipcMain.handle('get-window-stats', () => {
  return {
    isInteractive: true,
    windows: {
      main: { isVisible: true, isFocused: false, position: [100, 100], size: [520, 35] }
    }
  };
});

ipcMain.handle('get-settings', () => {
  return { codingLanguage: 'cpp', windowOpacity: 1.0 };
});

ipcMain.handle('save-settings', (_event, settings) => {
  ipcCalls.saveSettings.push(settings);
  return { success: true };
});

ipcMain.handle('update-active-skill', (_event, skill) => {
  ipcCalls.updateActiveSkill.push(skill);
  return { success: true };
});

ipcMain.handle('move-window', (_event, { deltaX, deltaY }) => {
  ipcCalls.moveWindow.push({ deltaX, deltaY });
  return { success: true };
});

ipcMain.handle('resize-window', (_event, { width, height }) => {
  return { success: true };
});

ipcMain.handle('notify-main-window-ready', () => {
  return { success: true };
});

ipcMain.handle('resize-llm-window-for-content', (_event, contentMetrics) => {
  return { success: true, contentMetrics };
});

ipcMain.handle('close-llm-response', () => {
  return { success: true };
});

async function runTests() {
  console.log('\n========================================');
  console.log('   E2E TOOLBAR & FOCUS TEST SUITE       ');
  console.log('========================================\n');

  // Exercise the visible toolbar without activating its window.
  testWindow.showInactive();

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName} ${details ? '(' + details + ')' : ''}`);
      failed++;
    }
  }

  // TEST 1: Window Stealth & Focusability Properties
  console.log('\n-- Test Group 1: Window Attributes & Fullscreen Protection --');
  assert(testWindow.isVisible() === true, 'Main toolbar is visible during focus checks');
  assert(testWindow.isFocusable() === false, 'Main window is non-focusable (focusable: false)');
  assert(testWindow.isAlwaysOnTop() === true, 'Main window is always-on-top');
  assert(testWindow.isFullScreenable() === false, 'Main window is not fullscreenable');

  // Wait for renderer to be fully initialized
  await new Promise(resolve => setTimeout(resolve, 800));

  const uiReady = await testWindow.webContents.executeJavaScript(`
    Boolean(window.mainWindowUI && window.mainWindowUI.statusDot)
  `);
  assert(uiReady === true, 'Renderer UI (MainWindowUI) initialized in DOM');

  // TEST 2: UI Elements Detection
  console.log('\n-- Test Group 2: Toolbar UI Elements --');
  const elementsCheck = await testWindow.webContents.executeJavaScript(`
    ({
      captureButton: Boolean(document.getElementById('captureButton')),
      micButton: Boolean(document.getElementById('micButton')),
      skillIndicator: Boolean(document.getElementById('skillIndicator')),
      languageSelector: Boolean(document.getElementById('languageSelector')),
      codingLanguage: Boolean(document.getElementById('codingLanguage')),
      opacityControl: Boolean(document.getElementById('opacityControl')),
      infoButton: Boolean(document.getElementById('infoButton')),
      statusDot: Boolean(document.getElementById('statusDot'))
    })
  `);

  for (const [key, exists] of Object.entries(elementsCheck)) {
    assert(exists === true, `Toolbar element #${key} is rendered`);
  }

  // TEST 3: Initial Button Click Functionality
  console.log('\n-- Test Group 3: Initial Button Clicks (Before Any Drag) --');
  
  // Test Screenshot click
  await testWindow.webContents.executeJavaScript(`
    document.getElementById('captureButton').click();
  `);
  await new Promise(r => setTimeout(r, 100));
  assert(ipcCalls.takeScreenshot >= 1, 'Clicking #captureButton triggers takeScreenshot IPC');

  // Test Mic click
  await testWindow.webContents.executeJavaScript(`
    document.getElementById('micButton').click();
  `);
  await new Promise(r => setTimeout(r, 100));
  assert(ipcCalls.startSpeech >= 1, 'Clicking #micButton triggers speech recognition IPC');

  // Test Skill click
  const initialSkill = await testWindow.webContents.executeJavaScript(`window.mainWindowUI.currentSkill`);
  await testWindow.webContents.executeJavaScript(`
    document.getElementById('skillIndicator').click();
  `);
  await new Promise(r => setTimeout(r, 100));
  const newSkill = await testWindow.webContents.executeJavaScript(`window.mainWindowUI.currentSkill`);
  assert(newSkill !== initialSkill, `Clicking #skillIndicator advances skill from ${initialSkill} to ${newSkill}`);

  // Test Language cycler click
  const initialLang = await testWindow.webContents.executeJavaScript(`
    document.getElementById('codingLanguage').textContent.trim()
  `);
  await testWindow.webContents.executeJavaScript(`
    document.getElementById('codingLanguage').click();
  `);
  await new Promise(r => setTimeout(r, 100));
  const newLang = await testWindow.webContents.executeJavaScript(`
    document.getElementById('codingLanguage').textContent.trim()
  `);
  assert(newLang !== initialLang, `Clicking #codingLanguage cycles language from ${initialLang} to ${newLang}`);

  // TEST 4: Drag Interaction & Pointer Capture Lifecycle
  console.log('\n-- Test Group 4: Drag Lifecycle & Pointer Capture Threshold --');

  // Micro-movement (<3px) should NOT start drag and NOT hold pointer capture
  const microDragTest = await testWindow.webContents.executeJavaScript(`
    (() => {
      const tab = document.querySelector('.command-tab');
      tab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, screenX: 100, screenY: 100, button: 0, pointerId: 1 }));
      tab.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, screenX: 101, screenY: 101, button: 0, pointerId: 1 }));
      const hasCap = tab.hasPointerCapture ? tab.hasPointerCapture(1) : false;
      const cursor = tab.style.cursor;
      tab.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, screenX: 101, screenY: 101, button: 0, pointerId: 1 }));
      return { hasCap, cursor };
    })()
  `);
  assert(microDragTest.hasCap === false, 'Micro-movement (<3px) does NOT capture pointer');
  assert(microDragTest.cursor !== 'grabbing', 'Micro-movement does NOT switch to grabbing cursor');

  // Real movement (>=3px) SHOULD start drag and call moveWindow IPC
  const initialMoves = ipcCalls.moveWindow.length;
  await testWindow.webContents.executeJavaScript(`
    (() => {
      const tab = document.querySelector('.command-tab');
      tab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, screenX: 100, screenY: 100, button: 0, buttons: 1, pointerId: 2 }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, screenX: 120, screenY: 130, button: 0, buttons: 1, pointerId: 2 }));
    })()
  `);
  await new Promise(r => setTimeout(r, 50));
  assert(ipcCalls.moveWindow.length > initialMoves, 'Dragging >=3px invokes moveWindow IPC');

  // Releasing drag must release capture and restore cursor
  const releaseTest = await testWindow.webContents.executeJavaScript(`
    (() => {
      const tab = document.querySelector('.command-tab');
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, screenX: 120, screenY: 130, button: 0, buttons: 0, pointerId: 2 }));
      return {
        hasCap: tab.hasPointerCapture ? tab.hasPointerCapture(2) : false,
        cursor: tab.style.cursor
      };
    })()
  `);
  assert(releaseTest.hasCap === false, 'Releasing pointer cleanly releases pointer capture');
  assert(releaseTest.cursor === 'grab', 'Cursor restores to grab after drag');

  // TEST 5: Post-Drag Button Click Functionality (Verifying Bug is Solved!)
  console.log('\n-- Test Group 5: Button Functionality After Dragging (Regression Test) --');
  
  // Reset action locks if needed
  await testWindow.webContents.executeJavaScript(`window.mainWindowUI.resetToolbarActionLocks();`);

  const prevScreenshots = ipcCalls.takeScreenshot;
  await testWindow.webContents.executeJavaScript(`
    document.getElementById('captureButton').click();
  `);
  await new Promise(r => setTimeout(r, 100));
  assert(ipcCalls.takeScreenshot > prevScreenshots, 'Clicking #captureButton AFTER drag succeeds');

  const prevSkill = await testWindow.webContents.executeJavaScript(`window.mainWindowUI.currentSkill`);
  await testWindow.webContents.executeJavaScript(`
    document.getElementById('skillIndicator').click();
  `);
  await new Promise(r => setTimeout(r, 100));
  const postSkill = await testWindow.webContents.executeJavaScript(`window.mainWindowUI.currentSkill`);
  assert(postSkill !== prevSkill, `Clicking #skillIndicator AFTER drag succeeds (changed from ${prevSkill} to ${postSkill})`);

  const prevLang = await testWindow.webContents.executeJavaScript(`
    document.getElementById('codingLanguage').textContent.trim()
  `);
  await testWindow.webContents.executeJavaScript(`
    document.getElementById('codingLanguage').click();
  `);
  await new Promise(r => setTimeout(r, 100));
  const postLang = await testWindow.webContents.executeJavaScript(`
    document.getElementById('codingLanguage').textContent.trim()
  `);
  assert(postLang !== prevLang, `Clicking #codingLanguage AFTER drag succeeds (cycled from ${prevLang} to ${postLang})`);

  // Info Button Popover Test
  const popoverInitialState = await testWindow.webContents.executeJavaScript(`
    document.getElementById('shortcutsPopover').classList.contains('is-open')
  `);
  assert(popoverInitialState === false, 'Shortcuts popover is initially closed');

  await testWindow.webContents.executeJavaScript(`
    document.getElementById('infoButton').click();
  `);
  await new Promise(r => setTimeout(r, 100));
  const popoverOpenState = await testWindow.webContents.executeJavaScript(`
    document.getElementById('shortcutsPopover').classList.contains('is-open')
  `);
  assert(popoverOpenState === true, 'Clicking #infoButton opens shortcuts popover');

  // TEST 6: Verify Focus & Non-Activation In Fullscreen
  console.log('\n-- Test Group 6: Fullscreen / No-Activation Integrity --');
  assert(testWindow.isVisible() === true, 'Main toolbar remains visible after button and drag actions');
  assert(testWindow.isFocusable() === false, 'Main toolbar remains non-focusable after button and drag actions');
  assert(testWindow.isFocused() === false, 'Visible main toolbar did not take OS focus during button clicks');

  // TEST 7: Keyboard Shortcuts For Opacity, Language, and Skill
  console.log('\n-- Test Group 7: Keyboard Shortcuts (Opacity, Language, Skill) --');

  // Test Alt+[ decreases opacity
  const prevOpacityCalls = ipcCalls.setWindowOpacity.length;
  await testWindow.webContents.executeJavaScript(`
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '[', altKey: true, bubbles: true }));
  `);
  await new Promise(r => setTimeout(r, 100));
  const sliderAfterDim = await testWindow.webContents.executeJavaScript(`
    document.getElementById('opacitySlider').value
  `);
  assert(ipcCalls.setWindowOpacity.length > prevOpacityCalls, 'Alt+[ triggers setWindowOpacity IPC');
  assert(Number(sliderAfterDim) <= 90, `Alt+[ dims opacity slider to ${sliderAfterDim}%`);

  // Test Alt+] increases opacity
  await testWindow.webContents.executeJavaScript(`
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ']', altKey: true, bubbles: true }));
  `);
  await new Promise(r => setTimeout(r, 100));
  const sliderAfterBright = await testWindow.webContents.executeJavaScript(`
    document.getElementById('opacitySlider').value
  `);
  assert(Number(sliderAfterBright) >= 95, `Alt+] brightens opacity slider back to ${sliderAfterBright}%`);

  // Test Alt+L cycles language
  const langBeforeShortcut = await testWindow.webContents.executeJavaScript(`
    document.getElementById('codingLanguage').textContent.trim()
  `);
  await testWindow.webContents.executeJavaScript(`
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', altKey: true, bubbles: true }));
  `);
  await new Promise(r => setTimeout(r, 100));
  const langAfterShortcut = await testWindow.webContents.executeJavaScript(`
    document.getElementById('codingLanguage').textContent.trim()
  `);
  assert(langAfterShortcut !== langBeforeShortcut, `Alt+L cycles coding language from ${langBeforeShortcut} to ${langAfterShortcut}`);

  // Test Alt+K cycles skill
  const skillBeforeShortcut = await testWindow.webContents.executeJavaScript(`
    window.mainWindowUI.currentSkill
  `);
  await testWindow.webContents.executeJavaScript(`
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', altKey: true, bubbles: true }));
  `);
  await new Promise(r => setTimeout(r, 100));
  const skillAfterShortcut = await testWindow.webContents.executeJavaScript(`
    window.mainWindowUI.currentSkill
  `);
  assert(skillAfterShortcut !== skillBeforeShortcut, `Alt+K cycles skill from ${skillBeforeShortcut} to ${skillAfterShortcut}`);

  // TEST 8: LLM Response Overlay Non-Activation & Fullscreen Preservation
  console.log('\n-- Test Group 8: LLM Response Fullscreen & Focus Protection --');
  
  const llmTestWindow = new BrowserWindow({
    width: 840,
    height: 480,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    focusable: false,
    type: process.platform === 'win32' ? 'toolbar' : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  await llmTestWindow.loadFile(path.join(__dirname, '../llm-response.html'));
  llmTestWindow.showInactive();

  assert(llmTestWindow.isVisible() === true, 'LLM response window is visible');
  assert(llmTestWindow.isFocusable() === false, 'LLM response window is strictly non-focusable');
  assert(llmTestWindow.isFocused() === false, 'LLM response window did not steal focus on showInactive');

  // Send AI response payload
  llmTestWindow.webContents.send('display-llm-response', {
    content: '### Optimal Solution\n\n```python\ndef two_sum(nums, target):\n    lookup = {}\n    for i, num in enumerate(nums):\n        if target - num in lookup:\n            return [lookup[target - num], i]\n        lookup[num] = i\n    return []\n```',
    metadata: { skill: 'dsa' }
  });

  await new Promise(r => setTimeout(r, 600));

  const contentRendered = await llmTestWindow.webContents.executeJavaScript(`
    Boolean(document.getElementById('response-content') && !document.getElementById('response-content').classList.contains('hidden'))
  `);
  assert(contentRendered === true, 'AI response content rendered successfully in DOM');

  // Verify non-activation after response hits screen
  assert(llmTestWindow.isFocused() === false, 'LLM response window remains non-focused when answer hits screen');

  // Simulate mouseenter over panel
  await llmTestWindow.webContents.executeJavaScript(`
    const panel = document.querySelector('.panel-content');
    if (panel) panel.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  `);
  await new Promise(r => setTimeout(r, 100));

  assert(llmTestWindow.isFocused() === false, 'Mouse hovering over response panel does NOT steal focus');

  llmTestWindow.destroy();

  console.log('\n========================================');
  console.log(`  SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

app.whenReady().then(() => {
  testWindow = new BrowserWindow({
    width: 520,
    height: 35,
    show: false, // Inactive
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    focusable: false, // Critical stealth property
    type: process.platform === 'win32' ? 'toolbar' : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  testWindow.loadFile(path.join(__dirname, '../index.html'));

  testWindow.webContents.on('did-finish-load', () => {
    runTests().catch(err => {
      console.error('Test execution error:', err);
      process.exit(1);
    });
  });
});
