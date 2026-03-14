const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');

/**
 * Minecraft Mod Builder - High Performance Server
 * מנגנון בנייה מבוסס Gradle עם תשתית Fabric
 */

const app = express();
app.use(express.json({ limit: '50mb' }));

const LOCKED_PKG = 'buildmeamod';
const GRADLE_CACHE = path.join(os.tmpdir(), '.gradle-cache');
fs.ensureDirSync(GRADLE_CACHE);

app.get('/', (req, res) => res.json({ status: 'Mod Builder Engine is Online', system: 'Active' }));

app.post('/build', async (req, res) => {
  const { projectId, modName, generated_files } = req.body;
  const logs = [];
  const log = (msg) => { logs.push(`[${new Date().toISOString()}] ${msg}`); console.log(msg); };

  if (!generated_files || !modName) {
    return res.status(400).json({ error: 'Missing modName or generated_files' });
  }

  const modId = (modName || 'mymod').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'mymod';
  const tmpDir = path.join(os.tmpdir(), `mod-build-${Date.now()}`);

  try {
    log(`Starting deep build for: ${modId}`);
    await fs.ensureDir(tmpDir);

    // --- שלב א': העתקת תשתית Gradle ---
    // זה השלב שהיה חסר וגרם לשרת "לא לחשוב"
    log('Synchronizing Gradle wrapper components...');
    const infrastructure = ['gradlew', 'gradle', 'build.gradle', 'settings.gradle', 'gradle.properties'];
    for (const file of infrastructure) {
      const src = path.join(__dirname, file);
      if (await fs.pathExists(src)) {
        await fs.copy(src, path.join(tmpDir, file));
      }
    }
    
    if (process.platform !== 'win32') {
      await fs.chmod(path.join(tmpDir, 'gradlew'), '755');
    }

    // --- שלב ב': יצירת מבנה התיקיות של Fabric (הלוגיקה של קלוד) ---
    log('Structuring Minecraft source directories...');
    const javaBase = path.join(tmpDir, 'src/main/java/com', LOCKED_PKG);
    const resourcesBase = path.join(tmpDir, 'src/main/resources/assets', modId);

    await fs.ensureDir(path.join(javaBase, 'registry'));
    await fs.ensureDir(path.join(javaBase, 'item'));
    await fs.ensureDir(path.join(resourcesBase, 'textures/item'));
    await fs.ensureDir(path.join(resourcesBase, 'models/item'));

    // --- שלב ג': כתיבת קבצי המקור ---
    log('Writing Java classes and JSON assets...');
    const gf = generated_files;
    let javaCount = 0;

    for (const [name, content] of Object.entries(gf)) {
      if (name.startsWith('_')) continue; // דילוג על מטא-דאטה

      let destPath;
      if (name === 'Main') {
        destPath = path.join(javaBase, 'Main.java');
      } else if (name.includes('Items') || name.includes('Blocks')) {
        destPath = path.join(javaBase, 'registry', `${name}.java`);
      } else if (name.endsWith('.java')) {
        destPath = path.join(javaBase, 'item', name);
      } else if (name.includes('models/')) {
        destPath = path.join(tmpDir, 'src/main/resources/assets', name);
      } else {
        destPath = path.join(tmpDir, name);
      }

      await fs.ensureDir(path.dirname(destPath));
      await fs.writeFile(destPath, content);
      if (name.endsWith('.java') || name === 'Main') javaCount++;
    }

    // --- שלב ד': הרצת Gradle Build ---
    log(`Compiling ${javaCount} Java files with Gradle...`);
    const result = spawnSync('./gradlew', ['build', '--no-daemon', '-x', 'test'], {
      cwd: tmpDir,
      timeout: 600000, // 10 דקות
      encoding: 'utf8',
      env: {
        ...process.env,
        GRADLE_OPTS: "-Xmx1024m -Xms512m",
        GRADLE_USER_HOME: GRADLE_CACHE,
        JAVA_HOME: process.env.JAVA_HOME || '/opt/java/openjdk'
      }
    });

    if (result.status !== 0) {
      const errorMsg = result.stderr || result.stdout || 'Unknown Gradle error';
      log('Build Failed. Extracting error details...');
      return res.status(500).json({ success: false, error: 'Gradle Build Failed', logs: logs.concat(errorMsg.split('\n')) });
    }

    // --- שלב ה': איתור ה-JAR ושליחה ---
    log('Locating compiled artifacts...');
    const libsDir = path.join(tmpDir, 'build/libs');
    const jarFiles = (await fs.readdir(libsDir)).filter(f => f.endsWith('.jar') && !f.includes('-dev') && !f.includes('-sources'));

    if (jarFiles.length === 0) throw new Error('Build finished but no JAR was found');

    const jarBuffer = await fs.readFile(path.join(libsDir, jarFiles[0]));
    const sizeKb = Math.round(jarBuffer.length / 1024);
    log(`Build Successful: ${jarFiles[0]} (${sizeKb} KB)`);

    res.json({
      success: true,
      file_name: `${modId}-1.0.0.jar`,
      jar_base64: jarBuffer.toString('base64'),
      size_kb: String(sizeKb),
      logs
    });

  } catch (err) {
    log(`CRITICAL ERROR: ${err.message}`);
    res.status(500).json({ success: false, error: err.message, logs });
  } finally {
    // ניקוי תיקייה זמנית
    await fs.remove(tmpDir).catch(e => console.error('Cleanup failed:', e));
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Server started on port ${PORT}`));
