// Тонкая обёртка над ssh2: подключение к серверу, выполнение команд, заливка файлов.

const fs = require('fs');
const { Client } = require('ssh2');

class SshSession {
  /**
   * @param {object} opts
   * @param {string} opts.host
   * @param {number} [opts.port]
   * @param {string} opts.username
   * @param {string} [opts.password]
   * @param {string} [opts.privateKeyPath]
   * @param {string} [opts.passphrase]
   * @param {(line: string) => void} [opts.onLog]
   */
  constructor(opts) {
    this.opts = opts;
    this.log = opts.onLog || (() => {});
    this.conn = null;
  }

  connect() {
    const { host, port, username, password, privateKeyPath, passphrase } = this.opts;
    const config = {
      host,
      port: port || 22,
      username,
      readyTimeout: 30000,
      keepaliveInterval: 10000,
    };

    if (privateKeyPath) {
      config.privateKey = fs.readFileSync(privateKeyPath);
      if (passphrase) config.passphrase = passphrase;
    } else if (password) {
      config.password = password;
      // Некоторые серверы отдают пароль только через keyboard-interactive.
      config.tryKeyboard = true;
    } else {
      throw new Error('не задан ни пароль, ни путь к приватному ключу SSH');
    }

    return new Promise((resolve, reject) => {
      const conn = new Client();
      const onKeyboard = (name, instructions, lang, prompts, finish) => finish([password || '']);

      conn.on('ready', () => {
        this.conn = conn;
        this.log(`Подключение к ${username}@${host}:${config.port} установлено.`);
        resolve();
      });
      conn.on('error', (err) => reject(new Error(`SSH: ${err.message}`)));
      if (config.tryKeyboard) conn.on('keyboard-interactive', onKeyboard);
      conn.connect(config);
    });
  }

  /**
   * Выполняет команду. По умолчанию ненулевой код выхода — ошибка.
   * @returns {Promise<{code: number, stdout: string, stderr: string}>}
   */
  exec(command, { stream = false, allowFailure = false } = {}) {
    if (!this.conn) throw new Error('нет активного SSH-подключения');
    return new Promise((resolve, reject) => {
      this.conn.exec(command, (err, channel) => {
        if (err) return reject(new Error(`SSH exec: ${err.message}`));
        let stdout = '';
        let stderr = '';

        channel.on('data', (chunk) => {
          stdout += chunk;
          if (stream) chunk.toString().split('\n').filter(Boolean).forEach((l) => this.log(l));
        });
        channel.stderr.on('data', (chunk) => {
          stderr += chunk;
          if (stream) chunk.toString().split('\n').filter(Boolean).forEach((l) => this.log(l));
        });
        channel.on('close', (code) => {
          if (code !== 0 && !allowFailure) {
            const detail = (stderr || stdout).trim().split('\n').slice(-5).join('\n');
            return reject(new Error(`команда завершилась с кодом ${code}:\n${detail}`));
          }
          resolve({ code, stdout, stderr });
        });
      });
    });
  }

  /** Пишет содержимое в файл на сервере. */
  upload(content, remotePath, mode = 0o700) {
    if (!this.conn) throw new Error('нет активного SSH-подключения');
    return new Promise((resolve, reject) => {
      this.conn.sftp((err, sftp) => {
        if (err) return reject(new Error(`SFTP: ${err.message}`));
        const stream = sftp.createWriteStream(remotePath, { mode });
        stream.on('error', (e) => reject(new Error(`SFTP запись ${remotePath}: ${e.message}`)));
        stream.on('close', () => resolve());
        stream.end(content);
      });
    });
  }

  close() {
    if (this.conn) {
      this.conn.end();
      this.conn = null;
    }
  }
}

/** Экранирует строку для безопасной подстановки в команду оболочки. */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

module.exports = { SshSession, shellQuote };
