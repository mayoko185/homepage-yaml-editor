const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const configFiles = require('../server/lib/config-files.js');

// Regression tests for process-local save serialization (D2): concurrent saves of the
// same destination file must not both pass revision validation and both publish.
//
// Overlap is established deterministically with a temporary-file barrier: fs.promises.open
// is patched so the winning save's temp-file creation waits on an explicit release promise.
// That point sits after initial revision validation (and backup creation) but before the
// external-writer recheck and the atomic rename, so while a save is held there it has
// validated its expected revision without having published anything. No sleeps or timing
// assumptions are involved; each test releases the barrier at a precisely coordinated point.

const CONFIG_BASE_NAMES = ['services', 'settings', 'bookmarks', 'widgets', 'docker', 'proxmox', 'kubernetes'];
const CONFIG_EXTENSIONS = ['.yaml', '.yml'];

function initFor(dir) {
  configFiles.init({
    CONFIG_BASE_NAMES: Object.freeze([...CONFIG_BASE_NAMES]),
    CONFIG_EXTENSIONS: Object.freeze([...CONFIG_EXTENSIONS]),
    ALLOWED_CONFIG_FILES: new Set(
      CONFIG_BASE_NAMES.flatMap((baseName) => CONFIG_EXTENSIONS.map((extension) => `${baseName}${extension}`))
    ),
    ALLOWED_CONFIG_DIRECTORIES: Object.freeze([path.resolve(dir)])
  });
}

// Holds every temp-file open for one destination (pattern .<filename>.<uuid>.tmp inside
// configDir) until release() is called. Only replaceConfigFileAtomically opens such paths.
function holdTempOpens(configDir, filename) {
  const nativeOpen = fs.open;
  const prefix = path.join(configDir, `.${filename}.`);
  let releaseHold;
  const released = new Promise((resolve) => {
    releaseHold = resolve;
  });
  let firstHoldResolve;
  const firstHold = new Promise((resolve) => {
    firstHoldResolve = resolve;
  });
  const holds = [];
  fs.open = async (target, flags, ...rest) => {
    if (String(target).startsWith(prefix)) {
      holds.push(String(target));
      firstHoldResolve();
      await released;
    }
    return nativeOpen(target, flags, ...rest);
  };
  return {
    holds,
    firstHold,
    release: () => releaseHold(),
    restore: () => {
      fs.open = nativeOpen;
    }
  };
}

async function listTempFiles(dirPath) {
  const entries = await fs.readdir(dirPath);
  return entries.filter((name) => name.endsWith('.tmp'));
}

function filterBackups(entries, filename) {
  return entries.filter((entry) => {
    const parsed = configFiles.parseBackupFilename(entry);
    return parsed && parsed.filename.toLowerCase() === filename.toLowerCase();
  });
}

const ORIGINAL_CONTENT = '# original services\n- Alpha:\n    - First:\n        href: https://alpha.example\n';

async function setupConfigDir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'config-files-test-'));
  const configDir = path.join(root, 'configs');
  await fs.mkdir(configDir);
  initFor(configDir);
  return {
    root,
    configDir,
    targetPath: path.join(configDir, 'services.yaml'),
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    }
  };
}

test('concurrent saves of different contents with the same expected revision: exactly one wins', { timeout: 15000 }, async () => {
  const setup = await setupConfigDir();
  const barrier = holdTempOpens(setup.configDir, 'services.yaml');
  try {
    await fs.writeFile(setup.targetPath, ORIGINAL_CONTENT, 'utf8');
    const expectedRevision = configFiles.createContentRevision(ORIGINAL_CONTENT);

    const contentA = '- Alpha:\n    - First:\n        href: https://alpha-a.example\n';
    const contentB = '- Beta:\n    - Second:\n        href: https://beta-b.example\n';

    const saveA = configFiles.saveConfigFile(setup.configDir, 'services.yaml', contentA, { expectedRevision });
    // A has passed revision validation and is held before its external-writer recheck.
    await barrier.firstHold;

    // B targets the same file with the same starting revision while A has not published.
    const saveB = configFiles.saveConfigFile(setup.configDir, 'services.yaml', contentB, { expectedRevision });
    barrier.release();

    const resultA = await saveA;
    assert.equal(resultA.changed, true);
    assert.equal(resultA.revision, configFiles.createContentRevision(contentA));

    await assert.rejects(saveB, (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /changed on disk after it was loaded/);
      assert.equal(error.currentRevision, resultA.revision);
      return true;
    });

    // The loser never reached the publish step.
    assert.equal(barrier.holds.length, 1);
    const finalContent = await fs.readFile(setup.targetPath, 'utf8');
    assert.equal(finalContent, contentA);
  } finally {
    barrier.release();
    barrier.restore();
    await setup.cleanup();
  }
});

