@echo off
set ROOT=%~dp0
start "ColdRoute Backend" cmd /k "cd /d %ROOT%backend && python -m uvicorn app.main:app --reload --port 8000"
start "ColdRoute Frontend" cmd /k "cd /d %ROOT%frontend && npm run dev"
echo Backend: http://localhost:8000/docs
echo Frontend: http://localhost:5173
