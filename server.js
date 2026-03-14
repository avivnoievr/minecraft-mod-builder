const express = require('express');
const fs = require('fs-extra'); // מומלץ להשתמש ב-fs-extra ב-package.json
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');

const app = express();
app.use(express.json({ limit: '50mb' }));

const GRADLE_CACHE = path.join(os.tmpdir(), '.gradle-cache');

app.post('/build', async (req, res) => {
  const { projectId, modName, generated_files } = req.body;
  const modId = (modName || 'mymod').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const tmpDir = path.join(os.tmpdir(), `mod-${Date.now()}`);
  const logs = [];
  const log = (msg) => { logs.push(msg); console.log('[BUILD] ' + msg); };

  try {
    log('Preparing workspace for: ' + modId);
    await fs.ensureDir(tmpDir);

    // *** התיקון הקריטי: העתקת קבצי Gradle מהשורש לתיקייה הזמנית ***
    const baseFiles = ['gradlew', 'gradle', 'build.gradle', 'settings.gradle', 'gradle.properties'];
    for (const f of baseFiles) {
      const src = path.join(__dirname, f);
      if (fs.existsSync(src)) await fs.copy(src, path.join(tmpDir, f));
    }
    if (process.platform !== 'win32') fs.chmodSync(path.join(tmpDir, 'gradlew'), '755');

    // יצירת מבנה התיקיות (הלוגיקה של קלוד ששמרתי)
    const srcDir = path.join(tmpDir, 'src/main/java/com/buildmeamod');
    await fs.ensureDir(path.join(srcDir, 'registry'));
    await fs.ensureDir(path.join(tmpDir, 'src/main/resources/assets', modId, 'textures/item'));

    // כתיבת קבצי ה-Java (כפי שקלוד הגדיר)
    for (const [name, content] of Object.entries(generated_files)) {
      if (name.endsWith('.java') || name === 'Main') {
        const fileName = name.endsWith('.java') ? name : `${name}.java`;
        const subFolder = name.includes('Items') || name.includes('Blocks') ? 'registry' : '';
        await fs.writeFile(path.join(srcDir, subFolder, fileName), content);
      }
    }

    log('Running Gradle Build...');
    const result = spawnSync('./gradlew', ['build', '--no-daemon'], {
      cwd: tmpDir, // תיקון: שימוש ב-tmpDir ולא buildDir
      timeout: 600000,
      encoding: 'utf8',
      env: {
        ...process.env,
        GRADLE_OPTS: "-Xmx1024m -Xms512m", 
        GRADLE_USER_HOME: GRADLE_CACHE
      }
    });

    if (result.status !== 0) throw new Error('Gradle failed: ' + result.stderr);

    const libsDir = path.join(tmpDir, 'build/libs');
    const jarFile = fs.readdirSync(libsDir).find(f => f.endsWith('.jar') && !f.includes('-dev'));
    const jarBuffer = fs.readFileSync(path.join(libsDir, jarFile));

    res.json({
      success: true,
      jar_base64: jarBuffer.toString('base64'),
      file_name: jarFile,
      logs
    });

  } catch (err) {
    log('ERROR: ' + err.message);
    res.status(500).json({ success: false, error: err.message, logs });
  } finally {
    await fs.remove(tmpDir).catch(() => {});
  }
});

app.listen(process.env.PORT || 8080);
