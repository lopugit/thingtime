/* Thingtime DS custom-element wrappers.
   Mounts window.Thingtime components (built against ds/react.js UMD)
   inside their own React 18 roots, wrapped in ChakraProvider, so they
   stay isolated from any host React runtime.
   Usage: <tt-logo theme="nature" voxel-size="14"></tt-logo>
          <tt-logo icon theme="pink" voxel-size="24"></tt-logo>
          <tt-attention w="180px"></tt-attention>
          <tt-skeleton width="160px" height="14px" radius="0"></tt-skeleton> */
(function () {
  function ready() {
    return window.React && window.ReactDOM && window.Thingtime && window.Thingtime.ChakraProvider;
  }
  function whenReady(cb) {
    if (ready()) return cb();
    var iv = setInterval(function () {
      if (ready()) { clearInterval(iv); cb(); }
    }, 30);
  }

  function defineEl(tag, name, attrs, mapProps) {
    if (customElements.get(tag)) return;
    var Cls = function () { return Reflect.construct(HTMLElement, [], Cls); };
    Cls.prototype = Object.create(HTMLElement.prototype);
    Cls.prototype.constructor = Cls;
    Cls.observedAttributes = attrs;

    Cls.prototype._render = function () {
      if (!this.__root) return;
      var R = window.React, T = window.Thingtime;
      this.__root.render(
        R.createElement(T.ChakraProvider, null, R.createElement(T[name], mapProps(this)))
      );
    };

    Cls.prototype.connectedCallback = function () {
      var self = this;
      whenReady(function () {
        if (!self.isConnected || self.__root) return;
        var mount = document.createElement('div');
        mount.style.display = 'contents';
        self.appendChild(mount);
        self.__root = window.ReactDOM.createRoot(mount);
        self._render();
      });
    };

    Cls.prototype.attributeChangedCallback = function () { this._render(); };

    Cls.prototype.disconnectedCallback = function () {
      var root = this.__root;
      this.__root = null;
      if (root) setTimeout(function () { root.unmount(); }, 0);
    };

    customElements.define(tag, Cls);
  }

  defineEl('tt-logo', 'Logo', ['theme', 'icon', 'voxel-size', 'space'], function (el) {
    var theme = el.getAttribute('theme');
    return {
      theme: theme && theme.length ? theme : 'nature',
      icon: el.hasAttribute('icon'),
      voxelSize: parseFloat(el.getAttribute('voxel-size') || '18') || 18,
      space: el.getAttribute('space') != null ? el.getAttribute('space') : '0px'
    };
  });

  defineEl('tt-attention', 'Attention', ['w'], function (el) {
    return { w: el.getAttribute('w') || '120px' };
  });

  defineEl('tt-skeleton', 'RainbowSkeleton', ['width', 'height', 'radius'], function (el) {
    return {
      width: el.getAttribute('width') || '160px',
      height: el.getAttribute('height') || '14px',
      borderRadius: el.getAttribute('radius') || '0px'
    };
  });
})();
