@echo off
set "ROOT=%~dp0"
rem the backend's packages live in the virtualenv that make setup creates
if not exist "%ROOT%backend\.venv\Scripts\python.exe" (
  echo backend\.venv is missing: run make setup first, or see README.md.
  exit /b 1
)
start "ColdRoute Backend" cmd /k "cd /d "%ROOT%backend" && .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000"
start "ColdRoute Frontend" cmd /k "cd /d "%ROOT%frontend" && npm run dev"
echo Backend: http://localhost:8000/docs
echo Frontend: http://localhost:5173
