/**
 * Service Worker - 离线缓存支持
 * 缓存静态资源，实现离线访问
 */

const CACHE_NAME = 'accounting-app-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/config.js',
    '/js/data.js',
    '/js/app.js',
    '/manifest.json',
    '/LOGO.png',
    '/favicon.png',
    '/icon.png'
];

// 安装事件 - 缓存静态资源
self.addEventListener('install', function(event) {
    console.log('Service Worker 安装中...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function(cache) {
                console.log('缓存静态资源');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(function() {
                return self.skipWaiting();
            })
    );
});

// 激活事件 - 清理旧缓存
self.addEventListener('activate', function(event) {
    console.log('Service Worker 激活中...');
    event.waitUntil(
        caches.keys()
            .then(function(cacheNames) {
                return Promise.all(
                    cacheNames.map(function(cacheName) {
                        if (cacheName !== CACHE_NAME) {
                            console.log('删除旧缓存:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(function() {
                return self.clients.claim();
            })
    );
});

// 请求拦截 - 缓存策略
self.addEventListener('fetch', function(event) {
    // 只处理 GET 请求
    if (event.request.method !== 'GET') {
        return;
    }

    // 跳过非同源请求（如 CDN）
    if (!event.request.url.startsWith(self.location.origin)) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(function(response) {
                // 如果缓存中有，直接返回
                if (response) {
                    return response;
                }

                // 否则发起网络请求
                return fetch(event.request)
                    .then(function(response) {
                        // 如果响应不正常，直接返回
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        // 克隆响应（因为响应只能使用一次）
                        var responseToCache = response.clone();

                        // 缓存响应
                        caches.open(CACHE_NAME)
                            .then(function(cache) {
                                cache.put(event.request, responseToCache);
                            });

                        return response;
                    })
                    .catch(function() {
                        // 网络失败时，如果是页面请求，返回缓存的首页
                        if (event.request.mode === 'navigate') {
                            return caches.match('/index.html');
                        }
                    });
            })
    );
});

// 后台同步
self.addEventListener('sync', function(event) {
    if (event.tag === 'sync-data') {
        console.log('后台同步数据...');
        // 这里可以触发数据同步逻辑
    }
});

// 推送通知
self.addEventListener('push', function(event) {
    if (event.data) {
        var data = event.data.json();
        var options = {
            body: data.body,
            icon: '/favicon.png',
            badge: '/icon.png',
            vibrate: [100, 50, 100],
            data: {
                dateOfArrival: Date.now(),
                primaryKey: 1
            }
        };
        event.waitUntil(
            self.registration.showNotification(data.title, options)
        );
    }
});

// 通知点击
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow('/')
    );
});
