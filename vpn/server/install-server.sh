#!/usr/bin/env bash
# MaxVPN — установщик сервера WireGuard / AmneziaWG для Debian и Ubuntu.
#
# Скрипт идемпотентен: повторный запуск не пересоздаёт ключи сервера и не
# теряет уже добавленные устройства.
#
# Источники по AmneziaWG:
#   https://github.com/amnezia-vpn/amneziawg-linux-kernel-module (установка, параметры обфускации)
#   https://github.com/amnezia-vpn/amneziawg-tools (awg, awg-quick, /etc/amnezia/amneziawg)

set -euo pipefail

MODE="awg"              # awg | wg
PORT=""                 # по умолчанию выбирается случайный в install()
SUBNET="10.28.0.0/24"
DNS="1.1.1.1,1.0.0.1"
ENDPOINT="auto"
EMIT_JSON=0

die() { echo "ОШИБКА: $*" >&2; exit 1; }
log() { echo "[maxvpn] $*" >&2; }

usage() {
  cat >&2 <<'EOF'
Использование: install-server.sh [опции]

  --mode wg|awg      Протокол: wg — обычный WireGuard, awg — AmneziaWG
                     с обфускацией (по умолчанию: awg)
  --port N           UDP-порт (по умолчанию: случайный 20000-60000)
  --subnet CIDR      Внутренняя сеть VPN (по умолчанию: 10.28.0.0/24)
  --dns A,B          DNS для клиентов (по умолчанию: 1.1.1.1,1.0.0.1)
  --endpoint HOST    Внешний адрес сервера (по умолчанию: определяется сам)
  --json             Вывести итоговые параметры машиночитаемым JSON
  -h, --help         Эта справка
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)     MODE="${2:-}"; shift 2 ;;
    --port)     PORT="${2:-}"; shift 2 ;;
    --subnet)   SUBNET="${2:-}"; shift 2 ;;
    --dns)      DNS="${2:-}"; shift 2 ;;
    --endpoint) ENDPOINT="${2:-}"; shift 2 ;;
    --json)     EMIT_JSON=1; shift ;;
    -h|--help)  usage; exit 0 ;;
    *) die "неизвестный аргумент: $1" ;;
  esac
done

[[ "$MODE" == "wg" || "$MODE" == "awg" ]] || die "--mode должен быть wg или awg"
[[ $EUID -eq 0 ]] || die "скрипт нужно запускать от root"

STATE_DIR="/etc/maxvpn"

if [[ "$MODE" == "awg" ]]; then
  IFACE="awg0"
  CONF_DIR="/etc/amnezia/amneziawg"
  QUICK="awg-quick"
  WGBIN="awg"
else
  IFACE="wg0"
  CONF_DIR="/etc/wireguard"
  QUICK="wg-quick"
  WGBIN="wg"
fi
CONF_FILE="$CONF_DIR/$IFACE.conf"

# ---------------------------------------------------------------- определения

detect_os() {
  [[ -r /etc/os-release ]] || die "не найден /etc/os-release, поддерживаются Debian и Ubuntu"
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID="${ID:-}"
  OS_CODENAME="${VERSION_CODENAME:-}"
  case "$OS_ID" in
    ubuntu|debian) : ;;
    *) die "поддерживаются только Debian и Ubuntu, обнаружено: ${OS_ID:-неизвестно}" ;;
  esac
}

detect_wan() {
  WAN_IF="$(ip -4 route show default 2>/dev/null | awk '{print $5; exit}')"
  [[ -n "$WAN_IF" ]] || die "не удалось определить внешний сетевой интерфейс"
}

detect_endpoint() {
  if [[ "$ENDPOINT" != "auto" ]]; then
    return
  fi
  # Сначала — адрес на самом интерфейсе (у большинства VPS белый IP висит прямо на нём).
  local ip
  ip="$(ip -4 -o addr show dev "$WAN_IF" scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -n1)"
  if [[ -z "$ip" ]]; then
    # Сервер за NAT — спрашиваем внешний сервис.
    ip="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
  fi
  [[ -n "$ip" ]] || die "не удалось определить внешний IP, задайте его через --endpoint"
  ENDPOINT="$ip"
}

