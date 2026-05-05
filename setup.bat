@echo off
REM R-Drive Email Client - Quick Start
REM Run this from the project root

echo ==========================================
echo  R-DRIVE EMAIL CLIENT - Quick Start
echo ==========================================
echo.

REM Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.10+ first.
    exit /b 1
)

REM Check Node
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found. Install Node 18+ first.
    exit /b 1
)

REM Setup backend
echo [1/4] Setting up backend...
cd backend
if not exist venv (
    python -m venv venv
)
call venv\Scripts\activate
pip install -r requirements.txt
if not exist .env (
    copy .env.example .env
    echo Created .env - EDIT IT WITH YOUR VALUES BEFORE RUNNING
)
cd ..

REM Setup frontend
echo [2/4] Setting up frontend...
cd frontend
if not exist node_modules (
    npm install
)
cd ..

REM Create R: drive directories
echo [3/4] Creating R: drive directories...
if not exist "R:\email_client" mkdir "R:\email_client"
if not exist "R:\email_client\attachments" mkdir "R:\email_client\attachments"

echo [4/4] Done!
echo.
echo NEXT STEPS:
echo 1. Edit backend\.env with your Cloudflare credentials
echo 2. Deploy the Cloudflare Worker (see docs\SETUP.md)
echo 3. Run: start_backend.bat
echo 4. Run: start_frontend.bat
echo.
pause
