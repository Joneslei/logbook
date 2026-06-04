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
const authCalls = { reset: [], update: [] };
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
        setItem(key, value) { store.set(key, String(value)); },
        removeItem(key) { store.delete(key); }
    },
    sessionStorage: {
        getItem() { return null; },
        setItem() {},
        removeItem() {}
    },
    authSession: null,
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
        innerHeight: 768,
        location: {
            origin: 'https://example.com',
            pathname: '/logbook/',
            hash: ''
        },
        history: { replaceState() {} }
    },
    location: { reload() {} },
    URLSearchParams,
    navigator: {},
    supabase: {
        createClient(url, key, options) {
            context.clientOptions = options;
            return {
                auth: {
                    async getSession() { return { data: { session: context.authSession } }; },
                    async signInWithPassword() { return { data: {}, error: null }; },
                    async resetPasswordForEmail(email, options) {
                        authCalls.reset.push({ email, options });
                        return { data: {}, error: null };
                    },
                    async updateUser(values) {
                        authCalls.update.push(values);
                        return { data: {}, error: null };
                    },
                    async signOut() {},
                    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
                },
                channel() { return { on() { return this; }, subscribe() { return this; } }; }
            };
        }
    },
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
    SB_URL: 'https://example.invalid',
    SB_KEY: 'test-public-key',
    sbUrl(table, params) { return 'https://example.invalid/' + table + (params || ''); }
};
context.window.document = context.document;
context.window.localStorage = context.localStorage;
context.window.sessionStorage = context.sessionStorage;
context.document.title = 'Test';
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

(async function() {
    assert.equal(context.clientOptions.auth.storage, context.sessionStorage);
    assert.equal(context.clientOptions.auth.persistSession, true);

    context.authSession = { access_token: 'test-token' };
    const headers = await vm.runInContext('getAuthHeaders()', context);
    assert.equal(headers.Authorization, 'Bearer test-token');

    context.authSession = null;
    await assert.rejects(vm.runInContext('getAuthHeaders()', context), /登录已过期/);

    await vm.runInContext(`document.getElementById = function(id) {
        if (!this._els) this._els = {};
        if (!this._els[id]) this._els[id] = (${element.toString()})();
        return this._els[id];
    }; document.getElementById('loginEmail').value = 'admin@example.com'; requestPasswordReset();`, context);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(authCalls.reset[0].email, 'admin@example.com');
    assert.equal(authCalls.reset[0].options.redirectTo, 'https://example.com/logbook/');

    vm.runInContext(`document.getElementById('newPassword').value = '12345678'; document.getElementById('confirmPassword').value = '12345678'; updatePassword();`, context);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(authCalls.update[0].password, '12345678');

    console.log('sync queue, auth, and password reset tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
