import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

// כתובת שרת הבנייה ב-Railway - תעדכן אחרי הדיפלוי
const BUILD_SERVER_URL = Deno.env.get('BUILD_SERVER_URL') || 'https://your-app.railway.app';

function snake(v: string): string {
  return (v || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const projectId = body.projectId;
    if (!projectId) return Response.json({ error: 'Missing projectId' }, { status: 400 });

    console.log(`[buildModJar] Starting build for project: ${projectId}`);

    // 1. טוען את הפרויקט מהדאטאבייס
    let project = null;
    try {
      project = await base44.entities.ModProject.get(projectId);
    } catch (_) {
      project = await base44.asServiceRole.entities.ModProject.get(projectId);
    }
    if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });

    const gf = project.generated_files || {};
    if (!gf.Main || !gf.ModItems) {
      return Response.json({ error: 'Project has no generated files. Run Reset & Rebuild first.' }, { status: 400 });
    }

    console.log(`[buildModJar] Sending to build server: ${project.name}`);

    // 2. שולח לשרת הבנייה
    const buildResponse = await fetch(`${BUILD_SERVER_URL}/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        modName: project.name,
        generated_files: gf,
      }),
      signal: AbortSignal.timeout(110000), // 110 שניות timeout
    });

    if (!buildResponse.ok) {
      const errText = await buildResponse.text();
      throw new Error(`Build server error ${buildResponse.status}: ${errText}`);
    }

    const buildData = await buildResponse.json();

    if (!buildData.success) {
      throw new Error(buildData.error || 'Build failed');
    }

    console.log(`[buildModJar] Build success! ${buildData.file_name} (${buildData.size_kb} KB)`);

    // 3. שומר את ה-JAR ב-Base44 Storage
    let jarUrl = null;
    if (buildData.jar_base64) {
      try {
        // המר base64 ל-Blob ושמור ב-Storage
        const binaryStr = atob(buildData.jar_base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        const jarBlob = new Blob([bytes], { type: 'application/java-archive' });
        const fileName = buildData.file_name || `${snake(project.name)}-1.0.0.jar`;

        // שמירה ב-Base44 storage
        const uploadResult = await base44.storage.upload(jarBlob, fileName);
        jarUrl = uploadResult?.url || null;
        console.log(`[buildModJar] JAR uploaded to storage: ${jarUrl}`);
      } catch (uploadErr) {
        console.warn(`[buildModJar] Storage upload failed: ${uploadErr.message} - using base64 fallback`);
        // Fallback: שמור את ה-base64 ישירות בדאטאבייס
        jarUrl = `data:application/java-archive;base64,${buildData.jar_base64}`;
      }
    }

    // 4. עדכון הדאטאבייס עם תוצאת הבנייה
    const buildResult = {
      success: true,
      jar_url: jarUrl,
      file_name: buildData.file_name,
      file_count: buildData.file_count || 0,
      size_kb: buildData.size_kb || '0',
      manifest: buildData.manifest || {},
      logs: buildData.logs || ['Build completed successfully'],
    };

    await base44.asServiceRole.entities.ModProject.update(projectId, {
      last_build_result: buildResult,
      status: 'ready',
    });

    return Response.json(buildResult);

  } catch (error) {
    console.error(`[buildModJar] ERROR: ${error.message}`);
    return Response.json({
      success: false,
      error: error.message,
      logs: [`ERROR: ${error.message}`],
    }, { status: 500 });
  }
});
