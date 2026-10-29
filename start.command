#!/bin/bash
# Запуск платформы на macOS и Linux: двойной щелчок по этому файлу.
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  exec python3 server.py
fi
echo "Не найден Python 3."
echo "Установите его с https://www.python.org/downloads/ и запустите этот файл снова."
read -r -p "Нажмите Enter, чтобы закрыть окно…"
