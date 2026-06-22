/**
 * Sun Rise Construction — Daily Agenda → Google Sheets logger
 * ------------------------------------------------------------
 * This Apps Script receives a webhook from the agenda Netlify function and
 * keeps one row per task in the sheet, stamped with when it was OPENED and
 * when it was CLOSED. Re-sending the same task id updates that task's row
 * (status, dates, rollover count, closed timestamp) instead of duplicating.
 *
 * SETUP
 * 1. Open the Google Sheet you want to log into.
 * 2. Extensions → Apps Script. Delete any boilerplate, paste this file.
 * 3. (Optional) set a shared secret below and as SHEETS_WEBHOOK_SECRET in Netlify.
 * 4. Deploy → New deployment → type "Web app".
 *      - Execute as: Me
 *      - Who has access: Anyone
 *    Copy the Web app URL.
 * 5. In Netlify → Site settings → Environment variables, add:
 *      SHEETS_WEBHOOK_URL    = <the Web app URL>
 *      SHEETS_WEBHOOK_SECRET = <same secret as below, if you set one>
 * 6. Redeploy the Netlify site. Done — tasks now log automatically.
 */

var SHARED_SECRET = '';            // leave '' to disable the check
var SHEET_NAME = 'Agenda Log';     // tab name; created automatically

var HEADERS = [
  'Task ID', 'Title', 'Notes', 'Status', 'Scheduled Date',
  'Opened At', 'Closed At', 'Rollovers', 'Type', 'Last Event', 'Last Update'
];

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (SHARED_SECRET && data.secret !== SHARED_SECRET) {
      return json_({ ok: false, error: 'unauthorized' });
    }

    var sheet = getSheet_();
    var rowIndex = findRow_(sheet, data.id);

    var row = [
      data.id || '',
      data.title || '',
      data.detail || '',
      (data.status || '').toUpperCase(),
      data.date || '',
      data.openedAt || '',
      data.closedAt || '',
      data.rollovers || 0,
      data.parentId ? 'Follow-up' : 'Task',
      data.event || '',
      data.loggedAt || new Date().toISOString()
    ];

    if (rowIndex > 0) {
      // Preserve the original "Opened At" if a later event omitted it.
      if (!data.openedAt) {
        row[5] = sheet.getRange(rowIndex, 6).getValue();
      }
      sheet.getRange(rowIndex, 1, 1, HEADERS.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }

    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findRow_(sheet, id) {
  if (!id) return -1;
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2;
  }
  return -1;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
