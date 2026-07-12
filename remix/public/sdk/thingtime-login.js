/*!
 * Thingtime Login SDK — "Login with Thingtime" for any website.
 *
 * <script src="https://thingtime.com/sdk/thingtime-login.js"></script>
 * <script>
 *   Thingtime.renderButton(document.querySelector('#login'), {
 *     clientId: 'ttapp_…',
 *     onLogin: function (session) {
 *       // session.token  — app-scoped Bearer token (revocable server-side)
 *       // session.user   — { id, username, displayName, avatarUrl }
 *       var data = Thingtime.data(session.token);
 *       data.set('preferences', { theme: 'rainbow' });
 *     }
 *   });
 * </script>
 *
 * Or drive it yourself: Thingtime.login({ clientId }).then(session => …)
 *
 * Register your app (name + your site's exact origins) on Thingtime first —
 * the popup only hands tokens to allowlisted origins.
 */
(function () {
  'use strict';

  // The Thingtime origin is derived from wherever this script was loaded from,
  // so the same file works in dev and prod without configuration.
  var script = document.currentScript;
  var DEFAULT_BASE = 'https://thingtime.com';
  try {
    if (script && script.src) DEFAULT_BASE = new URL(script.src).origin;
  } catch (err) {
    /* keep the default */
  }

  var POPUP_WIDTH = 480;
  var POPUP_HEIGHT = 680;
  var LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

  function randomState() {
    if (window.crypto && window.crypto.getRandomValues) {
      var bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      return Array.prototype.map
        .call(bytes, function (b) {
          return ('0' + b.toString(16)).slice(-2);
        })
        .join('');
    }
    return String(Math.random()).slice(2) + String(Date.now());
  }

  /**
   * Open the "Login with Thingtime" popup.
   * @param {{ clientId: string, baseUrl?: string }} options
   * @returns {Promise<{ token: string, tokenType: string, expiresAt: string, user: Object }>}
   */
  function login(options) {
    options = options || {};
    var clientId = options.clientId;
    var base = (options.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');

    return new Promise(function (resolve, reject) {
      if (!clientId) {
        reject(new Error('Thingtime.login: options.clientId is required'));
        return;
      }

      var state = randomState();
      var url =
        base +
        '/authorize?client_id=' +
        encodeURIComponent(clientId) +
        '&origin=' +
        encodeURIComponent(window.location.origin) +
        '&state=' +
        encodeURIComponent(state);

      var left = Math.max(0, Math.round((window.screen.width - POPUP_WIDTH) / 2));
      var top = Math.max(0, Math.round((window.screen.height - POPUP_HEIGHT) / 2));
      var popup = window.open(
        url,
        'thingtime-login',
        'popup=yes,width=' + POPUP_WIDTH + ',height=' + POPUP_HEIGHT + ',left=' + left + ',top=' + top
      );

      if (!popup) {
        reject(new Error('Thingtime.login: popup was blocked — call login() from a user gesture (e.g. a click)'));
        return;
      }

      var settled = false;
      var closePoll = null;
      var timeout = null;

      function finish(error, session) {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        if (closePoll) clearInterval(closePoll);
        if (timeout) clearTimeout(timeout);
        if (error) reject(error);
        else resolve(session);
      }

      function onMessage(event) {
        // Only trust the Thingtime origin, and only our own login attempt.
        if (event.origin !== base) return;
        var data = event.data;
        if (!data || data.type !== 'thingtime:login' || data.state !== state) return;

        if (data.ok) {
          finish(null, {
            token: data.token,
            tokenType: data.tokenType || 'Bearer',
            expiresAt: data.expiresAt,
            user: data.user
          });
        } else {
          finish(new Error(data.error === 'cancelled' ? 'cancelled' : data.error || 'Login failed'));
        }
        try {
          popup.close();
        } catch (err) {
          /* already closed */
        }
      }

      window.addEventListener('message', onMessage);

      closePoll = setInterval(function () {
        if (popup.closed) {
          // Give a just-sent postMessage a beat to arrive before rejecting.
          setTimeout(function () {
            finish(new Error('cancelled'));
          }, 200);
        }
      }, 400);

      timeout = setTimeout(function () {
        try {
          popup.close();
        } catch (err) {
          /* ignore */
        }
        finish(new Error('Login timed out'));
      }, LOGIN_TIMEOUT_MS);
    });
  }

  /**
   * Key/value storage in the user's Thingtime account, scoped to your app.
   * @param {string} token — the token from login()
   * @param {{ baseUrl?: string }} [options]
   */
  function data(token, options) {
    options = options || {};
    var base = (options.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');

    function call(path, init) {
      init = init || {};
      init.headers = init.headers || {};
      init.headers.Authorization = 'Bearer ' + token;
      if (init.body) init.headers['Content-Type'] = 'application/json';
      return fetch(base + path, init).then(function (response) {
        return response.json().then(function (payload) {
          if (!payload || payload.ok !== true) {
            var error = new Error((payload && payload.error) || 'Thingtime request failed');
            error.status = response.status;
            throw error;
          }
          return payload;
        });
      });
    }

    return {
      /** Resolve one value (null when unset). */
      get: function (key) {
        return call('/api/v1/app-data?key=' + encodeURIComponent(key)).then(function (payload) {
          return payload.entry ? payload.entry.value : null;
        });
      },
      /** List every { key, value, updatedAt } your app stored for this user. */
      list: function () {
        return call('/api/v1/app-data').then(function (payload) {
          return payload.entries || [];
        });
      },
      /** Insert-or-update one key (value = any JSON up to 32KB). */
      set: function (key, value) {
        return call('/api/v1/app-data', {
          method: 'POST',
          body: JSON.stringify({ key: key, value: value })
        }).then(function (payload) {
          return payload.entry;
        });
      },
      /** Remove one key. Resolves true when it existed. */
      remove: function (key) {
        return call('/api/v1/app-data/delete', {
          method: 'POST',
          body: JSON.stringify({ key: key })
        }).then(function (payload) {
          return payload.deleted === true;
        });
      }
    };
  }

  /**
   * Render a ready-made "Login with Thingtime" button into `el`.
   * @param {Element} el
   * @param {{ clientId: string, onLogin?: Function, onError?: Function, text?: string, baseUrl?: string }} options
   */
  function renderButton(el, options) {
    options = options || {};
    if (!el || !el.appendChild) throw new Error('Thingtime.renderButton: pass a DOM element');

    var button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-thingtime-login', '');
    button.textContent = options.text || 'Login with Thingtime';

    var baseStyle =
      'display:inline-flex;align-items:center;gap:8px;padding:10px 18px;' +
      'font:600 14px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
      'color:#1c1c22;background:#ffffff;border:1px solid transparent;border-radius:10px;cursor:pointer;' +
      'background-image:linear-gradient(#ffffff,#ffffff),linear-gradient(90deg,#ff5f6d,#ffc371,#47e891,#3ec6ff,#b06ab3,#ff5f6d);' +
      'background-origin:border-box;background-clip:padding-box,border-box;' +
      'box-shadow:0 1px 4px rgba(20,20,40,0.12);transition:box-shadow 150ms ease,transform 150ms ease;';
    button.setAttribute('style', baseStyle);

    button.addEventListener('mouseenter', function () {
      button.style.boxShadow = '0 3px 10px rgba(20,20,40,0.18)';
      button.style.transform = 'translateY(-1px)';
    });
    button.addEventListener('mouseleave', function () {
      button.style.boxShadow = '0 1px 4px rgba(20,20,40,0.12)';
      button.style.transform = 'none';
    });

    button.addEventListener('click', function () {
      button.disabled = true;
      login({ clientId: options.clientId, baseUrl: options.baseUrl })
        .then(function (session) {
          button.disabled = false;
          if (options.onLogin) options.onLogin(session);
        })
        .catch(function (error) {
          button.disabled = false;
          if (options.onError) options.onError(error);
        });
    });

    el.appendChild(button);
    return button;
  }

  window.Thingtime = window.Thingtime || {};
  window.Thingtime.login = login;
  window.Thingtime.data = data;
  window.Thingtime.renderButton = renderButton;
  window.Thingtime.sdkVersion = '1.0.0';
})();
