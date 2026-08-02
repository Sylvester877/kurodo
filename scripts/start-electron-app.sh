#!/usr/bin/env bash
set -e
cd /c/Users/sylvester/Downloads/kurodo/repo
nohup ./release/win-unpacked/Kurodo.exe > /tmp/kurodo-electron.log 2>&1 &
echo $! > /tmp/kurodo-electron.pid
echo "Started Kurodo Electron PID:$!"
