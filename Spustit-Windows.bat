@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" goto dependencies
where py >nul 2>nul
if errorlevel 1 goto try_python
py -3.12 -m venv .venv
if errorlevel 1 goto failed
goto dependencies
:try_python
where python >nul 2>nul
if errorlevel 1 goto missing_python
python -m venv .venv
if errorlevel 1 goto failed
:dependencies
echo Pripravuji aplikaci. Pri prvnim spusteni je potreba pripojeni k internetu.
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto failed
where tesseract >nul 2>nul
if errorlevel 1 goto start
".venv\Scripts\python.exe" scripts\setup_ocr.py
if errorlevel 1 echo Ceske OCR se nepodarilo pripravit. Textove PDF muzete zkontrolovat.
:start
echo Aplikace se otevre v prohlizeci. Toto okno ponechte otevrene.
".venv\Scripts\python.exe" -m streamlit run app.py
if errorlevel 1 goto failed
exit /b 0
:missing_python
echo Nejprve nainstalujte Python 3.12 z python.org a pri instalaci zvolte Add Python to PATH.
pause
exit /b 1
:failed
echo Spusteni se nepodarilo. Zkontrolujte chybovou zpravu vyse a navod README.md.
pause
exit /b 1
