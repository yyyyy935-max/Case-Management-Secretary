@echo off
chcp 65001 > nul
cd /d "%~dp0"
title 사례비서

where node > nul 2>&1
if errorlevel 1 (
  echo [사례비서] Node.js가 설치되어 있지 않습니다.
  echo https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [사례비서] 처음 실행이라 필요한 파일을 내려받습니다. 몇 분 걸릴 수 있습니다.
  call npm install --omit=dev
  if errorlevel 1 (
    echo [사례비서] 내려받기에 실패했습니다. 인터넷 연결을 확인하세요.
    pause
    exit /b 1
  )
)

if not exist config.local.json copy config.example.json config.local.json > nul

call npm start
pause
