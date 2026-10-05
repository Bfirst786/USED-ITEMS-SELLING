// A small in-memory stand-in for the Google Apps Script services the sync script
// uses (SpreadsheetApp, DriveApp, Utilities, ...), so the exact script the app hands
// to users can be run and tested locally.

let nextId = 1;
const newId = () => 'f' + nextId++;

function iterator(list) {
  let i = 0;
  return { hasNext: () => i < list.length, next: () => list[i++] };
}

class FakeFile {
  constructor(folder, name, bytes, mime) {
    this.id = newId();
    this.folder = folder;
    this.name = name;
    this.bytes = Buffer.from(bytes);
    this.mime = mime;
    this.created = new Date(Date.now() + nextId); // strictly increasing
  }
  getName() { return this.name; }
  getId() { return this.id; }
  getDateCreated() { return this.created; }
  getSize() { return this.bytes.length; }
  getBlob() {
    return { getDataAsString: () => this.bytes.toString('utf8'), getBytes: () => this.bytes };
  }
  setTrashed(v) {
    if (v) this.folder.files = this.folder.files.filter((f) => f !== this);
    this.trashed = v;
  }
}

class FakeFolder {
  constructor(name) {
    this.name = name;
    this.files = [];
    this.folders = [];
  }
  getFoldersByName(n) { return iterator(this.folders.filter((f) => f.name === n)); }
  createFolder(n) { const f = new FakeFolder(n); this.folders.push(f); return f; }
  getFiles() { return iterator([...this.files]); }
  getFilesByName(n) { return iterator(this.files.filter((f) => f.name === n)); }
  createFile(a, content, mime) {
    const f = typeof a === 'string' ? new FakeFile(this, a, Buffer.from(content, 'utf8'), mime) : new FakeFile(this, a.name, a.bytes, a.mime);
    this.files.push(f);
    return f;
  }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.values = [];
    this.notes = null;
    this.frozen = 0;
    this.maxCols = 26;
    this.widths = {};
    this.headerStyle = {};
  }
  clearContents() { this.values = []; }
  getMaxColumns() { return this.maxCols; }
  deleteColumns(start, n) { this.maxCols -= n; }
  setFrozenRows(n) { this.frozen = n; }
  getLastRow() { return this.values.length; }
  getLastColumn() { return this.values.length ? this.values[0].length : 0; }
  autoResizeColumns() {}
  getColumnWidth(c) { return this.widths[c] || 100; }
  setColumnWidth(c, w) { this.widths[c] = w; }
  getRange(r, c, nr, nc) {
    const sheet = this;
    const range = {
      setValues(v) {
        if (v.length !== nr || v.some((row) => row.length !== nc)) throw new Error('The number of rows or columns in the data does not match the range');
        sheet.values = v.map((row) => [...row]);
        return range;
      },
      setNotes(n) { sheet.notes = n; return range; },
      setFontWeight(x) { if (r === 1) sheet.headerStyle.bold = x; return range; },
      setBackground(x) { if (r === 1) sheet.headerStyle.background = x; return range; },
      setFontColor() { return range; },
      setWrap() { return range; },
      setVerticalAlignment() { return range; },
      setWrapStrategy() { return range; },
    };
    return range;
  }
}

export function createFakeGoogle({ sheetName = 'Resell listings' } = {}) {
  const root = new FakeFolder('My Drive');
  const parent = root.createFolder('FOR SALE APP');
  const sheets = [new FakeSheet('Sheet1')];
  const ss = {
    getId: () => 'sheet-file-id',
    getName: () => sheetName,
    getUrl: () => 'https://docs.google.com/spreadsheets/d/sheet-file-id/edit',
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n, idx) => { const s = new FakeSheet(n); sheets.splice(idx ?? sheets.length, 0, s); return s; },
    getSheets: () => [...sheets],
    deleteSheet: (s) => sheets.splice(sheets.indexOf(s), 1),
  };
  const env = {
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, WrapStrategy: { CLIP: 'CLIP' } },
    DriveApp: {
      getFileById: (id) => ({ getParents: () => iterator(id === 'sheet-file-id' ? [parent] : []) }),
      getRootFolder: () => root,
    },
    Utilities: {
      base64Decode: (s) => Buffer.from(s, 'base64'),
      base64Encode: (b) => Buffer.from(b).toString('base64'),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
      formatDate: (d) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14),
    },
    Session: { getScriptTimeZone: () => 'America/Chicago' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => t }) },
  };
  return { env, ss, sheets, root, parent };
}

// Load the script source against the fake services; returns { doPost(body) → object, doGet() → object }.
export function loadScript(source, fake) {
  const fn = new Function(...Object.keys(fake.env), source + '\nreturn { doPost, doGet };');
  const s = fn(...Object.values(fake.env));
  return {
    doPost: (body) => JSON.parse(s.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } })),
    doGet: () => JSON.parse(s.doGet()),
  };
}