test('identical-content saves remain idempotent under serialization', { timeout: 15000 }, async () => {
  const setup = await setupConfigDir();
  const barrier = holdTempOpens(setup.configDir, 'services.yaml');
  try {
    await fs.writeFile(setup.targetPath, ORIGINAL_CONTENT, 'utf8');
    const expectedRevision = configFiles.createContentRevision(ORIGINAL_CONTENT);

    // Plain no-op save: identical content is reported as unchanged without publishing.
    const noop = await configFiles.saveConfigFile(setup.configDir, 'services.yaml', ORIGINAL_CONTENT, { expectedRevision });
    assert.equal(noop.changed, false);
    assert.equal(noop.revision, expectedRevision);

    // Concurrent saves of the same new content: an external writer publishes that exact
    // content while A is held before its recheck. Both saves must succeed idempotently.
    const contentX = '- Alpha:\n    - First:\n        href: https://alpha-x.example\n';
    const saveA = configFiles.saveConfigFile(setup.configDir, 'services.yaml', contentX, { expectedRevision });
    await barrier.firstHold;
    await fs.writeFile(setup.targetPath, contentX, 'utf8');
    barrier.release();

    // A's recheck finds the desired revision already on disk: idempotent success.
    const resultA = await saveA;
    assert.equal(resultA.changed, false);
    assert.equal(resultA.revision, configFiles.createContentRevision(contentX));

    // A retry with the original expected revision is also a no-op now.
    const resultB = await configFiles.saveConfigFile(setup.configDir, 'services.yaml', contentX, { expectedRevision });
    assert.equal(resultB.changed, false);
    assert.equal(resultB.revision, configFiles.createContentRevision(contentX));

    assert.equal(await fs.readFile(setup.targetPath, 'utf8'), contentX);
    assert.deepEqual(await listTempFiles(setup.configDir), []);
  } finally {
    barrier.release();
    barrier.restore();
    await setup.cleanup();
  }
});

test('a failed save releases same-file serialization and cleans up its temporary file', { timeout: 15000 }, async () => {
  const setup = await setupConfigDir();
  const barrier = holdTempOpens(setup.configDir, 'services.yaml');
  try {
    await fs.writeFile(setup.targetPath, ORIGINAL_CONTENT, 'utf8');
    const expectedRevision = configFiles.createContentRevision(ORIGINAL_CONTENT);

    // A passes validation and is held before its recheck; an external writer changes the
    // file to different content while A is held.
    const externalContent = '- External:\n    - Writer:\n        href: https://external.example\n';
    const saveA = configFiles.saveConfigFile(setup.configDir, 'services.yaml', '- Alpha:\n    - First:\n        href: https://alpha-fail.example\n', { expectedRevision });
    await barrier.firstHold;
    await fs.writeFile(setup.targetPath, externalContent, 'utf8');
    barrier.release();

    // The external-writer recheck rejects A with the normal conflict result.
    const externalRevision = configFiles.createContentRevision(externalContent);
    await assert.rejects(saveA, (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /changed on disk after it was loaded/);
      assert.equal(error.currentRevision, externalRevision);
      return true;
    });

    // The failed save must not block later saves: a valid save against the new revision proceeds.
    const followUpContent = '- Alpha:\n    - First:\n        href: https://alpha-after.example\n';
    const resultB = await configFiles.saveConfigFile(setup.configDir, 'services.yaml', followUpContent, { expectedRevision: externalRevision });
    assert.equal(resultB.changed, true);
    assert.equal(resultB.revision, configFiles.createContentRevision(followUpContent));

    assert.equal(await fs.readFile(setup.targetPath, 'utf8'), followUpContent);
    // A's temporary file was cleaned up after the failed publish.
    assert.deepEqual(await listTempFiles(setup.configDir), []);
  } finally {
    barrier.release();
    barrier.restore();
    await setup.cleanup();
  }
});

test('concurrent saves with backups: one backup of the pre-save content, no temporary leftovers', { timeout: 15000 }, async () => {
  const setup = await setupConfigDir();
  const backupDir = path.join(setup.root, 'backups');
  const barrier = holdTempOpens(setup.configDir, 'services.yaml');
  try {
    await fs.writeFile(setup.targetPath, ORIGINAL_CONTENT, 'utf8');
    const expectedRevision = configFiles.createContentRevision(ORIGINAL_CONTENT);

    const contentA = '- Alpha:\n    - First:\n        href: https://alpha-backup.example\n';
    const contentB = '- Beta:\n    - Second:\n        href: https://beta-backup.example\n';

    const saveOptions = { expectedRevision, backupDir, backupCount: 3 };
    const saveA = configFiles.saveConfigFile(setup.configDir, 'services.yaml', contentA, saveOptions);
    // A has already created its backup and is held before its recheck.
    await barrier.firstHold;
    const saveB = configFiles.saveConfigFile(setup.configDir, 'services.yaml', contentB, saveOptions);
    barrier.release();

    const resultA = await saveA;
    assert.equal(resultA.changed, true);
    await assert.rejects(saveB, (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.currentRevision, resultA.revision);
      return true;
    });

    assert.equal(await fs.readFile(setup.targetPath, 'utf8'), contentA);

    // Exactly one backup exists: the pre-save content captured by the winning save.
    const entries = await fs.readdir(backupDir);
    const servicesBackups = filterBackups(entries, 'services.yaml');
    assert.equal(servicesBackups.length, 1);
    assert.equal(await fs.readFile(path.join(backupDir, servicesBackups[0]), 'utf8'), ORIGINAL_CONTENT);

    // A no-op save with backups enabled must not create another backup.
    const noop = await configFiles.saveConfigFile(setup.configDir, 'services.yaml', contentA, { expectedRevision: resultA.revision, backupDir, backupCount: 3 });
    assert.equal(noop.changed, false);
    const entriesAfterNoop = await fs.readdir(backupDir);
    assert.equal(filterBackups(entriesAfterNoop, 'services.yaml').length, 1);

    assert.deepEqual(await listTempFiles(setup.configDir), []);
    assert.deepEqual(await listTempFiles(backupDir), []);
  } finally {
    barrier.release();
    barrier.restore();
    await setup.cleanup();
  }
});

