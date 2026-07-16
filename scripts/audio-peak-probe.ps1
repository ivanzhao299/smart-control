# audio-peak-probe.ps1 -- which Windows audio endpoint is ACTUALLY making sound?
#
# ASCII-only on purpose: GK9000 PowerShell 5.1 reads BOM-less UTF-8 as GBK and a
# non-ASCII byte in a comment can swallow the next newline.
#
# WHY THIS EXISTS (2026-07-17, after a night of chasing ghosts):
# When "there is no sound", the ONLY question worth answering first is:
#   is the PC emitting audio at all, and out of WHICH endpoint?
# This answers it in 5 seconds and splits the problem cleanly in two:
#   peak > 0 on the expected endpoint -> PC side is fine, fault is downstream
#                                        (cable / matrix routing / amp)
#   peak == 0                         -> fault is on the PC (wrong sink, muted,
#                                        player not playing, setSinkId failed)
# It reads IAudioMeterInformation, which is MACHINE-GLOBAL -- unlike windows or
# Screen::AllScreens, it stays correct when read over SSH (session 0).
#
# Do NOT diagnose this from the EKX matrix input levels
# (GET /api/audio/input/:ch/diagnose -> level). They have lied repeatedly:
# unrouted channels return absurd values (e.g. a flat "20"), and a level of
# -66dB once sat next to a real signal. Trust this probe instead.
#
# Usage:  powershell -NoProfile -File .\scripts\audio-peak-probe.ps1
# Map the GUID it prints to a name via:
#   HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\{guid}\Properties
#   value "{a45c254e-df1c-4efd-8020-67d146a850e0},2"
#
# Known endpoints on GK9000 (2026-07-17):
#   HDMI1.3   (Intel Display Audio) -> HDMI audio splitter -> matrix IN4 -> OUT5 (LED wall amp)
#   speakers  (USB Audio and HID)   -> 3.5mm -> matrix IN1 -> OUT1,2,3,4,7,8 (zone amps)
#
# Peak > 0 means audio IS being rendered to that endpoint right now.
# Peak == 0 across a few seconds means nothing is feeding it.

Add-Type -Language CSharp @'
using System;
using System.Runtime.InteropServices;

namespace AudioPeak {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  public class MMDeviceEnumeratorComObject { }

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    int GetDevice(string id, out IMMDevice device);
  }

  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceCollection {
    int GetCount(out int count);
    int Item(int index, out IMMDevice device);
  }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr act, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    int OpenPropertyStore(int access, out IPropertyStore store);
    int GetId(out IntPtr id);
    int GetState(out int state);
  }

  [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    int GetCount(out int count);
    int GetAt(int index, out PROPERTYKEY key);
    int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct PROPERTYKEY { public Guid fmtid; public int pid; }

  [StructLayout(LayoutKind.Explicit)]
  public struct PROPVARIANT {
    [FieldOffset(0)] public short vt;
    [FieldOffset(8)] public IntPtr pointerValue;
  }

  [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioMeterInformation {
    int GetPeakValue(out float peak);
  }

  public class Probe {
    static Guid IID_METER = new Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064");

    public static string[] Read() {
      var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
      IMMDeviceCollection col;
      // dataFlow 0 = eRender, stateMask 1 = DEVICE_STATE_ACTIVE
      en.EnumAudioEndpoints(0, 1, out col);
      int n; col.GetCount(out n);
      var outp = new System.Collections.Generic.List<string>();
      for (int i = 0; i < n; i++) {
        IMMDevice dev; col.Item(i, out dev);
        IPropertyStore store; dev.OpenPropertyStore(0, out store);
        var key = new PROPERTYKEY();
        key.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
        key.pid = 2;
        PROPVARIANT pv;
        store.GetValue(ref key, out pv);
        string name = Marshal.PtrToStringUni(pv.pointerValue);
        IntPtr idp; dev.GetId(out idp);
        string id = Marshal.PtrToStringUni(idp);
        if (string.IsNullOrEmpty(name)) name = "(name?)";
        name = name + " [" + id + "]";
        object o;
        dev.Activate(ref IID_METER, 1, IntPtr.Zero, out o);
        var meter = (IAudioMeterInformation)o;
        float peak;
        meter.GetPeakValue(out peak);
        outp.Add(name + "|" + peak.ToString("0.0000"));
      }
      return outp.ToArray();
    }
  }
}
'@

$acc = @{}
# Sample repeatedly: a single instant can catch a silent passage in the track.
for ($i = 0; $i -lt 25; $i++) {
  foreach ($line in [AudioPeak.Probe]::Read()) {
    $parts = $line.Split('|')
    $nm = $parts[0]; $pk = [double]$parts[1]
    if (-not $acc.ContainsKey($nm)) { $acc[$nm] = 0.0 }
    if ($pk -gt $acc[$nm]) { $acc[$nm] = $pk }
  }
  Start-Sleep -Milliseconds 200
}
Write-Output "=== MAX PEAK over 5s per ACTIVE render endpoint ==="
foreach ($k in $acc.Keys) {
  $v = $acc[$k]
  $verdict = if ($v -gt 0.0001) { "  <== HAS AUDIO" } else { "  <== SILENT" }
  Write-Output ("{0,-28} peak={1:N4}{2}" -f $k, $v, $verdict)
}
