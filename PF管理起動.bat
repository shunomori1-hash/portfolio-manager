@echo off
chcp 65001 > nul
echo ポートフォリオ管理アプリを起動します...

:: ── ポート 5174 (フロントエンド) を使用しているプロセスを停止 ──────────────
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr " :5174 "') do (
  if not "%%p"=="" if not "%%p"=="0" (
    taskkill /PID %%p /F > nul 2>&1
  )
)

:: ── ポート 3001 (API サーバー) を使用しているプロセスを停止 ──────────────
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr " :3001 "') do (
  if not "%%p"=="" if not "%%p"=="0" (
    taskkill /PID %%p /F > nul 2>&1
  )
)

timeout /t 1 /nobreak > nul

:: ── アプリ起動 ────────────────────────────────────────────────────────────
cd /d C:\Users\shuno\portfolio-manager

:: ブラウザを 6 秒後に開く (サーバー起動待ち)
start /min cmd /c "timeout /t 6 /nobreak > nul && start http://localhost:5174"

:: 開発サーバー起動 (フロント + API)
npm.cmd run dev:all