test('independent files are not serialized against each other', { timeout: 15000 }, async () => {
  const setup = await setupConfigDir();
  const settingsPath = path.join(setup.configDir, 'settings.yaml');
  // One open patch with two independently releasable holds, one per destination file.
  const nativeOpen = fs.open;
  const servicesPrefix = path.join(setup.configDir, '.services.yaml.');
  const settingsPrefix = path.join(setup.configDir, '.settings.yaml.');
  let releaseA;
  const releasedA = new Promise((resolve) => {
    releaseA = resolve;
  });
  let firstHoldResolveA;
  const firstHoldA = new Promise((resolve) => {
    firstHoldResolveA = resolve;
  });
  let releaseB;
  const releasedB = new Promise((resolve) => {
    releaseB = resolve;
  });
  let firstHoldResolveB;
  const firstHoldB = new Promise((resolve) => {
    firstHoldResolveB = resolve;
  });
  fs.open = async (target, flags, ...rest) => {
    if (String(target).startsWith(servicesPrefix)) {
      firstHoldResolveA();
      await releasedA;
    } else if (String(target).startsWith(settingsPrefix)) {
      firstHoldResolveB();
      await releasedB;
    }
    return nativeOpen(target, flags, ...rest);
  };
  try {
    await fs.writeFile(setup.targetPath, ORIGINAL_CONTENT, 'utf8');
    const settingsContent = 'title: Original\n';
    await fs.writeFile(settingsPath, settingsContent, 'utf8');

    const saveA = configFiles.saveConfigFile(
      setup.configDir,
      'services.yaml',
      '- Alpha:\n    - First:\n        href: https://alpha-parallel.example\n',
      { expectedRevision: configFiles.createContentRevision(ORIGINAL_CONTENT) }
    );
    await firstHoldA;

    // While A is held before its publish step, a save of a different file must not wait for it.
    const saveB = configFiles.saveConfigFile(
      setup.configDir,
      'settings.yaml',
      'title: Updated\n',
      { expectedRevision: configFiles.createContentRevision(settingsContent) }
    );
    await firstHoldB;

    releaseA();
    releaseB();

    const [resultA, resultB] = await Promise.all([saveA, saveB]);
    assert.equal(resultA.changed, true);
    assert.equal(resultB.changed, true);
    assert.equal(await fs.readFile(setup.targetPath, 'utf8'), '- Alpha:\n    - First:\n        href: https://alpha-parallel.example\n');
    assert.equal(await fs.readFile(settingsPath, 'utf8'), 'title: Updated\n');
  } finally {
    releaseA();
    releaseB();
    fs.open = nativeOpen;
    await setup.cleanup();
  }
});

test('case-different spellings of the same destination share one queue slot', { timeout: 15000 }, async (t) => {
  if (process.platform !== 'win32') {
    t.skip('path case-insensitivity only applies on Windows');
    return;
  }
  const setup = await setupConfigDir();
  const barrier = holdTempOpens(setup.configDir, 'services.yaml');
  try {
    await fs.writeFile(setup.targetPath, ORIGINAL_CONTENT, 'utf8');
    const expectedRevision = configFiles.createContentRevision(ORIGINAL_CONTENT);

    const contentA = '- Alpha:\n    - First:\n        href: https://alpha-case.example\n';
    const saveA = configFiles.saveConfigFile(setup.configDir, 'services.yaml', contentA, { expectedRevision });
    await barrier.firstHold;

    // The same physical file addressed through a case-different directory spelling must
    // queue behind A instead of proceeding concurrently.
    const aliasedDir = setup.configDir.toUpperCase();
    const saveB = configFiles.saveConfigFile(aliasedDir, 'services.yaml', '- Beta:\n    - Second:\n        href: https://beta-case.example\n', { expectedRevision });

    barrier.release();
    const resultA = await saveA;
    assert.equal(resultA.changed, true);
    await assert.rejects(saveB, (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.currentRevision, resultA.revision);
      return true;
    });

    // B never reached the publish step.
    assert.equal(barrier.holds.length, 1);
    assert.equal(await fs.readFile(setup.targetPath, 'utf8'), contentA);
  } finally {
    barrier.release();
    barrier.restore();
    await setup.cleanup();
  }
});
