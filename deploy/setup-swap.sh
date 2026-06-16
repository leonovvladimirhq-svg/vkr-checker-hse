#!/usr/bin/env bash
# Идемпотентная настройка swap для RAM-ограниченного бокса (961 МБ).
# Добавляет /swapfile2 (2 ГБ) к существующему /swapfile (1 ГБ) -> итого ~3 ГБ,
# и снижает swappiness, чтобы ядро не выгружало память без нужды.
# Запуск: sudo bash deploy/setup-swap.sh
set -euo pipefail

SWAPFILE=/swapfile2
SIZE_MB=2048

if swapon --show=NAME --noheadings | grep -q "^${SWAPFILE}$"; then
  echo "[swap] ${SWAPFILE} уже активен — пропускаю создание."
else
  echo "[swap] создаю ${SWAPFILE} (${SIZE_MB} МБ)..."
  fallocate -l "${SIZE_MB}M" "${SWAPFILE}" 2>/dev/null \
    || dd if=/dev/zero of="${SWAPFILE}" bs=1M count="${SIZE_MB}" status=none
  chmod 600 "${SWAPFILE}"
  mkswap "${SWAPFILE}" >/dev/null
  swapon "${SWAPFILE}"
fi

# Персистентность после ребута
grep -q "^${SWAPFILE} " /etc/fstab || echo "${SWAPFILE} none swap sw 0 0" >> /etc/fstab

# Менее агрессивный своппинг
sysctl -q vm.swappiness=10
echo 'vm.swappiness=10' > /etc/sysctl.d/99-vkr-swap.conf

echo "[swap] готово:"
swapon --show
free -h
echo "swappiness=$(cat /proc/sys/vm/swappiness)"