random_port() {
  # /dev/urandom вместо $RANDOM: шире диапазон и не зависит от seed'а оболочки.
  local n
  n=$(( $(od -An -N2 -tu2 < /dev/urandom | tr -d ' ') % 40000 ))
  echo $(( 20000 + n ))
}

# ------------------------------------------------------------------ установка

install_packages() {
  export DEBIAN_FRONTEND=noninteractive
  log "обновляю список пакетов"
  apt-get update -qq

  log "ставлю базовые пакеты"
  apt-get install -y -qq iproute2 iptables curl qrencode ca-certificates python3 >/dev/null

  if [[ "$MODE" == "wg" ]]; then
    log "ставлю wireguard"
    apt-get install -y -qq wireguard wireguard-tools >/dev/null
    return
  fi

  if command -v awg >/dev/null 2>&1 && command -v awg-quick >/dev/null 2>&1; then
    log "amneziawg уже установлен"
    return
  fi

  log "подключаю репозиторий AmneziaWG (ppa:amnezia/ppa)"
  apt-get install -y -qq software-properties-common python3-launchpadlib gnupg2 >/dev/null
  # Заголовки ядра нужны DKMS для сборки модуля.
  apt-get install -y -qq "linux-headers-$(uname -r)" >/dev/null 2>&1 || \
    log "ВНИМАНИЕ: linux-headers-$(uname -r) не найдены — сборка модуля может не удаться"

  if [[ "$OS_ID" == "ubuntu" ]]; then
    add-apt-repository -y ppa:amnezia/ppa >/dev/null
  else
    # Debian: PPA подключается вручную, ключ 57290828 — ключ подписи ppa:amnezia/ppa.
    local keyring="/usr/share/keyrings/amnezia.gpg"
    gpg --no-default-keyring --keyring "$keyring" \
        --keyserver keyserver.ubuntu.com --recv-keys 57290828 >/dev/null 2>&1 \
      || die "не удалось получить ключ репозитория AmneziaWG"
    # В PPA нет сборок под кодовые имена Debian, поэтому берём ветку focal —
    # так же, как рекомендует README amneziawg-linux-kernel-module.
    echo "deb [signed-by=$keyring] https://ppa.launchpadcontent.net/amnezia/ppa/ubuntu focal main" \
      > /etc/apt/sources.list.d/amnezia.list
    apt-get update -qq
  fi

  log "ставлю amneziawg (сборка модуля через DKMS, это занимает 1-3 минуты)"
  if ! apt-get install -y -qq amneziawg >/dev/null; then
    cat >&2 <<EOF

Не удалось установить amneziawg. Частые причины:
  * ядро VPS не поддерживает загрузку модулей (OpenVZ / LXC-контейнер);
  * не установлены заголовки ядра для linux-headers-$(uname -r).

Виртуализация на этой машине: $(systemd-detect-virt 2>/dev/null || echo "не определена")

Запустите скрипт заново с обычным WireGuard:  install-server.sh --mode wg
EOF
    exit 1
  fi
}

enable_forwarding() {
  log "включаю маршрутизацию пакетов"
  cat > /etc/sysctl.d/99-maxvpn.conf <<'EOF'
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
EOF
  sysctl -q --system
}

