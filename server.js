import React, { useState, useEffect } from 'react';
import { Zap, Package, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import BuildDashboard from './BuildDashboard';

function ModExport({ project, onProjectRefresh }) {
  const [building, setBuilding] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [resetting, setResetting] = useState(false);

  // פונקציית הבנייה - חייבת להיות async!
  const buildJar = async () => {
    setBuilding(true);
    try {
      // עדכון ה-Database לפני הבנייה
      await base44.entities.ModProject.update(project.id, {
        generated_files: project.generated_files || {},
        status: 'building'
      });

      const response = await base44.functions.invoke('buildModJar', { projectId: project.id });
      
      if (response.data?.success) {
        setShowDashboard(true);
        toast.success("Build Started Successfully!");
      }
    } catch (err) {
      toast.error("Build Error: " + err.message);
    } finally {
      setBuilding(false);
    }
  };

  const fullReset = async () => {
    setResetting(true);
    try {
      await base44.functions.invoke('hardResetRegistry', { projectId: project.id });
      if (onProjectRefresh) await onProjectRefresh();
      toast.success("System Reset Complete");
    } catch (err) {
      toast.error("Reset Failed");
    } finally {
      setResetting(false);
    }
  };

  if (showDashboard) {
    return <BuildDashboard project={project} onBack={() => setShowDashboard(false)} />;
  }

  return (
    <div className="p-8 bg-[#0D0D0D] min-h-full text-white">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Zap className="text-[#39FF14]" />
          <h2 className="text-2xl font-black italic">CLOUD EXPORTER</h2>
        </div>

        <button 
          onClick={buildJar}
          disabled={building}
          className="w-full py-10 bg-gradient-to-r from-purple-600 to-[#39FF14] rounded-3xl font-black text-2xl mb-8 flex items-center justify-center gap-4"
        >
          {building ? <Loader2 className="animate-spin" /> : <Package size={32} />}
          {building ? "BUILDING..." : "GENERATE MOD JAR"}
        </button>

        <div className="p-6 border border-red-500/20 rounded-2xl bg-red-500/5 flex justify-between items-center">
          <div>
            <p className="font-bold text-red-400">Deep System Reset</p>
            <p className="text-xs text-white/40">Use this to fix "Service Crashed" errors.</p>
          </div>
          <button onClick={fullReset} className="px-6 py-2 bg-red-500/20 border border-red-500/40 rounded-xl text-red-500 font-bold">
            {resetting ? "RESETTING..." : "RESET NOW"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ModExport;
