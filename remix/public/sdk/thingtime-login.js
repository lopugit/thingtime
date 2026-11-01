/*!
 * Thingtime Login SDK — "Login with Thingtime" for any website.
 *
 * <script src="https://thingtime.com/sdk/thingtime-login.js"></script>
 * <script>
 *   Thingtime.renderButton(document.querySelector('#login'), {
 *     clientId: 'ttapp_…',
 *     scopes: ['profile', 'email', 'app-data'], // what to ask for (user picks on consent)
 *     theme: 'light',                            // 'light' | 'dark' | 'rainbow'
 *     size: 'md',                                // 'sm' | 'md' | 'lg'
 *     onLogin: function (session) {
 *       // session.token  — app-scoped Bearer token (revocable server-side)
 *       // session.scopes — what the user actually granted
 *       // session.user   — { id, username, displayName, avatarUrl }
 *       Thingtime.userinfo(session.token).then(function (info) { … });
 *       Thingtime.data(session.token).set('preferences', { theme: 'rainbow' });
 *     }
 *   });
 * </script>
 *
 * Or drive it yourself: Thingtime.login({ clientId, scopes }).then(session => …)
 *
 * Register your app (name + your site's exact origins) on Thingtime first —
 * the popup only hands tokens to allowlisted origins. Full docs + examples:
 * https://thingtime.com/docs/embed
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
   * @param {{
   *   clientId: string,
   *   scopes?: string[],         // REQUIRED permission paths (the user can't untick these — only cancel)
   *   optionalScopes?: string[], // nice-to-have paths the user can untick
   *   allowExtra?: boolean,      // default true: the user may volunteer MORE data than you asked for
   *   sandbox?: boolean,         // build mode: full consent UI for ANY clientId; the returned
   *                              // token really works (app-data + userinfo, 1h, pretend account,
   *                              // auto-deleted data) — or mint one headlessly via
   *                              // POST /api/v1/oauth/sandbox
   *   sandboxSpace?: string,     // opt-in pool secret (8-64 chars, use a uuid): sandbox logins
   *                              // sharing a space see each other's 'app'-visibility entries —
   *                              // rehearse the multi-user shared feed pre-registration
   *   sandboxUsername?: string,  // pretend-author name in pooled feeds ('sandbox-' prefixed)
   *   baseUrl?: string
   * }} options
   *   Scope paths are hierarchical — 'profile' covers every profile.* leaf;
   *   ask for exactly what you need ('profile.avatar', 'email', 'app-data',
   *   'things' — the user hand-picks which things). Privacy-expanding leaves
   *   marked exact in the catalog ('profile.birthday', 'app-data.shared') are
   *   NEVER covered by an ancestor — request them explicitly. Catalog:
   *   GET /api/v1/oauth/scopes (CORS-open — feature-detect a scope there
   *   before requesting it; unknown scopes 400 the popup). Always read
   *   `session.scopes` for what the user ACTUALLY granted — well-built
   *   platforms light features up dynamically from it.
   * @returns {Promise<{ token: string, tokenType: string, expiresAt: string,
   *   scopes: string[], sharedThings: number, sandbox?: boolean, user: Object }>}
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
      var scope = Array.isArray(options.scopes) ? options.scopes.join(' ') : '';
      var optionalScope = Array.isArray(options.optionalScopes) ? options.optionalScopes.join(' ') : '';
      var url =
        base +
        '/authorize?client_id=' +
        encodeURIComponent(clientId) +
        '&origin=' +
        encodeURIComponent(window.location.origin) +
        '&state=' +
        encodeURIComponent(state) +
        (scope ? '&scope=' + encodeURIComponent(scope) : '') +
        (optionalScope ? '&optional_scope=' + encodeURIComponent(optionalScope) : '') +
        (options.allowExtra === false ? '&extra=0' : '') +
        (options.sandbox ? '&sandbox=1' : '') +
        (options.sandbox && options.sandboxSpace
          ? '&sandbox_space=' + encodeURIComponent(options.sandboxSpace)
          : '') +
        (options.sandbox && options.sandboxUsername
          ? '&sandbox_username=' + encodeURIComponent(options.sandboxUsername)
          : '');

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
        // Only trust the Thingtime origin, only our own popup window, and
        // only our own login attempt (state echo).
        if (event.origin !== base) return;
        if (event.source !== popup) return;
        var data = event.data;
        if (!data || data.type !== 'thingtime:login' || data.state !== state) return;

        if (data.ok) {
          finish(null, {
            token: data.token,
            tokenType: data.tokenType || 'Bearer',
            expiresAt: data.expiresAt,
            // Trust only what the server says was granted — never fabricate a
            // default scope list the user may not have consented to.
            scopes: Array.isArray(data.scopes) ? data.scopes : [],
            sharedThings: data.sharedThings || 0,
            sandbox: data.sandbox === true,
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
      /**
       * Insert-or-update one key (value = any JSON up to 32KB).
       * opts.visibility: 'private' (default) or 'app' — 'app' lets other
       * users of YOUR app read the entry via shared() (never other apps,
       * never the public web). Needs the 'app-data.shared' scope on the
       * grant. Omit opts to leave an existing entry's audience unchanged.
       */
      set: function (key, value, opts) {
        opts = opts || {};
        var body = { key: key, value: value };
        if (opts.visibility !== undefined) body.visibility = opts.visibility;
        if (opts.acl !== undefined) body.acl = opts.acl;
        return call('/api/v1/app-data', {
          method: 'POST',
          body: JSON.stringify(body)
        }).then(function (payload) {
          return payload.entry;
        });
      },
      /**
       * The app-wide shared pool ('app-data.shared' scope): entries every
       * user of this app opted into sharing, newest first, with a cursor.
       * params: { key? ('post:*' matches a prefix), prefix?, limit?, cursor? }
       * Resolves { entries: [{ key, value, updatedAt, createdAt, author }],
       * nextCursor } — author is { id, username, displayName?, avatarUrl? },
       * honouring what THAT author granted.
       */
      shared: function (params) {
        params = params || {};
        var query = [];
        if (params.key) query.push('key=' + encodeURIComponent(params.key));
        if (params.prefix) query.push('prefix=' + encodeURIComponent(params.prefix));
        if (params.limit) query.push('limit=' + encodeURIComponent(params.limit));
        if (params.cursor) query.push('cursor=' + encodeURIComponent(params.cursor));
        return call('/api/v1/app-data/shared' + (query.length ? '?' + query.join('&') : '')).then(
          function (payload) {
            return { entries: payload.entries || [], nextCursor: payload.nextCursor || null };
          }
        );
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
   * SSO identity lookup: resolve the user this token was granted for.
   * Returns { user: { id, username, displayName, avatarUrl, profileUrl,
   * birthday?, email? }, scopes } — email only under the 'email' scope,
   * birthday (YYYY-MM-DD) only under the exact 'profile.birthday' scope.
   * @param {string} token — the token from login()
   * @param {{ baseUrl?: string }} [options]
   */
  function userinfo(token, options) {
    options = options || {};
    var base = (options.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
    return fetch(base + '/api/v1/oauth/userinfo', {
      headers: { Authorization: 'Bearer ' + token }
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!payload || payload.ok !== true) {
          var error = new Error((payload && payload.error) || 'Thingtime request failed');
          error.status = response.status;
          throw error;
        }
        return { user: payload.user, scopes: payload.scopes };
      });
    });
  }

  var BUTTON_SIZES = {
    sm: 'padding:7px 13px;font-size:13px;border-radius:8px;',
    md: 'padding:10px 18px;font-size:14px;border-radius:10px;',
    lg: 'padding:13px 24px;font-size:16px;border-radius:12px;'
  };

  // theme → [text color, inner background]. Every theme keeps the Thingtime
  // rainbow border so the button stays recognizable across host sites.
  var BUTTON_THEMES = {
    light: { color: '#1c1c22', background: '#ffffff' },
    dark: { color: '#f4f4f6', background: '#1c1c22' },
    rainbow: { color: '#1c1c22', background: '#ffffff', rainbowFill: true }
  };

  var RAINBOW_GRADIENT = 'linear-gradient(90deg,#ff5f6d,#ffc371,#47e891,#3ec6ff,#b06ab3,#ff5f6d)';

  /**
   * Render a ready-made "Login with Thingtime" button into `el`.
   * @param {Element} el
   * @param {{
   *   clientId: string,
   *   scopes?: string[],            // required permissions (see login())
   *   optionalScopes?: string[],    // nice-to-have permissions
   *   allowExtra?: boolean,         // let the user volunteer more (default true)
   *   sandbox?: boolean,            // build mode — working pretend token, nothing real shared
   *   theme?: 'light'|'dark'|'rainbow',
   *   size?: 'sm'|'md'|'lg',
   *   text?: string,
   *   onLogin?: Function,
   *   onError?: Function,
   *   baseUrl?: string
   * }} options
   */
  function renderButton(el, options) {
    options = options || {};
    if (!el || !el.appendChild) throw new Error('Thingtime.renderButton: pass a DOM element');

    var theme = BUTTON_THEMES[options.theme] || BUTTON_THEMES.light;
    var size = BUTTON_SIZES[options.size] || BUTTON_SIZES.md;

    var button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-thingtime-login', '');
    button.textContent = options.text || 'Login with Thingtime';

    var innerFill = theme.rainbowFill
      ? 'linear-gradient(rgba(255,255,255,0.88),rgba(255,255,255,0.88)),' + RAINBOW_GRADIENT
      : 'linear-gradient(' + theme.background + ',' + theme.background + ')';

    var baseStyle =
      'display:inline-flex;align-items:center;gap:8px;' +
      size +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-weight:600;line-height:1.2;' +
      'color:' + theme.color + ';border:1px solid transparent;cursor:pointer;' +
      'background-image:' + innerFill + ',' + RAINBOW_GRADIENT + ';' +
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
      login({
        clientId: options.clientId,
        scopes: options.scopes,
        optionalScopes: options.optionalScopes,
        allowExtra: options.allowExtra,
        sandbox: options.sandbox,
        baseUrl: options.baseUrl
      })
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

  /**
   * The things the user hand-picked to share with your app ('things' scope):
   * read-only [{ shareId, thingtime, crystal, tags, createdAt, updatedAt }].
   * @param {string} token — the token from login()
   * @param {{ baseUrl?: string }} [options]
   */
  function shared(token, options) {
    options = options || {};
    var base = (options.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
    return fetch(base + '/api/v1/oauth/shared', {
      headers: { Authorization: 'Bearer ' + token }
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!payload || payload.ok !== true) {
          var error = new Error((payload && payload.error) || 'Thingtime request failed');
          error.status = response.status;
          throw error;
        }
        return payload.things || [];
      });
    });
  }

  window.Thingtime = window.Thingtime || {};
  window.Thingtime.login = login;
  window.Thingtime.data = data;
  window.Thingtime.userinfo = userinfo;
  window.Thingtime.shared = shared;
  window.Thingtime.renderButton = renderButton;
  window.Thingtime.sdkVersion = '1.3.0';
})();
