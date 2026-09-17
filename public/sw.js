// Service worker for Claude Resets browser alerts.
// It does not cache pages: every visit fetches fresh content so nothing stale is ever shown as current.

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  var payload = { title: 'Claude Resets', body: '', url: '/', tag: 'claude-reset' };
  try {
    if (event.data) {
      var parsed = event.data.json();
      payload.title = String(parsed.title || payload.title).slice(0, 120);
      payload.body = String(parsed.body || '').slice(0, 300);
      payload.url = typeof parsed.url === 'string' && parsed.url.indexOf('/') === 0 ? parsed.url : payload.url;
      payload.tag = String(parsed.tag || payload.tag).slice(0, 60);
    }
  } catch (e) {
    /* malformed payload: show the generic notification */
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { url: payload.url },
    }),
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';
  var target = new URL(url, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url === target && 'focus' in list[i]) return list[i].focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener('pushsubscriptionchange', function (event) {
  // The browser rotated the subscription. Re-subscribe with the same key and tell the server.
  var oldEndpoint = event.oldSubscription ? event.oldSubscription.endpoint : null;
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription ? event.oldSubscription.options : { userVisibleOnly: true })
      .then(function (sub) {
        return fetch('/api/v1/push/subscriptions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ subscription: sub.toJSON(), previousEndpoint: oldEndpoint }),
        });
      })
      .catch(function () {
        /* nothing else to do */
      }),
  );
});
