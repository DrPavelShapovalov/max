/**
 * Анализатор КДО — серверный код для Google Apps Script.
 *
 * Как подключить (один раз, на вашем аккаунте Google):
 *  1. Создайте Google-Таблицу «Архив КДО» на своём Google Диске.
 *  2. Меню: Расширения → Apps Script. Удалите пустой код, вставьте ВЕСЬ этот файл.
 *  3. Ниже в строке TOKEN впишите свой секрет (любой пароль) — тот же вставьте
 *     в приложении в поле «Ключ (TOKEN)».
 *  4. Развернуть → Новое развёртывание → тип «Веб-приложение».
 *       • «У кого есть доступ»: Все (Anyone)
 *       • «Запуск от имени»: Я (ваш аккаунт)
 *  5. Скопируйте выданный URL вида …/exec → вставьте в приложении в поле
 *     «Адрес веб-приложения (URL)».
 *  6. На каждом компьютере укажите этот URL + TOKEN, впишите имя кабинета и
 *     включите автосинхронизацию.
 */

const TOKEN = "ПОСТАВЬТЕ_СВОЙ_СЕКРЕТ";  // тот же, что в приложении

function doGet(e){ return handle(e); }
function doPost(e){ return handle(e); }

function handle(e){
  var p = e.parameter || {};
  var cb = p.callback || "";
  function out(o){
    var t = cb ? (cb + "(" + JSON.stringify(o) + ")") : JSON.stringify(o);
    return ContentService.createTextOutput(t).setMimeType(
      cb ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
  }
  if (p.token !== TOKEN) return out({ ok: false, error: "auth" });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("Архив") || ss.getSheets()[0];
  var HEAD = ["timestamp","datetime","user","device","fio","age","gender","defectType","indexType","indexValue","severity","recommendation","rightArea","leftArea","functionalScore","id"];
  if (sh.getLastRow() === 0) sh.appendRow(HEAD);

  if (p.action === "ping") return out({ ok: true });

  if (p.action === "add") {
    var r = JSON.parse(p.record);
    sh.appendRow(HEAD.map(function(k){ return r[k] !== undefined ? r[k] : ""; }));
    return out({ ok: true });
  }

  if (p.action === "list") {
    return out({ ok: true, rows: sh.getDataRange().getValues() });
  }

  return out({ ok: false, error: "unknown action" });
}
