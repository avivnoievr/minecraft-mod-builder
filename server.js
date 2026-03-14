const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');

const app = express();
app.use(express.json({ limit: '10mb' }));

const LOCKED_PKG = 'buildmeamod';

app.get('/', (req, res) => res.json({ status: 'ok' }));

app.post('/build', (req, res) => {
  const { projectId, modName, generated_files } = req.body;
  if (!generated_files || !modName) {
    return res.status(400).json({ error: 'Missing modName or generated_files' });
  }

  const modId = (modName || 'mymod').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'mymod';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-'));
  const logs = [];
  const log = (msg) => { logs.push(msg); console.log('[BUILD] ' + msg); };

  try {
    log('Starting build: ' + modId);

    const gf = generated_files;
    const PKG_PATH = path.join(tmpDir, 'src', 'com', LOCKED_PKG);

    // יצירת תיקיות
    for (const d of ['registry', 'item', 'block', 'entity']) {
      fs.mkdirSync(path.join(PKG_PATH, d), { recursive: true });
    }

    // כתיבת קבצי Java
    const javaFiles = [];
    const fileMap = {
      'Main.java': gf.Main,
      'registry/ModItems.java': gf.ModItems,
      'registry/ModBlocks.java': gf.ModBlocks,
      'registry/ModEntities.java': gf.ModEntities,
      'item/TacticalCarbineItem.java': gf.TacticalCarbineItem,
      'item/ModMaterialItem.java': gf.ModMaterialItem,
      'block/ModOreBlock.java': gf.ModOreBlock,
    };

    const entityKey = gf._entity_class_key;
    if (entityKey && gf[entityKey]) fileMap[`entity/${entityKey}.java`] = gf[entityKey];

    for (const [file, content] of Object.entries(fileMap)) {
      if (content) {
        const fullPath = path.join(PKG_PATH, file);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf8');
        javaFiles.push(fullPath);
        log('Wrote: ' + file);
      }
    }

    if (javaFiles.length === 0) throw new Error('No Java files to compile');

    // קומפילציה עם javac
    const classesDir = path.join(tmpDir, 'classes');
    fs.mkdirSync(classesDir, { recursive: true });

    log('Compiling ' + javaFiles.length + ' Java files...');
    const javacResult = spawnSync('javac', [
      '-source', '17',
      '-target', '17',
      '-d', classesDir,
      '-encoding', 'UTF-8',
      '--release', '17',
      ...javaFiles
    ], {
      timeout: 60000,
      encoding: 'utf8',
    });

    if (javacResult.status !== 0) {
      const err = (javacResult.stdout || '') + (javacResult.stderr || '');
      log('javac error: ' + err.slice(0, 500));
      throw new Error('Compilation failed:\n' + err.slice(0, 800));
    }
    log('Compilation successful');

    // resources תיקיית
    const resDir = path.join(tmpDir, 'resources');
    const assetsDir = path.join(resDir, 'assets', modId);
    const dataDir = path.join(resDir, 'data', modId);

    for (const d of [
      path.join(assetsDir, 'models', 'item'),
      path.join(assetsDir, 'models', 'block'),
      path.join(assetsDir, 'blockstates'),
      path.join(assetsDir, 'lang'),
      path.join(assetsDir, 'textures', 'item'),
      path.join(assetsDir, 'textures', 'block'),
      path.join(dataDir, 'recipes'),
      path.join(dataDir, 'loot_tables', 'blocks'),
      path.join(dataDir, 'worldgen', 'configured_feature'),
      path.join(dataDir, 'worldgen', 'placed_feature'),
      path.join(resDir, 'META-INF'),
    ]) fs.mkdirSync(d, { recursive: true });

    // fabric.mod.json
    fs.writeFileSync(path.join(resDir, 'fabric.mod.json'), JSON.stringify({
      schemaVersion: 1, id: modId, version: '1.0.0', name: modName,
      description: modName + ' mod', authors: ['MindrentAI'], license: 'MIT',
      environment: '*',
      entrypoints: { main: ['com.' + LOCKED_PKG + '.Main'] },
      mixins: [],
      depends: { fabricloader: '>=0.15.6', fabric: '*', minecraft: '~1.20.1', java: '>=17' }
    }, null, 2));

    // MANIFEST.MF
    fs.writeFileSync(path.join(resDir, 'META-INF', 'MANIFEST.MF'),
      'Manifest-Version: 1.0\nMain-Class: com.' + LOCKED_PKG + '.Main\n');

    // assets
    const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
    if (gf.LanguageJson) fs.writeFileSync(path.join(assetsDir, 'lang', 'en_us.json'), gf.LanguageJson);

    const itemModels = tryParse(gf.ItemModelJson);
    if (itemModels) for (const [n, m] of Object.entries(itemModels))
      if (!n.includes('/') && !n.startsWith('_'))
        fs.writeFileSync(path.join(assetsDir, 'models', 'item', n + '.json'), JSON.stringify(m, null, 2));

    const blockModels = tryParse(gf.BlockModelJson);
    if (blockModels) for (const [n, m] of Object.entries(blockModels))
      if (!n.startsWith('_'))
        fs.writeFileSync(path.join(assetsDir, 'models', 'block', n + '.json'), JSON.stringify(m, null, 2));

    const blockStates = tryParse(gf.BlockStateJson);
    if (blockStates) for (const [n, s] of Object.entries(blockStates))
      if (!n.startsWith('_'))
        fs.writeFileSync(path.join(assetsDir, 'blockstates', n + '.json'), JSON.stringify(s, null, 2));

    const oreBlock = (gf._registry_blocks || 'ore_block').split(',')[0];
    if (gf.RecipeJson) fs.writeFileSync(path.join(dataDir, 'recipes', 'main.json'), gf.RecipeJson);
    if (gf.LootTableJson) fs.writeFileSync(path.join(dataDir, 'loot_tables', 'blocks', oreBlock + '.json'), gf.LootTableJson);
    if (gf.OreFeatureJson) fs.writeFileSync(path.join(dataDir, 'worldgen', 'configured_feature', oreBlock + '.json'), gf.OreFeatureJson);
    if (gf.OrePlacementJson) fs.writeFileSync(path.join(dataDir, 'worldgen', 'placed_feature', oreBlock + '.json'), gf.OrePlacementJson);

    if (gf._extra_data_files) {
      const extra = typeof gf._extra_data_files === 'string' ? tryParse(gf._extra_data_files) : gf._extra_data_files;
      if (extra) for (const [fp, content] of Object.entries(extra)) {
        const fullPath = path.join(resDir, fp);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, JSON.stringify(content, null, 2));
      }
    }

    // בניית JAR
    const jarPath = path.join(tmpDir, modId + '-1.0.0.jar');
    log('Building JAR...');

    // קובץ רשימת הכל
    const allFiles = [];
    function collectFiles(dir, base) {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        const rel = path.join(base, f);
        if (fs.statSync(full).isDirectory()) collectFiles(full, rel);
        else allFiles.push({ full, rel });
      }
    }
    collectFiles(classesDir, '');
    collectFiles(resDir, '');

    // יצירת JAR עם jar command
    const jarResult = spawnSync('jar', [
      'cf', jarPath,
      '-C', classesDir, '.',
      '-C', resDir, '.',
    ], {
      timeout: 30000,
      encoding: 'utf8',
    });

    if (jarResult.status !== 0) {
      throw new Error('jar command failed: ' + (jarResult.stderr || jarResult.stdout || ''));
    }

    const jarBuffer = fs.readFileSync(jarPath);
    const sizeKb = Math.round(jarBuffer.length / 1024);
    log('JAR built: ' + modId + '-1.0.0.jar (' + sizeKb + ' KB)');

    return res.json({
      success: true,
      file_name: modId + '-1.0.0.jar',
      jar_base64: jarBuffer.toString('base64'),
      size_kb: String(sizeKb),
      file_count: javaFiles.length + 10,
      manifest: {
        sourceFiles: javaFiles.length,
        items: (gf._registry_items || '').split(',').filter(Boolean),
        blocks: (gf._registry_blocks || '').split(',').filter(Boolean),
        dataPackFiles: 4,
      },
      logs,
    });

  } catch (err) {
    log('ERROR: ' + err.message);
    return res.status(500).json({ success: false, error: err.message, logs });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Mod builder on port ' + PORT));
