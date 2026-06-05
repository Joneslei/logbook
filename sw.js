/**
 * Service Worker - 离线缓存支持
 * 缓存静态资源和CDN资源，实现离线访问
 */

// 使用日期作为版本号，更新代码时自动清除旧缓存
const CACHE_VERSION = '20260605-mobile-cards-inline';
const CACHE_NAME = 'accounting-app-v' + CACHE_VERSION;
const CDN_CACHE_NAME = 'accounting-cdn-v' + CACHE_VERSION;

// 本地静态资源（cache-first 策略）
const STATIC_ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/config.js',
    './js/app.js',
    './manifest.json',
    './LOGO.png',
    './LOGO_B.png',
    './favicon.png',
    './icon.png'
];

// CDN 资源（stale-while-revalidate 策略）
const CDN_ASSETS = [
    'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js'
];

// 安装事件 - 预缓存静态资源和CDN资源
self.addEventListener('install', function(event) {
    console.log('Service Worker 安装中...');
    event.waitUntil(
        Promise.all([
            caches.open(CACHE_NAME).then(function(cache) {
                console.log('缓存本地静态资源');
                return cache.addAll(STATIC_ASSETS);
            }),
            caches.open(CDN_CACHE_NAME).then(function(cache) {
                console.log('缓存CDN资源');
                return Promise.all(
                    CDN_ASSETS.map(function(url) {
                        return cache.add(url).catch(function(err) {
                            console.warn('CDN资源缓存失败:', url, err);
                        });
                    })
                );
            })
        ]).then(function() {
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
                    cacheNames.filter(function(cacheName) {
                        return cacheName !== CACHE_NAME && cacheName !== CDN_CACHE_NAME;
                    }).map(function(cacheName) {
                        console.log('删除旧缓存:', cacheName);
                        return caches.delete(cacheName);
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

    var requestUrl = event.request.url;

    // 页面导航优先请求网络，离线时再回退到缓存首页。
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(function(response) {
                    if (response && response.status === 200) {
                        var copy = response.clone();
                        caches.open(CACHE_NAME).then(function(cache) { cache.put('./index.html', copy); });
                    }
                    return response;
                })
                .catch(function() { return caches.match('./index.html'); })
        );
        return;
    }

    // CDN 资源：stale-while-revalidate（先返回缓存，后台更新）
    if (CDN_ASSETS.some(function(url) { return requestUrl.startsWith(url.split('?')[0]); })) {
        event.respondWith(
            caches.open(CDN_CACHE_NAME).then(function(cache) {
                return cache.match(event.request, { ignoreSearch: true }).then(function(cachedResponse) {
                    var fetchPromise = fetch(event.request).then(function(networkResponse) {
                        if (networkResponse && networkResponse.status === 200) {
                            cache.put(event.request, networkResponse.clone());
                        }
                        return networkResponse;
                    }).catch(function() {
                        return cachedResponse;
                    });
                    return cachedResponse || fetchPromise;
                });
            })
        );
        return;
    }

    // 非同源的非CDN请求，跳过
    if (!requestUrl.startsWith(self.location.origin)) {
        return;
    }

    // 代码资源优先请求网络，避免发布后旧 Service Worker 返回过期脚本。
    if (/\.(js|css)(\?|$)/.test(requestUrl)) {
        event.respondWith(
            fetch(event.request)
                .then(function(response) {
                    if (response && response.status === 200) {
                        var copy = response.clone();
                        caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, copy); });
                    }
                    return response;
                })
                .catch(function() { return caches.match(event.request, { ignoreSearch: true }); })
        );
        return;
    }

    // 本地资源：cache-first 策略
    event.respondWith(
        caches.match(event.request, { ignoreSearch: true })
            .then(function(response) {
                // 缓存命中，直接返回
                if (response) {
                    return response;
                }

                // 缓存未命中，发起网络请求
                return fetch(event.request)
                    .then(function(response) {
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        // 克隆并缓存响应
                        var responseToCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then(function(cache) {
                                cache.put(event.request, responseToCache);
                            });

                        return response;
                    })
                    .catch(function() { return caches.match(event.request, { ignoreSearch: true }); });
            })
    );
});
