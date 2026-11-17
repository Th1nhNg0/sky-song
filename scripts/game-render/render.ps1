param([string]$GameDir, [string]$Jobs, [string]$OutWav, [string]$Log)
$ErrorActionPreference = 'Stop'
$code = @"
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class SkyRender {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr LoadLibraryW(string path);
  [DllImport("fmodstudio.dll")] static extern int FMOD_Studio_System_Create(out IntPtr system, uint version);
  [DllImport("fmodstudio.dll")] static extern int FMOD_Studio_System_GetCoreSystem(IntPtr system, out IntPtr core);
  [DllImport("fmod.dll")] static extern int FMOD_System_SetOutput(IntPtr core, int output);
  [DllImport("fmod.dll")] static extern int FMOD_System_SetSoftwareFormat(IntPtr core, int rate, int speakermode, int raw);
  [DllImport("fmod.dll")] static extern int FMOD_System_SetDSPBufferSize(IntPtr core, uint len, int num);
  [DllImport("fmodstudio.dll")] static extern int FMOD_Studio_System_Initialize(IntPtr system, int maxch, uint studioflags, uint flags, byte[] extra);
  [DllImport("fmodstudio.dll")] static extern int FMOD_Studio_System_LoadBankFile(IntPtr system, byte[] file, uint flags, out IntPtr bank);
  [DllImport("fmodstudio.dll")] static extern int FMOD_Studio_System_GetEvent(IntPtr system, byte[] path, out IntPtr desc);
  [DllImport("fmodstudio.dll")] static extern int FMOD_Studio_EventDescription_LoadSampleData(IntPtr desc);
  [DllImport("fmodstudio.dll")] static extern int FMOD_Studio_EventDescription_GetSampleLoadingState(IntPtr desc, out int state);
  [DllImport("fmodstudio.dll")] static extern int FMOD_Studio_EventDescription_CreateInstance(IntPtr desc, out IntPtr inst);
  [DllImport("fmodstudio.dll")] static extern int FMOD_Studio_EventInstance_SetParameterByName(IntPtr inst, byte[] name, float value, int ignoreSeek);
  [DllImport("fmodstudio.dll")] static extern int FMOD_Studio_EventInstance_Start(IntPtr inst);
  [DllImport("fmodstudio.dll")] static extern int FMOD_Studio_EventInstance_Stop(IntPtr inst, int mode);
  [DllImport("fmodstudio.dll")] static extern int FMOD_Studio_EventInstance_Release(IntPtr inst);
  [DllImport("fmodstudio.dll")] static extern int FMOD_Studio_System_Update(IntPtr system);
  [DllImport("fmodstudio.dll")] static extern int FMOD_Studio_System_Release(IntPtr system);

  static byte[] Z(string s) { return Encoding.UTF8.GetBytes(s + "\0"); }
  static void Ok(int r, string what) { if (r != 0) throw new Exception(what + " failed: FMOD error " + r); }

  const int Rate = 32000;
  const uint Block = 512;

  public static void Run(string gameDir, string jobs, string outWav, string log) {
    if (LoadLibraryW(Path.Combine(gameDir, "fmod.dll")) == IntPtr.Zero) throw new Exception("fmod.dll");
    if (LoadLibraryW(Path.Combine(gameDir, "fmodstudio.dll")) == IntPtr.Zero) throw new Exception("fmodstudio.dll");
    IntPtr sys, core;
    Ok(FMOD_Studio_System_Create(out sys, 0x00020222), "create");
    Ok(FMOD_Studio_System_GetCoreSystem(sys, out core), "core");
    Ok(FMOD_System_SetOutput(core, 5), "output WAVWRITER_NRT");
    Ok(FMOD_System_SetSoftwareFormat(core, Rate, 3, 0), "format");
    Ok(FMOD_System_SetDSPBufferSize(core, Block, 4), "buffer");
    Ok(FMOD_Studio_System_Initialize(sys, 256, 2 /* SYNCHRONOUS_UPDATE */, 1 /* STREAM_FROM_UPDATE */, Z(outWav)), "init");
    string banks = Path.Combine(gameDir, @"data\assets\initial\Data\Audio\Fmod\fmodswitch");
    var names = new List<string>(Directory.GetFiles(banks, "*.bank"));
    names.Sort((a, b) => (Path.GetFileName(b).StartsWith("MasterBank.") ? 1 : 0) - (Path.GetFileName(a).StartsWith("MasterBank.") ? 1 : 0));
    var w = new StreamWriter(log);
    foreach (var f in names) {
      if (f.EndsWith(".strings.bank")) continue;
      IntPtr bank;
      int r = FMOD_Studio_System_LoadBankFile(sys, Z(f), 0, out bank);
      if (r != 0) w.WriteLine("# bank " + Path.GetFileName(f) + " error " + r);
    }
    long frames = 0;
    Action step = () => { Ok(FMOD_Studio_System_Update(sys), "update"); frames += Block; };
    for (int i = 0; i < 8; i++) step();
    var descs = new Dictionary<string, IntPtr>();
    int n = 0;
    foreach (var raw in File.ReadAllLines(jobs)) {
      var line = raw.Trim();
      if (line.Length == 0 || line[0] == '#') continue;
      var p = line.Split(' ');
      string guid = p[0]; float pitch = float.Parse(p[1], System.Globalization.CultureInfo.InvariantCulture);
      double hold = double.Parse(p[2], System.Globalization.CultureInfo.InvariantCulture);
      double gap = double.Parse(p[3], System.Globalization.CultureInfo.InvariantCulture);
      IntPtr desc;
      if (!descs.TryGetValue(guid, out desc)) {
        Ok(FMOD_Studio_System_GetEvent(sys, Z("{" + guid + "}"), out desc), "event " + guid);
        Ok(FMOD_Studio_EventDescription_LoadSampleData(desc), "load " + guid);
        int state = 0;
        var clock = System.Diagnostics.Stopwatch.StartNew();
        while (clock.ElapsedMilliseconds < 30000) {
          step();
          FMOD_Studio_EventDescription_GetSampleLoadingState(desc, out state);
          if (state == 3) break;
          System.Threading.Thread.Sleep(2);
        }
        if (state != 3) w.WriteLine("# samples of " + guid + " still loading (" + state + ") after 30 s");
        descs[guid] = desc;
      }
      IntPtr inst;
      Ok(FMOD_Studio_EventDescription_CreateInstance(desc, out inst), "instance");
      int pr = FMOD_Studio_EventInstance_SetParameterByName(inst, Z("menuPitch"), pitch, 1);
      Ok(FMOD_Studio_EventInstance_Start(inst), "start");
      long at = frames;
      long holdBlocks = (long)Math.Round(hold * Rate / Block), gapBlocks = (long)Math.Round(gap * Rate / Block);
      for (long i = 0; i < holdBlocks; i++) step();
      FMOD_Studio_EventInstance_Stop(inst, 1);  // IMMEDIATE: silence before the next note
      FMOD_Studio_EventInstance_Release(inst);
      for (long i = 0; i < gapBlocks; i++) step();
      w.WriteLine(string.Format(System.Globalization.CultureInfo.InvariantCulture, "{0} {1} {2} {3} {4}", n++, guid, pitch, at, pr));
    }
    for (int i = 0; i < 16; i++) step();
    w.Close();
    FMOD_Studio_System_Release(sys);
  }
}
"@
Add-Type -TypeDefinition $code -Language CSharp
[SkyRender]::Run($GameDir, $Jobs, $OutWav, $Log)
"done"
