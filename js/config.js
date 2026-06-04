/**
 * 应用配置文件
 * 包含 Supabase 公共连接配置
 */

// Supabase 配置
const SB_URL = 'https://jupbscoeollfrymgfvom.supabase.co';
const SB_KEY = 'sb_publishable_VGkN1fbsKa_EuWjUIvYPIg_xq11vhMM';
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
