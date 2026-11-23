@echo off
cd /d "%~dp0"
title 사례비서

if not exist package.json (
  echo [사례비서] 필요한 파일이 이 폴더에 없습니다.
  echo ZIP 파일 안에서 바로 실행하면 이렇게 됩니다.
  echo ZIP 파일을 마우스 오른쪽 버튼으로 눌러 [압축 풀기]를 한 뒤,
  echo 압축을 푼 폴더 안의 시작.bat을 실행하세요.
  pause
  exit /b 1
)

where node > nul 2>&1
if errorlevel 1 (
  echo [사례비서] Node.js가 설치되어 있지 않습니다.
  echo https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)

rem 필요한 파일 목록(package-lock.json)이 바뀌었으면 다시 내려받는다
if not exist node_modules goto install
if not exist node_modules\.sarye-lock goto install
fc /b package-lock.json node_modules\.sarye-lock > nul || goto install
goto run

:install
echo [사례비서] 필요한 파일을 내려받습니다. 처음에는 몇 분 걸릴 수 있습니다.
call npm install --omit=dev --omit=optional || goto installfail
copy /y package-lock.json node_modules\.sarye-lock > nul

:run
if not exist config.local.json copy config.example.json config.local.json > nul
call npm start
pause
exit /b 0

:installfail
if exist node_modules rmdir /s /q node_modules
echo [사례비서] 내려받기에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 실행하세요.
pause
exit /b 1
