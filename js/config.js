/**
 * 应用配置文件
 * 包含 Supabase 配置、密码哈希等敏感信息
 */

// Supabase 配置
const SB_URL = 'https://jupbscoeollfrymgfvom.supabase.co';
const SB_KEY = 'sb_publishable_VGkN1fbsKa_EuWjUIvYPIg_xq11vhMM';
const SB_HEADERS = {
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json'
};

// 密码哈希 (SHA-256)
const PASSWORD_HASH = '295cedebf5379b6bc3ed38ad3668cd19d3eddaf3bb6f393c0ca658dd54080da4';

// 应用常量
const APP_CONSTANTS = {
    PAGE_SIZE: 50,
    UNDO_MAX: 30,
    CLOUD_FAIL_MAX: 3,
    CLOUD_SYNC_INTERVAL: 15000, // 最少间隔15秒
    LOGIN_ATTEMPTS_MAX: 5,
    LOGIN_LOCKOUT_DURATION: 30000, // 30秒
    TOAST_DURATION: 3000,
    TOAST_WARNING_DURATION: 5000
};

// Supabase URL 构建函数
function sbUrl(table, params) {
    return SB_URL + '/rest/v1/' + table + (params || '');
}
