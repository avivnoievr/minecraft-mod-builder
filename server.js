const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');

const app = express();
app.use(express.json({ limit: '10mb' }));

const LOCKED_PKG = 'buildmeamod';
const MC_VERSION = '1.20.1';
const FABRIC_LOADER = '0.15.6';
const FABRIC_API = '0.92.2+1.20.1';
const YARN = '1.20.1+build.10';

// Gradle cache משותף בין כל הbuildים
const GRADLE_CACHE = path.join(os.tmpdir(), '.gradle-cache');
fs.mkdirSync(GRADLE_CACHE, { recursive: true });

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
    log('Starting: ' + modId);

    const gf = generated_files;
    const srcDir = path.join(tmpDir, 'src', 'main', 'java', 'com', LOCKED_PKG);
    const resDir = path.join(tmpDir, 'src', 'main', 'resources');

    // יצירת תיקיות
    for (const d of [
      path.join(srcDir, 'registry'),
      path.join(srcDir, 'item'),
      path.join(srcDir, 'block'),
      path.join(srcDir, 'entity'),
      path.join(resDir, 'assets', modId, 'models', 'item'),
      path.join(resDir, 'assets', modId, 'models', 'block'),
      path.join(resDir, 'assets', modId, 'blockstates'),
      path.join(resDir, 'assets', modId, 'lang'),
      path.join(resDir, 'assets', modId, 'textures', 'item'),
      path.join(resDir, 'assets', modId, 'textures', 'block'),
      path.join(resDir, 'data', modId, 'recipes'),
      path.join(resDir, 'data', modId, 'loot_tables', 'blocks'),
      path.join(resDir, 'data', modId, 'worldgen', 'configured_feature'),
      path.join(resDir, 'data', modId, 'worldgen', 'placed_feature'),
    ]) fs.mkdirSync(d, { recursive: true });

    // כתיבת קבצי Java
    const javaMap = {
      'Main.java': gf.Main,
      'registry/ModItems.java': gf.ModItems,
      'registry/ModBlocks.java': gf.ModBlocks,
      'registry/ModEntities.java': gf.ModEntities,
      'item/TacticalCarbineItem.java': gf.TacticalCarbineItem,
      'item/ModMaterialItem.java': gf.ModMaterialItem,
      'block/ModOreBlock.java': gf.ModOreBlock,
    };
    const entityKey = gf._entity_class_key;
    if (entityKey && gf[entityKey]) javaMap[`entity/${entityKey}.java`] = gf[entityKey];

    let javaCount = 0;
    for (const [file, content] of Object.entries(javaMap)) {
      if (content) {
        const fullPath = path.join(srcDir, file);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf8');
        javaCount++;
      }
    }
    log(`Wrote ${javaCount} Java files`);

    // fabric.mod.json
    fs.writeFileSync(path.join(resDir, 'fabric.mod.json'), JSON.stringify({
      schemaVersion: 1, id: modId, version: '1.0.0', name: modName,
      description: modName + ' mod', authors: ['MindrentAI'], license: 'MIT',
      environment: '*',
      entrypoints: { main: ['com.' + LOCKED_PKG + '.Main'] },
      mixins: [],
      depends: { fabricloader: '>=' + FABRIC_LOADER, fabric: '*', minecraft: '~' + MC_VERSION, java: '>=17' }
    }, null, 2));

    // assets
    const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
    if (gf.LanguageJson) fs.writeFileSync(path.join(resDir, 'assets', modId, 'lang', 'en_us.json'), gf.LanguageJson);

    const itemModels = tryParse(gf.ItemModelJson);
    if (itemModels) for (const [n, m] of Object.entries(itemModels))
      if (!n.includes('/') && !n.startsWith('_'))
        fs.writeFileSync(path.join(resDir, 'assets', modId, 'models', 'item', n + '.json'), JSON.stringify(m, null, 2));

    const blockModels = tryParse(gf.BlockModelJson);
    if (blockModels) for (const [n, m] of Object.entries(blockModels))
      if (!n.startsWith('_'))
        fs.writeFileSync(path.join(resDir, 'assets', modId, 'models', 'block', n + '.json'), JSON.stringify(m, null, 2));

    const blockStates = tryParse(gf.BlockStateJson);
    if (blockStates) for (const [n, s] of Object.entries(blockStates))
      if (!n.startsWith('_'))
        fs.writeFileSync(path.join(resDir, 'assets', modId, 'blockstates', n + '.json'), JSON.stringify(s, null, 2));

    const oreBlock = (gf._registry_blocks || 'ore_block').split(',')[0];
    if (gf.RecipeJson) fs.writeFileSync(path.join(resDir, 'data', modId, 'recipes', 'main.json'), gf.RecipeJson);
    if (gf.LootTableJson) fs.writeFileSync(path.join(resDir, 'data', modId, 'loot_tables', 'blocks', oreBlock + '.json'), gf.LootTableJson);
    if (gf.OreFeatureJson) fs.writeFileSync(path.join(resDir, 'data', modId, 'worldgen', 'configured_feature', oreBlock + '.json'), gf.OreFeatureJson);
    if (gf.OrePlacementJson) fs.writeFileSync(path.join(resDir, 'data', modId, 'worldgen', 'placed_feature', oreBlock + '.json'), gf.OrePlacementJson);

    if (gf._extra_data_files) {
      const extra = typeof gf._extra_data_files === 'string' ? tryParse(gf._extra_data_files) : gf._extra_data_files;
      if (extra) for (const [fp, content] of Object.entries(extra)) {
        const fp2 = path.join(resDir, fp);
        fs.mkdirSync(path.dirname(fp2), { recursive: true });
        fs.writeFileSync(fp2, JSON.stringify(content, null, 2));
      }
    }

    // settings.gradle - חובה שיהיה pluginManagement עם Fabric Maven
    fs.writeFileSync(path.join(tmpDir, 'settings.gradle'), `
pluginManagement {
    repositories {
        maven { url 'https://maven.fabricmc.net/' }
        gradlePluginPortal()
        mavenCentral()
    }
}
rootProject.name = '${modId}'
`);

    // build.gradle
    fs.writeFileSync(path.join(tmpDir, 'build.gradle'), `
plugins {
    id 'fabric-loom' version '1.4.4'
}

version = '1.0.0'
group = 'com.${LOCKED_PKG}'
base { archivesName = '${modId}' }

repositories {
    mavenCentral()
    maven { url 'https://maven.fabricmc.net/' }
}

dependencies {
    minecraft 'com.mojang:minecraft:${MC_VERSION}'
    mappings "net.fabricmc:yarn:${YARN}:v2"
    modImplementation 'net.fabricmc:fabric-loader:${FABRIC_LOADER}'
    modImplementation 'net.fabricmc.fabric-api:fabric-api:${FABRIC_API}'
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

tasks.withType(JavaCompile).configureEach {
    options.release = 17
    options.encoding = 'UTF-8'
}

// מונע בניית sources jar
jar { from('LICENSE') }
`);

    fs.writeFileSync(path.join(tmpDir, 'gradle.properties'), `
org.gradle.jvmargs=-Xmx400m
org.gradle.daemon=false
`);

    log('Running Gradle build...');
    const result = spawnSync('gradle', ['build', '--no-daemon', '-x', 'test', '--stacktrace', '--info'], {
      cwd: tmpDir,
      timeout: 300000, // 5 דקות - הורדת MC לוקחת זמן בפעם הראשונה
      encoding: 'utf8',
      env: {
        ...process.env,
        GRADLE_USER_HOME: GRADLE_CACHE,
        JAVA_HOME: process.env.JAVA_HOME || '/opt/java/openjdk',
      }
    });

    const output = (result.stdout || '') + (result.stderr || '');

    if (result.status !== 0) {
      // מציג רק את שורות השגיאה הרלוונטיות
      const errorLines = output.split('\n')
        .filter(l => l.includes('error:') || l.includes('FAILED') || l.includes('Exception') || l.includes('> Task'))
        .slice(0, 30)
        .join('\n');
      log('Gradle failed: ' + errorLines);
      throw new Error('Build failed:\n' + errorLines);
    }

    // מצא את ה-JAR
    const libsDir = path.join(tmpDir, 'build', 'libs');
    if (!fs.existsSync(libsDir)) throw new Error('build/libs not found');

    const jarFiles = fs.readdirSync(libsDir).filter(f => f.endsWith('.jar') && !f.includes('sources') && !f.includes('dev'));
    if (jarFiles.length === 0) throw new Error('No JAR found. Files: ' + fs.readdirSync(libsDir).join(', '));

    const jarBuffer = fs.readFileSync(path.join(libsDir, jarFiles[0]));
    const sizeKb = Math.round(jarBuffer.length / 1024);
    log(`Success! ${jarFiles[0]} (${sizeKb} KB)`);

    return res.json({
      success: true,
      file_name: modId + '-1.0.0.jar',
      jar_base64: jarBuffer.toString('base64'),
      size_kb: String(sizeKb),
      file_count: javaCount + 10,
      manifest: {
        sourceFiles: javaCount,
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
