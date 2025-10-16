#!/usr/bin/env python3
"""
Simulate external keyboard malfunction on Windows by disabling the PnP device.

Requires: Run this script as Administrator.

Usage:
  python simulate_kb_malfunction_windows.py --action list
  python simulate_kb_malfunction_windows.py --action disable
  python simulate_kb_malfunction_windows.py --action enable
"""

import argparse
import subprocess
import json
import sys
import shlex

def run_ps(cmd):
    full = ["powershell", "-NoProfile", "-Command", cmd]
    result = subprocess.run(full, capture_output=True, text=True)
    return result

def list_keyboards():
    # Get keyboards as objects
    ps = "Get-PnpDevice -Class Keyboard | Select-Object -Property InstanceId,Status,FriendlyName | ConvertTo-Json"
    r = run_ps(ps)
    if r.returncode != 0:
        print("PowerShell call failed:", r.stderr)
        sys.exit(1)
    out = r.stdout.strip()
    if not out:
        return []
    # PowerShell returns either a list or a single object
    try:
        data = json.loads(out)
    except Exception as e:
        print("Failed to parse PowerShell JSON output:", e)
        print("Raw output:", out)
        sys.exit(1)
    if isinstance(data, dict):
        data = [data]
    return data

def change_device_state(instance_id, enable=True):
    action = "Enable-PnpDevice" if enable else "Disable-PnpDevice"
    # -Confirm:$false to avoid prompt, -ErrorAction Stop to catch errors
    ps = f"{action} -InstanceId '{instance_id}' -Confirm:$false -ErrorAction Stop"
    r = run_ps(ps)
    return r

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--action", choices=("list","disable","enable"), default="list")
    p.add_argument("--match", default="USB", help="match substring to identify external keyboard (default 'USB')")
    args = p.parse_args()

    devices = list_keyboards()
    matches = [d for d in devices if args.match.lower() in (d.get("InstanceId") or "").lower()]
    if not devices:
        print("No keyboard devices found or PowerShell failure.")
        return

    print("All keyboard devices:")
    for d in devices:
        print("-", d.get("FriendlyName"), "|", d.get("InstanceId"), "| status:", d.get("Status"))

    if args.action == "list":
        return

    matches = [d for d in devices if args.match.lower() in (d.get("FriendlyName") or "").lower()]

    if not matches:
        print(f"No keyboard device matched '{args.match}'. Use --action list to inspect devices.")
        return

    for m in matches:
        iid = m.get("InstanceId")
        print(f"{'Enabling' if args.action=='enable' else 'Disabling'}: {m.get('FriendlyName')} ({iid})")
        r = change_device_state(iid, enable=(args.action=="enable"))
        if r.returncode != 0:
            print("PowerShell error:", r.stderr)
        else:
            print("Success. Output:", r.stdout.strip())

if __name__ == "__main__":
    if not sys.platform.startswith("win"):
        print("This script is for Windows only.")
        sys.exit(1)
    main()
