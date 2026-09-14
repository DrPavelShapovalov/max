// Локальное хранилище профиля подключения.
//
// Пароль SSH здесь НЕ сохраняется: он живёт только в памяти во время одной
// операции. Приватный ключ устройства хранится с правами 600 — он нужен для
// сборки конфига и никогда не покидает эту машину.

const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'profile.json');
    fs.mkdirSync(dir, { recursive: true });
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  write(patch) {
    const next = { ...this.read(), ...patch };
    delete next.password;
    delete next.passphrase;
    fs.writeFileSync(this.file, JSON.stringify(next, null, 2), { mode: 0o600 });
    return next;
  }

  get confPath() {
    return path.join(this.dir, 'maxvpn.conf');
  }

  saveConf(text) {
    fs.writeFileSync(this.confPath, text, { mode: 0o600 });
    return this.confPath;
  }

  readConf() {
    return fs.existsSync(this.confPath) ? fs.readFileSync(this.confPath, 'utf8') : null;
  }
}

module.exports = { Store };
