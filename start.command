#!/bin/bash
# Запуск платформы на macOS и Linux: двойной щелчок по этому файлу.
cd "$(dirname "$0")" || exit 1

# macOS помечает всё скачанное «карантином» и отказывается запускать такие
# файлы. Раз уж мы запустились, снимаем метку со всей папки — чтобы при
# следующих запусках система больше не спрашивала.
xattr -dr com.apple.quarantine . 2>/dev/null || true
if command -v python3 >/dev/null 2>&1; then
  exec python3 server.py
fi
echo "Не найден Python 3."
echo "Установите его с https://www.python.org/downloads/ и запустите этот файл снова."
read -r -p "Нажмите Enter, чтобы закрыть окно…"
