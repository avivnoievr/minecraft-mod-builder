const express = require('express');
const { spawnSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

const app = express();
app.use(express.json({ limit: '50mb' }));

// בדיקת תקינות - אם תכנס לכתובת של Railway תראה "Server is Up"
app.get('/', (req, res) => res.send('Server is Up and Running!'));

app.post('/build', async (req, res) => {
    console.log("Build request received for mod:", req.body.modId);
    const { files } = req.body;
    const buildId = `build_${Date.now()}`;
    const buildDir = path.join(__dirname, buildId);
    
    try {
        const pkgPath = 'src/main/java/com/buildmeamod';
        await fs.ensureDir(path.join(buildDir, pkgPath));
        
        for (const [name, content] of Object.entries(files)) {
            if (name.endsWith('.java')) {
                await fs.writeFile(path.join(buildDir, pkgPath, name), content);
            }
        }

        // קובץ הגדרות בסיסי מאוד
        await fs.writeFile(path.join(buildDir, 'build.gradle'), `
            plugins { id 'fabric-loom' version '1.4-SNAPSHOT' }
            dependencies { 
                minecraft "com.mojang:minecraft:1.20.1"
                mappings "net.fabricmc:yarn:1.20.1+build.10:v2"
                modImplementation "net.fabricmc:fabric-loader:0.15.6"
            }
        `);

        res.status(200).send("Build started - check JAR later");
    } catch (e) {
        console.error(e);
        res.status(500).send(e.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