# Параметры обфускации AmneziaWG.
# Диапазоны и рекомендации — из README amneziawg-linux-kernel-module:
#   Jc 1-128 (рекомендовано 4-12), Jmin рекомендовано 8, Jmax рекомендовано 80,
#   S1 <= 1132, S2 <= 1188 (оба рекомендовано 15-150, при этом S1+56 != S2),
#   H1-H4 в диапазоне 5..2147483647 и обязательно различны между собой.
generate_awg_params() {
  local rnd
  rnd() { od -An -N4 -tu4 < /dev/urandom | tr -d ' '; }

  AWG_JC=$(( $(rnd) % 9 + 4 ))          # 4..12
  AWG_JMIN=8
  AWG_JMAX=80
  AWG_S1=$(( $(rnd) % 136 + 15 ))       # 15..150
  while :; do
    AWG_S2=$(( $(rnd) % 136 + 15 ))
    [[ $(( AWG_S1 + 56 )) -ne $AWG_S2 ]] && break
  done

  local h=()
  while [[ ${#h[@]} -lt 4 ]]; do
    local v=$(( $(rnd) % 2147483643 + 5 ))   # 5..2147483647
    local dup=0 existing
    for existing in ${h[@]+"${h[@]}"}; do
      [[ "$existing" == "$v" ]] && dup=1
    done
    [[ $dup -eq 0 ]] && h+=("$v")
  done
  AWG_H1="${h[0]}"; AWG_H2="${h[1]}"; AWG_H3="${h[2]}"; AWG_H4="${h[3]}"
}

# Записывает [Interface] сервера в $STATE_DIR/interface.base.
# CLI maxvpn пересобирает из него итоговый конфиг вместе со списком пиров.
write_interface_base() {
  local server_ip="$1"
  {
    echo "[Interface]"
    echo "Address = $server_ip/${SUBNET##*/}"
    echo "ListenPort = $PORT"
    echo "PrivateKey = $SERVER_PRIV"
    if [[ "$MODE" == "awg" ]]; then
      echo "Jc = $AWG_JC"
      echo "Jmin = $AWG_JMIN"
      echo "Jmax = $AWG_JMAX"
      echo "S1 = $AWG_S1"
      echo "S2 = $AWG_S2"
      echo "H1 = $AWG_H1"
      echo "H2 = $AWG_H2"
      echo "H3 = $AWG_H3"
      echo "H4 = $AWG_H4"
    fi
    echo "PostUp = iptables -t nat -A POSTROUTING -s $SUBNET -o $WAN_IF -j MASQUERADE; iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT"
    echo "PostDown = iptables -t nat -D POSTROUTING -s $SUBNET -o $WAN_IF -j MASQUERADE; iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT"
  } > "$STATE_DIR/interface.base"
  chmod 600 "$STATE_DIR/interface.base"
}

open_firewall() {
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "^Status: active"; then
    log "открываю $PORT/udp в ufw"
    ufw allow "$PORT"/udp >/dev/null || log "ВНИМАНИЕ: ufw allow $PORT/udp не выполнился"
  fi
}

install_cli() {
  local src
  src="$(dirname "$(readlink -f "$0")")/maxvpn"
  [[ -f "$src" ]] || die "рядом со скриптом не найден файл maxvpn"
  install -m 755 "$src" /usr/local/bin/maxvpn
  log "утилита управления установлена: /usr/local/bin/maxvpn"
}

enable_service() {
  # awg-quick@.service приходит вместе с amneziawg-tools, wg-quick@.service —
  # с wireguard-tools. Если юнита нет, systemd вернёт ошибку, и мы это покажем.
  systemctl enable "$QUICK@$IFACE" >/dev/null 2>&1 \
    || die "не найден systemd-юнит $QUICK@$IFACE — пакет установлен не полностью"
  systemctl restart "$QUICK@$IFACE" \
    || die "не удалось поднять интерфейс $IFACE, смотрите: journalctl -u $QUICK@$IFACE -n 50"
  log "интерфейс $IFACE поднят и добавлен в автозагрузку"
}

# --------------------------------------------------------------------- запуск

detect_os
detect_wan

mkdir -p "$STATE_DIR" "$CONF_DIR"
chmod 700 "$STATE_DIR" "$CONF_DIR"

# Ключи и порт переиспользуются при повторном запуске — иначе все уже розданные
# клиентские конфиги разом перестали бы работать.
if [[ -f "$STATE_DIR/params.env" ]]; then
  log "найдена прошлая установка, переиспользую ключи и параметры"
  # shellcheck disable=SC1091
  . "$STATE_DIR/params.env"
  PORT="${PORT:-$SAVED_PORT}"
  [[ -n "${PORT// }" ]] || PORT="$SAVED_PORT"
  SUBNET="$SAVED_SUBNET"
  MODE="$SAVED_MODE"
  SERVER_PRIV="$SAVED_SERVER_PRIV"
  SERVER_PUB="$SAVED_SERVER_PUB"
  [[ "$ENDPOINT" == "auto" && -n "${SAVED_ENDPOINT:-}" ]] && ENDPOINT="$SAVED_ENDPOINT"
  if [[ "$MODE" == "awg" ]]; then
    AWG_JC="$SAVED_JC"; AWG_JMIN="$SAVED_JMIN"; AWG_JMAX="$SAVED_JMAX"
    AWG_S1="$SAVED_S1"; AWG_S2="$SAVED_S2"
    AWG_H1="$SAVED_H1"; AWG_H2="$SAVED_H2"; AWG_H3="$SAVED_H3"; AWG_H4="$SAVED_H4"
  fi
  # Пути зависят от режима, а режим мог прийти из сохранённых параметров.
  if [[ "$MODE" == "awg" ]]; then
    IFACE="awg0"; CONF_DIR="/etc/amnezia/amneziawg"; QUICK="awg-quick"; WGBIN="awg"
  else
    IFACE="wg0"; CONF_DIR="/etc/wireguard"; QUICK="wg-quick"; WGBIN="wg"
  fi
  CONF_FILE="$CONF_DIR/$IFACE.conf"
  FRESH=0
else
  [[ -n "$PORT" ]] || PORT="$(random_port)"
  FRESH=1
fi

install_packages
enable_forwarding
detect_endpoint

if [[ $FRESH -eq 1 ]]; then
  log "генерирую ключи сервера"
  SERVER_PRIV="$("$WGBIN" genkey)"
  SERVER_PUB="$(printf '%s' "$SERVER_PRIV" | "$WGBIN" pubkey)"
  [[ "$MODE" == "awg" ]] && generate_awg_params
fi

SERVER_IP="$(python3 - "$SUBNET" <<'PY'
import ipaddress, sys
# Первый пригодный адрес сети — адрес самого сервера в туннеле.
print(str(next(ipaddress.ip_network(sys.argv[1], strict=False).hosts())))
PY
)"

cat > "$STATE_DIR/params.env" <<EOF
SAVED_MODE="$MODE"
SAVED_PORT="$PORT"
SAVED_SUBNET="$SUBNET"
SAVED_DNS="$DNS"
SAVED_ENDPOINT="$ENDPOINT"
SAVED_IFACE="$IFACE"
SAVED_CONF_FILE="$CONF_FILE"
SAVED_QUICK="$QUICK"
SAVED_WGBIN="$WGBIN"
SAVED_WAN_IF="$WAN_IF"
SAVED_SERVER_IP="$SERVER_IP"
SAVED_SERVER_PRIV="$SERVER_PRIV"
SAVED_SERVER_PUB="$SERVER_PUB"
EOF
if [[ "$MODE" == "awg" ]]; then
  cat >> "$STATE_DIR/params.env" <<EOF
SAVED_JC="$AWG_JC"
SAVED_JMIN="$AWG_JMIN"
SAVED_JMAX="$AWG_JMAX"
SAVED_S1="$AWG_S1"
SAVED_S2="$AWG_S2"
SAVED_H1="$AWG_H1"
SAVED_H2="$AWG_H2"
SAVED_H3="$AWG_H3"
SAVED_H4="$AWG_H4"
EOF
fi
chmod 600 "$STATE_DIR/params.env"

write_interface_base "$SERVER_IP"
[[ -f "$STATE_DIR/peers.tsv" ]] || : > "$STATE_DIR/peers.tsv"
chmod 600 "$STATE_DIR/peers.tsv"

install_cli
/usr/local/bin/maxvpn rebuild
open_firewall
enable_service

log "готово: $MODE, порт $PORT/udp, эндпоинт $ENDPOINT"

if [[ $EMIT_JSON -eq 1 ]]; then
  echo "---MAXVPN-JSON---"
  /usr/local/bin/maxvpn info
  echo "---MAXVPN-JSON-END---"
fi
