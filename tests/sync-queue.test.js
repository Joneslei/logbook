const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

function element() {
    return {
        style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        addEventListener() {},
        appendChild() {},
        querySelector() { return element(); },
        querySelectorAll() { return []; },
        setAttribute() {},
        getAttribute() { return ''; },
        focus() {},
        value: '',
        textContent: '',
        innerHTML: ''
    };
}

const store = new Map();
const context = {
    console,
    crypto: webcrypto,
    TextEncoder,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval() { return 1; },
    clearInterval() {},
    requestAnimationFrame(fn) { fn(); },
    localStorage: {
        getItem(key) { return store.has(key) ? store.get(key) : null; },
        setItem(key, value) { store.set(key, String(value)); }
    },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    document: {
        documentElement: element(),
        body: element(),
        addEventListener() {},
        getElementById() { return element(); },
        querySelector() { return element(); },
        querySelectorAll() { return []; },
        createElement() { return element(); },
        createDocumentFragment() { return element(); }
    },
    window: {
        addEventListener() {},
        matchMedia() { return { matches: false, addEventListener() {} }; },
        innerWidth: 1024,
        innerHeight: 768
    },
    navigator: {},
    APP_CONSTANTS: {
        PAGE_SIZE: 50,
        UNDO_MAX: 30,
        CLOUD_FAIL_MAX: 3,
        CLOUD_SYNC_INTERVAL: 15000,
        LOGIN_ATTEMPTS_MAX: 5,
        LOGIN_LOCKOUT_DURATION: 30000,
        TOAST_DURATION: 3000,
        TOAST_WARNING_DURATION: 5000
    },
    PASSWORD_HASH: '',
    SB_URL: 'https://example.invalid',
    SB_HEADERS: {},
    sbUrl(table, params) { return 'https://example.invalid/' + table + (params || ''); }
};
context.window.document = context.document;
context.window.localStorage = context.localStorage;
context.window.sessionStorage = context.sessionStorage;
context.globalThis = context;

vm.createContext(context);
vm.runInContext(fs.readFileSync('js/app.js', 'utf8'), context);

vm.runInContext(`
    loadPendingSync();
    const a = { id: 1, seq: 1, date: '2026-06-04', name: 'A', project: 'P', price: 0.1, qty: 3, total: money(0.1 * 3), paid: '', method: '', remark: '' };
    queueUpsert(a);
`, context);
assert.equal(JSON.parse(store.get('pendingSync')).upserts['1'].total, 0.3);

vm.runInContext('queueDelete(1)', context);
assert.equal(JSON.parse(store.get('pendingSync')).deletes['1'], true);
assert.equal(JSON.parse(store.get('pendingSync')).upserts['1'], undefined);

vm.runInContext('queueUpsert(a)', context);
assert.equal(JSON.parse(store.get('pendingSync')).deletes['1'], undefined);
assert.equal(JSON.parse(store.get('pendingSync')).upserts['1'].name, 'A');

vm.runInContext(`
    records = [
        { id: 1, seq: 1, date: '2026-06-04', name: 'cloud-old', project: 'P', price: 1, qty: 1, total: 1 },
        { id: 2, seq: 2, date: '2026-06-04', name: 'delete-me', project: 'P', price: 1, qty: 1, total: 1 }
    ];
    queueDelete(2);
    applyPendingSync();
`, context);
assert.equal(vm.runInContext('records.length', context), 1);
assert.equal(vm.runInContext('records[0].name', context), 'A');

const ids = new Set();
for (let i = 0; i < 500; i++) ids.add(vm.runInContext('genId()', context));
assert.equal(ids.size, 500);

console.log('sync queue tests passed');
