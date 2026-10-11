import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.skipif(sys.platform != "win32", reason="Windows local scheduler launcher")
def test_expiry_still_runs_when_refresh_fails(tmp_path):
    fake_docker = tmp_path / "docker.cmd"
    fake_docker.write_text(
        "@echo off\n"
        'echo %* | findstr /C:"refresh_youtube_metadata" >nul\n'
        "if %ERRORLEVEL% EQU 0 exit /b 9\n"
        'echo %* | findstr /C:"purge_expired_source_metadata" >nul\n'
        "if %ERRORLEVEL% EQU 0 exit /b 0\n"
        "exit /b 99\n",
        encoding="ascii",
    )
    state_path = tmp_path / "status.json"
    script = Path(__file__).resolve().parents[2] / "infra" / "run-maintenance.ps1"
    result = subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "RemoteSigned",
            "-File",
            str(script),
            "-StatePath",
            str(state_path),
        ],
        env={**os.environ, "PATH": str(tmp_path) + os.pathsep + os.environ["PATH"]},
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 1
    state = json.loads(state_path.read_text(encoding="utf-8-sig"))
    assert state["refresh_exit"] == 9
    assert state["expiry_exit"] == 0
