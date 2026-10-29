@echo off
rem Запуск платформы в Windows: двойной щелчок по этому файлу.
chcp 65001 >nul
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 server.py
  goto :end
)
where python >nul 2>nul
if %errorlevel%==0 (
  python server.py
  goto :end
)

echo.
echo   Не найден Python 3.
echo   Установите его с https://www.python.org/downloads/
echo   и при установке отметьте "Add Python to PATH".
echo.
pause

:end
