/* @ds-bundle: {"namespace":"Thingtime","components":[{"name":"Attention","sourcePath":"components/buttons/Attention/Attention.jsx"},{"name":"Branding","sourcePath":"components/general/Branding/Branding.jsx"},{"name":"Hamburger","sourcePath":"components/buttons/Hamburger/Hamburger.jsx"},{"name":"Icon","sourcePath":"components/general/Icon/Icon.jsx"},{"name":"Logo","sourcePath":"components/branding/Logo/Logo.jsx"},{"name":"RainbowSkeleton","sourcePath":"components/skeleton/RainbowSkeleton/RainbowSkeleton.jsx"}],"sourceHashes":{"components/buttons/Attention/Attention.jsx":"cf1932f2bb43","components/buttons/Attention/Attention.d.ts":"14ff4bca0e88","components/buttons/Attention/Attention.prompt.md":"399dd7324123","components/general/Branding/Branding.jsx":"4f6319624063","components/general/Branding/Branding.d.ts":"1983c62d653d","components/general/Branding/Branding.prompt.md":"c4e315c30e55","components/buttons/Hamburger/Hamburger.jsx":"f478044db160","components/buttons/Hamburger/Hamburger.d.ts":"10fa47709ba9","components/buttons/Hamburger/Hamburger.prompt.md":"ac9feb10ae97","components/general/Icon/Icon.jsx":"0ac2d6249545","components/general/Icon/Icon.d.ts":"c6e65e532393","components/general/Icon/Icon.prompt.md":"7d603d25c868","components/branding/Logo/Logo.jsx":"7a0aee790bd1","components/branding/Logo/Logo.d.ts":"97c37a534bf3","components/branding/Logo/Logo.prompt.md":"a62bb66f546d","components/skeleton/RainbowSkeleton/RainbowSkeleton.jsx":"58a0ac7f81ee","components/skeleton/RainbowSkeleton/RainbowSkeleton.d.ts":"821ae9a4077e","components/skeleton/RainbowSkeleton/RainbowSkeleton.prompt.md":"bb6a8d1cfc3e"},"inlinedExternals":[".pnpm"],"builtBy":"cc-design-sync"} */
var Thingtime = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from2, except, desc) => {
    if (from2 && typeof from2 === "object" || typeof from2 === "function") {
      for (let key of __getOwnPropNames(from2))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from2[key], enumerable: !(desc = __getOwnPropDesc(from2, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // <define:import.meta.env>
  var init_define_import_meta_env = __esm({
    "<define:import.meta.env>"() {
    }
  });

  // shim:react-shim
  var require_react_shim = __commonJS({
    "shim:react-shim"(exports, module) {
      init_define_import_meta_env();
      var R = window.React;
      function jsx36(t2, p, k) {
        return R.createElement(t2, k === void 0 ? p : Object.assign({ key: k }, p));
      }
      module.exports = R;
      module.exports.jsx = jsx36;
      module.exports.jsxs = jsx36;
      module.exports.jsxDEV = jsx36;
      module.exports.Fragment = R.Fragment;
    }
  });

  // remix/node_modules/.pnpm/lodash.mergewith@4.6.2/node_modules/lodash.mergewith/index.js
  var require_lodash = __commonJS({
    "remix/node_modules/.pnpm/lodash.mergewith@4.6.2/node_modules/lodash.mergewith/index.js"(exports, module) {
      init_define_import_meta_env();
      var LARGE_ARRAY_SIZE = 200;
      var HASH_UNDEFINED = "__lodash_hash_undefined__";
      var HOT_COUNT = 800;
      var HOT_SPAN = 16;
      var MAX_SAFE_INTEGER = 9007199254740991;
      var argsTag = "[object Arguments]";
      var arrayTag = "[object Array]";
      var asyncTag = "[object AsyncFunction]";
      var boolTag = "[object Boolean]";
      var dateTag = "[object Date]";
      var errorTag = "[object Error]";
      var funcTag = "[object Function]";
      var genTag = "[object GeneratorFunction]";
      var mapTag = "[object Map]";
      var numberTag = "[object Number]";
      var nullTag = "[object Null]";
      var objectTag = "[object Object]";
      var proxyTag = "[object Proxy]";
      var regexpTag = "[object RegExp]";
      var setTag = "[object Set]";
      var stringTag = "[object String]";
      var undefinedTag = "[object Undefined]";
      var weakMapTag = "[object WeakMap]";
      var arrayBufferTag = "[object ArrayBuffer]";
      var dataViewTag = "[object DataView]";
      var float32Tag = "[object Float32Array]";
      var float64Tag = "[object Float64Array]";
      var int8Tag = "[object Int8Array]";
      var int16Tag = "[object Int16Array]";
      var int32Tag = "[object Int32Array]";
      var uint8Tag = "[object Uint8Array]";
      var uint8ClampedTag = "[object Uint8ClampedArray]";
      var uint16Tag = "[object Uint16Array]";
      var uint32Tag = "[object Uint32Array]";
      var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;
      var reIsHostCtor = /^\[object .+?Constructor\]$/;
      var reIsUint = /^(?:0|[1-9]\d*)$/;
      var typedArrayTags = {};
      typedArrayTags[float32Tag] = typedArrayTags[float64Tag] = typedArrayTags[int8Tag] = typedArrayTags[int16Tag] = typedArrayTags[int32Tag] = typedArrayTags[uint8Tag] = typedArrayTags[uint8ClampedTag] = typedArrayTags[uint16Tag] = typedArrayTags[uint32Tag] = true;
      typedArrayTags[argsTag] = typedArrayTags[arrayTag] = typedArrayTags[arrayBufferTag] = typedArrayTags[boolTag] = typedArrayTags[dataViewTag] = typedArrayTags[dateTag] = typedArrayTags[errorTag] = typedArrayTags[funcTag] = typedArrayTags[mapTag] = typedArrayTags[numberTag] = typedArrayTags[objectTag] = typedArrayTags[regexpTag] = typedArrayTags[setTag] = typedArrayTags[stringTag] = typedArrayTags[weakMapTag] = false;
      var freeGlobal = typeof global == "object" && global && global.Object === Object && global;
      var freeSelf = typeof self == "object" && self && self.Object === Object && self;
      var root = freeGlobal || freeSelf || Function("return this")();
      var freeExports = typeof exports == "object" && exports && !exports.nodeType && exports;
      var freeModule = freeExports && typeof module == "object" && module && !module.nodeType && module;
      var moduleExports = freeModule && freeModule.exports === freeExports;
      var freeProcess = moduleExports && freeGlobal.process;
      var nodeUtil = (function() {
        try {
          var types = freeModule && freeModule.require && freeModule.require("util").types;
          if (types) {
            return types;
          }
          return freeProcess && freeProcess.binding && freeProcess.binding("util");
        } catch (e) {
        }
      })();
      var nodeIsTypedArray = nodeUtil && nodeUtil.isTypedArray;
      function apply(func, thisArg, args) {
        switch (args.length) {
          case 0:
            return func.call(thisArg);
          case 1:
            return func.call(thisArg, args[0]);
          case 2:
            return func.call(thisArg, args[0], args[1]);
          case 3:
            return func.call(thisArg, args[0], args[1], args[2]);
        }
        return func.apply(thisArg, args);
      }
      function baseTimes(n, iteratee) {
        var index = -1, result = Array(n);
        while (++index < n) {
          result[index] = iteratee(index);
        }
        return result;
      }
      function baseUnary(func) {
        return function(value) {
          return func(value);
        };
      }
      function getValue(object, key) {
        return object == null ? void 0 : object[key];
      }
      function overArg(func, transform2) {
        return function(arg) {
          return func(transform2(arg));
        };
      }
      var arrayProto = Array.prototype;
      var funcProto = Function.prototype;
      var objectProto = Object.prototype;
      var coreJsData = root["__core-js_shared__"];
      var funcToString = funcProto.toString;
      var hasOwnProperty = objectProto.hasOwnProperty;
      var maskSrcKey = (function() {
        var uid = /[^.]+$/.exec(coreJsData && coreJsData.keys && coreJsData.keys.IE_PROTO || "");
        return uid ? "Symbol(src)_1." + uid : "";
      })();
      var nativeObjectToString = objectProto.toString;
      var objectCtorString = funcToString.call(Object);
      var reIsNative = RegExp(
        "^" + funcToString.call(hasOwnProperty).replace(reRegExpChar, "\\$&").replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, "$1.*?") + "$"
      );
      var Buffer2 = moduleExports ? root.Buffer : void 0;
      var Symbol2 = root.Symbol;
      var Uint8Array2 = root.Uint8Array;
      var allocUnsafe = Buffer2 ? Buffer2.allocUnsafe : void 0;
      var getPrototype = overArg(Object.getPrototypeOf, Object);
      var objectCreate = Object.create;
      var propertyIsEnumerable = objectProto.propertyIsEnumerable;
      var splice = arrayProto.splice;
      var symToStringTag = Symbol2 ? Symbol2.toStringTag : void 0;
      var defineProperty = (function() {
        try {
          var func = getNative(Object, "defineProperty");
          func({}, "", {});
          return func;
        } catch (e) {
        }
      })();
      var nativeIsBuffer = Buffer2 ? Buffer2.isBuffer : void 0;
      var nativeMax = Math.max;
      var nativeNow = Date.now;
      var Map2 = getNative(root, "Map");
      var nativeCreate = getNative(Object, "create");
      var baseCreate = /* @__PURE__ */ (function() {
        function object() {
        }
        return function(proto) {
          if (!isObject2(proto)) {
            return {};
          }
          if (objectCreate) {
            return objectCreate(proto);
          }
          object.prototype = proto;
          var result = new object();
          object.prototype = void 0;
          return result;
        };
      })();
      function Hash(entries) {
        var index = -1, length2 = entries == null ? 0 : entries.length;
        this.clear();
        while (++index < length2) {
          var entry = entries[index];
          this.set(entry[0], entry[1]);
        }
      }
      function hashClear() {
        this.__data__ = nativeCreate ? nativeCreate(null) : {};
        this.size = 0;
      }
      function hashDelete(key) {
        var result = this.has(key) && delete this.__data__[key];
        this.size -= result ? 1 : 0;
        return result;
      }
      function hashGet(key) {
        var data = this.__data__;
        if (nativeCreate) {
          var result = data[key];
          return result === HASH_UNDEFINED ? void 0 : result;
        }
        return hasOwnProperty.call(data, key) ? data[key] : void 0;
      }
      function hashHas(key) {
        var data = this.__data__;
        return nativeCreate ? data[key] !== void 0 : hasOwnProperty.call(data, key);
      }
      function hashSet(key, value) {
        var data = this.__data__;
        this.size += this.has(key) ? 0 : 1;
        data[key] = nativeCreate && value === void 0 ? HASH_UNDEFINED : value;
        return this;
      }
      Hash.prototype.clear = hashClear;
      Hash.prototype["delete"] = hashDelete;
      Hash.prototype.get = hashGet;
      Hash.prototype.has = hashHas;
      Hash.prototype.set = hashSet;
      function ListCache(entries) {
        var index = -1, length2 = entries == null ? 0 : entries.length;
        this.clear();
        while (++index < length2) {
          var entry = entries[index];
          this.set(entry[0], entry[1]);
        }
      }
      function listCacheClear() {
        this.__data__ = [];
        this.size = 0;
      }
      function listCacheDelete(key) {
        var data = this.__data__, index = assocIndexOf(data, key);
        if (index < 0) {
          return false;
        }
        var lastIndex = data.length - 1;
        if (index == lastIndex) {
          data.pop();
        } else {
          splice.call(data, index, 1);
        }
        --this.size;
        return true;
      }
      function listCacheGet(key) {
        var data = this.__data__, index = assocIndexOf(data, key);
        return index < 0 ? void 0 : data[index][1];
      }
      function listCacheHas(key) {
        return assocIndexOf(this.__data__, key) > -1;
      }
      function listCacheSet(key, value) {
        var data = this.__data__, index = assocIndexOf(data, key);
        if (index < 0) {
          ++this.size;
          data.push([key, value]);
        } else {
          data[index][1] = value;
        }
        return this;
      }
      ListCache.prototype.clear = listCacheClear;
      ListCache.prototype["delete"] = listCacheDelete;
      ListCache.prototype.get = listCacheGet;
      ListCache.prototype.has = listCacheHas;
      ListCache.prototype.set = listCacheSet;
      function MapCache(entries) {
        var index = -1, length2 = entries == null ? 0 : entries.length;
        this.clear();
        while (++index < length2) {
          var entry = entries[index];
          this.set(entry[0], entry[1]);
        }
      }
      function mapCacheClear() {
        this.size = 0;
        this.__data__ = {
          "hash": new Hash(),
          "map": new (Map2 || ListCache)(),
          "string": new Hash()
        };
      }
      function mapCacheDelete(key) {
        var result = getMapData(this, key)["delete"](key);
        this.size -= result ? 1 : 0;
        return result;
      }
      function mapCacheGet(key) {
        return getMapData(this, key).get(key);
      }
      function mapCacheHas(key) {
        return getMapData(this, key).has(key);
      }
      function mapCacheSet(key, value) {
        var data = getMapData(this, key), size2 = data.size;
        data.set(key, value);
        this.size += data.size == size2 ? 0 : 1;
        return this;
      }
      MapCache.prototype.clear = mapCacheClear;
      MapCache.prototype["delete"] = mapCacheDelete;
      MapCache.prototype.get = mapCacheGet;
      MapCache.prototype.has = mapCacheHas;
      MapCache.prototype.set = mapCacheSet;
      function Stack(entries) {
        var data = this.__data__ = new ListCache(entries);
        this.size = data.size;
      }
      function stackClear() {
        this.__data__ = new ListCache();
        this.size = 0;
      }
      function stackDelete(key) {
        var data = this.__data__, result = data["delete"](key);
        this.size = data.size;
        return result;
      }
      function stackGet(key) {
        return this.__data__.get(key);
      }
      function stackHas(key) {
        return this.__data__.has(key);
      }
      function stackSet(key, value) {
        var data = this.__data__;
        if (data instanceof ListCache) {
          var pairs = data.__data__;
          if (!Map2 || pairs.length < LARGE_ARRAY_SIZE - 1) {
            pairs.push([key, value]);
            this.size = ++data.size;
            return this;
          }
          data = this.__data__ = new MapCache(pairs);
        }
        data.set(key, value);
        this.size = data.size;
        return this;
      }
      Stack.prototype.clear = stackClear;
      Stack.prototype["delete"] = stackDelete;
      Stack.prototype.get = stackGet;
      Stack.prototype.has = stackHas;
      Stack.prototype.set = stackSet;
      function arrayLikeKeys(value, inherited) {
        var isArr = isArray2(value), isArg = !isArr && isArguments(value), isBuff = !isArr && !isArg && isBuffer(value), isType = !isArr && !isArg && !isBuff && isTypedArray(value), skipIndexes = isArr || isArg || isBuff || isType, result = skipIndexes ? baseTimes(value.length, String) : [], length2 = result.length;
        for (var key in value) {
          if ((inherited || hasOwnProperty.call(value, key)) && !(skipIndexes && // Safari 9 has enumerable `arguments.length` in strict mode.
          (key == "length" || // Node.js 0.10 has enumerable non-index properties on buffers.
          isBuff && (key == "offset" || key == "parent") || // PhantomJS 2 has enumerable non-index properties on typed arrays.
          isType && (key == "buffer" || key == "byteLength" || key == "byteOffset") || // Skip index properties.
          isIndex(key, length2)))) {
            result.push(key);
          }
        }
        return result;
      }
      function assignMergeValue(object, key, value) {
        if (value !== void 0 && !eq(object[key], value) || value === void 0 && !(key in object)) {
          baseAssignValue(object, key, value);
        }
      }
      function assignValue(object, key, value) {
        var objValue = object[key];
        if (!(hasOwnProperty.call(object, key) && eq(objValue, value)) || value === void 0 && !(key in object)) {
          baseAssignValue(object, key, value);
        }
      }
      function assocIndexOf(array, key) {
        var length2 = array.length;
        while (length2--) {
          if (eq(array[length2][0], key)) {
            return length2;
          }
        }
        return -1;
      }
      function baseAssignValue(object, key, value) {
        if (key == "__proto__" && defineProperty) {
          defineProperty(object, key, {
            "configurable": true,
            "enumerable": true,
            "value": value,
            "writable": true
          });
        } else {
          object[key] = value;
        }
      }
      var baseFor = createBaseFor();
      function baseGetTag(value) {
        if (value == null) {
          return value === void 0 ? undefinedTag : nullTag;
        }
        return symToStringTag && symToStringTag in Object(value) ? getRawTag(value) : objectToString(value);
      }
      function baseIsArguments(value) {
        return isObjectLike(value) && baseGetTag(value) == argsTag;
      }
      function baseIsNative(value) {
        if (!isObject2(value) || isMasked(value)) {
          return false;
        }
        var pattern = isFunction4(value) ? reIsNative : reIsHostCtor;
        return pattern.test(toSource(value));
      }
      function baseIsTypedArray(value) {
        return isObjectLike(value) && isLength(value.length) && !!typedArrayTags[baseGetTag(value)];
      }
      function baseKeysIn(object) {
        if (!isObject2(object)) {
          return nativeKeysIn(object);
        }
        var isProto = isPrototype(object), result = [];
        for (var key in object) {
          if (!(key == "constructor" && (isProto || !hasOwnProperty.call(object, key)))) {
            result.push(key);
          }
        }
        return result;
      }
      function baseMerge(object, source, srcIndex, customizer, stack) {
        if (object === source) {
          return;
        }
        baseFor(source, function(srcValue, key) {
          stack || (stack = new Stack());
          if (isObject2(srcValue)) {
            baseMergeDeep(object, source, key, srcIndex, baseMerge, customizer, stack);
          } else {
            var newValue = customizer ? customizer(safeGet(object, key), srcValue, key + "", object, source, stack) : void 0;
            if (newValue === void 0) {
              newValue = srcValue;
            }
            assignMergeValue(object, key, newValue);
          }
        }, keysIn);
      }
      function baseMergeDeep(object, source, key, srcIndex, mergeFunc, customizer, stack) {
        var objValue = safeGet(object, key), srcValue = safeGet(source, key), stacked = stack.get(srcValue);
        if (stacked) {
          assignMergeValue(object, key, stacked);
          return;
        }
        var newValue = customizer ? customizer(objValue, srcValue, key + "", object, source, stack) : void 0;
        var isCommon = newValue === void 0;
        if (isCommon) {
          var isArr = isArray2(srcValue), isBuff = !isArr && isBuffer(srcValue), isTyped = !isArr && !isBuff && isTypedArray(srcValue);
          newValue = srcValue;
          if (isArr || isBuff || isTyped) {
            if (isArray2(objValue)) {
              newValue = objValue;
            } else if (isArrayLikeObject(objValue)) {
              newValue = copyArray(objValue);
            } else if (isBuff) {
              isCommon = false;
              newValue = cloneBuffer(srcValue, true);
            } else if (isTyped) {
              isCommon = false;
              newValue = cloneTypedArray(srcValue, true);
            } else {
              newValue = [];
            }
          } else if (isPlainObject(srcValue) || isArguments(srcValue)) {
            newValue = objValue;
            if (isArguments(objValue)) {
              newValue = toPlainObject(objValue);
            } else if (!isObject2(objValue) || isFunction4(objValue)) {
              newValue = initCloneObject(srcValue);
            }
          } else {
            isCommon = false;
          }
        }
        if (isCommon) {
          stack.set(srcValue, newValue);
          mergeFunc(newValue, srcValue, srcIndex, customizer, stack);
          stack["delete"](srcValue);
        }
        assignMergeValue(object, key, newValue);
      }
      function baseRest(func, start) {
        return setToString(overRest(func, start, identity), func + "");
      }
      var baseSetToString = !defineProperty ? identity : function(func, string) {
        return defineProperty(func, "toString", {
          "configurable": true,
          "enumerable": false,
          "value": constant(string),
          "writable": true
        });
      };
      function cloneBuffer(buffer, isDeep) {
        if (isDeep) {
          return buffer.slice();
        }
        var length2 = buffer.length, result = allocUnsafe ? allocUnsafe(length2) : new buffer.constructor(length2);
        buffer.copy(result);
        return result;
      }
      function cloneArrayBuffer(arrayBuffer) {
        var result = new arrayBuffer.constructor(arrayBuffer.byteLength);
        new Uint8Array2(result).set(new Uint8Array2(arrayBuffer));
        return result;
      }
      function cloneTypedArray(typedArray, isDeep) {
        var buffer = isDeep ? cloneArrayBuffer(typedArray.buffer) : typedArray.buffer;
        return new typedArray.constructor(buffer, typedArray.byteOffset, typedArray.length);
      }
      function copyArray(source, array) {
        var index = -1, length2 = source.length;
        array || (array = Array(length2));
        while (++index < length2) {
          array[index] = source[index];
        }
        return array;
      }
      function copyObject(source, props, object, customizer) {
        var isNew = !object;
        object || (object = {});
        var index = -1, length2 = props.length;
        while (++index < length2) {
          var key = props[index];
          var newValue = customizer ? customizer(object[key], source[key], key, object, source) : void 0;
          if (newValue === void 0) {
            newValue = source[key];
          }
          if (isNew) {
            baseAssignValue(object, key, newValue);
          } else {
            assignValue(object, key, newValue);
          }
        }
        return object;
      }
      function createAssigner(assigner) {
        return baseRest(function(object, sources) {
          var index = -1, length2 = sources.length, customizer = length2 > 1 ? sources[length2 - 1] : void 0, guard2 = length2 > 2 ? sources[2] : void 0;
          customizer = assigner.length > 3 && typeof customizer == "function" ? (length2--, customizer) : void 0;
          if (guard2 && isIterateeCall(sources[0], sources[1], guard2)) {
            customizer = length2 < 3 ? void 0 : customizer;
            length2 = 1;
          }
          object = Object(object);
          while (++index < length2) {
            var source = sources[index];
            if (source) {
              assigner(object, source, index, customizer);
            }
          }
          return object;
        });
      }
      function createBaseFor(fromRight) {
        return function(object, iteratee, keysFunc) {
          var index = -1, iterable = Object(object), props = keysFunc(object), length2 = props.length;
          while (length2--) {
            var key = props[fromRight ? length2 : ++index];
            if (iteratee(iterable[key], key, iterable) === false) {
              break;
            }
          }
          return object;
        };
      }
      function getMapData(map, key) {
        var data = map.__data__;
        return isKeyable(key) ? data[typeof key == "string" ? "string" : "hash"] : data.map;
      }
      function getNative(object, key) {
        var value = getValue(object, key);
        return baseIsNative(value) ? value : void 0;
      }
      function getRawTag(value) {
        var isOwn = hasOwnProperty.call(value, symToStringTag), tag = value[symToStringTag];
        try {
          value[symToStringTag] = void 0;
          var unmasked = true;
        } catch (e) {
        }
        var result = nativeObjectToString.call(value);
        if (unmasked) {
          if (isOwn) {
            value[symToStringTag] = tag;
          } else {
            delete value[symToStringTag];
          }
        }
        return result;
      }
      function initCloneObject(object) {
        return typeof object.constructor == "function" && !isPrototype(object) ? baseCreate(getPrototype(object)) : {};
      }
      function isIndex(value, length2) {
        var type = typeof value;
        length2 = length2 == null ? MAX_SAFE_INTEGER : length2;
        return !!length2 && (type == "number" || type != "symbol" && reIsUint.test(value)) && (value > -1 && value % 1 == 0 && value < length2);
      }
      function isIterateeCall(value, index, object) {
        if (!isObject2(object)) {
          return false;
        }
        var type = typeof index;
        if (type == "number" ? isArrayLike(object) && isIndex(index, object.length) : type == "string" && index in object) {
          return eq(object[index], value);
        }
        return false;
      }
      function isKeyable(value) {
        var type = typeof value;
        return type == "string" || type == "number" || type == "symbol" || type == "boolean" ? value !== "__proto__" : value === null;
      }
      function isMasked(func) {
        return !!maskSrcKey && maskSrcKey in func;
      }
      function isPrototype(value) {
        var Ctor = value && value.constructor, proto = typeof Ctor == "function" && Ctor.prototype || objectProto;
        return value === proto;
      }
      function nativeKeysIn(object) {
        var result = [];
        if (object != null) {
          for (var key in Object(object)) {
            result.push(key);
          }
        }
        return result;
      }
      function objectToString(value) {
        return nativeObjectToString.call(value);
      }
      function overRest(func, start, transform2) {
        start = nativeMax(start === void 0 ? func.length - 1 : start, 0);
        return function() {
          var args = arguments, index = -1, length2 = nativeMax(args.length - start, 0), array = Array(length2);
          while (++index < length2) {
            array[index] = args[start + index];
          }
          index = -1;
          var otherArgs = Array(start + 1);
          while (++index < start) {
            otherArgs[index] = args[index];
          }
          otherArgs[start] = transform2(array);
          return apply(func, this, otherArgs);
        };
      }
      function safeGet(object, key) {
        if (key === "constructor" && typeof object[key] === "function") {
          return;
        }
        if (key == "__proto__") {
          return;
        }
        return object[key];
      }
      var setToString = shortOut(baseSetToString);
      function shortOut(func) {
        var count = 0, lastCalled = 0;
        return function() {
          var stamp = nativeNow(), remaining = HOT_SPAN - (stamp - lastCalled);
          lastCalled = stamp;
          if (remaining > 0) {
            if (++count >= HOT_COUNT) {
              return arguments[0];
            }
          } else {
            count = 0;
          }
          return func.apply(void 0, arguments);
        };
      }
      function toSource(func) {
        if (func != null) {
          try {
            return funcToString.call(func);
          } catch (e) {
          }
          try {
            return func + "";
          } catch (e) {
          }
        }
        return "";
      }
      function eq(value, other) {
        return value === other || value !== value && other !== other;
      }
      var isArguments = baseIsArguments(/* @__PURE__ */ (function() {
        return arguments;
      })()) ? baseIsArguments : function(value) {
        return isObjectLike(value) && hasOwnProperty.call(value, "callee") && !propertyIsEnumerable.call(value, "callee");
      };
      var isArray2 = Array.isArray;
      function isArrayLike(value) {
        return value != null && isLength(value.length) && !isFunction4(value);
      }
      function isArrayLikeObject(value) {
        return isObjectLike(value) && isArrayLike(value);
      }
      var isBuffer = nativeIsBuffer || stubFalse;
      function isFunction4(value) {
        if (!isObject2(value)) {
          return false;
        }
        var tag = baseGetTag(value);
        return tag == funcTag || tag == genTag || tag == asyncTag || tag == proxyTag;
      }
      function isLength(value) {
        return typeof value == "number" && value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
      }
      function isObject2(value) {
        var type = typeof value;
        return value != null && (type == "object" || type == "function");
      }
      function isObjectLike(value) {
        return value != null && typeof value == "object";
      }
      function isPlainObject(value) {
        if (!isObjectLike(value) || baseGetTag(value) != objectTag) {
          return false;
        }
        var proto = getPrototype(value);
        if (proto === null) {
          return true;
        }
        var Ctor = hasOwnProperty.call(proto, "constructor") && proto.constructor;
        return typeof Ctor == "function" && Ctor instanceof Ctor && funcToString.call(Ctor) == objectCtorString;
      }
      var isTypedArray = nodeIsTypedArray ? baseUnary(nodeIsTypedArray) : baseIsTypedArray;
      function toPlainObject(value) {
        return copyObject(value, keysIn(value));
      }
      function keysIn(object) {
        return isArrayLike(object) ? arrayLikeKeys(object, true) : baseKeysIn(object);
      }
      var mergeWith = createAssigner(function(object, source, srcIndex, customizer) {
        baseMerge(object, source, srcIndex, customizer);
      });
      function constant(value) {
        return function() {
          return value;
        };
      }
      function identity(value) {
        return value;
      }
      function stubFalse() {
        return false;
      }
      module.exports = mergeWith;
    }
  });

  // remix/node_modules/.pnpm/@emotion+memoize@0.9.0/node_modules/@emotion/memoize/dist/emotion-memoize.esm.js
  function memoize3(fn) {
    var cache = /* @__PURE__ */ Object.create(null);
    return function(arg) {
      if (cache[arg] === void 0) cache[arg] = fn(arg);
      return cache[arg];
    };
  }
  var init_emotion_memoize_esm = __esm({
    "remix/node_modules/.pnpm/@emotion+memoize@0.9.0/node_modules/@emotion/memoize/dist/emotion-memoize.esm.js"() {
      init_define_import_meta_env();
    }
  });

  // shim:react-is-shim
  var require_react_is_shim = __commonJS({
    "shim:react-is-shim"(exports) {
      init_define_import_meta_env();
      var R = window.React;
      var FWD = /* @__PURE__ */ Symbol.for("react.forward_ref");
      var MEMO = /* @__PURE__ */ Symbol.for("react.memo");
      var PORTAL = /* @__PURE__ */ Symbol.for("react.portal");
      var LAZY = /* @__PURE__ */ Symbol.for("react.lazy");
      function tt(o) {
        return o != null && typeof o === "object" ? R.isValidElement(o) ? o.type && o.type.$$typeof || o.type : o.$$typeof : void 0;
      }
      exports.typeOf = tt;
      exports.isElement = R.isValidElement;
      exports.isValidElementType = function(t2) {
        return typeof t2 === "string" || typeof t2 === "function" || t2 === R.Fragment || t2 === R.Suspense || t2 === R.StrictMode || t2 === R.Profiler || t2 != null && typeof t2 === "object" && t2.$$typeof != null;
      };
      exports.isFragment = function(o) {
        return R.isValidElement(o) && o.type === R.Fragment;
      };
      exports.isSuspense = function(o) {
        return R.isValidElement(o) && o.type === R.Suspense;
      };
      exports.isPortal = function(o) {
        return o != null && o.$$typeof === PORTAL;
      };
      exports.isForwardRef = function(o) {
        return tt(o) === FWD;
      };
      exports.isMemo = function(o) {
        return tt(o) === MEMO;
      };
      exports.isLazy = function(o) {
        return tt(o) === LAZY;
      };
      exports.isContextProvider = exports.isContextConsumer = exports.isProfiler = exports.isStrictMode = function() {
        return false;
      };
      exports.ForwardRef = FWD;
      exports.Memo = MEMO;
      exports.Portal = PORTAL;
      exports.Lazy = LAZY;
      exports.Fragment = R.Fragment;
      exports.Suspense = R.Suspense;
      exports.StrictMode = R.StrictMode;
      exports.Profiler = R.Profiler;
    }
  });

  // remix/node_modules/.pnpm/hoist-non-react-statics@3.3.2/node_modules/hoist-non-react-statics/dist/hoist-non-react-statics.cjs.js
  var require_hoist_non_react_statics_cjs = __commonJS({
    "remix/node_modules/.pnpm/hoist-non-react-statics@3.3.2/node_modules/hoist-non-react-statics/dist/hoist-non-react-statics.cjs.js"(exports, module) {
      "use strict";
      init_define_import_meta_env();
      var reactIs = require_react_is_shim();
      var REACT_STATICS = {
        childContextTypes: true,
        contextType: true,
        contextTypes: true,
        defaultProps: true,
        displayName: true,
        getDefaultProps: true,
        getDerivedStateFromError: true,
        getDerivedStateFromProps: true,
        mixins: true,
        propTypes: true,
        type: true
      };
      var KNOWN_STATICS = {
        name: true,
        length: true,
        prototype: true,
        caller: true,
        callee: true,
        arguments: true,
        arity: true
      };
      var FORWARD_REF_STATICS = {
        "$$typeof": true,
        render: true,
        defaultProps: true,
        displayName: true,
        propTypes: true
      };
      var MEMO_STATICS = {
        "$$typeof": true,
        compare: true,
        defaultProps: true,
        displayName: true,
        propTypes: true,
        type: true
      };
      var TYPE_STATICS = {};
      TYPE_STATICS[reactIs.ForwardRef] = FORWARD_REF_STATICS;
      TYPE_STATICS[reactIs.Memo] = MEMO_STATICS;
      function getStatics(component) {
        if (reactIs.isMemo(component)) {
          return MEMO_STATICS;
        }
        return TYPE_STATICS[component["$$typeof"]] || REACT_STATICS;
      }
      var defineProperty = Object.defineProperty;
      var getOwnPropertyNames = Object.getOwnPropertyNames;
      var getOwnPropertySymbols = Object.getOwnPropertySymbols;
      var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
      var getPrototypeOf = Object.getPrototypeOf;
      var objectPrototype = Object.prototype;
      function hoistNonReactStatics(targetComponent, sourceComponent, blacklist) {
        if (typeof sourceComponent !== "string") {
          if (objectPrototype) {
            var inheritedComponent = getPrototypeOf(sourceComponent);
            if (inheritedComponent && inheritedComponent !== objectPrototype) {
              hoistNonReactStatics(targetComponent, inheritedComponent, blacklist);
            }
          }
          var keys2 = getOwnPropertyNames(sourceComponent);
          if (getOwnPropertySymbols) {
            keys2 = keys2.concat(getOwnPropertySymbols(sourceComponent));
          }
          var targetStatics = getStatics(targetComponent);
          var sourceStatics = getStatics(sourceComponent);
          for (var i = 0; i < keys2.length; ++i) {
            var key = keys2[i];
            if (!KNOWN_STATICS[key] && !(blacklist && blacklist[key]) && !(sourceStatics && sourceStatics[key]) && !(targetStatics && targetStatics[key])) {
              var descriptor = getOwnPropertyDescriptor(sourceComponent, key);
              try {
                defineProperty(targetComponent, key, descriptor);
              } catch (e) {
              }
            }
          }
        }
        return targetComponent;
      }
      module.exports = hoistNonReactStatics;
    }
  });

  // remix/node_modules/.pnpm/@emotion+is-prop-valid@1.4.0/node_modules/@emotion/is-prop-valid/dist/emotion-is-prop-valid.esm.js
  var emotion_is_prop_valid_esm_exports = {};
  __export(emotion_is_prop_valid_esm_exports, {
    default: () => isPropValid
  });
  var reactPropsRegex, isPropValid;
  var init_emotion_is_prop_valid_esm = __esm({
    "remix/node_modules/.pnpm/@emotion+is-prop-valid@1.4.0/node_modules/@emotion/is-prop-valid/dist/emotion-is-prop-valid.esm.js"() {
      init_define_import_meta_env();
      init_emotion_memoize_esm();
      reactPropsRegex = /^((children|dangerouslySetInnerHTML|key|ref|autoFocus|defaultValue|defaultChecked|innerHTML|suppressContentEditableWarning|suppressHydrationWarning|valueLink|abbr|accept|acceptCharset|accessKey|action|allow|allowUserMedia|allowPaymentRequest|allowFullScreen|allowTransparency|alt|async|autoComplete|autoPlay|capture|cellPadding|cellSpacing|challenge|charSet|checked|cite|classID|className|cols|colSpan|content|contentEditable|contextMenu|controls|controlsList|coords|crossOrigin|data|dateTime|decoding|default|defer|dir|disabled|disablePictureInPicture|disableRemotePlayback|download|draggable|encType|enterKeyHint|fetchpriority|fetchPriority|form|formAction|formEncType|formMethod|formNoValidate|formTarget|frameBorder|headers|height|hidden|high|href|hrefLang|htmlFor|httpEquiv|id|inputMode|integrity|is|keyParams|keyType|kind|label|lang|list|loading|loop|low|marginHeight|marginWidth|max|maxLength|media|mediaGroup|method|min|minLength|multiple|muted|name|nonce|noValidate|open|optimum|pattern|placeholder|playsInline|popover|popoverTarget|popoverTargetAction|poster|preload|profile|radioGroup|readOnly|referrerPolicy|rel|required|reversed|role|rows|rowSpan|sandbox|scope|scoped|scrolling|seamless|selected|shape|size|sizes|slot|span|spellCheck|src|srcDoc|srcLang|srcSet|start|step|style|summary|tabIndex|target|title|translate|type|useMap|value|width|wmode|wrap|about|datatype|inlist|prefix|property|resource|typeof|vocab|autoCapitalize|autoCorrect|autoSave|color|incremental|fallback|inert|itemProp|itemScope|itemType|itemID|itemRef|on|option|results|security|unselectable|accentHeight|accumulate|additive|alignmentBaseline|allowReorder|alphabetic|amplitude|arabicForm|ascent|attributeName|attributeType|autoReverse|azimuth|baseFrequency|baselineShift|baseProfile|bbox|begin|bias|by|calcMode|capHeight|clip|clipPathUnits|clipPath|clipRule|colorInterpolation|colorInterpolationFilters|colorProfile|colorRendering|contentScriptType|contentStyleType|cursor|cx|cy|d|decelerate|descent|diffuseConstant|direction|display|divisor|dominantBaseline|dur|dx|dy|edgeMode|elevation|enableBackground|end|exponent|externalResourcesRequired|fill|fillOpacity|fillRule|filter|filterRes|filterUnits|floodColor|floodOpacity|focusable|fontFamily|fontSize|fontSizeAdjust|fontStretch|fontStyle|fontVariant|fontWeight|format|from|fr|fx|fy|g1|g2|glyphName|glyphOrientationHorizontal|glyphOrientationVertical|glyphRef|gradientTransform|gradientUnits|hanging|horizAdvX|horizOriginX|ideographic|imageRendering|in|in2|intercept|k|k1|k2|k3|k4|kernelMatrix|kernelUnitLength|kerning|keyPoints|keySplines|keyTimes|lengthAdjust|letterSpacing|lightingColor|limitingConeAngle|local|markerEnd|markerMid|markerStart|markerHeight|markerUnits|markerWidth|mask|maskContentUnits|maskUnits|mathematical|mode|numOctaves|offset|opacity|operator|order|orient|orientation|origin|overflow|overlinePosition|overlineThickness|panose1|paintOrder|pathLength|patternContentUnits|patternTransform|patternUnits|pointerEvents|points|pointsAtX|pointsAtY|pointsAtZ|preserveAlpha|preserveAspectRatio|primitiveUnits|r|radius|refX|refY|renderingIntent|repeatCount|repeatDur|requiredExtensions|requiredFeatures|restart|result|rotate|rx|ry|scale|seed|shapeRendering|slope|spacing|specularConstant|specularExponent|speed|spreadMethod|startOffset|stdDeviation|stemh|stemv|stitchTiles|stopColor|stopOpacity|strikethroughPosition|strikethroughThickness|string|stroke|strokeDasharray|strokeDashoffset|strokeLinecap|strokeLinejoin|strokeMiterlimit|strokeOpacity|strokeWidth|surfaceScale|systemLanguage|tableValues|targetX|targetY|textAnchor|textDecoration|textRendering|textLength|to|transform|u1|u2|underlinePosition|underlineThickness|unicode|unicodeBidi|unicodeRange|unitsPerEm|vAlphabetic|vHanging|vIdeographic|vMathematical|values|vectorEffect|version|vertAdvY|vertOriginX|vertOriginY|viewBox|viewTarget|visibility|widths|wordSpacing|writingMode|x|xHeight|x1|x2|xChannelSelector|xlinkActuate|xlinkArcrole|xlinkHref|xlinkRole|xlinkShow|xlinkTitle|xlinkType|xmlBase|xmlns|xmlnsXlink|xmlLang|xmlSpace|y|y1|y2|yChannelSelector|z|zoomAndPan|for|class|autofocus)|(([Dd][Aa][Tt][Aa]|[Aa][Rr][Ii][Aa]|x)-.*))$/;
      isPropValid = /* @__PURE__ */ memoize3(
        function(prop) {
          return reactPropsRegex.test(prop) || prop.charCodeAt(0) === 111 && prop.charCodeAt(1) === 110 && prop.charCodeAt(2) < 91;
        }
        /* Z+1 */
      );
    }
  });

  // remix/node_modules/.pnpm/react-fast-compare@3.2.2/node_modules/react-fast-compare/index.js
  var require_react_fast_compare = __commonJS({
    "remix/node_modules/.pnpm/react-fast-compare@3.2.2/node_modules/react-fast-compare/index.js"(exports, module) {
      init_define_import_meta_env();
      var hasElementType = typeof Element !== "undefined";
      var hasMap = typeof Map === "function";
      var hasSet = typeof Set === "function";
      var hasArrayBuffer = typeof ArrayBuffer === "function" && !!ArrayBuffer.isView;
      function equal(a, b) {
        if (a === b) return true;
        if (a && b && typeof a == "object" && typeof b == "object") {
          if (a.constructor !== b.constructor) return false;
          var length2, i, keys2;
          if (Array.isArray(a)) {
            length2 = a.length;
            if (length2 != b.length) return false;
            for (i = length2; i-- !== 0; )
              if (!equal(a[i], b[i])) return false;
            return true;
          }
          var it;
          if (hasMap && a instanceof Map && b instanceof Map) {
            if (a.size !== b.size) return false;
            it = a.entries();
            while (!(i = it.next()).done)
              if (!b.has(i.value[0])) return false;
            it = a.entries();
            while (!(i = it.next()).done)
              if (!equal(i.value[1], b.get(i.value[0]))) return false;
            return true;
          }
          if (hasSet && a instanceof Set && b instanceof Set) {
            if (a.size !== b.size) return false;
            it = a.entries();
            while (!(i = it.next()).done)
              if (!b.has(i.value[0])) return false;
            return true;
          }
          if (hasArrayBuffer && ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
            length2 = a.length;
            if (length2 != b.length) return false;
            for (i = length2; i-- !== 0; )
              if (a[i] !== b[i]) return false;
            return true;
          }
          if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
          if (a.valueOf !== Object.prototype.valueOf && typeof a.valueOf === "function" && typeof b.valueOf === "function") return a.valueOf() === b.valueOf();
          if (a.toString !== Object.prototype.toString && typeof a.toString === "function" && typeof b.toString === "function") return a.toString() === b.toString();
          keys2 = Object.keys(a);
          length2 = keys2.length;
          if (length2 !== Object.keys(b).length) return false;
          for (i = length2; i-- !== 0; )
            if (!Object.prototype.hasOwnProperty.call(b, keys2[i])) return false;
          if (hasElementType && a instanceof Element) return false;
          for (i = length2; i-- !== 0; ) {
            if ((keys2[i] === "_owner" || keys2[i] === "__v" || keys2[i] === "__o") && a.$$typeof) {
              continue;
            }
            if (!equal(a[keys2[i]], b[keys2[i]])) return false;
          }
          return true;
        }
        return a !== a && b !== b;
      }
      module.exports = function isEqual2(a, b) {
        try {
          return equal(a, b);
        } catch (error) {
          if ((error.message || "").match(/stack|recursion/i)) {
            console.warn("react-fast-compare cannot handle circular refs");
            return false;
          }
          throw error;
        }
      };
    }
  });

  // shim:react-dom-shim
  var require_react_dom_shim = __commonJS({
    "shim:react-dom-shim"(exports, module) {
      init_define_import_meta_env();
      var D = window.ReactDOM;
      var n = function() {
      };
      module.exports = Object.assign({ preload: n, preinit: n, preconnect: n, prefetchDNS: n, preloadModule: n, preinitModule: n }, D);
    }
  });

  // remix/node_modules/.pnpm/emojis-list@3.0.0/node_modules/emojis-list/index.js
  var require_emojis_list = __commonJS({
    "remix/node_modules/.pnpm/emojis-list@3.0.0/node_modules/emojis-list/index.js"(exports, module) {
      init_define_import_meta_env();
      module.exports = [
        "\u{1F004}\uFE0F",
        "\u{1F0CF}",
        "\u{1F170}\uFE0F",
        "\u{1F171}\uFE0F",
        "\u{1F17E}\uFE0F",
        "\u{1F17F}\uFE0F",
        "\u{1F18E}",
        "\u{1F191}",
        "\u{1F192}",
        "\u{1F193}",
        "\u{1F194}",
        "\u{1F195}",
        "\u{1F196}",
        "\u{1F197}",
        "\u{1F198}",
        "\u{1F199}",
        "\u{1F19A}",
        "\u{1F1E6}\u{1F1E8}",
        "\u{1F1E6}\u{1F1E9}",
        "\u{1F1E6}\u{1F1EA}",
        "\u{1F1E6}\u{1F1EB}",
        "\u{1F1E6}\u{1F1EC}",
        "\u{1F1E6}\u{1F1EE}",
        "\u{1F1E6}\u{1F1F1}",
        "\u{1F1E6}\u{1F1F2}",
        "\u{1F1E6}\u{1F1F4}",
        "\u{1F1E6}\u{1F1F6}",
        "\u{1F1E6}\u{1F1F7}",
        "\u{1F1E6}\u{1F1F8}",
        "\u{1F1E6}\u{1F1F9}",
        "\u{1F1E6}\u{1F1FA}",
        "\u{1F1E6}\u{1F1FC}",
        "\u{1F1E6}\u{1F1FD}",
        "\u{1F1E6}\u{1F1FF}",
        "\u{1F1E6}",
        "\u{1F1E7}\u{1F1E6}",
        "\u{1F1E7}\u{1F1E7}",
        "\u{1F1E7}\u{1F1E9}",
        "\u{1F1E7}\u{1F1EA}",
        "\u{1F1E7}\u{1F1EB}",
        "\u{1F1E7}\u{1F1EC}",
        "\u{1F1E7}\u{1F1ED}",
        "\u{1F1E7}\u{1F1EE}",
        "\u{1F1E7}\u{1F1EF}",
        "\u{1F1E7}\u{1F1F1}",
        "\u{1F1E7}\u{1F1F2}",
        "\u{1F1E7}\u{1F1F3}",
        "\u{1F1E7}\u{1F1F4}",
        "\u{1F1E7}\u{1F1F6}",
        "\u{1F1E7}\u{1F1F7}",
        "\u{1F1E7}\u{1F1F8}",
        "\u{1F1E7}\u{1F1F9}",
        "\u{1F1E7}\u{1F1FB}",
        "\u{1F1E7}\u{1F1FC}",
        "\u{1F1E7}\u{1F1FE}",
        "\u{1F1E7}\u{1F1FF}",
        "\u{1F1E7}",
        "\u{1F1E8}\u{1F1E6}",
        "\u{1F1E8}\u{1F1E8}",
        "\u{1F1E8}\u{1F1E9}",
        "\u{1F1E8}\u{1F1EB}",
        "\u{1F1E8}\u{1F1EC}",
        "\u{1F1E8}\u{1F1ED}",
        "\u{1F1E8}\u{1F1EE}",
        "\u{1F1E8}\u{1F1F0}",
        "\u{1F1E8}\u{1F1F1}",
        "\u{1F1E8}\u{1F1F2}",
        "\u{1F1E8}\u{1F1F3}",
        "\u{1F1E8}\u{1F1F4}",
        "\u{1F1E8}\u{1F1F5}",
        "\u{1F1E8}\u{1F1F7}",
        "\u{1F1E8}\u{1F1FA}",
        "\u{1F1E8}\u{1F1FB}",
        "\u{1F1E8}\u{1F1FC}",
        "\u{1F1E8}\u{1F1FD}",
        "\u{1F1E8}\u{1F1FE}",
        "\u{1F1E8}\u{1F1FF}",
        "\u{1F1E8}",
        "\u{1F1E9}\u{1F1EA}",
        "\u{1F1E9}\u{1F1EC}",
        "\u{1F1E9}\u{1F1EF}",
        "\u{1F1E9}\u{1F1F0}",
        "\u{1F1E9}\u{1F1F2}",
        "\u{1F1E9}\u{1F1F4}",
        "\u{1F1E9}\u{1F1FF}",
        "\u{1F1E9}",
        "\u{1F1EA}\u{1F1E6}",
        "\u{1F1EA}\u{1F1E8}",
        "\u{1F1EA}\u{1F1EA}",
        "\u{1F1EA}\u{1F1EC}",
        "\u{1F1EA}\u{1F1ED}",
        "\u{1F1EA}\u{1F1F7}",
        "\u{1F1EA}\u{1F1F8}",
        "\u{1F1EA}\u{1F1F9}",
        "\u{1F1EA}\u{1F1FA}",
        "\u{1F1EA}",
        "\u{1F1EB}\u{1F1EE}",
        "\u{1F1EB}\u{1F1EF}",
        "\u{1F1EB}\u{1F1F0}",
        "\u{1F1EB}\u{1F1F2}",
        "\u{1F1EB}\u{1F1F4}",
        "\u{1F1EB}\u{1F1F7}",
        "\u{1F1EB}",
        "\u{1F1EC}\u{1F1E6}",
        "\u{1F1EC}\u{1F1E7}",
        "\u{1F1EC}\u{1F1E9}",
        "\u{1F1EC}\u{1F1EA}",
        "\u{1F1EC}\u{1F1EB}",
        "\u{1F1EC}\u{1F1EC}",
        "\u{1F1EC}\u{1F1ED}",
        "\u{1F1EC}\u{1F1EE}",
        "\u{1F1EC}\u{1F1F1}",
        "\u{1F1EC}\u{1F1F2}",
        "\u{1F1EC}\u{1F1F3}",
        "\u{1F1EC}\u{1F1F5}",
        "\u{1F1EC}\u{1F1F6}",
        "\u{1F1EC}\u{1F1F7}",
        "\u{1F1EC}\u{1F1F8}",
        "\u{1F1EC}\u{1F1F9}",
        "\u{1F1EC}\u{1F1FA}",
        "\u{1F1EC}\u{1F1FC}",
        "\u{1F1EC}\u{1F1FE}",
        "\u{1F1EC}",
        "\u{1F1ED}\u{1F1F0}",
        "\u{1F1ED}\u{1F1F2}",
        "\u{1F1ED}\u{1F1F3}",
        "\u{1F1ED}\u{1F1F7}",
        "\u{1F1ED}\u{1F1F9}",
        "\u{1F1ED}\u{1F1FA}",
        "\u{1F1ED}",
        "\u{1F1EE}\u{1F1E8}",
        "\u{1F1EE}\u{1F1E9}",
        "\u{1F1EE}\u{1F1EA}",
        "\u{1F1EE}\u{1F1F1}",
        "\u{1F1EE}\u{1F1F2}",
        "\u{1F1EE}\u{1F1F3}",
        "\u{1F1EE}\u{1F1F4}",
        "\u{1F1EE}\u{1F1F6}",
        "\u{1F1EE}\u{1F1F7}",
        "\u{1F1EE}\u{1F1F8}",
        "\u{1F1EE}\u{1F1F9}",
        "\u{1F1EE}",
        "\u{1F1EF}\u{1F1EA}",
        "\u{1F1EF}\u{1F1F2}",
        "\u{1F1EF}\u{1F1F4}",
        "\u{1F1EF}\u{1F1F5}",
        "\u{1F1EF}",
        "\u{1F1F0}\u{1F1EA}",
        "\u{1F1F0}\u{1F1EC}",
        "\u{1F1F0}\u{1F1ED}",
        "\u{1F1F0}\u{1F1EE}",
        "\u{1F1F0}\u{1F1F2}",
        "\u{1F1F0}\u{1F1F3}",
        "\u{1F1F0}\u{1F1F5}",
        "\u{1F1F0}\u{1F1F7}",
        "\u{1F1F0}\u{1F1FC}",
        "\u{1F1F0}\u{1F1FE}",
        "\u{1F1F0}\u{1F1FF}",
        "\u{1F1F0}",
        "\u{1F1F1}\u{1F1E6}",
        "\u{1F1F1}\u{1F1E7}",
        "\u{1F1F1}\u{1F1E8}",
        "\u{1F1F1}\u{1F1EE}",
        "\u{1F1F1}\u{1F1F0}",
        "\u{1F1F1}\u{1F1F7}",
        "\u{1F1F1}\u{1F1F8}",
        "\u{1F1F1}\u{1F1F9}",
        "\u{1F1F1}\u{1F1FA}",
        "\u{1F1F1}\u{1F1FB}",
        "\u{1F1F1}\u{1F1FE}",
        "\u{1F1F1}",
        "\u{1F1F2}\u{1F1E6}",
        "\u{1F1F2}\u{1F1E8}",
        "\u{1F1F2}\u{1F1E9}",
        "\u{1F1F2}\u{1F1EA}",
        "\u{1F1F2}\u{1F1EB}",
        "\u{1F1F2}\u{1F1EC}",
        "\u{1F1F2}\u{1F1ED}",
        "\u{1F1F2}\u{1F1F0}",
        "\u{1F1F2}\u{1F1F1}",
        "\u{1F1F2}\u{1F1F2}",
        "\u{1F1F2}\u{1F1F3}",
        "\u{1F1F2}\u{1F1F4}",
        "\u{1F1F2}\u{1F1F5}",
        "\u{1F1F2}\u{1F1F6}",
        "\u{1F1F2}\u{1F1F7}",
        "\u{1F1F2}\u{1F1F8}",
        "\u{1F1F2}\u{1F1F9}",
        "\u{1F1F2}\u{1F1FA}",
        "\u{1F1F2}\u{1F1FB}",
        "\u{1F1F2}\u{1F1FC}",
        "\u{1F1F2}\u{1F1FD}",
        "\u{1F1F2}\u{1F1FE}",
        "\u{1F1F2}\u{1F1FF}",
        "\u{1F1F2}",
        "\u{1F1F3}\u{1F1E6}",
        "\u{1F1F3}\u{1F1E8}",
        "\u{1F1F3}\u{1F1EA}",
        "\u{1F1F3}\u{1F1EB}",
        "\u{1F1F3}\u{1F1EC}",
        "\u{1F1F3}\u{1F1EE}",
        "\u{1F1F3}\u{1F1F1}",
        "\u{1F1F3}\u{1F1F4}",
        "\u{1F1F3}\u{1F1F5}",
        "\u{1F1F3}\u{1F1F7}",
        "\u{1F1F3}\u{1F1FA}",
        "\u{1F1F3}\u{1F1FF}",
        "\u{1F1F3}",
        "\u{1F1F4}\u{1F1F2}",
        "\u{1F1F4}",
        "\u{1F1F5}\u{1F1E6}",
        "\u{1F1F5}\u{1F1EA}",
        "\u{1F1F5}\u{1F1EB}",
        "\u{1F1F5}\u{1F1EC}",
        "\u{1F1F5}\u{1F1ED}",
        "\u{1F1F5}\u{1F1F0}",
        "\u{1F1F5}\u{1F1F1}",
        "\u{1F1F5}\u{1F1F2}",
        "\u{1F1F5}\u{1F1F3}",
        "\u{1F1F5}\u{1F1F7}",
        "\u{1F1F5}\u{1F1F8}",
        "\u{1F1F5}\u{1F1F9}",
        "\u{1F1F5}\u{1F1FC}",
        "\u{1F1F5}\u{1F1FE}",
        "\u{1F1F5}",
        "\u{1F1F6}\u{1F1E6}",
        "\u{1F1F6}",
        "\u{1F1F7}\u{1F1EA}",
        "\u{1F1F7}\u{1F1F4}",
        "\u{1F1F7}\u{1F1F8}",
        "\u{1F1F7}\u{1F1FA}",
        "\u{1F1F7}\u{1F1FC}",
        "\u{1F1F7}",
        "\u{1F1F8}\u{1F1E6}",
        "\u{1F1F8}\u{1F1E7}",
        "\u{1F1F8}\u{1F1E8}",
        "\u{1F1F8}\u{1F1E9}",
        "\u{1F1F8}\u{1F1EA}",
        "\u{1F1F8}\u{1F1EC}",
        "\u{1F1F8}\u{1F1ED}",
        "\u{1F1F8}\u{1F1EE}",
        "\u{1F1F8}\u{1F1EF}",
        "\u{1F1F8}\u{1F1F0}",
        "\u{1F1F8}\u{1F1F1}",
        "\u{1F1F8}\u{1F1F2}",
        "\u{1F1F8}\u{1F1F3}",
        "\u{1F1F8}\u{1F1F4}",
        "\u{1F1F8}\u{1F1F7}",
        "\u{1F1F8}\u{1F1F8}",
        "\u{1F1F8}\u{1F1F9}",
        "\u{1F1F8}\u{1F1FB}",
        "\u{1F1F8}\u{1F1FD}",
        "\u{1F1F8}\u{1F1FE}",
        "\u{1F1F8}\u{1F1FF}",
        "\u{1F1F8}",
        "\u{1F1F9}\u{1F1E6}",
        "\u{1F1F9}\u{1F1E8}",
        "\u{1F1F9}\u{1F1E9}",
        "\u{1F1F9}\u{1F1EB}",
        "\u{1F1F9}\u{1F1EC}",
        "\u{1F1F9}\u{1F1ED}",
        "\u{1F1F9}\u{1F1EF}",
        "\u{1F1F9}\u{1F1F0}",
        "\u{1F1F9}\u{1F1F1}",
        "\u{1F1F9}\u{1F1F2}",
        "\u{1F1F9}\u{1F1F3}",
        "\u{1F1F9}\u{1F1F4}",
        "\u{1F1F9}\u{1F1F7}",
        "\u{1F1F9}\u{1F1F9}",
        "\u{1F1F9}\u{1F1FB}",
        "\u{1F1F9}\u{1F1FC}",
        "\u{1F1F9}\u{1F1FF}",
        "\u{1F1F9}",
        "\u{1F1FA}\u{1F1E6}",
        "\u{1F1FA}\u{1F1EC}",
        "\u{1F1FA}\u{1F1F2}",
        "\u{1F1FA}\u{1F1F3}",
        "\u{1F1FA}\u{1F1F8}",
        "\u{1F1FA}\u{1F1FE}",
        "\u{1F1FA}\u{1F1FF}",
        "\u{1F1FA}",
        "\u{1F1FB}\u{1F1E6}",
        "\u{1F1FB}\u{1F1E8}",
        "\u{1F1FB}\u{1F1EA}",
        "\u{1F1FB}\u{1F1EC}",
        "\u{1F1FB}\u{1F1EE}",
        "\u{1F1FB}\u{1F1F3}",
        "\u{1F1FB}\u{1F1FA}",
        "\u{1F1FB}",
        "\u{1F1FC}\u{1F1EB}",
        "\u{1F1FC}\u{1F1F8}",
        "\u{1F1FC}",
        "\u{1F1FD}\u{1F1F0}",
        "\u{1F1FD}",
        "\u{1F1FE}\u{1F1EA}",
        "\u{1F1FE}\u{1F1F9}",
        "\u{1F1FE}",
        "\u{1F1FF}\u{1F1E6}",
        "\u{1F1FF}\u{1F1F2}",
        "\u{1F1FF}\u{1F1FC}",
        "\u{1F1FF}",
        "\u{1F201}",
        "\u{1F202}\uFE0F",
        "\u{1F21A}\uFE0F",
        "\u{1F22F}\uFE0F",
        "\u{1F232}",
        "\u{1F233}",
        "\u{1F234}",
        "\u{1F235}",
        "\u{1F236}",
        "\u{1F237}\uFE0F",
        "\u{1F238}",
        "\u{1F239}",
        "\u{1F23A}",
        "\u{1F250}",
        "\u{1F251}",
        "\u{1F300}",
        "\u{1F301}",
        "\u{1F302}",
        "\u{1F303}",
        "\u{1F304}",
        "\u{1F305}",
        "\u{1F306}",
        "\u{1F307}",
        "\u{1F308}",
        "\u{1F309}",
        "\u{1F30A}",
        "\u{1F30B}",
        "\u{1F30C}",
        "\u{1F30D}",
        "\u{1F30E}",
        "\u{1F30F}",
        "\u{1F310}",
        "\u{1F311}",
        "\u{1F312}",
        "\u{1F313}",
        "\u{1F314}",
        "\u{1F315}",
        "\u{1F316}",
        "\u{1F317}",
        "\u{1F318}",
        "\u{1F319}",
        "\u{1F31A}",
        "\u{1F31B}",
        "\u{1F31C}",
        "\u{1F31D}",
        "\u{1F31E}",
        "\u{1F31F}",
        "\u{1F320}",
        "\u{1F321}\uFE0F",
        "\u{1F324}\uFE0F",
        "\u{1F325}\uFE0F",
        "\u{1F326}\uFE0F",
        "\u{1F327}\uFE0F",
        "\u{1F328}\uFE0F",
        "\u{1F329}\uFE0F",
        "\u{1F32A}\uFE0F",
        "\u{1F32B}\uFE0F",
        "\u{1F32C}\uFE0F",
        "\u{1F32D}",
        "\u{1F32E}",
        "\u{1F32F}",
        "\u{1F330}",
        "\u{1F331}",
        "\u{1F332}",
        "\u{1F333}",
        "\u{1F334}",
        "\u{1F335}",
        "\u{1F336}\uFE0F",
        "\u{1F337}",
        "\u{1F338}",
        "\u{1F339}",
        "\u{1F33A}",
        "\u{1F33B}",
        "\u{1F33C}",
        "\u{1F33D}",
        "\u{1F33E}",
        "\u{1F33F}",
        "\u{1F340}",
        "\u{1F341}",
        "\u{1F342}",
        "\u{1F343}",
        "\u{1F344}",
        "\u{1F345}",
        "\u{1F346}",
        "\u{1F347}",
        "\u{1F348}",
        "\u{1F349}",
        "\u{1F34A}",
        "\u{1F34B}",
        "\u{1F34C}",
        "\u{1F34D}",
        "\u{1F34E}",
        "\u{1F34F}",
        "\u{1F350}",
        "\u{1F351}",
        "\u{1F352}",
        "\u{1F353}",
        "\u{1F354}",
        "\u{1F355}",
        "\u{1F356}",
        "\u{1F357}",
        "\u{1F358}",
        "\u{1F359}",
        "\u{1F35A}",
        "\u{1F35B}",
        "\u{1F35C}",
        "\u{1F35D}",
        "\u{1F35E}",
        "\u{1F35F}",
        "\u{1F360}",
        "\u{1F361}",
        "\u{1F362}",
        "\u{1F363}",
        "\u{1F364}",
        "\u{1F365}",
        "\u{1F366}",
        "\u{1F367}",
        "\u{1F368}",
        "\u{1F369}",
        "\u{1F36A}",
        "\u{1F36B}",
        "\u{1F36C}",
        "\u{1F36D}",
        "\u{1F36E}",
        "\u{1F36F}",
        "\u{1F370}",
        "\u{1F371}",
        "\u{1F372}",
        "\u{1F373}",
        "\u{1F374}",
        "\u{1F375}",
        "\u{1F376}",
        "\u{1F377}",
        "\u{1F378}",
        "\u{1F379}",
        "\u{1F37A}",
        "\u{1F37B}",
        "\u{1F37C}",
        "\u{1F37D}\uFE0F",
        "\u{1F37E}",
        "\u{1F37F}",
        "\u{1F380}",
        "\u{1F381}",
        "\u{1F382}",
        "\u{1F383}",
        "\u{1F384}",
        "\u{1F385}\u{1F3FB}",
        "\u{1F385}\u{1F3FC}",
        "\u{1F385}\u{1F3FD}",
        "\u{1F385}\u{1F3FE}",
        "\u{1F385}\u{1F3FF}",
        "\u{1F385}",
        "\u{1F386}",
        "\u{1F387}",
        "\u{1F388}",
        "\u{1F389}",
        "\u{1F38A}",
        "\u{1F38B}",
        "\u{1F38C}",
        "\u{1F38D}",
        "\u{1F38E}",
        "\u{1F38F}",
        "\u{1F390}",
        "\u{1F391}",
        "\u{1F392}",
        "\u{1F393}",
        "\u{1F396}\uFE0F",
        "\u{1F397}\uFE0F",
        "\u{1F399}\uFE0F",
        "\u{1F39A}\uFE0F",
        "\u{1F39B}\uFE0F",
        "\u{1F39E}\uFE0F",
        "\u{1F39F}\uFE0F",
        "\u{1F3A0}",
        "\u{1F3A1}",
        "\u{1F3A2}",
        "\u{1F3A3}",
        "\u{1F3A4}",
        "\u{1F3A5}",
        "\u{1F3A6}",
        "\u{1F3A7}",
        "\u{1F3A8}",
        "\u{1F3A9}",
        "\u{1F3AA}",
        "\u{1F3AB}",
        "\u{1F3AC}",
        "\u{1F3AD}",
        "\u{1F3AE}",
        "\u{1F3AF}",
        "\u{1F3B0}",
        "\u{1F3B1}",
        "\u{1F3B2}",
        "\u{1F3B3}",
        "\u{1F3B4}",
        "\u{1F3B5}",
        "\u{1F3B6}",
        "\u{1F3B7}",
        "\u{1F3B8}",
        "\u{1F3B9}",
        "\u{1F3BA}",
        "\u{1F3BB}",
        "\u{1F3BC}",
        "\u{1F3BD}",
        "\u{1F3BE}",
        "\u{1F3BF}",
        "\u{1F3C0}",
        "\u{1F3C1}",
        "\u{1F3C2}\u{1F3FB}",
        "\u{1F3C2}\u{1F3FC}",
        "\u{1F3C2}\u{1F3FD}",
        "\u{1F3C2}\u{1F3FE}",
        "\u{1F3C2}\u{1F3FF}",
        "\u{1F3C2}",
        "\u{1F3C3}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F3C3}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F3C3}\u{1F3FB}",
        "\u{1F3C3}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F3C3}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F3C3}\u{1F3FC}",
        "\u{1F3C3}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F3C3}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F3C3}\u{1F3FD}",
        "\u{1F3C3}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F3C3}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F3C3}\u{1F3FE}",
        "\u{1F3C3}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F3C3}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F3C3}\u{1F3FF}",
        "\u{1F3C3}\u200D\u2640\uFE0F",
        "\u{1F3C3}\u200D\u2642\uFE0F",
        "\u{1F3C3}",
        "\u{1F3C4}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F3C4}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F3C4}\u{1F3FB}",
        "\u{1F3C4}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F3C4}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F3C4}\u{1F3FC}",
        "\u{1F3C4}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F3C4}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F3C4}\u{1F3FD}",
        "\u{1F3C4}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F3C4}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F3C4}\u{1F3FE}",
        "\u{1F3C4}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F3C4}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F3C4}\u{1F3FF}",
        "\u{1F3C4}\u200D\u2640\uFE0F",
        "\u{1F3C4}\u200D\u2642\uFE0F",
        "\u{1F3C4}",
        "\u{1F3C5}",
        "\u{1F3C6}",
        "\u{1F3C7}\u{1F3FB}",
        "\u{1F3C7}\u{1F3FC}",
        "\u{1F3C7}\u{1F3FD}",
        "\u{1F3C7}\u{1F3FE}",
        "\u{1F3C7}\u{1F3FF}",
        "\u{1F3C7}",
        "\u{1F3C8}",
        "\u{1F3C9}",
        "\u{1F3CA}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F3CA}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F3CA}\u{1F3FB}",
        "\u{1F3CA}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F3CA}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F3CA}\u{1F3FC}",
        "\u{1F3CA}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F3CA}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F3CA}\u{1F3FD}",
        "\u{1F3CA}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F3CA}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F3CA}\u{1F3FE}",
        "\u{1F3CA}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F3CA}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F3CA}\u{1F3FF}",
        "\u{1F3CA}\u200D\u2640\uFE0F",
        "\u{1F3CA}\u200D\u2642\uFE0F",
        "\u{1F3CA}",
        "\u{1F3CB}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F3CB}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F3CB}\u{1F3FB}",
        "\u{1F3CB}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F3CB}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F3CB}\u{1F3FC}",
        "\u{1F3CB}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F3CB}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F3CB}\u{1F3FD}",
        "\u{1F3CB}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F3CB}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F3CB}\u{1F3FE}",
        "\u{1F3CB}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F3CB}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F3CB}\u{1F3FF}",
        "\u{1F3CB}\uFE0F\u200D\u2640\uFE0F",
        "\u{1F3CB}\uFE0F\u200D\u2642\uFE0F",
        "\u{1F3CB}\uFE0F",
        "\u{1F3CC}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F3CC}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F3CC}\u{1F3FB}",
        "\u{1F3CC}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F3CC}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F3CC}\u{1F3FC}",
        "\u{1F3CC}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F3CC}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F3CC}\u{1F3FD}",
        "\u{1F3CC}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F3CC}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F3CC}\u{1F3FE}",
        "\u{1F3CC}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F3CC}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F3CC}\u{1F3FF}",
        "\u{1F3CC}\uFE0F\u200D\u2640\uFE0F",
        "\u{1F3CC}\uFE0F\u200D\u2642\uFE0F",
        "\u{1F3CC}\uFE0F",
        "\u{1F3CD}\uFE0F",
        "\u{1F3CE}\uFE0F",
        "\u{1F3CF}",
        "\u{1F3D0}",
        "\u{1F3D1}",
        "\u{1F3D2}",
        "\u{1F3D3}",
        "\u{1F3D4}\uFE0F",
        "\u{1F3D5}\uFE0F",
        "\u{1F3D6}\uFE0F",
        "\u{1F3D7}\uFE0F",
        "\u{1F3D8}\uFE0F",
        "\u{1F3D9}\uFE0F",
        "\u{1F3DA}\uFE0F",
        "\u{1F3DB}\uFE0F",
        "\u{1F3DC}\uFE0F",
        "\u{1F3DD}\uFE0F",
        "\u{1F3DE}\uFE0F",
        "\u{1F3DF}\uFE0F",
        "\u{1F3E0}",
        "\u{1F3E1}",
        "\u{1F3E2}",
        "\u{1F3E3}",
        "\u{1F3E4}",
        "\u{1F3E5}",
        "\u{1F3E6}",
        "\u{1F3E7}",
        "\u{1F3E8}",
        "\u{1F3E9}",
        "\u{1F3EA}",
        "\u{1F3EB}",
        "\u{1F3EC}",
        "\u{1F3ED}",
        "\u{1F3EE}",
        "\u{1F3EF}",
        "\u{1F3F0}",
        "\u{1F3F3}\uFE0F\u200D\u{1F308}",
        "\u{1F3F3}\uFE0F",
        "\u{1F3F4}\u200D\u2620\uFE0F",
        "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
        "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
        "\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}",
        "\u{1F3F4}",
        "\u{1F3F5}\uFE0F",
        "\u{1F3F7}\uFE0F",
        "\u{1F3F8}",
        "\u{1F3F9}",
        "\u{1F3FA}",
        "\u{1F3FB}",
        "\u{1F3FC}",
        "\u{1F3FD}",
        "\u{1F3FE}",
        "\u{1F3FF}",
        "\u{1F400}",
        "\u{1F401}",
        "\u{1F402}",
        "\u{1F403}",
        "\u{1F404}",
        "\u{1F405}",
        "\u{1F406}",
        "\u{1F407}",
        "\u{1F408}",
        "\u{1F409}",
        "\u{1F40A}",
        "\u{1F40B}",
        "\u{1F40C}",
        "\u{1F40D}",
        "\u{1F40E}",
        "\u{1F40F}",
        "\u{1F410}",
        "\u{1F411}",
        "\u{1F412}",
        "\u{1F413}",
        "\u{1F414}",
        "\u{1F415}\u200D\u{1F9BA}",
        "\u{1F415}",
        "\u{1F416}",
        "\u{1F417}",
        "\u{1F418}",
        "\u{1F419}",
        "\u{1F41A}",
        "\u{1F41B}",
        "\u{1F41C}",
        "\u{1F41D}",
        "\u{1F41E}",
        "\u{1F41F}",
        "\u{1F420}",
        "\u{1F421}",
        "\u{1F422}",
        "\u{1F423}",
        "\u{1F424}",
        "\u{1F425}",
        "\u{1F426}",
        "\u{1F427}",
        "\u{1F428}",
        "\u{1F429}",
        "\u{1F42A}",
        "\u{1F42B}",
        "\u{1F42C}",
        "\u{1F42D}",
        "\u{1F42E}",
        "\u{1F42F}",
        "\u{1F430}",
        "\u{1F431}",
        "\u{1F432}",
        "\u{1F433}",
        "\u{1F434}",
        "\u{1F435}",
        "\u{1F436}",
        "\u{1F437}",
        "\u{1F438}",
        "\u{1F439}",
        "\u{1F43A}",
        "\u{1F43B}",
        "\u{1F43C}",
        "\u{1F43D}",
        "\u{1F43E}",
        "\u{1F43F}\uFE0F",
        "\u{1F440}",
        "\u{1F441}\u200D\u{1F5E8}",
        "\u{1F441}\uFE0F",
        "\u{1F442}\u{1F3FB}",
        "\u{1F442}\u{1F3FC}",
        "\u{1F442}\u{1F3FD}",
        "\u{1F442}\u{1F3FE}",
        "\u{1F442}\u{1F3FF}",
        "\u{1F442}",
        "\u{1F443}\u{1F3FB}",
        "\u{1F443}\u{1F3FC}",
        "\u{1F443}\u{1F3FD}",
        "\u{1F443}\u{1F3FE}",
        "\u{1F443}\u{1F3FF}",
        "\u{1F443}",
        "\u{1F444}",
        "\u{1F445}",
        "\u{1F446}\u{1F3FB}",
        "\u{1F446}\u{1F3FC}",
        "\u{1F446}\u{1F3FD}",
        "\u{1F446}\u{1F3FE}",
        "\u{1F446}\u{1F3FF}",
        "\u{1F446}",
        "\u{1F447}\u{1F3FB}",
        "\u{1F447}\u{1F3FC}",
        "\u{1F447}\u{1F3FD}",
        "\u{1F447}\u{1F3FE}",
        "\u{1F447}\u{1F3FF}",
        "\u{1F447}",
        "\u{1F448}\u{1F3FB}",
        "\u{1F448}\u{1F3FC}",
        "\u{1F448}\u{1F3FD}",
        "\u{1F448}\u{1F3FE}",
        "\u{1F448}\u{1F3FF}",
        "\u{1F448}",
        "\u{1F449}\u{1F3FB}",
        "\u{1F449}\u{1F3FC}",
        "\u{1F449}\u{1F3FD}",
        "\u{1F449}\u{1F3FE}",
        "\u{1F449}\u{1F3FF}",
        "\u{1F449}",
        "\u{1F44A}\u{1F3FB}",
        "\u{1F44A}\u{1F3FC}",
        "\u{1F44A}\u{1F3FD}",
        "\u{1F44A}\u{1F3FE}",
        "\u{1F44A}\u{1F3FF}",
        "\u{1F44A}",
        "\u{1F44B}\u{1F3FB}",
        "\u{1F44B}\u{1F3FC}",
        "\u{1F44B}\u{1F3FD}",
        "\u{1F44B}\u{1F3FE}",
        "\u{1F44B}\u{1F3FF}",
        "\u{1F44B}",
        "\u{1F44C}\u{1F3FB}",
        "\u{1F44C}\u{1F3FC}",
        "\u{1F44C}\u{1F3FD}",
        "\u{1F44C}\u{1F3FE}",
        "\u{1F44C}\u{1F3FF}",
        "\u{1F44C}",
        "\u{1F44D}\u{1F3FB}",
        "\u{1F44D}\u{1F3FC}",
        "\u{1F44D}\u{1F3FD}",
        "\u{1F44D}\u{1F3FE}",
        "\u{1F44D}\u{1F3FF}",
        "\u{1F44D}",
        "\u{1F44E}\u{1F3FB}",
        "\u{1F44E}\u{1F3FC}",
        "\u{1F44E}\u{1F3FD}",
        "\u{1F44E}\u{1F3FE}",
        "\u{1F44E}\u{1F3FF}",
        "\u{1F44E}",
        "\u{1F44F}\u{1F3FB}",
        "\u{1F44F}\u{1F3FC}",
        "\u{1F44F}\u{1F3FD}",
        "\u{1F44F}\u{1F3FE}",
        "\u{1F44F}\u{1F3FF}",
        "\u{1F44F}",
        "\u{1F450}\u{1F3FB}",
        "\u{1F450}\u{1F3FC}",
        "\u{1F450}\u{1F3FD}",
        "\u{1F450}\u{1F3FE}",
        "\u{1F450}\u{1F3FF}",
        "\u{1F450}",
        "\u{1F451}",
        "\u{1F452}",
        "\u{1F453}",
        "\u{1F454}",
        "\u{1F455}",
        "\u{1F456}",
        "\u{1F457}",
        "\u{1F458}",
        "\u{1F459}",
        "\u{1F45A}",
        "\u{1F45B}",
        "\u{1F45C}",
        "\u{1F45D}",
        "\u{1F45E}",
        "\u{1F45F}",
        "\u{1F460}",
        "\u{1F461}",
        "\u{1F462}",
        "\u{1F463}",
        "\u{1F464}",
        "\u{1F465}",
        "\u{1F466}\u{1F3FB}",
        "\u{1F466}\u{1F3FC}",
        "\u{1F466}\u{1F3FD}",
        "\u{1F466}\u{1F3FE}",
        "\u{1F466}\u{1F3FF}",
        "\u{1F466}",
        "\u{1F467}\u{1F3FB}",
        "\u{1F467}\u{1F3FC}",
        "\u{1F467}\u{1F3FD}",
        "\u{1F467}\u{1F3FE}",
        "\u{1F467}\u{1F3FF}",
        "\u{1F467}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F33E}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F373}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F393}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F3A4}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F3A8}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F3EB}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F3ED}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F4BB}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F4BC}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F527}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F52C}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F680}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F692}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F9AF}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F9B0}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F9B1}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F9B2}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F9B3}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F9BC}",
        "\u{1F468}\u{1F3FB}\u200D\u{1F9BD}",
        "\u{1F468}\u{1F3FB}\u200D\u2695\uFE0F",
        "\u{1F468}\u{1F3FB}\u200D\u2696\uFE0F",
        "\u{1F468}\u{1F3FB}\u200D\u2708\uFE0F",
        "\u{1F468}\u{1F3FB}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F33E}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F373}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F393}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F3A4}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F3A8}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F3EB}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F3ED}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F4BB}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F4BC}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F527}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F52C}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F680}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F692}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FB}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F9AF}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F9B0}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F9B1}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F9B2}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F9B3}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F9BC}",
        "\u{1F468}\u{1F3FC}\u200D\u{1F9BD}",
        "\u{1F468}\u{1F3FC}\u200D\u2695\uFE0F",
        "\u{1F468}\u{1F3FC}\u200D\u2696\uFE0F",
        "\u{1F468}\u{1F3FC}\u200D\u2708\uFE0F",
        "\u{1F468}\u{1F3FC}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F33E}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F373}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F393}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F3A4}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F3A8}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F3EB}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F3ED}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F4BB}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F4BC}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F527}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F52C}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F680}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F692}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FB}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FC}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F9AF}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F9B0}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F9B1}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F9B2}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F9B3}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F9BC}",
        "\u{1F468}\u{1F3FD}\u200D\u{1F9BD}",
        "\u{1F468}\u{1F3FD}\u200D\u2695\uFE0F",
        "\u{1F468}\u{1F3FD}\u200D\u2696\uFE0F",
        "\u{1F468}\u{1F3FD}\u200D\u2708\uFE0F",
        "\u{1F468}\u{1F3FD}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F33E}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F373}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F393}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F3A4}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F3A8}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F3EB}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F3ED}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F4BB}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F4BC}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F527}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F52C}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F680}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F692}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FB}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FC}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FD}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F9AF}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F9B0}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F9B1}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F9B2}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F9B3}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F9BC}",
        "\u{1F468}\u{1F3FE}\u200D\u{1F9BD}",
        "\u{1F468}\u{1F3FE}\u200D\u2695\uFE0F",
        "\u{1F468}\u{1F3FE}\u200D\u2696\uFE0F",
        "\u{1F468}\u{1F3FE}\u200D\u2708\uFE0F",
        "\u{1F468}\u{1F3FE}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F33E}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F373}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F393}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F3A4}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F3A8}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F3EB}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F3ED}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F4BB}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F4BC}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F527}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F52C}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F680}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F692}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FB}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FC}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FD}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FE}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F9AF}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F9B0}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F9B1}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F9B2}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F9B3}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F9BC}",
        "\u{1F468}\u{1F3FF}\u200D\u{1F9BD}",
        "\u{1F468}\u{1F3FF}\u200D\u2695\uFE0F",
        "\u{1F468}\u{1F3FF}\u200D\u2696\uFE0F",
        "\u{1F468}\u{1F3FF}\u200D\u2708\uFE0F",
        "\u{1F468}\u{1F3FF}",
        "\u{1F468}\u200D\u{1F33E}",
        "\u{1F468}\u200D\u{1F373}",
        "\u{1F468}\u200D\u{1F393}",
        "\u{1F468}\u200D\u{1F3A4}",
        "\u{1F468}\u200D\u{1F3A8}",
        "\u{1F468}\u200D\u{1F3EB}",
        "\u{1F468}\u200D\u{1F3ED}",
        "\u{1F468}\u200D\u{1F466}\u200D\u{1F466}",
        "\u{1F468}\u200D\u{1F466}",
        "\u{1F468}\u200D\u{1F467}\u200D\u{1F466}",
        "\u{1F468}\u200D\u{1F467}\u200D\u{1F467}",
        "\u{1F468}\u200D\u{1F467}",
        "\u{1F468}\u200D\u{1F468}\u200D\u{1F466}\u200D\u{1F466}",
        "\u{1F468}\u200D\u{1F468}\u200D\u{1F466}",
        "\u{1F468}\u200D\u{1F468}\u200D\u{1F467}\u200D\u{1F466}",
        "\u{1F468}\u200D\u{1F468}\u200D\u{1F467}\u200D\u{1F467}",
        "\u{1F468}\u200D\u{1F468}\u200D\u{1F467}",
        "\u{1F468}\u200D\u{1F469}\u200D\u{1F466}\u200D\u{1F466}",
        "\u{1F468}\u200D\u{1F469}\u200D\u{1F466}",
        "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}",
        "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F467}",
        "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}",
        "\u{1F468}\u200D\u{1F4BB}",
        "\u{1F468}\u200D\u{1F4BC}",
        "\u{1F468}\u200D\u{1F527}",
        "\u{1F468}\u200D\u{1F52C}",
        "\u{1F468}\u200D\u{1F680}",
        "\u{1F468}\u200D\u{1F692}",
        "\u{1F468}\u200D\u{1F9AF}",
        "\u{1F468}\u200D\u{1F9B0}",
        "\u{1F468}\u200D\u{1F9B1}",
        "\u{1F468}\u200D\u{1F9B2}",
        "\u{1F468}\u200D\u{1F9B3}",
        "\u{1F468}\u200D\u{1F9BC}",
        "\u{1F468}\u200D\u{1F9BD}",
        "\u{1F468}\u200D\u2695\uFE0F",
        "\u{1F468}\u200D\u2696\uFE0F",
        "\u{1F468}\u200D\u2708\uFE0F",
        "\u{1F468}\u200D\u2764\uFE0F\u200D\u{1F468}",
        "\u{1F468}\u200D\u2764\uFE0F\u200D\u{1F48B}\u200D\u{1F468}",
        "\u{1F468}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F33E}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F373}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F393}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F3A4}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F3A8}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F3EB}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F3ED}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F4BB}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F4BC}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F527}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F52C}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F680}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F692}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FC}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FD}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FE}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FF}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F9AF}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F9B0}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F9B1}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F9B2}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F9B3}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F9BC}",
        "\u{1F469}\u{1F3FB}\u200D\u{1F9BD}",
        "\u{1F469}\u{1F3FB}\u200D\u2695\uFE0F",
        "\u{1F469}\u{1F3FB}\u200D\u2696\uFE0F",
        "\u{1F469}\u{1F3FB}\u200D\u2708\uFE0F",
        "\u{1F469}\u{1F3FB}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F33E}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F373}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F393}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F3A4}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F3A8}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F3EB}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F3ED}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F4BB}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F4BC}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F527}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F52C}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F680}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F692}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FB}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FD}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FE}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FF}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F91D}\u200D\u{1F469}\u{1F3FB}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F9AF}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F9B0}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F9B1}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F9B2}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F9B3}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F9BC}",
        "\u{1F469}\u{1F3FC}\u200D\u{1F9BD}",
        "\u{1F469}\u{1F3FC}\u200D\u2695\uFE0F",
        "\u{1F469}\u{1F3FC}\u200D\u2696\uFE0F",
        "\u{1F469}\u{1F3FC}\u200D\u2708\uFE0F",
        "\u{1F469}\u{1F3FC}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F33E}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F373}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F393}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F3A4}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F3A8}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F3EB}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F3ED}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F4BB}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F4BC}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F527}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F52C}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F680}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F692}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FB}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FC}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FE}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FF}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F91D}\u200D\u{1F469}\u{1F3FB}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F91D}\u200D\u{1F469}\u{1F3FC}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F9AF}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F9B0}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F9B1}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F9B2}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F9B3}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F9BC}",
        "\u{1F469}\u{1F3FD}\u200D\u{1F9BD}",
        "\u{1F469}\u{1F3FD}\u200D\u2695\uFE0F",
        "\u{1F469}\u{1F3FD}\u200D\u2696\uFE0F",
        "\u{1F469}\u{1F3FD}\u200D\u2708\uFE0F",
        "\u{1F469}\u{1F3FD}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F33E}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F373}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F393}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F3A4}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F3A8}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F3EB}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F3ED}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F4BB}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F4BC}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F527}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F52C}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F680}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F692}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FB}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FC}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FD}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FF}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F91D}\u200D\u{1F469}\u{1F3FB}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F91D}\u200D\u{1F469}\u{1F3FC}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F91D}\u200D\u{1F469}\u{1F3FD}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F9AF}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F9B0}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F9B1}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F9B2}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F9B3}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F9BC}",
        "\u{1F469}\u{1F3FE}\u200D\u{1F9BD}",
        "\u{1F469}\u{1F3FE}\u200D\u2695\uFE0F",
        "\u{1F469}\u{1F3FE}\u200D\u2696\uFE0F",
        "\u{1F469}\u{1F3FE}\u200D\u2708\uFE0F",
        "\u{1F469}\u{1F3FE}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F33E}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F373}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F393}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F3A4}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F3A8}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F3EB}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F3ED}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F4BB}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F4BC}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F527}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F52C}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F680}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F692}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FB}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FC}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FD}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FE}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F91D}\u200D\u{1F469}\u{1F3FB}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F91D}\u200D\u{1F469}\u{1F3FC}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F91D}\u200D\u{1F469}\u{1F3FD}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F91D}\u200D\u{1F469}\u{1F3FE}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F9AF}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F9B0}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F9B1}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F9B2}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F9B3}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F9BC}",
        "\u{1F469}\u{1F3FF}\u200D\u{1F9BD}",
        "\u{1F469}\u{1F3FF}\u200D\u2695\uFE0F",
        "\u{1F469}\u{1F3FF}\u200D\u2696\uFE0F",
        "\u{1F469}\u{1F3FF}\u200D\u2708\uFE0F",
        "\u{1F469}\u{1F3FF}",
        "\u{1F469}\u200D\u{1F33E}",
        "\u{1F469}\u200D\u{1F373}",
        "\u{1F469}\u200D\u{1F393}",
        "\u{1F469}\u200D\u{1F3A4}",
        "\u{1F469}\u200D\u{1F3A8}",
        "\u{1F469}\u200D\u{1F3EB}",
        "\u{1F469}\u200D\u{1F3ED}",
        "\u{1F469}\u200D\u{1F466}\u200D\u{1F466}",
        "\u{1F469}\u200D\u{1F466}",
        "\u{1F469}\u200D\u{1F467}\u200D\u{1F466}",
        "\u{1F469}\u200D\u{1F467}\u200D\u{1F467}",
        "\u{1F469}\u200D\u{1F467}",
        "\u{1F469}\u200D\u{1F469}\u200D\u{1F466}\u200D\u{1F466}",
        "\u{1F469}\u200D\u{1F469}\u200D\u{1F466}",
        "\u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}",
        "\u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F467}",
        "\u{1F469}\u200D\u{1F469}\u200D\u{1F467}",
        "\u{1F469}\u200D\u{1F4BB}",
        "\u{1F469}\u200D\u{1F4BC}",
        "\u{1F469}\u200D\u{1F527}",
        "\u{1F469}\u200D\u{1F52C}",
        "\u{1F469}\u200D\u{1F680}",
        "\u{1F469}\u200D\u{1F692}",
        "\u{1F469}\u200D\u{1F9AF}",
        "\u{1F469}\u200D\u{1F9B0}",
        "\u{1F469}\u200D\u{1F9B1}",
        "\u{1F469}\u200D\u{1F9B2}",
        "\u{1F469}\u200D\u{1F9B3}",
        "\u{1F469}\u200D\u{1F9BC}",
        "\u{1F469}\u200D\u{1F9BD}",
        "\u{1F469}\u200D\u2695\uFE0F",
        "\u{1F469}\u200D\u2696\uFE0F",
        "\u{1F469}\u200D\u2708\uFE0F",
        "\u{1F469}\u200D\u2764\uFE0F\u200D\u{1F468}",
        "\u{1F469}\u200D\u2764\uFE0F\u200D\u{1F469}",
        "\u{1F469}\u200D\u2764\uFE0F\u200D\u{1F48B}\u200D\u{1F468}",
        "\u{1F469}\u200D\u2764\uFE0F\u200D\u{1F48B}\u200D\u{1F469}",
        "\u{1F469}",
        "\u{1F46A}",
        "\u{1F46B}\u{1F3FB}",
        "\u{1F46B}\u{1F3FC}",
        "\u{1F46B}\u{1F3FD}",
        "\u{1F46B}\u{1F3FE}",
        "\u{1F46B}\u{1F3FF}",
        "\u{1F46B}",
        "\u{1F46C}\u{1F3FB}",
        "\u{1F46C}\u{1F3FC}",
        "\u{1F46C}\u{1F3FD}",
        "\u{1F46C}\u{1F3FE}",
        "\u{1F46C}\u{1F3FF}",
        "\u{1F46C}",
        "\u{1F46D}\u{1F3FB}",
        "\u{1F46D}\u{1F3FC}",
        "\u{1F46D}\u{1F3FD}",
        "\u{1F46D}\u{1F3FE}",
        "\u{1F46D}\u{1F3FF}",
        "\u{1F46D}",
        "\u{1F46E}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F46E}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F46E}\u{1F3FB}",
        "\u{1F46E}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F46E}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F46E}\u{1F3FC}",
        "\u{1F46E}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F46E}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F46E}\u{1F3FD}",
        "\u{1F46E}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F46E}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F46E}\u{1F3FE}",
        "\u{1F46E}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F46E}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F46E}\u{1F3FF}",
        "\u{1F46E}\u200D\u2640\uFE0F",
        "\u{1F46E}\u200D\u2642\uFE0F",
        "\u{1F46E}",
        "\u{1F46F}\u200D\u2640\uFE0F",
        "\u{1F46F}\u200D\u2642\uFE0F",
        "\u{1F46F}",
        "\u{1F470}\u{1F3FB}",
        "\u{1F470}\u{1F3FC}",
        "\u{1F470}\u{1F3FD}",
        "\u{1F470}\u{1F3FE}",
        "\u{1F470}\u{1F3FF}",
        "\u{1F470}",
        "\u{1F471}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F471}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F471}\u{1F3FB}",
        "\u{1F471}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F471}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F471}\u{1F3FC}",
        "\u{1F471}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F471}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F471}\u{1F3FD}",
        "\u{1F471}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F471}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F471}\u{1F3FE}",
        "\u{1F471}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F471}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F471}\u{1F3FF}",
        "\u{1F471}\u200D\u2640\uFE0F",
        "\u{1F471}\u200D\u2642\uFE0F",
        "\u{1F471}",
        "\u{1F472}\u{1F3FB}",
        "\u{1F472}\u{1F3FC}",
        "\u{1F472}\u{1F3FD}",
        "\u{1F472}\u{1F3FE}",
        "\u{1F472}\u{1F3FF}",
        "\u{1F472}",
        "\u{1F473}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F473}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F473}\u{1F3FB}",
        "\u{1F473}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F473}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F473}\u{1F3FC}",
        "\u{1F473}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F473}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F473}\u{1F3FD}",
        "\u{1F473}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F473}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F473}\u{1F3FE}",
        "\u{1F473}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F473}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F473}\u{1F3FF}",
        "\u{1F473}\u200D\u2640\uFE0F",
        "\u{1F473}\u200D\u2642\uFE0F",
        "\u{1F473}",
        "\u{1F474}\u{1F3FB}",
        "\u{1F474}\u{1F3FC}",
        "\u{1F474}\u{1F3FD}",
        "\u{1F474}\u{1F3FE}",
        "\u{1F474}\u{1F3FF}",
        "\u{1F474}",
        "\u{1F475}\u{1F3FB}",
        "\u{1F475}\u{1F3FC}",
        "\u{1F475}\u{1F3FD}",
        "\u{1F475}\u{1F3FE}",
        "\u{1F475}\u{1F3FF}",
        "\u{1F475}",
        "\u{1F476}\u{1F3FB}",
        "\u{1F476}\u{1F3FC}",
        "\u{1F476}\u{1F3FD}",
        "\u{1F476}\u{1F3FE}",
        "\u{1F476}\u{1F3FF}",
        "\u{1F476}",
        "\u{1F477}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F477}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F477}\u{1F3FB}",
        "\u{1F477}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F477}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F477}\u{1F3FC}",
        "\u{1F477}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F477}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F477}\u{1F3FD}",
        "\u{1F477}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F477}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F477}\u{1F3FE}",
        "\u{1F477}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F477}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F477}\u{1F3FF}",
        "\u{1F477}\u200D\u2640\uFE0F",
        "\u{1F477}\u200D\u2642\uFE0F",
        "\u{1F477}",
        "\u{1F478}\u{1F3FB}",
        "\u{1F478}\u{1F3FC}",
        "\u{1F478}\u{1F3FD}",
        "\u{1F478}\u{1F3FE}",
        "\u{1F478}\u{1F3FF}",
        "\u{1F478}",
        "\u{1F479}",
        "\u{1F47A}",
        "\u{1F47B}",
        "\u{1F47C}\u{1F3FB}",
        "\u{1F47C}\u{1F3FC}",
        "\u{1F47C}\u{1F3FD}",
        "\u{1F47C}\u{1F3FE}",
        "\u{1F47C}\u{1F3FF}",
        "\u{1F47C}",
        "\u{1F47D}",
        "\u{1F47E}",
        "\u{1F47F}",
        "\u{1F480}",
        "\u{1F481}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F481}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F481}\u{1F3FB}",
        "\u{1F481}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F481}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F481}\u{1F3FC}",
        "\u{1F481}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F481}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F481}\u{1F3FD}",
        "\u{1F481}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F481}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F481}\u{1F3FE}",
        "\u{1F481}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F481}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F481}\u{1F3FF}",
        "\u{1F481}\u200D\u2640\uFE0F",
        "\u{1F481}\u200D\u2642\uFE0F",
        "\u{1F481}",
        "\u{1F482}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F482}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F482}\u{1F3FB}",
        "\u{1F482}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F482}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F482}\u{1F3FC}",
        "\u{1F482}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F482}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F482}\u{1F3FD}",
        "\u{1F482}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F482}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F482}\u{1F3FE}",
        "\u{1F482}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F482}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F482}\u{1F3FF}",
        "\u{1F482}\u200D\u2640\uFE0F",
        "\u{1F482}\u200D\u2642\uFE0F",
        "\u{1F482}",
        "\u{1F483}\u{1F3FB}",
        "\u{1F483}\u{1F3FC}",
        "\u{1F483}\u{1F3FD}",
        "\u{1F483}\u{1F3FE}",
        "\u{1F483}\u{1F3FF}",
        "\u{1F483}",
        "\u{1F484}",
        "\u{1F485}\u{1F3FB}",
        "\u{1F485}\u{1F3FC}",
        "\u{1F485}\u{1F3FD}",
        "\u{1F485}\u{1F3FE}",
        "\u{1F485}\u{1F3FF}",
        "\u{1F485}",
        "\u{1F486}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F486}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F486}\u{1F3FB}",
        "\u{1F486}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F486}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F486}\u{1F3FC}",
        "\u{1F486}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F486}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F486}\u{1F3FD}",
        "\u{1F486}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F486}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F486}\u{1F3FE}",
        "\u{1F486}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F486}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F486}\u{1F3FF}",
        "\u{1F486}\u200D\u2640\uFE0F",
        "\u{1F486}\u200D\u2642\uFE0F",
        "\u{1F486}",
        "\u{1F487}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F487}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F487}\u{1F3FB}",
        "\u{1F487}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F487}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F487}\u{1F3FC}",
        "\u{1F487}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F487}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F487}\u{1F3FD}",
        "\u{1F487}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F487}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F487}\u{1F3FE}",
        "\u{1F487}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F487}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F487}\u{1F3FF}",
        "\u{1F487}\u200D\u2640\uFE0F",
        "\u{1F487}\u200D\u2642\uFE0F",
        "\u{1F487}",
        "\u{1F488}",
        "\u{1F489}",
        "\u{1F48A}",
        "\u{1F48B}",
        "\u{1F48C}",
        "\u{1F48D}",
        "\u{1F48E}",
        "\u{1F48F}",
        "\u{1F490}",
        "\u{1F491}",
        "\u{1F492}",
        "\u{1F493}",
        "\u{1F494}",
        "\u{1F495}",
        "\u{1F496}",
        "\u{1F497}",
        "\u{1F498}",
        "\u{1F499}",
        "\u{1F49A}",
        "\u{1F49B}",
        "\u{1F49C}",
        "\u{1F49D}",
        "\u{1F49E}",
        "\u{1F49F}",
        "\u{1F4A0}",
        "\u{1F4A1}",
        "\u{1F4A2}",
        "\u{1F4A3}",
        "\u{1F4A4}",
        "\u{1F4A5}",
        "\u{1F4A6}",
        "\u{1F4A7}",
        "\u{1F4A8}",
        "\u{1F4A9}",
        "\u{1F4AA}\u{1F3FB}",
        "\u{1F4AA}\u{1F3FC}",
        "\u{1F4AA}\u{1F3FD}",
        "\u{1F4AA}\u{1F3FE}",
        "\u{1F4AA}\u{1F3FF}",
        "\u{1F4AA}",
        "\u{1F4AB}",
        "\u{1F4AC}",
        "\u{1F4AD}",
        "\u{1F4AE}",
        "\u{1F4AF}",
        "\u{1F4B0}",
        "\u{1F4B1}",
        "\u{1F4B2}",
        "\u{1F4B3}",
        "\u{1F4B4}",
        "\u{1F4B5}",
        "\u{1F4B6}",
        "\u{1F4B7}",
        "\u{1F4B8}",
        "\u{1F4B9}",
        "\u{1F4BA}",
        "\u{1F4BB}",
        "\u{1F4BC}",
        "\u{1F4BD}",
        "\u{1F4BE}",
        "\u{1F4BF}",
        "\u{1F4C0}",
        "\u{1F4C1}",
        "\u{1F4C2}",
        "\u{1F4C3}",
        "\u{1F4C4}",
        "\u{1F4C5}",
        "\u{1F4C6}",
        "\u{1F4C7}",
        "\u{1F4C8}",
        "\u{1F4C9}",
        "\u{1F4CA}",
        "\u{1F4CB}",
        "\u{1F4CC}",
        "\u{1F4CD}",
        "\u{1F4CE}",
        "\u{1F4CF}",
        "\u{1F4D0}",
        "\u{1F4D1}",
        "\u{1F4D2}",
        "\u{1F4D3}",
        "\u{1F4D4}",
        "\u{1F4D5}",
        "\u{1F4D6}",
        "\u{1F4D7}",
        "\u{1F4D8}",
        "\u{1F4D9}",
        "\u{1F4DA}",
        "\u{1F4DB}",
        "\u{1F4DC}",
        "\u{1F4DD}",
        "\u{1F4DE}",
        "\u{1F4DF}",
        "\u{1F4E0}",
        "\u{1F4E1}",
        "\u{1F4E2}",
        "\u{1F4E3}",
        "\u{1F4E4}",
        "\u{1F4E5}",
        "\u{1F4E6}",
        "\u{1F4E7}",
        "\u{1F4E8}",
        "\u{1F4E9}",
        "\u{1F4EA}",
        "\u{1F4EB}",
        "\u{1F4EC}",
        "\u{1F4ED}",
        "\u{1F4EE}",
        "\u{1F4EF}",
        "\u{1F4F0}",
        "\u{1F4F1}",
        "\u{1F4F2}",
        "\u{1F4F3}",
        "\u{1F4F4}",
        "\u{1F4F5}",
        "\u{1F4F6}",
        "\u{1F4F7}",
        "\u{1F4F8}",
        "\u{1F4F9}",
        "\u{1F4FA}",
        "\u{1F4FB}",
        "\u{1F4FC}",
        "\u{1F4FD}\uFE0F",
        "\u{1F4FF}",
        "\u{1F500}",
        "\u{1F501}",
        "\u{1F502}",
        "\u{1F503}",
        "\u{1F504}",
        "\u{1F505}",
        "\u{1F506}",
        "\u{1F507}",
        "\u{1F508}",
        "\u{1F509}",
        "\u{1F50A}",
        "\u{1F50B}",
        "\u{1F50C}",
        "\u{1F50D}",
        "\u{1F50E}",
        "\u{1F50F}",
        "\u{1F510}",
        "\u{1F511}",
        "\u{1F512}",
        "\u{1F513}",
        "\u{1F514}",
        "\u{1F515}",
        "\u{1F516}",
        "\u{1F517}",
        "\u{1F518}",
        "\u{1F519}",
        "\u{1F51A}",
        "\u{1F51B}",
        "\u{1F51C}",
        "\u{1F51D}",
        "\u{1F51E}",
        "\u{1F51F}",
        "\u{1F520}",
        "\u{1F521}",
        "\u{1F522}",
        "\u{1F523}",
        "\u{1F524}",
        "\u{1F525}",
        "\u{1F526}",
        "\u{1F527}",
        "\u{1F528}",
        "\u{1F529}",
        "\u{1F52A}",
        "\u{1F52B}",
        "\u{1F52C}",
        "\u{1F52D}",
        "\u{1F52E}",
        "\u{1F52F}",
        "\u{1F530}",
        "\u{1F531}",
        "\u{1F532}",
        "\u{1F533}",
        "\u{1F534}",
        "\u{1F535}",
        "\u{1F536}",
        "\u{1F537}",
        "\u{1F538}",
        "\u{1F539}",
        "\u{1F53A}",
        "\u{1F53B}",
        "\u{1F53C}",
        "\u{1F53D}",
        "\u{1F549}\uFE0F",
        "\u{1F54A}\uFE0F",
        "\u{1F54B}",
        "\u{1F54C}",
        "\u{1F54D}",
        "\u{1F54E}",
        "\u{1F550}",
        "\u{1F551}",
        "\u{1F552}",
        "\u{1F553}",
        "\u{1F554}",
        "\u{1F555}",
        "\u{1F556}",
        "\u{1F557}",
        "\u{1F558}",
        "\u{1F559}",
        "\u{1F55A}",
        "\u{1F55B}",
        "\u{1F55C}",
        "\u{1F55D}",
        "\u{1F55E}",
        "\u{1F55F}",
        "\u{1F560}",
        "\u{1F561}",
        "\u{1F562}",
        "\u{1F563}",
        "\u{1F564}",
        "\u{1F565}",
        "\u{1F566}",
        "\u{1F567}",
        "\u{1F56F}\uFE0F",
        "\u{1F570}\uFE0F",
        "\u{1F573}\uFE0F",
        "\u{1F574}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F574}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F574}\u{1F3FB}",
        "\u{1F574}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F574}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F574}\u{1F3FC}",
        "\u{1F574}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F574}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F574}\u{1F3FD}",
        "\u{1F574}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F574}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F574}\u{1F3FE}",
        "\u{1F574}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F574}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F574}\u{1F3FF}",
        "\u{1F574}\uFE0F\u200D\u2640\uFE0F",
        "\u{1F574}\uFE0F\u200D\u2642\uFE0F",
        "\u{1F574}\uFE0F",
        "\u{1F575}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F575}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F575}\u{1F3FB}",
        "\u{1F575}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F575}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F575}\u{1F3FC}",
        "\u{1F575}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F575}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F575}\u{1F3FD}",
        "\u{1F575}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F575}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F575}\u{1F3FE}",
        "\u{1F575}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F575}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F575}\u{1F3FF}",
        "\u{1F575}\uFE0F\u200D\u2640\uFE0F",
        "\u{1F575}\uFE0F\u200D\u2642\uFE0F",
        "\u{1F575}\uFE0F",
        "\u{1F576}\uFE0F",
        "\u{1F577}\uFE0F",
        "\u{1F578}\uFE0F",
        "\u{1F579}\uFE0F",
        "\u{1F57A}\u{1F3FB}",
        "\u{1F57A}\u{1F3FC}",
        "\u{1F57A}\u{1F3FD}",
        "\u{1F57A}\u{1F3FE}",
        "\u{1F57A}\u{1F3FF}",
        "\u{1F57A}",
        "\u{1F587}\uFE0F",
        "\u{1F58A}\uFE0F",
        "\u{1F58B}\uFE0F",
        "\u{1F58C}\uFE0F",
        "\u{1F58D}\uFE0F",
        "\u{1F590}\u{1F3FB}",
        "\u{1F590}\u{1F3FC}",
        "\u{1F590}\u{1F3FD}",
        "\u{1F590}\u{1F3FE}",
        "\u{1F590}\u{1F3FF}",
        "\u{1F590}\uFE0F",
        "\u{1F595}\u{1F3FB}",
        "\u{1F595}\u{1F3FC}",
        "\u{1F595}\u{1F3FD}",
        "\u{1F595}\u{1F3FE}",
        "\u{1F595}\u{1F3FF}",
        "\u{1F595}",
        "\u{1F596}\u{1F3FB}",
        "\u{1F596}\u{1F3FC}",
        "\u{1F596}\u{1F3FD}",
        "\u{1F596}\u{1F3FE}",
        "\u{1F596}\u{1F3FF}",
        "\u{1F596}",
        "\u{1F5A4}",
        "\u{1F5A5}\uFE0F",
        "\u{1F5A8}\uFE0F",
        "\u{1F5B1}\uFE0F",
        "\u{1F5B2}\uFE0F",
        "\u{1F5BC}\uFE0F",
        "\u{1F5C2}\uFE0F",
        "\u{1F5C3}\uFE0F",
        "\u{1F5C4}\uFE0F",
        "\u{1F5D1}\uFE0F",
        "\u{1F5D2}\uFE0F",
        "\u{1F5D3}\uFE0F",
        "\u{1F5DC}\uFE0F",
        "\u{1F5DD}\uFE0F",
        "\u{1F5DE}\uFE0F",
        "\u{1F5E1}\uFE0F",
        "\u{1F5E3}\uFE0F",
        "\u{1F5E8}\uFE0F",
        "\u{1F5EF}\uFE0F",
        "\u{1F5F3}\uFE0F",
        "\u{1F5FA}\uFE0F",
        "\u{1F5FB}",
        "\u{1F5FC}",
        "\u{1F5FD}",
        "\u{1F5FE}",
        "\u{1F5FF}",
        "\u{1F600}",
        "\u{1F601}",
        "\u{1F602}",
        "\u{1F603}",
        "\u{1F604}",
        "\u{1F605}",
        "\u{1F606}",
        "\u{1F607}",
        "\u{1F608}",
        "\u{1F609}",
        "\u{1F60A}",
        "\u{1F60B}",
        "\u{1F60C}",
        "\u{1F60D}",
        "\u{1F60E}",
        "\u{1F60F}",
        "\u{1F610}",
        "\u{1F611}",
        "\u{1F612}",
        "\u{1F613}",
        "\u{1F614}",
        "\u{1F615}",
        "\u{1F616}",
        "\u{1F617}",
        "\u{1F618}",
        "\u{1F619}",
        "\u{1F61A}",
        "\u{1F61B}",
        "\u{1F61C}",
        "\u{1F61D}",
        "\u{1F61E}",
        "\u{1F61F}",
        "\u{1F620}",
        "\u{1F621}",
        "\u{1F622}",
        "\u{1F623}",
        "\u{1F624}",
        "\u{1F625}",
        "\u{1F626}",
        "\u{1F627}",
        "\u{1F628}",
        "\u{1F629}",
        "\u{1F62A}",
        "\u{1F62B}",
        "\u{1F62C}",
        "\u{1F62D}",
        "\u{1F62E}",
        "\u{1F62F}",
        "\u{1F630}",
        "\u{1F631}",
        "\u{1F632}",
        "\u{1F633}",
        "\u{1F634}",
        "\u{1F635}",
        "\u{1F636}",
        "\u{1F637}",
        "\u{1F638}",
        "\u{1F639}",
        "\u{1F63A}",
        "\u{1F63B}",
        "\u{1F63C}",
        "\u{1F63D}",
        "\u{1F63E}",
        "\u{1F63F}",
        "\u{1F640}",
        "\u{1F641}",
        "\u{1F642}",
        "\u{1F643}",
        "\u{1F644}",
        "\u{1F645}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F645}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F645}\u{1F3FB}",
        "\u{1F645}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F645}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F645}\u{1F3FC}",
        "\u{1F645}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F645}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F645}\u{1F3FD}",
        "\u{1F645}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F645}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F645}\u{1F3FE}",
        "\u{1F645}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F645}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F645}\u{1F3FF}",
        "\u{1F645}\u200D\u2640\uFE0F",
        "\u{1F645}\u200D\u2642\uFE0F",
        "\u{1F645}",
        "\u{1F646}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F646}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F646}\u{1F3FB}",
        "\u{1F646}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F646}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F646}\u{1F3FC}",
        "\u{1F646}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F646}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F646}\u{1F3FD}",
        "\u{1F646}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F646}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F646}\u{1F3FE}",
        "\u{1F646}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F646}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F646}\u{1F3FF}",
        "\u{1F646}\u200D\u2640\uFE0F",
        "\u{1F646}\u200D\u2642\uFE0F",
        "\u{1F646}",
        "\u{1F647}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F647}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F647}\u{1F3FB}",
        "\u{1F647}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F647}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F647}\u{1F3FC}",
        "\u{1F647}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F647}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F647}\u{1F3FD}",
        "\u{1F647}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F647}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F647}\u{1F3FE}",
        "\u{1F647}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F647}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F647}\u{1F3FF}",
        "\u{1F647}\u200D\u2640\uFE0F",
        "\u{1F647}\u200D\u2642\uFE0F",
        "\u{1F647}",
        "\u{1F648}",
        "\u{1F649}",
        "\u{1F64A}",
        "\u{1F64B}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F64B}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F64B}\u{1F3FB}",
        "\u{1F64B}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F64B}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F64B}\u{1F3FC}",
        "\u{1F64B}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F64B}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F64B}\u{1F3FD}",
        "\u{1F64B}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F64B}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F64B}\u{1F3FE}",
        "\u{1F64B}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F64B}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F64B}\u{1F3FF}",
        "\u{1F64B}\u200D\u2640\uFE0F",
        "\u{1F64B}\u200D\u2642\uFE0F",
        "\u{1F64B}",
        "\u{1F64C}\u{1F3FB}",
        "\u{1F64C}\u{1F3FC}",
        "\u{1F64C}\u{1F3FD}",
        "\u{1F64C}\u{1F3FE}",
        "\u{1F64C}\u{1F3FF}",
        "\u{1F64C}",
        "\u{1F64D}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F64D}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F64D}\u{1F3FB}",
        "\u{1F64D}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F64D}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F64D}\u{1F3FC}",
        "\u{1F64D}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F64D}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F64D}\u{1F3FD}",
        "\u{1F64D}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F64D}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F64D}\u{1F3FE}",
        "\u{1F64D}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F64D}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F64D}\u{1F3FF}",
        "\u{1F64D}\u200D\u2640\uFE0F",
        "\u{1F64D}\u200D\u2642\uFE0F",
        "\u{1F64D}",
        "\u{1F64E}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F64E}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F64E}\u{1F3FB}",
        "\u{1F64E}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F64E}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F64E}\u{1F3FC}",
        "\u{1F64E}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F64E}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F64E}\u{1F3FD}",
        "\u{1F64E}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F64E}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F64E}\u{1F3FE}",
        "\u{1F64E}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F64E}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F64E}\u{1F3FF}",
        "\u{1F64E}\u200D\u2640\uFE0F",
        "\u{1F64E}\u200D\u2642\uFE0F",
        "\u{1F64E}",
        "\u{1F64F}\u{1F3FB}",
        "\u{1F64F}\u{1F3FC}",
        "\u{1F64F}\u{1F3FD}",
        "\u{1F64F}\u{1F3FE}",
        "\u{1F64F}\u{1F3FF}",
        "\u{1F64F}",
        "\u{1F680}",
        "\u{1F681}",
        "\u{1F682}",
        "\u{1F683}",
        "\u{1F684}",
        "\u{1F685}",
        "\u{1F686}",
        "\u{1F687}",
        "\u{1F688}",
        "\u{1F689}",
        "\u{1F68A}",
        "\u{1F68B}",
        "\u{1F68C}",
        "\u{1F68D}",
        "\u{1F68E}",
        "\u{1F68F}",
        "\u{1F690}",
        "\u{1F691}",
        "\u{1F692}",
        "\u{1F693}",
        "\u{1F694}",
        "\u{1F695}",
        "\u{1F696}",
        "\u{1F697}",
        "\u{1F698}",
        "\u{1F699}",
        "\u{1F69A}",
        "\u{1F69B}",
        "\u{1F69C}",
        "\u{1F69D}",
        "\u{1F69E}",
        "\u{1F69F}",
        "\u{1F6A0}",
        "\u{1F6A1}",
        "\u{1F6A2}",
        "\u{1F6A3}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F6A3}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F6A3}\u{1F3FB}",
        "\u{1F6A3}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F6A3}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F6A3}\u{1F3FC}",
        "\u{1F6A3}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F6A3}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F6A3}\u{1F3FD}",
        "\u{1F6A3}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F6A3}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F6A3}\u{1F3FE}",
        "\u{1F6A3}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F6A3}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F6A3}\u{1F3FF}",
        "\u{1F6A3}\u200D\u2640\uFE0F",
        "\u{1F6A3}\u200D\u2642\uFE0F",
        "\u{1F6A3}",
        "\u{1F6A4}",
        "\u{1F6A5}",
        "\u{1F6A6}",
        "\u{1F6A7}",
        "\u{1F6A8}",
        "\u{1F6A9}",
        "\u{1F6AA}",
        "\u{1F6AB}",
        "\u{1F6AC}",
        "\u{1F6AD}",
        "\u{1F6AE}",
        "\u{1F6AF}",
        "\u{1F6B0}",
        "\u{1F6B1}",
        "\u{1F6B2}",
        "\u{1F6B3}",
        "\u{1F6B4}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F6B4}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F6B4}\u{1F3FB}",
        "\u{1F6B4}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F6B4}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F6B4}\u{1F3FC}",
        "\u{1F6B4}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F6B4}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F6B4}\u{1F3FD}",
        "\u{1F6B4}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F6B4}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F6B4}\u{1F3FE}",
        "\u{1F6B4}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F6B4}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F6B4}\u{1F3FF}",
        "\u{1F6B4}\u200D\u2640\uFE0F",
        "\u{1F6B4}\u200D\u2642\uFE0F",
        "\u{1F6B4}",
        "\u{1F6B5}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F6B5}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F6B5}\u{1F3FB}",
        "\u{1F6B5}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F6B5}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F6B5}\u{1F3FC}",
        "\u{1F6B5}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F6B5}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F6B5}\u{1F3FD}",
        "\u{1F6B5}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F6B5}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F6B5}\u{1F3FE}",
        "\u{1F6B5}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F6B5}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F6B5}\u{1F3FF}",
        "\u{1F6B5}\u200D\u2640\uFE0F",
        "\u{1F6B5}\u200D\u2642\uFE0F",
        "\u{1F6B5}",
        "\u{1F6B6}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F6B6}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F6B6}\u{1F3FB}",
        "\u{1F6B6}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F6B6}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F6B6}\u{1F3FC}",
        "\u{1F6B6}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F6B6}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F6B6}\u{1F3FD}",
        "\u{1F6B6}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F6B6}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F6B6}\u{1F3FE}",
        "\u{1F6B6}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F6B6}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F6B6}\u{1F3FF}",
        "\u{1F6B6}\u200D\u2640\uFE0F",
        "\u{1F6B6}\u200D\u2642\uFE0F",
        "\u{1F6B6}",
        "\u{1F6B7}",
        "\u{1F6B8}",
        "\u{1F6B9}",
        "\u{1F6BA}",
        "\u{1F6BB}",
        "\u{1F6BC}",
        "\u{1F6BD}",
        "\u{1F6BE}",
        "\u{1F6BF}",
        "\u{1F6C0}\u{1F3FB}",
        "\u{1F6C0}\u{1F3FC}",
        "\u{1F6C0}\u{1F3FD}",
        "\u{1F6C0}\u{1F3FE}",
        "\u{1F6C0}\u{1F3FF}",
        "\u{1F6C0}",
        "\u{1F6C1}",
        "\u{1F6C2}",
        "\u{1F6C3}",
        "\u{1F6C4}",
        "\u{1F6C5}",
        "\u{1F6CB}\uFE0F",
        "\u{1F6CC}\u{1F3FB}",
        "\u{1F6CC}\u{1F3FC}",
        "\u{1F6CC}\u{1F3FD}",
        "\u{1F6CC}\u{1F3FE}",
        "\u{1F6CC}\u{1F3FF}",
        "\u{1F6CC}",
        "\u{1F6CD}\uFE0F",
        "\u{1F6CE}\uFE0F",
        "\u{1F6CF}\uFE0F",
        "\u{1F6D0}",
        "\u{1F6D1}",
        "\u{1F6D2}",
        "\u{1F6D5}",
        "\u{1F6E0}\uFE0F",
        "\u{1F6E1}\uFE0F",
        "\u{1F6E2}\uFE0F",
        "\u{1F6E3}\uFE0F",
        "\u{1F6E4}\uFE0F",
        "\u{1F6E5}\uFE0F",
        "\u{1F6E9}\uFE0F",
        "\u{1F6EB}",
        "\u{1F6EC}",
        "\u{1F6F0}\uFE0F",
        "\u{1F6F3}\uFE0F",
        "\u{1F6F4}",
        "\u{1F6F5}",
        "\u{1F6F6}",
        "\u{1F6F7}",
        "\u{1F6F8}",
        "\u{1F6F9}",
        "\u{1F6FA}",
        "\u{1F7E0}",
        "\u{1F7E1}",
        "\u{1F7E2}",
        "\u{1F7E3}",
        "\u{1F7E4}",
        "\u{1F7E5}",
        "\u{1F7E6}",
        "\u{1F7E7}",
        "\u{1F7E8}",
        "\u{1F7E9}",
        "\u{1F7EA}",
        "\u{1F7EB}",
        "\u{1F90D}",
        "\u{1F90E}",
        "\u{1F90F}\u{1F3FB}",
        "\u{1F90F}\u{1F3FC}",
        "\u{1F90F}\u{1F3FD}",
        "\u{1F90F}\u{1F3FE}",
        "\u{1F90F}\u{1F3FF}",
        "\u{1F90F}",
        "\u{1F910}",
        "\u{1F911}",
        "\u{1F912}",
        "\u{1F913}",
        "\u{1F914}",
        "\u{1F915}",
        "\u{1F916}",
        "\u{1F917}",
        "\u{1F918}\u{1F3FB}",
        "\u{1F918}\u{1F3FC}",
        "\u{1F918}\u{1F3FD}",
        "\u{1F918}\u{1F3FE}",
        "\u{1F918}\u{1F3FF}",
        "\u{1F918}",
        "\u{1F919}\u{1F3FB}",
        "\u{1F919}\u{1F3FC}",
        "\u{1F919}\u{1F3FD}",
        "\u{1F919}\u{1F3FE}",
        "\u{1F919}\u{1F3FF}",
        "\u{1F919}",
        "\u{1F91A}\u{1F3FB}",
        "\u{1F91A}\u{1F3FC}",
        "\u{1F91A}\u{1F3FD}",
        "\u{1F91A}\u{1F3FE}",
        "\u{1F91A}\u{1F3FF}",
        "\u{1F91A}",
        "\u{1F91B}\u{1F3FB}",
        "\u{1F91B}\u{1F3FC}",
        "\u{1F91B}\u{1F3FD}",
        "\u{1F91B}\u{1F3FE}",
        "\u{1F91B}\u{1F3FF}",
        "\u{1F91B}",
        "\u{1F91C}\u{1F3FB}",
        "\u{1F91C}\u{1F3FC}",
        "\u{1F91C}\u{1F3FD}",
        "\u{1F91C}\u{1F3FE}",
        "\u{1F91C}\u{1F3FF}",
        "\u{1F91C}",
        "\u{1F91D}",
        "\u{1F91E}\u{1F3FB}",
        "\u{1F91E}\u{1F3FC}",
        "\u{1F91E}\u{1F3FD}",
        "\u{1F91E}\u{1F3FE}",
        "\u{1F91E}\u{1F3FF}",
        "\u{1F91E}",
        "\u{1F91F}\u{1F3FB}",
        "\u{1F91F}\u{1F3FC}",
        "\u{1F91F}\u{1F3FD}",
        "\u{1F91F}\u{1F3FE}",
        "\u{1F91F}\u{1F3FF}",
        "\u{1F91F}",
        "\u{1F920}",
        "\u{1F921}",
        "\u{1F922}",
        "\u{1F923}",
        "\u{1F924}",
        "\u{1F925}",
        "\u{1F926}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F926}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F926}\u{1F3FB}",
        "\u{1F926}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F926}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F926}\u{1F3FC}",
        "\u{1F926}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F926}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F926}\u{1F3FD}",
        "\u{1F926}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F926}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F926}\u{1F3FE}",
        "\u{1F926}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F926}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F926}\u{1F3FF}",
        "\u{1F926}\u200D\u2640\uFE0F",
        "\u{1F926}\u200D\u2642\uFE0F",
        "\u{1F926}",
        "\u{1F927}",
        "\u{1F928}",
        "\u{1F929}",
        "\u{1F92A}",
        "\u{1F92B}",
        "\u{1F92C}",
        "\u{1F92D}",
        "\u{1F92E}",
        "\u{1F92F}",
        "\u{1F930}\u{1F3FB}",
        "\u{1F930}\u{1F3FC}",
        "\u{1F930}\u{1F3FD}",
        "\u{1F930}\u{1F3FE}",
        "\u{1F930}\u{1F3FF}",
        "\u{1F930}",
        "\u{1F931}\u{1F3FB}",
        "\u{1F931}\u{1F3FC}",
        "\u{1F931}\u{1F3FD}",
        "\u{1F931}\u{1F3FE}",
        "\u{1F931}\u{1F3FF}",
        "\u{1F931}",
        "\u{1F932}\u{1F3FB}",
        "\u{1F932}\u{1F3FC}",
        "\u{1F932}\u{1F3FD}",
        "\u{1F932}\u{1F3FE}",
        "\u{1F932}\u{1F3FF}",
        "\u{1F932}",
        "\u{1F933}\u{1F3FB}",
        "\u{1F933}\u{1F3FC}",
        "\u{1F933}\u{1F3FD}",
        "\u{1F933}\u{1F3FE}",
        "\u{1F933}\u{1F3FF}",
        "\u{1F933}",
        "\u{1F934}\u{1F3FB}",
        "\u{1F934}\u{1F3FC}",
        "\u{1F934}\u{1F3FD}",
        "\u{1F934}\u{1F3FE}",
        "\u{1F934}\u{1F3FF}",
        "\u{1F934}",
        "\u{1F935}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F935}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F935}\u{1F3FB}",
        "\u{1F935}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F935}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F935}\u{1F3FC}",
        "\u{1F935}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F935}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F935}\u{1F3FD}",
        "\u{1F935}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F935}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F935}\u{1F3FE}",
        "\u{1F935}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F935}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F935}\u{1F3FF}",
        "\u{1F935}\u200D\u2640\uFE0F",
        "\u{1F935}\u200D\u2642\uFE0F",
        "\u{1F935}",
        "\u{1F936}\u{1F3FB}",
        "\u{1F936}\u{1F3FC}",
        "\u{1F936}\u{1F3FD}",
        "\u{1F936}\u{1F3FE}",
        "\u{1F936}\u{1F3FF}",
        "\u{1F936}",
        "\u{1F937}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F937}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F937}\u{1F3FB}",
        "\u{1F937}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F937}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F937}\u{1F3FC}",
        "\u{1F937}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F937}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F937}\u{1F3FD}",
        "\u{1F937}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F937}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F937}\u{1F3FE}",
        "\u{1F937}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F937}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F937}\u{1F3FF}",
        "\u{1F937}\u200D\u2640\uFE0F",
        "\u{1F937}\u200D\u2642\uFE0F",
        "\u{1F937}",
        "\u{1F938}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F938}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F938}\u{1F3FB}",
        "\u{1F938}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F938}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F938}\u{1F3FC}",
        "\u{1F938}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F938}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F938}\u{1F3FD}",
        "\u{1F938}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F938}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F938}\u{1F3FE}",
        "\u{1F938}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F938}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F938}\u{1F3FF}",
        "\u{1F938}\u200D\u2640\uFE0F",
        "\u{1F938}\u200D\u2642\uFE0F",
        "\u{1F938}",
        "\u{1F939}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F939}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F939}\u{1F3FB}",
        "\u{1F939}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F939}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F939}\u{1F3FC}",
        "\u{1F939}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F939}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F939}\u{1F3FD}",
        "\u{1F939}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F939}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F939}\u{1F3FE}",
        "\u{1F939}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F939}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F939}\u{1F3FF}",
        "\u{1F939}\u200D\u2640\uFE0F",
        "\u{1F939}\u200D\u2642\uFE0F",
        "\u{1F939}",
        "\u{1F93A}",
        "\u{1F93C}\u200D\u2640\uFE0F",
        "\u{1F93C}\u200D\u2642\uFE0F",
        "\u{1F93C}",
        "\u{1F93D}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F93D}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F93D}\u{1F3FB}",
        "\u{1F93D}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F93D}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F93D}\u{1F3FC}",
        "\u{1F93D}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F93D}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F93D}\u{1F3FD}",
        "\u{1F93D}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F93D}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F93D}\u{1F3FE}",
        "\u{1F93D}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F93D}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F93D}\u{1F3FF}",
        "\u{1F93D}\u200D\u2640\uFE0F",
        "\u{1F93D}\u200D\u2642\uFE0F",
        "\u{1F93D}",
        "\u{1F93E}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F93E}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F93E}\u{1F3FB}",
        "\u{1F93E}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F93E}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F93E}\u{1F3FC}",
        "\u{1F93E}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F93E}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F93E}\u{1F3FD}",
        "\u{1F93E}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F93E}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F93E}\u{1F3FE}",
        "\u{1F93E}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F93E}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F93E}\u{1F3FF}",
        "\u{1F93E}\u200D\u2640\uFE0F",
        "\u{1F93E}\u200D\u2642\uFE0F",
        "\u{1F93E}",
        "\u{1F93F}",
        "\u{1F940}",
        "\u{1F941}",
        "\u{1F942}",
        "\u{1F943}",
        "\u{1F944}",
        "\u{1F945}",
        "\u{1F947}",
        "\u{1F948}",
        "\u{1F949}",
        "\u{1F94A}",
        "\u{1F94B}",
        "\u{1F94C}",
        "\u{1F94D}",
        "\u{1F94E}",
        "\u{1F94F}",
        "\u{1F950}",
        "\u{1F951}",
        "\u{1F952}",
        "\u{1F953}",
        "\u{1F954}",
        "\u{1F955}",
        "\u{1F956}",
        "\u{1F957}",
        "\u{1F958}",
        "\u{1F959}",
        "\u{1F95A}",
        "\u{1F95B}",
        "\u{1F95C}",
        "\u{1F95D}",
        "\u{1F95E}",
        "\u{1F95F}",
        "\u{1F960}",
        "\u{1F961}",
        "\u{1F962}",
        "\u{1F963}",
        "\u{1F964}",
        "\u{1F965}",
        "\u{1F966}",
        "\u{1F967}",
        "\u{1F968}",
        "\u{1F969}",
        "\u{1F96A}",
        "\u{1F96B}",
        "\u{1F96C}",
        "\u{1F96D}",
        "\u{1F96E}",
        "\u{1F96F}",
        "\u{1F970}",
        "\u{1F971}",
        "\u{1F973}",
        "\u{1F974}",
        "\u{1F975}",
        "\u{1F976}",
        "\u{1F97A}",
        "\u{1F97B}",
        "\u{1F97C}",
        "\u{1F97D}",
        "\u{1F97E}",
        "\u{1F97F}",
        "\u{1F980}",
        "\u{1F981}",
        "\u{1F982}",
        "\u{1F983}",
        "\u{1F984}",
        "\u{1F985}",
        "\u{1F986}",
        "\u{1F987}",
        "\u{1F988}",
        "\u{1F989}",
        "\u{1F98A}",
        "\u{1F98B}",
        "\u{1F98C}",
        "\u{1F98D}",
        "\u{1F98E}",
        "\u{1F98F}",
        "\u{1F990}",
        "\u{1F991}",
        "\u{1F992}",
        "\u{1F993}",
        "\u{1F994}",
        "\u{1F995}",
        "\u{1F996}",
        "\u{1F997}",
        "\u{1F998}",
        "\u{1F999}",
        "\u{1F99A}",
        "\u{1F99B}",
        "\u{1F99C}",
        "\u{1F99D}",
        "\u{1F99E}",
        "\u{1F99F}",
        "\u{1F9A0}",
        "\u{1F9A1}",
        "\u{1F9A2}",
        "\u{1F9A5}",
        "\u{1F9A6}",
        "\u{1F9A7}",
        "\u{1F9A8}",
        "\u{1F9A9}",
        "\u{1F9AA}",
        "\u{1F9AE}",
        "\u{1F9AF}",
        "\u{1F9B0}",
        "\u{1F9B1}",
        "\u{1F9B2}",
        "\u{1F9B3}",
        "\u{1F9B4}",
        "\u{1F9B5}\u{1F3FB}",
        "\u{1F9B5}\u{1F3FC}",
        "\u{1F9B5}\u{1F3FD}",
        "\u{1F9B5}\u{1F3FE}",
        "\u{1F9B5}\u{1F3FF}",
        "\u{1F9B5}",
        "\u{1F9B6}\u{1F3FB}",
        "\u{1F9B6}\u{1F3FC}",
        "\u{1F9B6}\u{1F3FD}",
        "\u{1F9B6}\u{1F3FE}",
        "\u{1F9B6}\u{1F3FF}",
        "\u{1F9B6}",
        "\u{1F9B7}",
        "\u{1F9B8}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F9B8}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F9B8}\u{1F3FB}",
        "\u{1F9B8}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F9B8}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F9B8}\u{1F3FC}",
        "\u{1F9B8}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F9B8}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F9B8}\u{1F3FD}",
        "\u{1F9B8}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F9B8}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F9B8}\u{1F3FE}",
        "\u{1F9B8}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F9B8}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F9B8}\u{1F3FF}",
        "\u{1F9B8}\u200D\u2640\uFE0F",
        "\u{1F9B8}\u200D\u2642\uFE0F",
        "\u{1F9B8}",
        "\u{1F9B9}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F9B9}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F9B9}\u{1F3FB}",
        "\u{1F9B9}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F9B9}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F9B9}\u{1F3FC}",
        "\u{1F9B9}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F9B9}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F9B9}\u{1F3FD}",
        "\u{1F9B9}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F9B9}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F9B9}\u{1F3FE}",
        "\u{1F9B9}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F9B9}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F9B9}\u{1F3FF}",
        "\u{1F9B9}\u200D\u2640\uFE0F",
        "\u{1F9B9}\u200D\u2642\uFE0F",
        "\u{1F9B9}",
        "\u{1F9BA}",
        "\u{1F9BB}\u{1F3FB}",
        "\u{1F9BB}\u{1F3FC}",
        "\u{1F9BB}\u{1F3FD}",
        "\u{1F9BB}\u{1F3FE}",
        "\u{1F9BB}\u{1F3FF}",
        "\u{1F9BB}",
        "\u{1F9BC}",
        "\u{1F9BD}",
        "\u{1F9BE}",
        "\u{1F9BF}",
        "\u{1F9C0}",
        "\u{1F9C1}",
        "\u{1F9C2}",
        "\u{1F9C3}",
        "\u{1F9C4}",
        "\u{1F9C5}",
        "\u{1F9C6}",
        "\u{1F9C7}",
        "\u{1F9C8}",
        "\u{1F9C9}",
        "\u{1F9CA}",
        "\u{1F9CD}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F9CD}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F9CD}\u{1F3FB}",
        "\u{1F9CD}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F9CD}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F9CD}\u{1F3FC}",
        "\u{1F9CD}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F9CD}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F9CD}\u{1F3FD}",
        "\u{1F9CD}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F9CD}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F9CD}\u{1F3FE}",
        "\u{1F9CD}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F9CD}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F9CD}\u{1F3FF}",
        "\u{1F9CD}\u200D\u2640\uFE0F",
        "\u{1F9CD}\u200D\u2642\uFE0F",
        "\u{1F9CD}",
        "\u{1F9CE}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F9CE}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F9CE}\u{1F3FB}",
        "\u{1F9CE}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F9CE}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F9CE}\u{1F3FC}",
        "\u{1F9CE}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F9CE}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F9CE}\u{1F3FD}",
        "\u{1F9CE}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F9CE}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F9CE}\u{1F3FE}",
        "\u{1F9CE}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F9CE}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F9CE}\u{1F3FF}",
        "\u{1F9CE}\u200D\u2640\uFE0F",
        "\u{1F9CE}\u200D\u2642\uFE0F",
        "\u{1F9CE}",
        "\u{1F9CF}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F9CF}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F9CF}\u{1F3FB}",
        "\u{1F9CF}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F9CF}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F9CF}\u{1F3FC}",
        "\u{1F9CF}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F9CF}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F9CF}\u{1F3FD}",
        "\u{1F9CF}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F9CF}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F9CF}\u{1F3FE}",
        "\u{1F9CF}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F9CF}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F9CF}\u{1F3FF}",
        "\u{1F9CF}\u200D\u2640\uFE0F",
        "\u{1F9CF}\u200D\u2642\uFE0F",
        "\u{1F9CF}",
        "\u{1F9D0}",
        "\u{1F9D1}\u{1F3FB}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FB}",
        "\u{1F9D1}\u{1F3FB}",
        "\u{1F9D1}\u{1F3FC}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FB}",
        "\u{1F9D1}\u{1F3FC}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FC}",
        "\u{1F9D1}\u{1F3FC}",
        "\u{1F9D1}\u{1F3FD}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FB}",
        "\u{1F9D1}\u{1F3FD}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FC}",
        "\u{1F9D1}\u{1F3FD}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FD}",
        "\u{1F9D1}\u{1F3FD}",
        "\u{1F9D1}\u{1F3FE}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FB}",
        "\u{1F9D1}\u{1F3FE}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FC}",
        "\u{1F9D1}\u{1F3FE}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FD}",
        "\u{1F9D1}\u{1F3FE}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FE}",
        "\u{1F9D1}\u{1F3FE}",
        "\u{1F9D1}\u{1F3FF}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FB}",
        "\u{1F9D1}\u{1F3FF}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FC}",
        "\u{1F9D1}\u{1F3FF}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FD}",
        "\u{1F9D1}\u{1F3FF}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FE}",
        "\u{1F9D1}\u{1F3FF}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FF}",
        "\u{1F9D1}\u{1F3FF}",
        "\u{1F9D1}\u200D\u{1F91D}\u200D\u{1F9D1}",
        "\u{1F9D1}",
        "\u{1F9D2}\u{1F3FB}",
        "\u{1F9D2}\u{1F3FC}",
        "\u{1F9D2}\u{1F3FD}",
        "\u{1F9D2}\u{1F3FE}",
        "\u{1F9D2}\u{1F3FF}",
        "\u{1F9D2}",
        "\u{1F9D3}\u{1F3FB}",
        "\u{1F9D3}\u{1F3FC}",
        "\u{1F9D3}\u{1F3FD}",
        "\u{1F9D3}\u{1F3FE}",
        "\u{1F9D3}\u{1F3FF}",
        "\u{1F9D3}",
        "\u{1F9D4}\u{1F3FB}",
        "\u{1F9D4}\u{1F3FC}",
        "\u{1F9D4}\u{1F3FD}",
        "\u{1F9D4}\u{1F3FE}",
        "\u{1F9D4}\u{1F3FF}",
        "\u{1F9D4}",
        "\u{1F9D5}\u{1F3FB}",
        "\u{1F9D5}\u{1F3FC}",
        "\u{1F9D5}\u{1F3FD}",
        "\u{1F9D5}\u{1F3FE}",
        "\u{1F9D5}\u{1F3FF}",
        "\u{1F9D5}",
        "\u{1F9D6}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F9D6}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F9D6}\u{1F3FB}",
        "\u{1F9D6}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F9D6}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F9D6}\u{1F3FC}",
        "\u{1F9D6}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F9D6}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F9D6}\u{1F3FD}",
        "\u{1F9D6}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F9D6}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F9D6}\u{1F3FE}",
        "\u{1F9D6}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F9D6}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F9D6}\u{1F3FF}",
        "\u{1F9D6}\u200D\u2640\uFE0F",
        "\u{1F9D6}\u200D\u2642\uFE0F",
        "\u{1F9D6}",
        "\u{1F9D7}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F9D7}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F9D7}\u{1F3FB}",
        "\u{1F9D7}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F9D7}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F9D7}\u{1F3FC}",
        "\u{1F9D7}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F9D7}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F9D7}\u{1F3FD}",
        "\u{1F9D7}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F9D7}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F9D7}\u{1F3FE}",
        "\u{1F9D7}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F9D7}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F9D7}\u{1F3FF}",
        "\u{1F9D7}\u200D\u2640\uFE0F",
        "\u{1F9D7}\u200D\u2642\uFE0F",
        "\u{1F9D7}",
        "\u{1F9D8}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F9D8}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F9D8}\u{1F3FB}",
        "\u{1F9D8}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F9D8}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F9D8}\u{1F3FC}",
        "\u{1F9D8}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F9D8}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F9D8}\u{1F3FD}",
        "\u{1F9D8}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F9D8}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F9D8}\u{1F3FE}",
        "\u{1F9D8}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F9D8}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F9D8}\u{1F3FF}",
        "\u{1F9D8}\u200D\u2640\uFE0F",
        "\u{1F9D8}\u200D\u2642\uFE0F",
        "\u{1F9D8}",
        "\u{1F9D9}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F9D9}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F9D9}\u{1F3FB}",
        "\u{1F9D9}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F9D9}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F9D9}\u{1F3FC}",
        "\u{1F9D9}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F9D9}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F9D9}\u{1F3FD}",
        "\u{1F9D9}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F9D9}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F9D9}\u{1F3FE}",
        "\u{1F9D9}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F9D9}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F9D9}\u{1F3FF}",
        "\u{1F9D9}\u200D\u2640\uFE0F",
        "\u{1F9D9}\u200D\u2642\uFE0F",
        "\u{1F9D9}",
        "\u{1F9DA}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F9DA}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F9DA}\u{1F3FB}",
        "\u{1F9DA}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F9DA}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F9DA}\u{1F3FC}",
        "\u{1F9DA}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F9DA}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F9DA}\u{1F3FD}",
        "\u{1F9DA}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F9DA}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F9DA}\u{1F3FE}",
        "\u{1F9DA}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F9DA}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F9DA}\u{1F3FF}",
        "\u{1F9DA}\u200D\u2640\uFE0F",
        "\u{1F9DA}\u200D\u2642\uFE0F",
        "\u{1F9DA}",
        "\u{1F9DB}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F9DB}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F9DB}\u{1F3FB}",
        "\u{1F9DB}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F9DB}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F9DB}\u{1F3FC}",
        "\u{1F9DB}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F9DB}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F9DB}\u{1F3FD}",
        "\u{1F9DB}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F9DB}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F9DB}\u{1F3FE}",
        "\u{1F9DB}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F9DB}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F9DB}\u{1F3FF}",
        "\u{1F9DB}\u200D\u2640\uFE0F",
        "\u{1F9DB}\u200D\u2642\uFE0F",
        "\u{1F9DB}",
        "\u{1F9DC}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F9DC}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F9DC}\u{1F3FB}",
        "\u{1F9DC}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F9DC}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F9DC}\u{1F3FC}",
        "\u{1F9DC}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F9DC}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F9DC}\u{1F3FD}",
        "\u{1F9DC}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F9DC}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F9DC}\u{1F3FE}",
        "\u{1F9DC}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F9DC}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F9DC}\u{1F3FF}",
        "\u{1F9DC}\u200D\u2640\uFE0F",
        "\u{1F9DC}\u200D\u2642\uFE0F",
        "\u{1F9DC}",
        "\u{1F9DD}\u{1F3FB}\u200D\u2640\uFE0F",
        "\u{1F9DD}\u{1F3FB}\u200D\u2642\uFE0F",
        "\u{1F9DD}\u{1F3FB}",
        "\u{1F9DD}\u{1F3FC}\u200D\u2640\uFE0F",
        "\u{1F9DD}\u{1F3FC}\u200D\u2642\uFE0F",
        "\u{1F9DD}\u{1F3FC}",
        "\u{1F9DD}\u{1F3FD}\u200D\u2640\uFE0F",
        "\u{1F9DD}\u{1F3FD}\u200D\u2642\uFE0F",
        "\u{1F9DD}\u{1F3FD}",
        "\u{1F9DD}\u{1F3FE}\u200D\u2640\uFE0F",
        "\u{1F9DD}\u{1F3FE}\u200D\u2642\uFE0F",
        "\u{1F9DD}\u{1F3FE}",
        "\u{1F9DD}\u{1F3FF}\u200D\u2640\uFE0F",
        "\u{1F9DD}\u{1F3FF}\u200D\u2642\uFE0F",
        "\u{1F9DD}\u{1F3FF}",
        "\u{1F9DD}\u200D\u2640\uFE0F",
        "\u{1F9DD}\u200D\u2642\uFE0F",
        "\u{1F9DD}",
        "\u{1F9DE}\u200D\u2640\uFE0F",
        "\u{1F9DE}\u200D\u2642\uFE0F",
        "\u{1F9DE}",
        "\u{1F9DF}\u200D\u2640\uFE0F",
        "\u{1F9DF}\u200D\u2642\uFE0F",
        "\u{1F9DF}",
        "\u{1F9E0}",
        "\u{1F9E1}",
        "\u{1F9E2}",
        "\u{1F9E3}",
        "\u{1F9E4}",
        "\u{1F9E5}",
        "\u{1F9E6}",
        "\u{1F9E7}",
        "\u{1F9E8}",
        "\u{1F9E9}",
        "\u{1F9EA}",
        "\u{1F9EB}",
        "\u{1F9EC}",
        "\u{1F9ED}",
        "\u{1F9EE}",
        "\u{1F9EF}",
        "\u{1F9F0}",
        "\u{1F9F1}",
        "\u{1F9F2}",
        "\u{1F9F3}",
        "\u{1F9F4}",
        "\u{1F9F5}",
        "\u{1F9F6}",
        "\u{1F9F7}",
        "\u{1F9F8}",
        "\u{1F9F9}",
        "\u{1F9FA}",
        "\u{1F9FB}",
        "\u{1F9FC}",
        "\u{1F9FD}",
        "\u{1F9FE}",
        "\u{1F9FF}",
        "\u{1FA70}",
        "\u{1FA71}",
        "\u{1FA72}",
        "\u{1FA73}",
        "\u{1FA78}",
        "\u{1FA79}",
        "\u{1FA7A}",
        "\u{1FA80}",
        "\u{1FA81}",
        "\u{1FA82}",
        "\u{1FA90}",
        "\u{1FA91}",
        "\u{1FA92}",
        "\u{1FA93}",
        "\u{1FA94}",
        "\u{1FA95}",
        "\u203C\uFE0F",
        "\u2049\uFE0F",
        "\u2122\uFE0F",
        "\u2139\uFE0F",
        "\u2194\uFE0F",
        "\u2195\uFE0F",
        "\u2196\uFE0F",
        "\u2197\uFE0F",
        "\u2198\uFE0F",
        "\u2199\uFE0F",
        "\u21A9\uFE0F",
        "\u21AA\uFE0F",
        "#\u20E3",
        "\u231A\uFE0F",
        "\u231B\uFE0F",
        "\u2328\uFE0F",
        "\u23CF\uFE0F",
        "\u23E9",
        "\u23EA",
        "\u23EB",
        "\u23EC",
        "\u23ED\uFE0F",
        "\u23EE\uFE0F",
        "\u23EF\uFE0F",
        "\u23F0",
        "\u23F1\uFE0F",
        "\u23F2\uFE0F",
        "\u23F3",
        "\u23F8\uFE0F",
        "\u23F9\uFE0F",
        "\u23FA\uFE0F",
        "\u24C2\uFE0F",
        "\u25AA\uFE0F",
        "\u25AB\uFE0F",
        "\u25B6\uFE0F",
        "\u25C0\uFE0F",
        "\u25FB\uFE0F",
        "\u25FC\uFE0F",
        "\u25FD\uFE0F",
        "\u25FE\uFE0F",
        "\u2600\uFE0F",
        "\u2601\uFE0F",
        "\u2602\uFE0F",
        "\u2603\uFE0F",
        "\u2604\uFE0F",
        "\u260E\uFE0F",
        "\u2611\uFE0F",
        "\u2614\uFE0F",
        "\u2615\uFE0F",
        "\u2618\uFE0F",
        "\u261D\u{1F3FB}",
        "\u261D\u{1F3FC}",
        "\u261D\u{1F3FD}",
        "\u261D\u{1F3FE}",
        "\u261D\u{1F3FF}",
        "\u261D\uFE0F",
        "\u2620\uFE0F",
        "\u2622\uFE0F",
        "\u2623\uFE0F",
        "\u2626\uFE0F",
        "\u262A\uFE0F",
        "\u262E\uFE0F",
        "\u262F\uFE0F",
        "\u2638\uFE0F",
        "\u2639\uFE0F",
        "\u263A\uFE0F",
        "\u2640\uFE0F",
        "\u2642\uFE0F",
        "\u2648\uFE0F",
        "\u2649\uFE0F",
        "\u264A\uFE0F",
        "\u264B\uFE0F",
        "\u264C\uFE0F",
        "\u264D\uFE0F",
        "\u264E\uFE0F",
        "\u264F\uFE0F",
        "\u2650\uFE0F",
        "\u2651\uFE0F",
        "\u2652\uFE0F",
        "\u2653\uFE0F",
        "\u265F\uFE0F",
        "\u2660\uFE0F",
        "\u2663\uFE0F",
        "\u2665\uFE0F",
        "\u2666\uFE0F",
        "\u2668\uFE0F",
        "\u267B\uFE0F",
        "\u267E",
        "\u267F\uFE0F",
        "\u2692\uFE0F",
        "\u2693\uFE0F",
        "\u2694\uFE0F",
        "\u2695\uFE0F",
        "\u2696\uFE0F",
        "\u2697\uFE0F",
        "\u2699\uFE0F",
        "\u269B\uFE0F",
        "\u269C\uFE0F",
        "\u26A0\uFE0F",
        "\u26A1\uFE0F",
        "\u26AA\uFE0F",
        "\u26AB\uFE0F",
        "\u26B0\uFE0F",
        "\u26B1\uFE0F",
        "\u26BD\uFE0F",
        "\u26BE\uFE0F",
        "\u26C4\uFE0F",
        "\u26C5\uFE0F",
        "\u26C8\uFE0F",
        "\u26CE",
        "\u26CF\uFE0F",
        "\u26D1\uFE0F",
        "\u26D3\uFE0F",
        "\u26D4\uFE0F",
        "\u26E9\uFE0F",
        "\u26EA\uFE0F",
        "\u26F0\uFE0F",
        "\u26F1\uFE0F",
        "\u26F2\uFE0F",
        "\u26F3\uFE0F",
        "\u26F4\uFE0F",
        "\u26F5\uFE0F",
        "\u26F7\u{1F3FB}",
        "\u26F7\u{1F3FC}",
        "\u26F7\u{1F3FD}",
        "\u26F7\u{1F3FE}",
        "\u26F7\u{1F3FF}",
        "\u26F7\uFE0F",
        "\u26F8\uFE0F",
        "\u26F9\u{1F3FB}\u200D\u2640\uFE0F",
        "\u26F9\u{1F3FB}\u200D\u2642\uFE0F",
        "\u26F9\u{1F3FB}",
        "\u26F9\u{1F3FC}\u200D\u2640\uFE0F",
        "\u26F9\u{1F3FC}\u200D\u2642\uFE0F",
        "\u26F9\u{1F3FC}",
        "\u26F9\u{1F3FD}\u200D\u2640\uFE0F",
        "\u26F9\u{1F3FD}\u200D\u2642\uFE0F",
        "\u26F9\u{1F3FD}",
        "\u26F9\u{1F3FE}\u200D\u2640\uFE0F",
        "\u26F9\u{1F3FE}\u200D\u2642\uFE0F",
        "\u26F9\u{1F3FE}",
        "\u26F9\u{1F3FF}\u200D\u2640\uFE0F",
        "\u26F9\u{1F3FF}\u200D\u2642\uFE0F",
        "\u26F9\u{1F3FF}",
        "\u26F9\uFE0F\u200D\u2640\uFE0F",
        "\u26F9\uFE0F\u200D\u2642\uFE0F",
        "\u26F9\uFE0F",
        "\u26FA\uFE0F",
        "\u26FD\uFE0F",
        "\u2702\uFE0F",
        "\u2705",
        "\u2708\uFE0F",
        "\u2709\uFE0F",
        "\u270A\u{1F3FB}",
        "\u270A\u{1F3FC}",
        "\u270A\u{1F3FD}",
        "\u270A\u{1F3FE}",
        "\u270A\u{1F3FF}",
        "\u270A",
        "\u270B\u{1F3FB}",
        "\u270B\u{1F3FC}",
        "\u270B\u{1F3FD}",
        "\u270B\u{1F3FE}",
        "\u270B\u{1F3FF}",
        "\u270B",
        "\u270C\u{1F3FB}",
        "\u270C\u{1F3FC}",
        "\u270C\u{1F3FD}",
        "\u270C\u{1F3FE}",
        "\u270C\u{1F3FF}",
        "\u270C\uFE0F",
        "\u270D\u{1F3FB}",
        "\u270D\u{1F3FC}",
        "\u270D\u{1F3FD}",
        "\u270D\u{1F3FE}",
        "\u270D\u{1F3FF}",
        "\u270D\uFE0F",
        "\u270F\uFE0F",
        "\u2712\uFE0F",
        "\u2714\uFE0F",
        "\u2716\uFE0F",
        "\u271D\uFE0F",
        "\u2721\uFE0F",
        "\u2728",
        "\u2733\uFE0F",
        "\u2734\uFE0F",
        "\u2744\uFE0F",
        "\u2747\uFE0F",
        "\u274C",
        "\u274E",
        "\u2753",
        "\u2754",
        "\u2755",
        "\u2757\uFE0F",
        "\u2763\uFE0F",
        "\u2764\uFE0F",
        "\u2795",
        "\u2796",
        "\u2797",
        "\u27A1\uFE0F",
        "\u27B0",
        "\u27BF",
        "\u2934\uFE0F",
        "\u2935\uFE0F",
        "*\u20E3",
        "\u2B05\uFE0F",
        "\u2B06\uFE0F",
        "\u2B07\uFE0F",
        "\u2B1B\uFE0F",
        "\u2B1C\uFE0F",
        "\u2B50\uFE0F",
        "\u2B55\uFE0F",
        "0\u20E3",
        "\u3030\uFE0F",
        "\u303D\uFE0F",
        "1\u20E3",
        "2\u20E3",
        "\u3297\uFE0F",
        "\u3299\uFE0F",
        "3\u20E3",
        "4\u20E3",
        "5\u20E3",
        "6\u20E3",
        "7\u20E3",
        "8\u20E3",
        "9\u20E3",
        "\xA9\uFE0F",
        "\xAE\uFE0F",
        "\uE50A"
      ];
    }
  });

  // remix/.ds-entry.tsx
  var ds_entry_exports = {};
  __export(ds_entry_exports, {
    Attention: () => Attention,
    Branding: () => Branding,
    ChakraProvider: () => ChakraProvider,
    Hamburger: () => Hamburger,
    Icon: () => Icon2,
    Logo: () => Logo,
    RainbowSkeleton: () => RainbowSkeleton
  });
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+hooks@2.4.6_react@18.3.1/node_modules/@chakra-ui/hooks/dist/esm/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+utils@2.2.6_react@18.3.1/node_modules/@chakra-ui/utils/dist/esm/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+utils@2.2.6_react@18.3.1/node_modules/@chakra-ui/utils/dist/esm/is-element.mjs
  init_define_import_meta_env();
  function isBrowser() {
    return Boolean(globalThis?.document);
  }

  // remix/node_modules/.pnpm/@chakra-ui+utils@2.2.6_react@18.3.1/node_modules/@chakra-ui/utils/dist/esm/assign-after.mjs
  init_define_import_meta_env();
  function assignAfter(target, ...sources) {
    if (target == null) {
      throw new TypeError("Cannot convert undefined or null to object");
    }
    const result = { ...target };
    for (const nextSource of sources) {
      if (nextSource == null)
        continue;
      for (const nextKey in nextSource) {
        if (!Object.prototype.hasOwnProperty.call(nextSource, nextKey))
          continue;
        if (nextKey in result)
          delete result[nextKey];
        result[nextKey] = nextSource[nextKey];
      }
    }
    return result;
  }

  // remix/node_modules/.pnpm/@chakra-ui+utils@2.2.6_react@18.3.1/node_modules/@chakra-ui/utils/dist/esm/breakpoint.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+utils@2.2.6_react@18.3.1/node_modules/@chakra-ui/utils/dist/esm/is.mjs
  init_define_import_meta_env();
  function isArray(value) {
    return Array.isArray(value);
  }
  function isObject(value) {
    const type = typeof value;
    return value != null && (type === "object" || type === "function") && !isArray(value);
  }

  // remix/node_modules/.pnpm/@chakra-ui+utils@2.2.6_react@18.3.1/node_modules/@chakra-ui/utils/dist/esm/breakpoint.mjs
  function getLastItem(array) {
    const length2 = array == null ? 0 : array.length;
    return length2 ? array[length2 - 1] : void 0;
  }
  function analyzeCSSValue(value) {
    const num = parseFloat(value.toString());
    const unit = value.toString().replace(String(num), "");
    return { unitless: !unit, value: num, unit };
  }
  function px(value) {
    if (value == null)
      return value;
    const { unitless } = analyzeCSSValue(value);
    return unitless || typeof value === "number" ? `${value}px` : value;
  }
  var sortByBreakpointValue = (a, b) => parseInt(a[1], 10) > parseInt(b[1], 10) ? 1 : -1;
  var sortBps = (breakpoints2) => Object.fromEntries(Object.entries(breakpoints2).sort(sortByBreakpointValue));
  function normalize(breakpoints2) {
    const sorted = sortBps(breakpoints2);
    return Object.assign(Object.values(sorted), sorted);
  }
  function keys(breakpoints2) {
    const value = Object.keys(sortBps(breakpoints2));
    return new Set(value);
  }
  function subtract(value) {
    if (!value)
      return value;
    value = px(value) ?? value;
    const OFFSET = -0.02;
    return typeof value === "number" ? `${value + OFFSET}` : value.replace(/(\d+\.?\d*)/u, (m) => `${parseFloat(m) + OFFSET}`);
  }
  function toMediaQueryString(min, max) {
    const query = ["@media screen"];
    if (min)
      query.push("and", `(min-width: ${px(min)})`);
    if (max)
      query.push("and", `(max-width: ${px(max)})`);
    return query.join(" ");
  }
  function analyzeBreakpoints(breakpoints2) {
    if (!breakpoints2)
      return null;
    breakpoints2.base = breakpoints2.base ?? "0px";
    const normalized = normalize(breakpoints2);
    const queries = Object.entries(breakpoints2).sort(sortByBreakpointValue).map(([breakpoint, minW], index, entry) => {
      let [, maxW] = entry[index + 1] ?? [];
      maxW = parseFloat(maxW) > 0 ? subtract(maxW) : void 0;
      return {
        _minW: subtract(minW),
        breakpoint,
        minW,
        maxW,
        maxWQuery: toMediaQueryString(null, maxW),
        minWQuery: toMediaQueryString(minW),
        minMaxQuery: toMediaQueryString(minW, maxW)
      };
    });
    const _keys = keys(breakpoints2);
    const _keysArr = Array.from(_keys.values());
    return {
      keys: _keys,
      normalized,
      isResponsive(test2) {
        const keys2 = Object.keys(test2);
        return keys2.length > 0 && keys2.every((key) => _keys.has(key));
      },
      asObject: sortBps(breakpoints2),
      asArray: normalize(breakpoints2),
      details: queries,
      get(key) {
        return queries.find((q) => q.breakpoint === key);
      },
      media: [
        null,
        ...normalized.map((minW) => toMediaQueryString(minW)).slice(1)
      ],
      /**
       * Converts the object responsive syntax to array syntax
       *
       * @example
       * toArrayValue({ base: 1, sm: 2, md: 3 }) // => [1, 2, 3]
       */
      toArrayValue(test2) {
        if (!isObject(test2)) {
          throw new Error("toArrayValue: value must be an object");
        }
        const result = _keysArr.map((bp) => test2[bp] ?? null);
        while (getLastItem(result) === null) {
          result.pop();
        }
        return result;
      },
      /**
       * Converts the array responsive syntax to object syntax
       *
       * @example
       * toObjectValue([1, 2, 3]) // => { base: 1, sm: 2, md: 3 }
       */
      toObjectValue(test2) {
        if (!Array.isArray(test2)) {
          throw new Error("toObjectValue: value must be an array");
        }
        return test2.reduce(
          (acc, value, index) => {
            const key = _keysArr[index];
            if (key != null && value != null)
              acc[key] = value;
            return acc;
          },
          {}
        );
      }
    };
  }

  // remix/node_modules/.pnpm/@chakra-ui+utils@2.2.6_react@18.3.1/node_modules/@chakra-ui/utils/dist/esm/compact.mjs
  init_define_import_meta_env();
  function compact(object) {
    const clone = Object.assign({}, object);
    for (let key in clone) {
      if (clone[key] === void 0)
        delete clone[key];
    }
    return clone;
  }

  // remix/node_modules/.pnpm/@chakra-ui+utils@2.2.6_react@18.3.1/node_modules/@chakra-ui/utils/dist/esm/context.mjs
  init_define_import_meta_env();
  var import_react = __toESM(require_react_shim(), 1);
  function getErrorMessage(hook, provider) {
    return `${hook} returned \`undefined\`. Seems you forgot to wrap component within ${provider}`;
  }
  function createContext(options = {}) {
    const {
      name,
      strict = true,
      hookName = "useContext",
      providerName = "Provider",
      errorMessage,
      defaultValue
    } = options;
    const Context = (0, import_react.createContext)(defaultValue);
    Context.displayName = name;
    function useContext$1() {
      const context = (0, import_react.useContext)(Context);
      if (!context && strict) {
        const error = new Error(
          errorMessage ?? getErrorMessage(hookName, providerName)
        );
        error.name = "ContextError";
        Error.captureStackTrace?.(error, useContext$1);
        throw error;
      }
      return context;
    }
    return [Context.Provider, useContext$1, Context];
  }

  // remix/node_modules/.pnpm/@chakra-ui+utils@2.2.6_react@18.3.1/node_modules/@chakra-ui/utils/dist/esm/cx.mjs
  init_define_import_meta_env();
  var cx = (...classNames2) => classNames2.filter(Boolean).join(" ");

  // remix/node_modules/.pnpm/@chakra-ui+utils@2.2.6_react@18.3.1/node_modules/@chakra-ui/utils/dist/esm/get.mjs
  init_define_import_meta_env();
  function get(obj, path, fallback, index) {
    const key = typeof path === "string" ? path.split(".") : [path];
    for (index = 0; index < key.length; index += 1) {
      if (!obj)
        break;
      obj = obj[key[index]];
    }
    return obj === void 0 ? fallback : obj;
  }
  var memoize = (fn) => {
    const cache = /* @__PURE__ */ new WeakMap();
    const memoizedFn = (obj, path, fallback, index) => {
      if (typeof obj === "undefined") {
        return fn(obj, path, fallback);
      }
      if (!cache.has(obj)) {
        cache.set(obj, /* @__PURE__ */ new Map());
      }
      const map = cache.get(obj);
      if (map.has(path)) {
        return map.get(path);
      }
      const value = fn(obj, path, fallback, index);
      map.set(path, value);
      return value;
    };
    return memoizedFn;
  };
  var memoizedGet = memoize(get);

  // remix/node_modules/.pnpm/@chakra-ui+utils@2.2.6_react@18.3.1/node_modules/@chakra-ui/utils/dist/esm/interop-default.mjs
  init_define_import_meta_env();
  var interopDefault = (mod) => mod.default || mod;

  // remix/node_modules/.pnpm/@chakra-ui+utils@2.2.6_react@18.3.1/node_modules/@chakra-ui/utils/dist/esm/omit.mjs
  init_define_import_meta_env();
  function omit(object, keysToOmit = []) {
    const clone = Object.assign({}, object);
    for (const key of keysToOmit) {
      if (key in clone) {
        delete clone[key];
      }
    }
    return clone;
  }

  // remix/node_modules/.pnpm/@chakra-ui+utils@2.2.6_react@18.3.1/node_modules/@chakra-ui/utils/dist/esm/pick.mjs
  init_define_import_meta_env();
  function pick(object, keysToPick) {
    const result = {};
    for (const key of keysToPick) {
      if (key in object) {
        result[key] = object[key];
      }
    }
    return result;
  }

  // remix/node_modules/.pnpm/@chakra-ui+utils@2.2.6_react@18.3.1/node_modules/@chakra-ui/utils/dist/esm/run-if-fn.mjs
  init_define_import_meta_env();
  var isFunction = (value) => typeof value === "function";
  function runIfFn(valueOrFn, ...args) {
    return isFunction(valueOrFn) ? valueOrFn(...args) : valueOrFn;
  }

  // remix/node_modules/.pnpm/@chakra-ui+utils@2.2.6_react@18.3.1/node_modules/@chakra-ui/utils/dist/esm/split-props.mjs
  init_define_import_meta_env();
  function splitProps(props, ...keys2) {
    const descriptors = Object.getOwnPropertyDescriptors(props);
    const dKeys = Object.keys(descriptors);
    const split = (k) => {
      const clone = {};
      for (let i = 0; i < k.length; i++) {
        const key = k[i];
        if (descriptors[key]) {
          Object.defineProperty(clone, key, descriptors[key]);
          delete descriptors[key];
        }
      }
      return clone;
    };
    const fn = (key) => split(Array.isArray(key) ? key : dKeys.filter(key));
    return keys2.map(fn).concat(split(dKeys));
  }

  // remix/node_modules/.pnpm/@chakra-ui+utils@2.2.6_react@18.3.1/node_modules/@chakra-ui/utils/dist/esm/walk-object.mjs
  init_define_import_meta_env();
  function walkObject(target, predicate, options = {}) {
    const { stop, getKey } = options;
    function inner(value, path = []) {
      if (isObject(value) || Array.isArray(value)) {
        const result = {};
        for (const [prop, child] of Object.entries(value)) {
          const key = getKey?.(prop) ?? prop;
          const childPath = [...path, key];
          if (stop?.(value, childPath)) {
            return predicate(value, path);
          }
          result[key] = inner(child, childPath);
        }
        return result;
      }
      return predicate(value, path);
    }
    return inner(target);
  }

  // remix/node_modules/.pnpm/@chakra-ui+utils@2.2.6_react@18.3.1/node_modules/@chakra-ui/utils/dist/esm/index.mjs
  var import_lodash = __toESM(require_lodash(), 1);

  // remix/node_modules/.pnpm/@chakra-ui+hooks@2.4.6_react@18.3.1/node_modules/@chakra-ui/hooks/dist/esm/use-callback-ref.mjs
  init_define_import_meta_env();
  var import_react2 = __toESM(require_react_shim(), 1);
  function useCallbackRef(callback, deps = []) {
    const callbackRef = (0, import_react2.useRef)(callback);
    (0, import_react2.useEffect)(() => {
      callbackRef.current = callback;
    });
    return (0, import_react2.useCallback)((...args) => callbackRef.current?.(...args), deps);
  }

  // remix/node_modules/.pnpm/@chakra-ui+hooks@2.4.6_react@18.3.1/node_modules/@chakra-ui/hooks/dist/esm/use-safe-layout-effect.mjs
  init_define_import_meta_env();
  var import_react3 = __toESM(require_react_shim(), 1);
  var useSafeLayoutEffect = Boolean(globalThis?.document) ? import_react3.useLayoutEffect : import_react3.useEffect;

  // remix/node_modules/.pnpm/@chakra-ui+hooks@2.4.6_react@18.3.1/node_modules/@chakra-ui/hooks/dist/esm/use-update-effect.mjs
  init_define_import_meta_env();
  var import_react4 = __toESM(require_react_shim(), 1);
  var useUpdateEffect = (effect2, deps) => {
    const renderCycleRef = (0, import_react4.useRef)(false);
    const effectCycleRef = (0, import_react4.useRef)(false);
    (0, import_react4.useEffect)(() => {
      const isMounted = renderCycleRef.current;
      const shouldRun = isMounted && effectCycleRef.current;
      if (shouldRun) {
        return effect2();
      }
      effectCycleRef.current = true;
    }, deps);
    (0, import_react4.useEffect)(() => {
      renderCycleRef.current = true;
      return () => {
        renderCycleRef.current = false;
      };
    }, []);
  };

  // remix/node_modules/.pnpm/@chakra-ui+hooks@2.4.6_react@18.3.1/node_modules/@chakra-ui/hooks/dist/esm/use-timeout.mjs
  init_define_import_meta_env();
  var import_react5 = __toESM(require_react_shim(), 1);
  function useTimeout(callback, delay2) {
    const fn = useCallbackRef(callback);
    (0, import_react5.useEffect)(() => {
      if (delay2 == null)
        return void 0;
      let timeoutId = null;
      timeoutId = window.setTimeout(() => {
        fn();
      }, delay2);
      return () => {
        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }
      };
    }, [delay2, fn]);
  }

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/css.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/pseudos.mjs
  init_define_import_meta_env();
  var state = {
    open: (str, post) => `${str}[data-open], ${str}[open], ${str}[data-state=open] ${post}`,
    closed: (str, post) => `${str}[data-closed], ${str}[data-state=closed] ${post}`,
    hover: (str, post) => `${str}:hover ${post}, ${str}[data-hover] ${post}`,
    focus: (str, post) => `${str}:focus ${post}, ${str}[data-focus] ${post}`,
    focusVisible: (str, post) => `${str}:focus-visible ${post}`,
    focusWithin: (str, post) => `${str}:focus-within ${post}`,
    active: (str, post) => `${str}:active ${post}, ${str}[data-active] ${post}`,
    disabled: (str, post) => `${str}:disabled ${post}, ${str}[data-disabled] ${post}`,
    invalid: (str, post) => `${str}:invalid ${post}, ${str}[data-invalid] ${post}`,
    checked: (str, post) => `${str}:checked ${post}, ${str}[data-checked] ${post}`,
    indeterminate: (str, post) => `${str}:indeterminate ${post}, ${str}[aria-checked=mixed] ${post}, ${str}[data-indeterminate] ${post}`,
    readOnly: (str, post) => `${str}:read-only ${post}, ${str}[readonly] ${post}, ${str}[data-read-only] ${post}`,
    expanded: (str, post) => `${str}:read-only ${post}, ${str}[aria-expanded=true] ${post}, ${str}[data-expanded] ${post}`,
    placeholderShown: (str, post) => `${str}:placeholder-shown ${post}`
  };
  var toGroup = (fn) => merge((v) => fn(v, "&"), "[role=group]", "[data-group]", ".group");
  var toPeer = (fn) => merge((v) => fn(v, "~ &"), "[data-peer]", ".peer");
  var merge = (fn, ...selectors) => selectors.map(fn).join(", ");
  var pseudoSelectors = {
    /**
     * Styles for CSS selector `&:hover`
     */
    _hover: "&:hover, &[data-hover]",
    /**
     * Styles for CSS Selector `&:active`
     */
    _active: "&:active, &[data-active]",
    /**
     * Styles for CSS selector `&:focus`
     *
     */
    _focus: "&:focus, &[data-focus]",
    /**
     * Styles for the highlighted state.
     */
    _highlighted: "&[data-highlighted]",
    /**
     * Styles to apply when a child of this element has received focus
     * - CSS Selector `&:focus-within`
     */
    _focusWithin: "&:focus-within, &[data-focus-within]",
    /**
     * Styles to apply when this element has received focus via tabbing
     * - CSS Selector `&:focus-visible`
     */
    _focusVisible: "&:focus-visible, &[data-focus-visible]",
    /**
     * Styles to apply when this element is disabled. The passed styles are applied to these CSS selectors:
     * - `&[aria-disabled=true]`
     * - `&:disabled`
     * - `&[data-disabled]`
     * - `&[disabled]`
     */
    _disabled: "&:disabled, &[disabled], &[aria-disabled=true], &[data-disabled]",
    /**
     * Styles for CSS Selector `&:readonly`
     */
    _readOnly: "&[aria-readonly=true], &[readonly], &[data-readonly]",
    /**
     * Styles for CSS selector `&::before`
     *
     * NOTE:When using this, ensure the `content` is wrapped in a backtick.
     * @example
     * ```jsx
     * <Box _before={{content:`""` }}/>
     * ```
     */
    _before: "&::before",
    /**
     * Styles for CSS selector `&::after`
     *
     * NOTE:When using this, ensure the `content` is wrapped in a backtick.
     * @example
     * ```jsx
     * <Box _after={{content:`""` }}/>
     * ```
     */
    _after: "&::after",
    /**
     * Styles for CSS selector `&:empty`
     */
    _empty: "&:empty, &[data-empty]",
    /**
     * Styles to apply when the ARIA attribute `aria-expanded` is `true`
     * - CSS selector `&[aria-expanded=true]`
     */
    _expanded: "&[aria-expanded=true], &[data-expanded], &[data-state=expanded]",
    /**
     * Styles to apply when the ARIA attribute `aria-checked` is `true`
     * - CSS selector `&[aria-checked=true]`
     */
    _checked: "&[aria-checked=true], &[data-checked], &[data-state=checked]",
    /**
     * Styles to apply when the ARIA attribute `aria-grabbed` is `true`
     * - CSS selector `&[aria-grabbed=true]`
     */
    _grabbed: "&[aria-grabbed=true], &[data-grabbed]",
    /**
     * Styles for CSS Selector `&[aria-pressed=true]`
     * Typically used to style the current "pressed" state of toggle buttons
     */
    _pressed: "&[aria-pressed=true], &[data-pressed]",
    /**
     * Styles to apply when the ARIA attribute `aria-invalid` is `true`
     * - CSS selector `&[aria-invalid=true]`
     */
    _invalid: "&[aria-invalid=true], &[data-invalid]",
    /**
     * Styles for the valid state
     * - CSS selector `&[data-valid], &[data-state=valid]`
     */
    _valid: "&[data-valid], &[data-state=valid]",
    /**
     * Styles for CSS Selector `&[aria-busy=true]` or `&[data-loading=true]`.
     * Useful for styling loading states
     */
    _loading: "&[data-loading], &[aria-busy=true]",
    /**
     * Styles to apply when the ARIA attribute `aria-selected` is `true`
     *
     * - CSS selector `&[aria-selected=true]`
     */
    _selected: "&[aria-selected=true], &[data-selected]",
    /**
     * Styles for CSS Selector `[hidden=true]`
     */
    _hidden: "&[hidden], &[data-hidden]",
    /**
     * Styles for CSS Selector `&:-webkit-autofill`
     */
    _autofill: "&:-webkit-autofill",
    /**
     * Styles for CSS Selector `&:nth-child(even)`
     */
    _even: "&:nth-of-type(even)",
    /**
     * Styles for CSS Selector `&:nth-child(odd)`
     */
    _odd: "&:nth-of-type(odd)",
    /**
     * Styles for CSS Selector `&:first-of-type`
     */
    _first: "&:first-of-type",
    /**
     * Styles for CSS selector `&::first-letter`
     *
     * NOTE: This selector is only applied for block-level elements and not preceded by an image or table.
     * @example
     * ```jsx
     * <Text _firstLetter={{ textDecoration: 'underline' }}>Once upon a time</Text>
     * ```
     */
    _firstLetter: "&::first-letter",
    /**
     * Styles for CSS Selector `&:last-of-type`
     */
    _last: "&:last-of-type",
    /**
     * Styles for CSS Selector `&:not(:first-of-type)`
     */
    _notFirst: "&:not(:first-of-type)",
    /**
     * Styles for CSS Selector `&:not(:last-of-type)`
     */
    _notLast: "&:not(:last-of-type)",
    /**
     * Styles for CSS Selector `&:visited`
     */
    _visited: "&:visited",
    /**
     * Used to style the active link in a navigation
     * Styles for CSS Selector `&[aria-current=page]`
     */
    _activeLink: "&[aria-current=page]",
    /**
     * Used to style the current step within a process
     * Styles for CSS Selector `&[aria-current=step]`
     */
    _activeStep: "&[aria-current=step]",
    /**
     * Styles to apply when the ARIA attribute `aria-checked` is `mixed`
     * - CSS selector `&[aria-checked=mixed]`
     */
    _indeterminate: "&:indeterminate, &[aria-checked=mixed], &[data-indeterminate], &[data-state=indeterminate]",
    /**
     * Styles to apply when a parent element with `.group`, `data-group` or `role=group` is open
     */
    _groupOpen: toGroup(state.open),
    /**
     * Styles to apply when a parent element with `.group`, `data-group` or `role=group` is closed
     */
    _groupClosed: toGroup(state.closed),
    /**
     * Styles to apply when a parent element with `.group`, `data-group` or `role=group` is hovered
     */
    _groupHover: toGroup(state.hover),
    /**
     * Styles to apply when a sibling element with `.peer` or `data-peer` is hovered
     */
    _peerHover: toPeer(state.hover),
    /**
     * Styles to apply when a parent element with `.group`, `data-group` or `role=group` is focused
     */
    _groupFocus: toGroup(state.focus),
    /**
     * Styles to apply when a sibling element with `.peer` or `data-peer` is focused
     */
    _peerFocus: toPeer(state.focus),
    /**
     * Styles to apply when a parent element with `.group`, `data-group` or `role=group` has visible focus
     */
    _groupFocusVisible: toGroup(state.focusVisible),
    /**
     * Styles to apply when a sibling element with `.peer`or `data-peer` has visible focus
     */
    _peerFocusVisible: toPeer(state.focusVisible),
    /**
     * Styles to apply when a parent element with `.group`, `data-group` or `role=group` is active
     */
    _groupActive: toGroup(state.active),
    /**
     * Styles to apply when a sibling element with `.peer` or `data-peer` is active
     */
    _peerActive: toPeer(state.active),
    /**
     * Styles to apply when a parent element with `.group`, `data-group` or `role=group` is disabled
     */
    _groupDisabled: toGroup(state.disabled),
    /**
     *  Styles to apply when a sibling element with `.peer` or `data-peer` is disabled
     */
    _peerDisabled: toPeer(state.disabled),
    /**
     *  Styles to apply when a parent element with `.group`, `data-group` or `role=group` is invalid
     */
    _groupInvalid: toGroup(state.invalid),
    /**
     *  Styles to apply when a sibling element with `.peer` or `data-peer` is invalid
     */
    _peerInvalid: toPeer(state.invalid),
    /**
     * Styles to apply when a parent element with `.group`, `data-group` or `role=group` is checked
     */
    _groupChecked: toGroup(state.checked),
    /**
     * Styles to apply when a sibling element with `.peer` or `data-peer` is checked
     */
    _peerChecked: toPeer(state.checked),
    /**
     *  Styles to apply when a parent element with `.group`, `data-group` or `role=group` has focus within
     */
    _groupFocusWithin: toGroup(state.focusWithin),
    /**
     *  Styles to apply when a sibling element with `.peer` or `data-peer` has focus within
     */
    _peerFocusWithin: toPeer(state.focusWithin),
    /**
     * Styles to apply when a sibling element with `.peer` or `data-peer` has placeholder shown
     */
    _peerPlaceholderShown: toPeer(state.placeholderShown),
    /**
     * Styles for CSS Selector `&::placeholder`.
     */
    _placeholder: "&::placeholder, &[data-placeholder]",
    /**
     * Styles for CSS Selector `&:placeholder-shown`.
     */
    _placeholderShown: "&:placeholder-shown, &[data-placeholder-shown]",
    /**
     * Styles for CSS Selector `&:fullscreen`.
     */
    _fullScreen: "&:fullscreen, &[data-fullscreen]",
    /**
     * Styles for CSS Selector `&::selection`
     */
    _selection: "&::selection",
    /**
     * Styles for CSS Selector `[dir=rtl] &`
     * It is applied when a parent element or this element has `dir="rtl"`
     */
    _rtl: "[dir=rtl] &, &[dir=rtl]",
    /**
     * Styles for CSS Selector `[dir=ltr] &`
     * It is applied when a parent element or this element has `dir="ltr"`
     */
    _ltr: "[dir=ltr] &, &[dir=ltr]",
    /**
     * Styles for CSS Selector `@media (prefers-color-scheme: dark)`
     * It is used when the user has requested the system use a light or dark color theme.
     */
    _mediaDark: "@media (prefers-color-scheme: dark)",
    /**
     * Styles for CSS Selector `@media (prefers-reduced-motion: reduce)`
     * It is used when the user has requested the system to reduce the amount of animations.
     */
    _mediaReduceMotion: "@media (prefers-reduced-motion: reduce)",
    /**
     * Styles for when `data-theme` is applied to any parent of
     * this component or element.
     */
    _dark: ".chakra-ui-dark &:not([data-theme]),[data-theme=dark] &:not([data-theme]),&[data-theme=dark]",
    /**
     * Styles for when `data-theme` is applied to any parent of
     * this component or element.
     */
    _light: ".chakra-ui-light &:not([data-theme]),[data-theme=light] &:not([data-theme]),&[data-theme=light]",
    /**
     * Styles for the CSS Selector `&[data-orientation=horizontal]`
     */
    _horizontal: "&[data-orientation=horizontal]",
    /**
     * Styles for the CSS Selector `&[data-orientation=vertical]`
     */
    _vertical: "&[data-orientation=vertical]",
    /**
     * Styles for the CSS Selector `&[data-open], &[open], &[data-state=open]`
     */
    _open: "&[data-open], &[open], &[data-state=open]",
    /**
     * Styles for the CSS Selector `&[data-closed], &[data-state=closed]`
     */
    _closed: "&[data-closed], &[data-state=closed]",
    /**
     * Styles for the CSS Selector `&[data-complete]`
     */
    _complete: "&[data-complete]",
    /**
     * Styles for the CSS Selector `&[data-incomplete]`
     */
    _incomplete: "&[data-incomplete]",
    /**
     * Styles for the CSS Selector `&[data-current]`
     */
    _current: "&[data-current]"
  };
  var pseudoPropNames = Object.keys(
    pseudoSelectors
  );

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/system.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/background.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/utils/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/utils/create-transform.mjs
  init_define_import_meta_env();
  var isImportant = (value) => /!(important)?$/.test(value);
  var withoutImportant = (value) => typeof value === "string" ? value.replace(/!(important)?$/, "").trim() : value;
  var tokenToCSSVar = (scale2, value) => (theme2) => {
    const valueStr = String(value);
    const important = isImportant(valueStr);
    const valueWithoutImportant = withoutImportant(valueStr);
    const key = scale2 ? `${scale2}.${valueWithoutImportant}` : valueWithoutImportant;
    let transformed = isObject(theme2.__cssMap) && key in theme2.__cssMap ? theme2.__cssMap[key].varRef : value;
    transformed = withoutImportant(transformed);
    return important ? `${transformed} !important` : transformed;
  };
  function createTransform(options) {
    const { scale: scale2, transform: transform2, compose } = options;
    const fn = (value, theme2) => {
      const _value = tokenToCSSVar(scale2, value)(theme2);
      let result = transform2?.(_value, theme2) ?? _value;
      if (compose) {
        result = compose(result, theme2);
      }
      return result;
    };
    return fn;
  }

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/utils/pipe.mjs
  init_define_import_meta_env();
  var pipe = (...fns) => (v) => fns.reduce((a, b) => b(a), v);

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/utils/prop-config.mjs
  init_define_import_meta_env();
  function toConfig(scale2, transform2) {
    return (property) => {
      const result = { property, scale: scale2 };
      result.transform = createTransform({
        scale: scale2,
        transform: transform2
      });
      return result;
    };
  }
  var getRtl = ({ rtl, ltr }) => (theme2) => theme2.direction === "rtl" ? rtl : ltr;
  function logical(options) {
    const { property, scale: scale2, transform: transform2 } = options;
    return {
      scale: scale2,
      property: getRtl(property),
      transform: scale2 ? createTransform({
        scale: scale2,
        compose: transform2
      }) : transform2
    };
  }

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/utils/transform-functions.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/utils/templates.mjs
  init_define_import_meta_env();
  var transformTemplate = [
    "rotate(var(--chakra-rotate, 0))",
    "scaleX(var(--chakra-scale-x, 1))",
    "scaleY(var(--chakra-scale-y, 1))",
    "skewX(var(--chakra-skew-x, 0))",
    "skewY(var(--chakra-skew-y, 0))"
  ];
  function getTransformTemplate() {
    return [
      "translateX(var(--chakra-translate-x, 0))",
      "translateY(var(--chakra-translate-y, 0))",
      ...transformTemplate
    ].join(" ");
  }
  function getTransformGpuTemplate() {
    return [
      "translate3d(var(--chakra-translate-x, 0), var(--chakra-translate-y, 0), 0)",
      ...transformTemplate
    ].join(" ");
  }
  var filterTemplate = {
    "--chakra-blur": "var(--chakra-empty,/*!*/ /*!*/)",
    "--chakra-brightness": "var(--chakra-empty,/*!*/ /*!*/)",
    "--chakra-contrast": "var(--chakra-empty,/*!*/ /*!*/)",
    "--chakra-grayscale": "var(--chakra-empty,/*!*/ /*!*/)",
    "--chakra-hue-rotate": "var(--chakra-empty,/*!*/ /*!*/)",
    "--chakra-invert": "var(--chakra-empty,/*!*/ /*!*/)",
    "--chakra-saturate": "var(--chakra-empty,/*!*/ /*!*/)",
    "--chakra-sepia": "var(--chakra-empty,/*!*/ /*!*/)",
    "--chakra-drop-shadow": "var(--chakra-empty,/*!*/ /*!*/)",
    filter: [
      "var(--chakra-blur)",
      "var(--chakra-brightness)",
      "var(--chakra-contrast)",
      "var(--chakra-grayscale)",
      "var(--chakra-hue-rotate)",
      "var(--chakra-invert)",
      "var(--chakra-saturate)",
      "var(--chakra-sepia)",
      "var(--chakra-drop-shadow)"
    ].join(" ")
  };
  var backdropFilterTemplate = {
    backdropFilter: [
      "var(--chakra-backdrop-blur)",
      "var(--chakra-backdrop-brightness)",
      "var(--chakra-backdrop-contrast)",
      "var(--chakra-backdrop-grayscale)",
      "var(--chakra-backdrop-hue-rotate)",
      "var(--chakra-backdrop-invert)",
      "var(--chakra-backdrop-opacity)",
      "var(--chakra-backdrop-saturate)",
      "var(--chakra-backdrop-sepia)"
    ].join(" "),
    "--chakra-backdrop-blur": "var(--chakra-empty,/*!*/ /*!*/)",
    "--chakra-backdrop-brightness": "var(--chakra-empty,/*!*/ /*!*/)",
    "--chakra-backdrop-contrast": "var(--chakra-empty,/*!*/ /*!*/)",
    "--chakra-backdrop-grayscale": "var(--chakra-empty,/*!*/ /*!*/)",
    "--chakra-backdrop-hue-rotate": "var(--chakra-empty,/*!*/ /*!*/)",
    "--chakra-backdrop-invert": "var(--chakra-empty,/*!*/ /*!*/)",
    "--chakra-backdrop-opacity": "var(--chakra-empty,/*!*/ /*!*/)",
    "--chakra-backdrop-saturate": "var(--chakra-empty,/*!*/ /*!*/)",
    "--chakra-backdrop-sepia": "var(--chakra-empty,/*!*/ /*!*/)"
  };
  function getRingTemplate(value) {
    return {
      "--chakra-ring-offset-shadow": `var(--chakra-ring-inset) 0 0 0 var(--chakra-ring-offset-width) var(--chakra-ring-offset-color)`,
      "--chakra-ring-shadow": `var(--chakra-ring-inset) 0 0 0 calc(var(--chakra-ring-width) + var(--chakra-ring-offset-width)) var(--chakra-ring-color)`,
      "--chakra-ring-width": value,
      boxShadow: [
        `var(--chakra-ring-offset-shadow)`,
        `var(--chakra-ring-shadow)`,
        `var(--chakra-shadow, 0 0 #0000)`
      ].join(", ")
    };
  }
  var flexDirectionTemplate = {
    "row-reverse": {
      space: "--chakra-space-x-reverse",
      divide: "--chakra-divide-x-reverse"
    },
    "column-reverse": {
      space: "--chakra-space-y-reverse",
      divide: "--chakra-divide-y-reverse"
    }
  };

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/utils/parse-gradient.mjs
  init_define_import_meta_env();
  var directionMap = {
    "to-t": "to top",
    "to-tr": "to top right",
    "to-r": "to right",
    "to-br": "to bottom right",
    "to-b": "to bottom",
    "to-bl": "to bottom left",
    "to-l": "to left",
    "to-tl": "to top left"
  };
  var valueSet = new Set(Object.values(directionMap));
  var globalSet = /* @__PURE__ */ new Set([
    "none",
    "-moz-initial",
    "inherit",
    "initial",
    "revert",
    "unset"
  ]);
  var trimSpace = (str) => str.trim();
  function parseGradient(value, theme2) {
    if (value == null || globalSet.has(value))
      return value;
    const prevent = isCSSFunction(value) || globalSet.has(value);
    if (!prevent)
      return `url('${value}')`;
    const regex = /(^[a-z-A-Z]+)\((.*)\)/g;
    const results = regex.exec(value);
    const type = results?.[1];
    const values = results?.[2];
    if (!type || !values)
      return value;
    const _type = type.includes("-gradient") ? type : `${type}-gradient`;
    const [maybeDirection, ...stops] = values.split(",").map(trimSpace).filter(Boolean);
    if (stops?.length === 0)
      return value;
    const direction2 = maybeDirection in directionMap ? directionMap[maybeDirection] : maybeDirection;
    stops.unshift(direction2);
    const _values = stops.map((stop) => {
      if (valueSet.has(stop))
        return stop;
      const firstStop = stop.indexOf(" ");
      const [_color, _stop] = firstStop !== -1 ? [stop.substr(0, firstStop), stop.substr(firstStop + 1)] : [stop];
      const _stopOrFunc = isCSSFunction(_stop) ? _stop : _stop && _stop.split(" ");
      const key = `colors.${_color}`;
      const color3 = key in theme2.__cssMap ? theme2.__cssMap[key].varRef : _color;
      return _stopOrFunc ? [
        color3,
        ...Array.isArray(_stopOrFunc) ? _stopOrFunc : [_stopOrFunc]
      ].join(" ") : color3;
    });
    return `${_type}(${_values.join(", ")})`;
  }
  var isCSSFunction = (value) => {
    return typeof value === "string" && value.includes("(") && value.includes(")");
  };
  var gradientTransform = (value, theme2) => parseGradient(value, theme2 ?? {});

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/utils/transform-functions.mjs
  function isCssVar2(value) {
    return /^var\(--.+\)$/.test(value);
  }
  var analyzeCSSValue2 = (value) => {
    const num = parseFloat(value.toString());
    const unit = value.toString().replace(String(num), "");
    return { unitless: !unit, value: num, unit };
  };
  var wrap = (str) => (value) => `${str}(${value})`;
  var transformFunctions = {
    filter(value) {
      return value !== "auto" ? value : filterTemplate;
    },
    backdropFilter(value) {
      return value !== "auto" ? value : backdropFilterTemplate;
    },
    ring(value) {
      return getRingTemplate(transformFunctions.px(value));
    },
    bgClip(value) {
      return value === "text" ? { color: "transparent", backgroundClip: "text" } : { backgroundClip: value };
    },
    transform(value) {
      if (value === "auto")
        return getTransformTemplate();
      if (value === "auto-gpu")
        return getTransformGpuTemplate();
      return value;
    },
    vh(value) {
      return value === "$100vh" ? "var(--chakra-vh)" : value;
    },
    px(value) {
      if (value == null)
        return value;
      const { unitless } = analyzeCSSValue2(value);
      return unitless || typeof value === "number" ? `${value}px` : value;
    },
    fraction(value) {
      return !(typeof value === "number") || value > 1 ? value : `${value * 100}%`;
    },
    float(value, theme2) {
      const map = { left: "right", right: "left" };
      return theme2.direction === "rtl" ? map[value] : value;
    },
    degree(value) {
      if (isCssVar2(value) || value == null)
        return value;
      const unitless = typeof value === "string" && !value.endsWith("deg");
      return typeof value === "number" || unitless ? `${value}deg` : value;
    },
    gradient: gradientTransform,
    blur: wrap("blur"),
    opacity: wrap("opacity"),
    brightness: wrap("brightness"),
    contrast: wrap("contrast"),
    dropShadow: wrap("drop-shadow"),
    grayscale: wrap("grayscale"),
    hueRotate: (value) => wrap("hue-rotate")(transformFunctions.degree(value)),
    invert: wrap("invert"),
    saturate: wrap("saturate"),
    sepia: wrap("sepia"),
    bgImage(value) {
      if (value == null)
        return value;
      const prevent = isCSSFunction(value) || globalSet.has(value);
      return !prevent ? `url(${value})` : value;
    },
    outline(value) {
      const isNoneOrZero = String(value) === "0" || String(value) === "none";
      return value !== null && isNoneOrZero ? { outline: "2px solid transparent", outlineOffset: "2px" } : { outline: value };
    },
    flexDirection(value) {
      const { space: space2, divide: divide3 } = flexDirectionTemplate[value] ?? {};
      const result = { flexDirection: value };
      if (space2)
        result[space2] = 1;
      if (divide3)
        result[divide3] = 1;
      return result;
    }
  };

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/utils/index.mjs
  var t = {
    borderWidths: toConfig("borderWidths"),
    borderStyles: toConfig("borderStyles"),
    colors: toConfig("colors"),
    borders: toConfig("borders"),
    gradients: toConfig("gradients", transformFunctions.gradient),
    radii: toConfig("radii", transformFunctions.px),
    space: toConfig("space", pipe(transformFunctions.vh, transformFunctions.px)),
    spaceT: toConfig("space", pipe(transformFunctions.vh, transformFunctions.px)),
    degreeT(property) {
      return { property, transform: transformFunctions.degree };
    },
    prop(property, scale2, transform2) {
      return {
        property,
        scale: scale2,
        ...scale2 && {
          transform: createTransform({ scale: scale2, transform: transform2 })
        }
      };
    },
    propT(property, transform2) {
      return { property, transform: transform2 };
    },
    sizes: toConfig("sizes", pipe(transformFunctions.vh, transformFunctions.px)),
    sizesT: toConfig("sizes", pipe(transformFunctions.vh, transformFunctions.fraction)),
    shadows: toConfig("shadows"),
    logical,
    blur: toConfig("blur", transformFunctions.blur)
  };

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/background.mjs
  var background = {
    background: t.colors("background"),
    backgroundColor: t.colors("backgroundColor"),
    backgroundImage: t.gradients("backgroundImage"),
    backgroundSize: true,
    backgroundPosition: true,
    backgroundRepeat: true,
    backgroundAttachment: true,
    backgroundClip: { transform: transformFunctions.bgClip },
    bgSize: t.prop("backgroundSize"),
    bgPosition: t.prop("backgroundPosition"),
    bg: t.colors("background"),
    bgColor: t.colors("backgroundColor"),
    bgPos: t.prop("backgroundPosition"),
    bgRepeat: t.prop("backgroundRepeat"),
    bgAttachment: t.prop("backgroundAttachment"),
    bgGradient: t.gradients("backgroundImage"),
    bgClip: { transform: transformFunctions.bgClip }
  };
  Object.assign(background, {
    bgImage: background.backgroundImage,
    bgImg: background.backgroundImage
  });

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/border.mjs
  init_define_import_meta_env();
  var border = {
    border: t.borders("border"),
    borderWidth: t.borderWidths("borderWidth"),
    borderStyle: t.borderStyles("borderStyle"),
    borderColor: t.colors("borderColor"),
    borderRadius: t.radii("borderRadius"),
    borderTop: t.borders("borderTop"),
    borderBlockStart: t.borders("borderBlockStart"),
    borderTopLeftRadius: t.radii("borderTopLeftRadius"),
    borderStartStartRadius: t.logical({
      scale: "radii",
      property: {
        ltr: "borderTopLeftRadius",
        rtl: "borderTopRightRadius"
      }
    }),
    borderEndStartRadius: t.logical({
      scale: "radii",
      property: {
        ltr: "borderBottomLeftRadius",
        rtl: "borderBottomRightRadius"
      }
    }),
    borderTopRightRadius: t.radii("borderTopRightRadius"),
    borderStartEndRadius: t.logical({
      scale: "radii",
      property: {
        ltr: "borderTopRightRadius",
        rtl: "borderTopLeftRadius"
      }
    }),
    borderEndEndRadius: t.logical({
      scale: "radii",
      property: {
        ltr: "borderBottomRightRadius",
        rtl: "borderBottomLeftRadius"
      }
    }),
    borderRight: t.borders("borderRight"),
    borderInlineEnd: t.borders("borderInlineEnd"),
    borderBottom: t.borders("borderBottom"),
    borderBlockEnd: t.borders("borderBlockEnd"),
    borderBottomLeftRadius: t.radii("borderBottomLeftRadius"),
    borderBottomRightRadius: t.radii("borderBottomRightRadius"),
    borderLeft: t.borders("borderLeft"),
    borderInlineStart: {
      property: "borderInlineStart",
      scale: "borders"
    },
    borderInlineStartRadius: t.logical({
      scale: "radii",
      property: {
        ltr: ["borderTopLeftRadius", "borderBottomLeftRadius"],
        rtl: ["borderTopRightRadius", "borderBottomRightRadius"]
      }
    }),
    borderInlineEndRadius: t.logical({
      scale: "radii",
      property: {
        ltr: ["borderTopRightRadius", "borderBottomRightRadius"],
        rtl: ["borderTopLeftRadius", "borderBottomLeftRadius"]
      }
    }),
    borderX: t.borders(["borderLeft", "borderRight"]),
    borderInline: t.borders("borderInline"),
    borderY: t.borders(["borderTop", "borderBottom"]),
    borderBlock: t.borders("borderBlock"),
    borderTopWidth: t.borderWidths("borderTopWidth"),
    borderBlockStartWidth: t.borderWidths("borderBlockStartWidth"),
    borderTopColor: t.colors("borderTopColor"),
    borderBlockStartColor: t.colors("borderBlockStartColor"),
    borderTopStyle: t.borderStyles("borderTopStyle"),
    borderBlockStartStyle: t.borderStyles("borderBlockStartStyle"),
    borderBottomWidth: t.borderWidths("borderBottomWidth"),
    borderBlockEndWidth: t.borderWidths("borderBlockEndWidth"),
    borderBottomColor: t.colors("borderBottomColor"),
    borderBlockEndColor: t.colors("borderBlockEndColor"),
    borderBottomStyle: t.borderStyles("borderBottomStyle"),
    borderBlockEndStyle: t.borderStyles("borderBlockEndStyle"),
    borderLeftWidth: t.borderWidths("borderLeftWidth"),
    borderInlineStartWidth: t.borderWidths("borderInlineStartWidth"),
    borderLeftColor: t.colors("borderLeftColor"),
    borderInlineStartColor: t.colors("borderInlineStartColor"),
    borderLeftStyle: t.borderStyles("borderLeftStyle"),
    borderInlineStartStyle: t.borderStyles("borderInlineStartStyle"),
    borderRightWidth: t.borderWidths("borderRightWidth"),
    borderInlineEndWidth: t.borderWidths("borderInlineEndWidth"),
    borderRightColor: t.colors("borderRightColor"),
    borderInlineEndColor: t.colors("borderInlineEndColor"),
    borderRightStyle: t.borderStyles("borderRightStyle"),
    borderInlineEndStyle: t.borderStyles("borderInlineEndStyle"),
    borderTopRadius: t.radii(["borderTopLeftRadius", "borderTopRightRadius"]),
    borderBottomRadius: t.radii([
      "borderBottomLeftRadius",
      "borderBottomRightRadius"
    ]),
    borderLeftRadius: t.radii(["borderTopLeftRadius", "borderBottomLeftRadius"]),
    borderRightRadius: t.radii([
      "borderTopRightRadius",
      "borderBottomRightRadius"
    ])
  };
  Object.assign(border, {
    rounded: border.borderRadius,
    roundedTop: border.borderTopRadius,
    roundedTopLeft: border.borderTopLeftRadius,
    roundedTopRight: border.borderTopRightRadius,
    roundedTopStart: border.borderStartStartRadius,
    roundedTopEnd: border.borderStartEndRadius,
    roundedBottom: border.borderBottomRadius,
    roundedBottomLeft: border.borderBottomLeftRadius,
    roundedBottomRight: border.borderBottomRightRadius,
    roundedBottomStart: border.borderEndStartRadius,
    roundedBottomEnd: border.borderEndEndRadius,
    roundedLeft: border.borderLeftRadius,
    roundedRight: border.borderRightRadius,
    roundedStart: border.borderInlineStartRadius,
    roundedEnd: border.borderInlineEndRadius,
    borderStart: border.borderInlineStart,
    borderEnd: border.borderInlineEnd,
    borderTopStartRadius: border.borderStartStartRadius,
    borderTopEndRadius: border.borderStartEndRadius,
    borderBottomStartRadius: border.borderEndStartRadius,
    borderBottomEndRadius: border.borderEndEndRadius,
    borderStartRadius: border.borderInlineStartRadius,
    borderEndRadius: border.borderInlineEndRadius,
    borderStartWidth: border.borderInlineStartWidth,
    borderEndWidth: border.borderInlineEndWidth,
    borderStartColor: border.borderInlineStartColor,
    borderEndColor: border.borderInlineEndColor,
    borderStartStyle: border.borderInlineStartStyle,
    borderEndStyle: border.borderInlineEndStyle
  });

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/color.mjs
  init_define_import_meta_env();
  var color = {
    color: t.colors("color"),
    textColor: t.colors("color"),
    fill: t.colors("fill"),
    stroke: t.colors("stroke"),
    accentColor: t.colors("accentColor"),
    textFillColor: t.colors("textFillColor")
  };

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/flexbox.mjs
  init_define_import_meta_env();
  var flexbox = {
    alignItems: true,
    alignContent: true,
    justifyItems: true,
    justifyContent: true,
    flexWrap: true,
    flexDirection: { transform: transformFunctions.flexDirection },
    flex: true,
    flexFlow: true,
    flexGrow: true,
    flexShrink: true,
    flexBasis: t.sizes("flexBasis"),
    justifySelf: true,
    alignSelf: true,
    order: true,
    placeItems: true,
    placeContent: true,
    placeSelf: true,
    gap: t.space("gap"),
    rowGap: t.space("rowGap"),
    columnGap: t.space("columnGap")
  };
  Object.assign(flexbox, {
    flexDir: flexbox.flexDirection
  });

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/layout.mjs
  init_define_import_meta_env();
  var layout = {
    width: t.sizesT("width"),
    inlineSize: t.sizesT("inlineSize"),
    height: t.sizes("height"),
    blockSize: t.sizes("blockSize"),
    boxSize: t.sizes(["width", "height"]),
    minWidth: t.sizes("minWidth"),
    minInlineSize: t.sizes("minInlineSize"),
    minHeight: t.sizes("minHeight"),
    minBlockSize: t.sizes("minBlockSize"),
    maxWidth: t.sizes("maxWidth"),
    maxInlineSize: t.sizes("maxInlineSize"),
    maxHeight: t.sizes("maxHeight"),
    maxBlockSize: t.sizes("maxBlockSize"),
    overflow: true,
    overflowX: true,
    overflowY: true,
    overscrollBehavior: true,
    overscrollBehaviorX: true,
    overscrollBehaviorY: true,
    display: true,
    aspectRatio: true,
    hideFrom: {
      scale: "breakpoints",
      transform: (value, theme2) => {
        const breakpoint = theme2.__breakpoints?.get(value)?.minW ?? value;
        const mq = `@media screen and (min-width: ${breakpoint})`;
        return { [mq]: { display: "none" } };
      }
    },
    hideBelow: {
      scale: "breakpoints",
      transform: (value, theme2) => {
        const breakpoint = theme2.__breakpoints?.get(value)?._minW ?? value;
        const mq = `@media screen and (max-width: ${breakpoint})`;
        return { [mq]: { display: "none" } };
      }
    },
    verticalAlign: true,
    boxSizing: true,
    boxDecorationBreak: true,
    float: t.propT("float", transformFunctions.float),
    objectFit: true,
    objectPosition: true,
    visibility: true,
    isolation: true
  };
  Object.assign(layout, {
    w: layout.width,
    h: layout.height,
    minW: layout.minWidth,
    maxW: layout.maxWidth,
    minH: layout.minHeight,
    maxH: layout.maxHeight,
    overscroll: layout.overscrollBehavior,
    overscrollX: layout.overscrollBehaviorX,
    overscrollY: layout.overscrollBehaviorY
  });

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/filter.mjs
  init_define_import_meta_env();
  var filter = {
    filter: { transform: transformFunctions.filter },
    blur: t.blur("--chakra-blur"),
    brightness: t.propT("--chakra-brightness", transformFunctions.brightness),
    contrast: t.propT("--chakra-contrast", transformFunctions.contrast),
    hueRotate: t.propT("--chakra-hue-rotate", transformFunctions.hueRotate),
    invert: t.propT("--chakra-invert", transformFunctions.invert),
    saturate: t.propT("--chakra-saturate", transformFunctions.saturate),
    dropShadow: t.propT("--chakra-drop-shadow", transformFunctions.dropShadow),
    backdropFilter: { transform: transformFunctions.backdropFilter },
    backdropBlur: t.blur("--chakra-backdrop-blur"),
    backdropBrightness: t.propT(
      "--chakra-backdrop-brightness",
      transformFunctions.brightness
    ),
    backdropContrast: t.propT("--chakra-backdrop-contrast", transformFunctions.contrast),
    backdropHueRotate: t.propT(
      "--chakra-backdrop-hue-rotate",
      transformFunctions.hueRotate
    ),
    backdropInvert: t.propT("--chakra-backdrop-invert", transformFunctions.invert),
    backdropSaturate: t.propT("--chakra-backdrop-saturate", transformFunctions.saturate)
  };

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/ring.mjs
  init_define_import_meta_env();
  var ring = {
    ring: { transform: transformFunctions.ring },
    ringColor: t.colors("--chakra-ring-color"),
    ringOffset: t.prop("--chakra-ring-offset-width"),
    ringOffsetColor: t.colors("--chakra-ring-offset-color"),
    ringInset: t.prop("--chakra-ring-inset")
  };

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/interactivity.mjs
  init_define_import_meta_env();
  var interactivity = {
    appearance: true,
    cursor: true,
    resize: true,
    userSelect: true,
    pointerEvents: true,
    outline: { transform: transformFunctions.outline },
    outlineOffset: true,
    outlineColor: t.colors("outlineColor")
  };

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/grid.mjs
  init_define_import_meta_env();
  var grid = {
    gridGap: t.space("gridGap"),
    gridColumnGap: t.space("gridColumnGap"),
    gridRowGap: t.space("gridRowGap"),
    gridColumn: true,
    gridRow: true,
    gridAutoFlow: true,
    gridAutoColumns: true,
    gridColumnStart: true,
    gridColumnEnd: true,
    gridRowStart: true,
    gridRowEnd: true,
    gridAutoRows: true,
    gridTemplate: true,
    gridTemplateColumns: true,
    gridTemplateRows: true,
    gridTemplateAreas: true,
    gridArea: true
  };

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/others.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/get.mjs
  init_define_import_meta_env();
  function get2(obj, path, fallback, index) {
    const key = typeof path === "string" ? path.split(".") : [path];
    for (index = 0; index < key.length; index += 1) {
      if (!obj)
        break;
      obj = obj[key[index]];
    }
    return obj === void 0 ? fallback : obj;
  }
  var memoize2 = (fn) => {
    const cache = /* @__PURE__ */ new WeakMap();
    const memoizedFn = (obj, path, fallback, index) => {
      if (typeof obj === "undefined") {
        return fn(obj, path, fallback);
      }
      if (!cache.has(obj)) {
        cache.set(obj, /* @__PURE__ */ new Map());
      }
      const map = cache.get(obj);
      if (map.has(path)) {
        return map.get(path);
      }
      const value = fn(obj, path, fallback, index);
      map.set(path, value);
      return value;
    };
    return memoizedFn;
  };
  var memoizedGet2 = memoize2(get2);

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/others.mjs
  var srOnly = {
    border: "0px",
    clip: "rect(0, 0, 0, 0)",
    width: "1px",
    height: "1px",
    margin: "-1px",
    padding: "0px",
    overflow: "hidden",
    whiteSpace: "nowrap",
    position: "absolute"
  };
  var srFocusable = {
    position: "static",
    width: "auto",
    height: "auto",
    clip: "auto",
    padding: "0",
    margin: "0",
    overflow: "visible",
    whiteSpace: "normal"
  };
  var getWithPriority = (theme2, key, styles2) => {
    const result = {};
    const obj = memoizedGet2(theme2, key, {});
    for (const prop in obj) {
      const isInStyles = prop in styles2 && styles2[prop] != null;
      if (!isInStyles)
        result[prop] = obj[prop];
    }
    return result;
  };
  var others = {
    srOnly: {
      transform(value) {
        if (value === true)
          return srOnly;
        if (value === "focusable")
          return srFocusable;
        return {};
      }
    },
    layerStyle: {
      processResult: true,
      transform: (value, theme2, styles2) => getWithPriority(theme2, `layerStyles.${value}`, styles2)
    },
    textStyle: {
      processResult: true,
      transform: (value, theme2, styles2) => getWithPriority(theme2, `textStyles.${value}`, styles2)
    },
    apply: {
      processResult: true,
      transform: (value, theme2, styles2) => getWithPriority(theme2, value, styles2)
    }
  };

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/position.mjs
  init_define_import_meta_env();
  var position = {
    position: true,
    pos: t.prop("position"),
    zIndex: t.prop("zIndex", "zIndices"),
    inset: t.spaceT("inset"),
    insetX: t.spaceT(["left", "right"]),
    insetInline: t.spaceT("insetInline"),
    insetY: t.spaceT(["top", "bottom"]),
    insetBlock: t.spaceT("insetBlock"),
    top: t.spaceT("top"),
    insetBlockStart: t.spaceT("insetBlockStart"),
    bottom: t.spaceT("bottom"),
    insetBlockEnd: t.spaceT("insetBlockEnd"),
    left: t.spaceT("left"),
    insetInlineStart: t.logical({
      scale: "space",
      property: { ltr: "left", rtl: "right" }
    }),
    right: t.spaceT("right"),
    insetInlineEnd: t.logical({
      scale: "space",
      property: { ltr: "right", rtl: "left" }
    })
  };
  Object.assign(position, {
    insetStart: position.insetInlineStart,
    insetEnd: position.insetInlineEnd
  });

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/effect.mjs
  init_define_import_meta_env();
  var effect = {
    boxShadow: t.shadows("boxShadow"),
    mixBlendMode: true,
    blendMode: t.prop("mixBlendMode"),
    backgroundBlendMode: true,
    bgBlendMode: t.prop("backgroundBlendMode"),
    opacity: true
  };
  Object.assign(effect, {
    shadow: effect.boxShadow
  });

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/space.mjs
  init_define_import_meta_env();
  var space = {
    margin: t.spaceT("margin"),
    marginTop: t.spaceT("marginTop"),
    marginBlockStart: t.spaceT("marginBlockStart"),
    marginRight: t.spaceT("marginRight"),
    marginInlineEnd: t.spaceT("marginInlineEnd"),
    marginBottom: t.spaceT("marginBottom"),
    marginBlockEnd: t.spaceT("marginBlockEnd"),
    marginLeft: t.spaceT("marginLeft"),
    marginInlineStart: t.spaceT("marginInlineStart"),
    marginX: t.spaceT(["marginInlineStart", "marginInlineEnd"]),
    marginInline: t.spaceT("marginInline"),
    marginY: t.spaceT(["marginTop", "marginBottom"]),
    marginBlock: t.spaceT("marginBlock"),
    padding: t.space("padding"),
    paddingTop: t.space("paddingTop"),
    paddingBlockStart: t.space("paddingBlockStart"),
    paddingRight: t.space("paddingRight"),
    paddingBottom: t.space("paddingBottom"),
    paddingBlockEnd: t.space("paddingBlockEnd"),
    paddingLeft: t.space("paddingLeft"),
    paddingInlineStart: t.space("paddingInlineStart"),
    paddingInlineEnd: t.space("paddingInlineEnd"),
    paddingX: t.space(["paddingInlineStart", "paddingInlineEnd"]),
    paddingInline: t.space("paddingInline"),
    paddingY: t.space(["paddingTop", "paddingBottom"]),
    paddingBlock: t.space("paddingBlock")
  };
  Object.assign(space, {
    m: space.margin,
    mt: space.marginTop,
    mr: space.marginRight,
    me: space.marginInlineEnd,
    marginEnd: space.marginInlineEnd,
    mb: space.marginBottom,
    ml: space.marginLeft,
    ms: space.marginInlineStart,
    marginStart: space.marginInlineStart,
    mx: space.marginX,
    my: space.marginY,
    p: space.padding,
    pt: space.paddingTop,
    py: space.paddingY,
    px: space.paddingX,
    pb: space.paddingBottom,
    pl: space.paddingLeft,
    ps: space.paddingInlineStart,
    paddingStart: space.paddingInlineStart,
    pr: space.paddingRight,
    pe: space.paddingInlineEnd,
    paddingEnd: space.paddingInlineEnd
  });

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/scroll.mjs
  init_define_import_meta_env();
  var scroll = {
    scrollBehavior: true,
    scrollSnapAlign: true,
    scrollSnapStop: true,
    scrollSnapType: true,
    // scroll margin
    scrollMargin: t.spaceT("scrollMargin"),
    scrollMarginTop: t.spaceT("scrollMarginTop"),
    scrollMarginBottom: t.spaceT("scrollMarginBottom"),
    scrollMarginLeft: t.spaceT("scrollMarginLeft"),
    scrollMarginRight: t.spaceT("scrollMarginRight"),
    scrollMarginX: t.spaceT(["scrollMarginLeft", "scrollMarginRight"]),
    scrollMarginY: t.spaceT(["scrollMarginTop", "scrollMarginBottom"]),
    // scroll padding
    scrollPadding: t.spaceT("scrollPadding"),
    scrollPaddingTop: t.spaceT("scrollPaddingTop"),
    scrollPaddingBottom: t.spaceT("scrollPaddingBottom"),
    scrollPaddingLeft: t.spaceT("scrollPaddingLeft"),
    scrollPaddingRight: t.spaceT("scrollPaddingRight"),
    scrollPaddingX: t.spaceT(["scrollPaddingLeft", "scrollPaddingRight"]),
    scrollPaddingY: t.spaceT(["scrollPaddingTop", "scrollPaddingBottom"])
  };

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/typography.mjs
  init_define_import_meta_env();
  var typography = {
    fontFamily: t.prop("fontFamily", "fonts"),
    fontSize: t.prop("fontSize", "fontSizes", transformFunctions.px),
    fontWeight: t.prop("fontWeight", "fontWeights"),
    lineHeight: t.prop("lineHeight", "lineHeights"),
    letterSpacing: t.prop("letterSpacing", "letterSpacings"),
    textAlign: true,
    fontStyle: true,
    textIndent: true,
    wordBreak: true,
    overflowWrap: true,
    textOverflow: true,
    textTransform: true,
    whiteSpace: true,
    isTruncated: {
      transform(value) {
        if (value === true) {
          return {
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          };
        }
      }
    },
    noOfLines: {
      static: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        //@ts-ignore
        WebkitLineClamp: "var(--chakra-line-clamp)"
      },
      property: "--chakra-line-clamp"
    }
  };

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/text-decoration.mjs
  init_define_import_meta_env();
  var textDecoration = {
    textDecorationColor: t.colors("textDecorationColor"),
    textDecoration: true,
    textDecor: { property: "textDecoration" },
    textDecorationLine: true,
    textDecorationStyle: true,
    textDecorationThickness: true,
    textUnderlineOffset: true,
    textShadow: t.shadows("textShadow")
  };

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/transform.mjs
  init_define_import_meta_env();
  var transform = {
    clipPath: true,
    transform: t.propT("transform", transformFunctions.transform),
    transformOrigin: true,
    translateX: t.spaceT("--chakra-translate-x"),
    translateY: t.spaceT("--chakra-translate-y"),
    skewX: t.degreeT("--chakra-skew-x"),
    skewY: t.degreeT("--chakra-skew-y"),
    scaleX: t.prop("--chakra-scale-x"),
    scaleY: t.prop("--chakra-scale-y"),
    scale: t.prop(["--chakra-scale-x", "--chakra-scale-y"]),
    rotate: t.degreeT("--chakra-rotate")
  };

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/list.mjs
  init_define_import_meta_env();
  var list = {
    listStyleType: true,
    listStylePosition: true,
    listStylePos: t.prop("listStylePosition"),
    listStyleImage: true,
    listStyleImg: t.prop("listStyleImage")
  };

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/config/transition.mjs
  init_define_import_meta_env();
  var transition = {
    transition: true,
    transitionDelay: true,
    animation: true,
    willChange: true,
    transitionDuration: t.prop("transitionDuration", "transition.duration"),
    transitionProperty: t.prop("transitionProperty", "transition.property"),
    transitionTimingFunction: t.prop(
      "transitionTimingFunction",
      "transition.easing"
    )
  };

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/system.mjs
  var systemProps = (0, import_lodash.default)(
    {},
    background,
    border,
    color,
    flexbox,
    layout,
    filter,
    ring,
    interactivity,
    grid,
    others,
    position,
    effect,
    space,
    scroll,
    typography,
    textDecoration,
    transform,
    list,
    transition
  );
  var layoutSystem = Object.assign({}, space, layout, flexbox, grid, position);
  var layoutPropNames = Object.keys(
    layoutSystem
  );
  var propNames = [...Object.keys(systemProps), ...pseudoPropNames];
  var styleProps = { ...systemProps, ...pseudoSelectors };
  var isStyleProp = (prop) => prop in styleProps;

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/utils/expand-responsive.mjs
  init_define_import_meta_env();
  var expandResponsive = (styles2) => (theme2) => {
    if (!theme2.__breakpoints)
      return styles2;
    const { isResponsive, toArrayValue, media: medias } = theme2.__breakpoints;
    const computedStyles = {};
    for (const key in styles2) {
      let value = runIfFn(styles2[key], theme2);
      if (value == null)
        continue;
      value = isObject(value) && isResponsive(value) ? toArrayValue(value) : value;
      if (!Array.isArray(value)) {
        computedStyles[key] = value;
        continue;
      }
      const queries = value.slice(0, medias.length).length;
      for (let index = 0; index < queries; index += 1) {
        const media = medias?.[index];
        if (!media) {
          computedStyles[key] = value[index];
          continue;
        }
        computedStyles[media] = computedStyles[media] || {};
        if (value[index] == null) {
          continue;
        }
        computedStyles[media][key] = value[index];
      }
    }
    return computedStyles;
  };

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/utils/split-by-comma.mjs
  init_define_import_meta_env();
  function splitByComma(value) {
    const chunks = [];
    let chunk = "";
    let inParens = false;
    for (let i = 0; i < value.length; i++) {
      const char2 = value[i];
      if (char2 === "(") {
        inParens = true;
        chunk += char2;
      } else if (char2 === ")") {
        inParens = false;
        chunk += char2;
      } else if (char2 === "," && !inParens) {
        chunks.push(chunk);
        chunk = "";
      } else {
        chunk += char2;
      }
    }
    chunk = chunk.trim();
    if (chunk) {
      chunks.push(chunk);
    }
    return chunks;
  }

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/css.mjs
  function isCssVar3(value) {
    return /^var\(--.+\)$/.test(value);
  }
  var isCSSVariableTokenValue = (key, value) => key.startsWith("--") && typeof value === "string" && !isCssVar3(value);
  var resolveTokenValue = (theme2, value) => {
    if (value == null)
      return value;
    const getVar = (val) => theme2.__cssMap?.[val]?.varRef;
    const getValue = (val) => getVar(val) ?? val;
    const [tokenValue, fallbackValue] = splitByComma(value);
    value = getVar(tokenValue) ?? getValue(fallbackValue) ?? getValue(value);
    return value;
  };
  function getCss(options) {
    const { configs = {}, pseudos = {}, theme: theme2 } = options;
    const css22 = (stylesOrFn, nested = false) => {
      const _styles = runIfFn(stylesOrFn, theme2);
      const styles2 = expandResponsive(_styles)(theme2);
      let computedStyles = {};
      for (let key in styles2) {
        const valueOrFn = styles2[key];
        let value = runIfFn(valueOrFn, theme2);
        if (key in pseudos) {
          key = pseudos[key];
        }
        if (isCSSVariableTokenValue(key, value)) {
          value = resolveTokenValue(theme2, value);
        }
        let config2 = configs[key];
        if (config2 === true) {
          config2 = { property: key };
        }
        if (isObject(value)) {
          computedStyles[key] = computedStyles[key] ?? {};
          computedStyles[key] = (0, import_lodash.default)(
            {},
            computedStyles[key],
            css22(value, true)
          );
          continue;
        }
        let rawValue = config2?.transform?.(value, theme2, _styles) ?? value;
        rawValue = config2?.processResult ? css22(rawValue, true) : rawValue;
        const configProperty = runIfFn(config2?.property, theme2);
        if (!nested && config2?.static) {
          const staticStyles = runIfFn(config2.static, theme2);
          computedStyles = (0, import_lodash.default)({}, computedStyles, staticStyles);
        }
        if (configProperty && Array.isArray(configProperty)) {
          for (const property of configProperty) {
            computedStyles[property] = rawValue;
          }
          continue;
        }
        if (configProperty) {
          if (configProperty === "&" && isObject(rawValue)) {
            computedStyles = (0, import_lodash.default)({}, computedStyles, rawValue);
          } else {
            computedStyles[configProperty] = rawValue;
          }
          continue;
        }
        if (isObject(rawValue)) {
          computedStyles = (0, import_lodash.default)({}, computedStyles, rawValue);
          continue;
        }
        computedStyles[key] = rawValue;
      }
      return computedStyles;
    };
    return css22;
  }
  var css = (styles2) => (theme2) => {
    const cssFn = getCss({
      theme: theme2,
      pseudos: pseudoSelectors,
      configs: systemProps
    });
    return cssFn(styles2);
  };

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/define-styles.mjs
  init_define_import_meta_env();
  function defineStyle(styles2) {
    return styles2;
  }
  function defineStyleConfig(config2) {
    return config2;
  }
  function createMultiStyleConfigHelpers(parts) {
    return {
      definePartsStyle(config2) {
        return config2;
      },
      defineMultiStyleConfig(config2) {
        return { parts, ...config2 };
      }
    };
  }

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/style-config.mjs
  init_define_import_meta_env();
  function normalize2(value, toArray) {
    if (Array.isArray(value))
      return value;
    if (isObject(value))
      return toArray(value);
    if (value != null)
      return [value];
  }
  function getNextIndex(values, i) {
    for (let j = i + 1; j < values.length; j++) {
      if (values[j] != null)
        return j;
    }
    return -1;
  }
  function createResolver(theme2) {
    const breakpointUtil = theme2.__breakpoints;
    return function resolver(config2, prop, value, props) {
      if (!breakpointUtil)
        return;
      const result = {};
      const normalized = normalize2(value, breakpointUtil.toArrayValue);
      if (!normalized)
        return result;
      const len = normalized.length;
      const isSingle = len === 1;
      const isMultipart = !!config2.parts;
      for (let i = 0; i < len; i++) {
        const key = breakpointUtil.details[i];
        const nextKey = breakpointUtil.details[getNextIndex(normalized, i)];
        const query = toMediaQueryString(key.minW, nextKey?._minW);
        const styles2 = runIfFn(config2[prop]?.[normalized[i]], props);
        if (!styles2)
          continue;
        if (isMultipart) {
          config2.parts?.forEach((part) => {
            (0, import_lodash.default)(result, {
              [part]: isSingle ? styles2[part] : { [query]: styles2[part] }
            });
          });
          continue;
        }
        if (!isMultipart) {
          if (isSingle)
            (0, import_lodash.default)(result, styles2);
          else
            result[query] = styles2;
          continue;
        }
        result[query] = styles2;
      }
      return result;
    };
  }
  function resolveStyleConfig(config2) {
    return (props) => {
      const { variant, size: size2, theme: theme2 } = props;
      const recipe = createResolver(theme2);
      return (0, import_lodash.default)(
        {},
        runIfFn(config2.baseStyle ?? {}, props),
        recipe(config2, "sizes", size2, props),
        recipe(config2, "variants", variant, props)
      );
    };
  }

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/theming-props.mjs
  init_define_import_meta_env();
  function omitThemingProps(props) {
    return omit(props, ["styleConfig", "size", "variant", "colorScheme"]);
  }

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/create-theme-vars/calc.mjs
  init_define_import_meta_env();
  function resolveReference(operand) {
    if (isObject(operand) && operand.reference) {
      return operand.reference;
    }
    return String(operand);
  }
  var toExpression = (operator, ...operands) => operands.map(resolveReference).join(` ${operator} `).replace(/calc/g, "");
  var add = (...operands) => `calc(${toExpression("+", ...operands)})`;
  var subtract2 = (...operands) => `calc(${toExpression("-", ...operands)})`;
  var multiply = (...operands) => `calc(${toExpression("*", ...operands)})`;
  var divide = (...operands) => `calc(${toExpression("/", ...operands)})`;
  var negate = (x) => {
    const value = resolveReference(x);
    if (value != null && !Number.isNaN(parseFloat(value))) {
      return String(value).startsWith("-") ? String(value).slice(1) : `-${value}`;
    }
    return multiply(value, -1);
  };
  var calc = Object.assign(
    (x) => ({
      add: (...operands) => calc(add(x, ...operands)),
      subtract: (...operands) => calc(subtract2(x, ...operands)),
      multiply: (...operands) => calc(multiply(x, ...operands)),
      divide: (...operands) => calc(divide(x, ...operands)),
      negate: () => calc(negate(x)),
      toString: () => x.toString()
    }),
    {
      add,
      subtract: subtract2,
      multiply,
      divide,
      negate
    }
  );

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/create-theme-vars/css-var.mjs
  init_define_import_meta_env();
  function replaceWhiteSpace(value, replaceValue = "-") {
    return value.replace(/\s+/g, replaceValue);
  }
  function escape(value) {
    const valueStr = replaceWhiteSpace(value.toString());
    return escapeSymbol(escapeDot(valueStr));
  }
  function escapeDot(value) {
    if (value.includes("\\."))
      return value;
    const isDecimal2 = !Number.isInteger(parseFloat(value.toString()));
    return isDecimal2 ? value.replace(".", `\\.`) : value;
  }
  function escapeSymbol(value) {
    return value.replace(/[!-,/:-@[-^`{-~]/g, "\\$&");
  }
  function addPrefix(value, prefix2 = "") {
    return [prefix2, value].filter(Boolean).join("-");
  }
  function toVarReference(name, fallback) {
    return `var(${name}${fallback ? `, ${fallback}` : ""})`;
  }
  function toVarDefinition(value, prefix2 = "") {
    return escape(`--${addPrefix(value, prefix2)}`);
  }
  function cssVar(name, fallback, cssVarPrefix) {
    const cssVariable = toVarDefinition(name, cssVarPrefix);
    return {
      variable: cssVariable,
      reference: toVarReference(cssVariable, fallback)
    };
  }
  function defineCssVars(scope, keys2) {
    const vars2 = {};
    for (const key of keys2) {
      if (Array.isArray(key)) {
        const [name, fallback] = key;
        vars2[name] = cssVar(`${scope}-${name}`, fallback);
        continue;
      }
      vars2[key] = cssVar(`${scope}-${key}`);
    }
    return vars2;
  }

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/create-theme-vars/to-css-var.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/create-theme-vars/create-theme-vars.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/create-theme-vars/flatten-tokens.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/create-theme-vars/theme-tokens.mjs
  init_define_import_meta_env();
  var tokens = [
    "colors",
    "borders",
    "borderWidths",
    "borderStyles",
    "fonts",
    "fontSizes",
    "fontWeights",
    "gradients",
    "letterSpacings",
    "lineHeights",
    "radii",
    "space",
    "shadows",
    "sizes",
    "zIndices",
    "transition",
    "blur",
    "breakpoints"
  ];
  function extractTokens(theme2) {
    const _tokens = tokens;
    return pick(theme2, _tokens);
  }
  function extractSemanticTokens(theme2) {
    return theme2.semanticTokens;
  }
  function omitVars(rawTheme) {
    const { __cssMap, __cssVars, __breakpoints, ...cleanTheme } = rawTheme;
    return cleanTheme;
  }

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/create-theme-vars/flatten-tokens.mjs
  function flattenTokens(theme2) {
    const tokens2 = extractTokens(theme2);
    const semanticTokens2 = extractSemanticTokens(theme2);
    const isSemanticCondition = (key) => (
      // @ts-ignore
      pseudoPropNames.includes(key) || "default" === key
    );
    const result = {};
    walkObject(tokens2, (value, path) => {
      if (value == null)
        return;
      result[path.join(".")] = { isSemantic: false, value };
    });
    walkObject(
      semanticTokens2,
      (value, path) => {
        if (value == null)
          return;
        result[path.join(".")] = { isSemantic: true, value };
      },
      {
        stop: (value) => Object.keys(value).every(isSemanticCondition)
      }
    );
    return result;
  }

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/create-theme-vars/create-theme-vars.mjs
  function tokenToCssVar(token2, prefix2) {
    return cssVar(String(token2).replace(/\./g, "-"), void 0, prefix2);
  }
  function createThemeVars(theme2) {
    const flatTokens = flattenTokens(theme2);
    const cssVarPrefix = theme2.config?.cssVarPrefix;
    let cssVars = {};
    const cssMap = {};
    function lookupToken(token2, maybeToken) {
      const scale2 = String(token2).split(".")[0];
      const withScale = [scale2, maybeToken].join(".");
      const resolvedTokenValue = flatTokens[withScale];
      if (!resolvedTokenValue)
        return maybeToken;
      const { reference } = tokenToCssVar(withScale, cssVarPrefix);
      return reference;
    }
    for (const [token2, tokenValue] of Object.entries(flatTokens)) {
      const { isSemantic, value } = tokenValue;
      const { variable, reference } = tokenToCssVar(token2, cssVarPrefix);
      if (!isSemantic) {
        if (token2.startsWith("space")) {
          const keys2 = token2.split(".");
          const [firstKey, ...referenceKeys] = keys2;
          const negativeLookupKey = `${firstKey}.-${referenceKeys.join(".")}`;
          const negativeValue = calc.negate(value);
          const negatedReference = calc.negate(reference);
          cssMap[negativeLookupKey] = {
            value: negativeValue,
            var: variable,
            varRef: negatedReference
          };
        }
        cssVars[variable] = value;
        cssMap[token2] = {
          value,
          var: variable,
          varRef: reference
        };
        continue;
      }
      const normalizedValue = isObject(value) ? value : { default: value };
      cssVars = (0, import_lodash.default)(
        cssVars,
        Object.entries(normalizedValue).reduce(
          (acc, [conditionAlias, conditionValue]) => {
            if (!conditionValue)
              return acc;
            const tokenReference = lookupToken(token2, `${conditionValue}`);
            if (conditionAlias === "default") {
              acc[variable] = tokenReference;
              return acc;
            }
            const conditionSelector = pseudoSelectors?.[conditionAlias] ?? conditionAlias;
            acc[conditionSelector] = { [variable]: tokenReference };
            return acc;
          },
          {}
        )
      );
      cssMap[token2] = {
        value: reference,
        var: variable,
        varRef: reference
      };
    }
    return {
      cssVars,
      cssMap
    };
  }

  // remix/node_modules/.pnpm/@chakra-ui+styled-system@2.12.5_react@18.3.1/node_modules/@chakra-ui/styled-system/dist/esm/create-theme-vars/to-css-var.mjs
  function toCSSVar(rawTheme) {
    const theme2 = omitVars(rawTheme);
    const {
      /**
       * This is more like a dictionary of tokens users will type `green.500`,
       * and their equivalent css variable.
       */
      cssMap,
      /**
       * The extracted css variables will be stored here, and used in
       * the emotion's <Global/> component to attach variables to `:root`
       */
      cssVars
    } = createThemeVars(theme2);
    const defaultCssVars = {
      "--chakra-ring-inset": "var(--chakra-empty,/*!*/ /*!*/)",
      "--chakra-ring-offset-width": "0px",
      "--chakra-ring-offset-color": "#fff",
      "--chakra-ring-color": "rgba(66, 153, 225, 0.6)",
      "--chakra-ring-offset-shadow": "0 0 #0000",
      "--chakra-ring-shadow": "0 0 #0000",
      "--chakra-space-x-reverse": "0",
      "--chakra-space-y-reverse": "0"
    };
    Object.assign(theme2, {
      __cssVars: { ...defaultCssVars, ...cssVars },
      __cssMap: cssMap,
      __breakpoints: analyzeBreakpoints(theme2.breakpoints)
    });
    return theme2;
  }

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/accordion.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+anatomy@2.3.6/node_modules/@chakra-ui/anatomy/dist/esm/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+anatomy@2.3.6/node_modules/@chakra-ui/anatomy/dist/esm/create-anatomy.mjs
  init_define_import_meta_env();
  function anatomy(name, map = {}) {
    let called = false;
    function assert() {
      if (!called) {
        called = true;
        return;
      }
      throw new Error(
        "[anatomy] .part(...) should only be called once. Did you mean to use .extend(...) ?"
      );
    }
    function parts(...values) {
      assert();
      for (const part of values) {
        map[part] = toPart(part);
      }
      return anatomy(name, map);
    }
    function extend(...parts2) {
      for (const part of parts2) {
        if (part in map)
          continue;
        map[part] = toPart(part);
      }
      return anatomy(name, map);
    }
    function selectors() {
      const value = Object.fromEntries(
        Object.entries(map).map(([key, part]) => [key, part.selector])
      );
      return value;
    }
    function classnames() {
      const value = Object.fromEntries(
        Object.entries(map).map(([key, part]) => [key, part.className])
      );
      return value;
    }
    function toPart(part) {
      const el = ["container", "root"].includes(part ?? "") ? [name] : [name, part];
      const attr = el.filter(Boolean).join("__");
      const className = `chakra-${attr}`;
      const partObj = {
        className,
        selector: `.${className}`,
        toString: () => part
      };
      return partObj;
    }
    const __type = {};
    return {
      parts,
      toPart,
      extend,
      selectors,
      classnames,
      get keys() {
        return Object.keys(map);
      },
      __type
    };
  }

  // remix/node_modules/.pnpm/@chakra-ui+anatomy@2.3.6/node_modules/@chakra-ui/anatomy/dist/esm/components.mjs
  init_define_import_meta_env();
  var accordionAnatomy = anatomy("accordion").parts(
    "root",
    "container",
    "button",
    "panel",
    "icon"
  );
  var alertAnatomy = anatomy("alert").parts(
    "title",
    "description",
    "container",
    "icon",
    "spinner"
  );
  var avatarAnatomy = anatomy("avatar").parts(
    "label",
    "badge",
    "container",
    "excessLabel",
    "group"
  );
  var breadcrumbAnatomy = anatomy("breadcrumb").parts(
    "link",
    "item",
    "container",
    "separator"
  );
  var buttonAnatomy = anatomy("button").parts();
  var checkboxAnatomy = anatomy("checkbox").parts(
    "control",
    "icon",
    "container",
    "label"
  );
  var circularProgressAnatomy = anatomy("progress").parts(
    "track",
    "filledTrack",
    "label"
  );
  var drawerAnatomy = anatomy("drawer").parts(
    "overlay",
    "dialogContainer",
    "dialog",
    "header",
    "closeButton",
    "body",
    "footer"
  );
  var editableAnatomy = anatomy("editable").parts(
    "preview",
    "input",
    "textarea"
  );
  var formAnatomy = anatomy("form").parts(
    "container",
    "requiredIndicator",
    "helperText"
  );
  var formErrorAnatomy = anatomy("formError").parts("text", "icon");
  var inputAnatomy = anatomy("input").parts(
    "addon",
    "field",
    "element",
    "group"
  );
  var listAnatomy = anatomy("list").parts("container", "item", "icon");
  var menuAnatomy = anatomy("menu").parts(
    "button",
    "list",
    "item",
    "groupTitle",
    "icon",
    "command",
    "divider"
  );
  var modalAnatomy = anatomy("modal").parts(
    "overlay",
    "dialogContainer",
    "dialog",
    "header",
    "closeButton",
    "body",
    "footer"
  );
  var numberInputAnatomy = anatomy("numberinput").parts(
    "root",
    "field",
    "stepperGroup",
    "stepper"
  );
  var pinInputAnatomy = anatomy("pininput").parts("field");
  var popoverAnatomy = anatomy("popover").parts(
    "content",
    "header",
    "body",
    "footer",
    "popper",
    "arrow",
    "closeButton"
  );
  var progressAnatomy = anatomy("progress").parts(
    "label",
    "filledTrack",
    "track"
  );
  var radioAnatomy = anatomy("radio").parts(
    "container",
    "control",
    "label"
  );
  var selectAnatomy = anatomy("select").parts("field", "icon");
  var sliderAnatomy = anatomy("slider").parts(
    "container",
    "track",
    "thumb",
    "filledTrack",
    "mark"
  );
  var statAnatomy = anatomy("stat").parts(
    "container",
    "label",
    "helpText",
    "number",
    "icon"
  );
  var switchAnatomy = anatomy("switch").parts(
    "container",
    "track",
    "thumb",
    "label"
  );
  var tableAnatomy = anatomy("table").parts(
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "tfoot",
    "caption"
  );
  var tabsAnatomy = anatomy("tabs").parts(
    "root",
    "tab",
    "tablist",
    "tabpanel",
    "tabpanels",
    "indicator"
  );
  var tagAnatomy = anatomy("tag").parts(
    "container",
    "label",
    "closeButton"
  );
  var cardAnatomy = anatomy("card").parts(
    "container",
    "header",
    "body",
    "footer"
  );
  var stepperAnatomy = anatomy("stepper").parts(
    "stepper",
    "step",
    "title",
    "description",
    "indicator",
    "separator",
    "icon",
    "number"
  );

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/accordion.mjs
  var { definePartsStyle, defineMultiStyleConfig } = createMultiStyleConfigHelpers(accordionAnatomy.keys);
  var baseStyleContainer = defineStyle({
    borderTopWidth: "1px",
    borderColor: "inherit",
    _last: {
      borderBottomWidth: "1px"
    }
  });
  var baseStyleButton = defineStyle({
    transitionProperty: "common",
    transitionDuration: "normal",
    fontSize: "md",
    _focusVisible: {
      boxShadow: "outline"
    },
    _hover: {
      bg: "blackAlpha.50"
    },
    _disabled: {
      opacity: 0.4,
      cursor: "not-allowed"
    },
    px: "4",
    py: "2"
  });
  var baseStylePanel = defineStyle({
    pt: "2",
    px: "4",
    pb: "5"
  });
  var baseStyleIcon = defineStyle({
    fontSize: "1.25em"
  });
  var baseStyle = definePartsStyle({
    container: baseStyleContainer,
    button: baseStyleButton,
    panel: baseStylePanel,
    icon: baseStyleIcon
  });
  var accordionTheme = defineMultiStyleConfig({ baseStyle });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/alert.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+theme-tools@2.2.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme-tools/dist/esm/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+theme-tools@2.2.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme-tools/dist/esm/color.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/color2k@2.0.3/node_modules/color2k/dist/index.exports.import.es.mjs
  init_define_import_meta_env();
  function guard(low, high, value) {
    return Math.min(Math.max(low, value), high);
  }
  var ColorError = class extends Error {
    constructor(color3) {
      super(`Failed to parse color: "${color3}"`);
    }
  };
  var ColorError$1 = ColorError;
  function parseToRgba(color3) {
    if (typeof color3 !== "string") throw new ColorError$1(color3);
    if (color3.trim().toLowerCase() === "transparent") return [0, 0, 0, 0];
    let normalizedColor = color3.trim();
    normalizedColor = namedColorRegex.test(color3) ? nameToHex(color3) : color3;
    const reducedHexMatch = reducedHexRegex.exec(normalizedColor);
    if (reducedHexMatch) {
      const arr = Array.from(reducedHexMatch).slice(1);
      return [...arr.slice(0, 3).map((x) => parseInt(r(x, 2), 16)), parseInt(r(arr[3] || "f", 2), 16) / 255];
    }
    const hexMatch = hexRegex.exec(normalizedColor);
    if (hexMatch) {
      const arr = Array.from(hexMatch).slice(1);
      return [...arr.slice(0, 3).map((x) => parseInt(x, 16)), parseInt(arr[3] || "ff", 16) / 255];
    }
    const rgbaMatch = rgbaRegex.exec(normalizedColor);
    if (rgbaMatch) {
      const arr = Array.from(rgbaMatch).slice(1);
      return [...arr.slice(0, 3).map((x) => parseInt(x, 10)), parseFloat(arr[3] || "1")];
    }
    const hslaMatch = hslaRegex.exec(normalizedColor);
    if (hslaMatch) {
      const [h, s, l, a] = Array.from(hslaMatch).slice(1).map(parseFloat);
      if (guard(0, 100, s) !== s) throw new ColorError$1(color3);
      if (guard(0, 100, l) !== l) throw new ColorError$1(color3);
      return [...hslToRgb(h, s, l), Number.isNaN(a) ? 1 : a];
    }
    throw new ColorError$1(color3);
  }
  function hash(str) {
    let hash3 = 5381;
    let i = str.length;
    while (i) {
      hash3 = hash3 * 33 ^ str.charCodeAt(--i);
    }
    return (hash3 >>> 0) % 2341;
  }
  var colorToInt = (x) => parseInt(x.replace(/_/g, ""), 36);
  var compressedColorMap = "1q29ehhb 1n09sgk7 1kl1ekf_ _yl4zsno 16z9eiv3 1p29lhp8 _bd9zg04 17u0____ _iw9zhe5 _to73___ _r45e31e _7l6g016 _jh8ouiv _zn3qba8 1jy4zshs 11u87k0u 1ro9yvyo 1aj3xael 1gz9zjz0 _3w8l4xo 1bf1ekf_ _ke3v___ _4rrkb__ 13j776yz _646mbhl _nrjr4__ _le6mbhl 1n37ehkb _m75f91n _qj3bzfz 1939yygw 11i5z6x8 _1k5f8xs 1509441m 15t5lwgf _ae2th1n _tg1ugcv 1lp1ugcv 16e14up_ _h55rw7n _ny9yavn _7a11xb_ 1ih442g9 _pv442g9 1mv16xof 14e6y7tu 1oo9zkds 17d1cisi _4v9y70f _y98m8kc 1019pq0v 12o9zda8 _348j4f4 1et50i2o _8epa8__ _ts6senj 1o350i2o 1mi9eiuo 1259yrp0 1ln80gnw _632xcoy 1cn9zldc _f29edu4 1n490c8q _9f9ziet 1b94vk74 _m49zkct 1kz6s73a 1eu9dtog _q58s1rz 1dy9sjiq __u89jo3 _aj5nkwg _ld89jo3 13h9z6wx _qa9z2ii _l119xgq _bs5arju 1hj4nwk9 1qt4nwk9 1ge6wau6 14j9zlcw 11p1edc_ _ms1zcxe _439shk6 _jt9y70f _754zsow 1la40eju _oq5p___ _x279qkz 1fa5r3rv _yd2d9ip _424tcku _8y1di2_ _zi2uabw _yy7rn9h 12yz980_ __39ljp6 1b59zg0x _n39zfzp 1fy9zest _b33k___ _hp9wq92 1il50hz4 _io472ub _lj9z3eo 19z9ykg0 _8t8iu3a 12b9bl4a 1ak5yw0o _896v4ku _tb8k8lv _s59zi6t _c09ze0p 1lg80oqn 1id9z8wb _238nba5 1kq6wgdi _154zssg _tn3zk49 _da9y6tc 1sg7cv4f _r12jvtt 1gq5fmkz 1cs9rvci _lp9jn1c _xw1tdnb 13f9zje6 16f6973h _vo7ir40 _bt5arjf _rc45e4t _hr4e100 10v4e100 _hc9zke2 _w91egv_ _sj2r1kk 13c87yx8 _vqpds__ _ni8ggk8 _tj9yqfb 1ia2j4r4 _7x9b10u 1fc9ld4j 1eq9zldr _5j9lhpx _ez9zl6o _md61fzm".split(" ").reduce((acc, next2) => {
    const key = colorToInt(next2.substring(0, 3));
    const hex2 = colorToInt(next2.substring(3)).toString(16);
    let prefix2 = "";
    for (let i = 0; i < 6 - hex2.length; i++) {
      prefix2 += "0";
    }
    acc[key] = `${prefix2}${hex2}`;
    return acc;
  }, {});
  function nameToHex(color3) {
    const normalizedColorName = color3.toLowerCase().trim();
    const result = compressedColorMap[hash(normalizedColorName)];
    if (!result) throw new ColorError$1(color3);
    return `#${result}`;
  }
  var r = (str, amount) => Array.from(Array(amount)).map(() => str).join("");
  var reducedHexRegex = new RegExp(`^#${r("([a-f0-9])", 3)}([a-f0-9])?$`, "i");
  var hexRegex = new RegExp(`^#${r("([a-f0-9]{2})", 3)}([a-f0-9]{2})?$`, "i");
  var rgbaRegex = new RegExp(`^rgba?\\(\\s*(\\d+)\\s*${r(",\\s*(\\d+)\\s*", 2)}(?:,\\s*([\\d.]+))?\\s*\\)$`, "i");
  var hslaRegex = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(?:\s*,\s*([\d.]+))?\s*\)$/i;
  var namedColorRegex = /^[a-z]+$/i;
  var roundColor = (color3) => {
    return Math.round(color3 * 255);
  };
  var hslToRgb = (hue, saturation, lightness) => {
    let l = lightness / 100;
    if (saturation === 0) {
      return [l, l, l].map(roundColor);
    }
    const huePrime = (hue % 360 + 360) % 360 / 60;
    const chroma = (1 - Math.abs(2 * l - 1)) * (saturation / 100);
    const secondComponent = chroma * (1 - Math.abs(huePrime % 2 - 1));
    let red = 0;
    let green = 0;
    let blue = 0;
    if (huePrime >= 0 && huePrime < 1) {
      red = chroma;
      green = secondComponent;
    } else if (huePrime >= 1 && huePrime < 2) {
      red = secondComponent;
      green = chroma;
    } else if (huePrime >= 2 && huePrime < 3) {
      green = chroma;
      blue = secondComponent;
    } else if (huePrime >= 3 && huePrime < 4) {
      green = secondComponent;
      blue = chroma;
    } else if (huePrime >= 4 && huePrime < 5) {
      red = secondComponent;
      blue = chroma;
    } else if (huePrime >= 5 && huePrime < 6) {
      red = chroma;
      blue = secondComponent;
    }
    const lightnessModification = l - chroma / 2;
    const finalRed = red + lightnessModification;
    const finalGreen = green + lightnessModification;
    const finalBlue = blue + lightnessModification;
    return [finalRed, finalGreen, finalBlue].map(roundColor);
  };
  function rgba(red, green, blue, alpha2) {
    return `rgba(${guard(0, 255, red).toFixed()}, ${guard(0, 255, green).toFixed()}, ${guard(0, 255, blue).toFixed()}, ${parseFloat(guard(0, 1, alpha2).toFixed(3))})`;
  }
  function transparentize(color3, amount) {
    const [r2, g, b, a] = parseToRgba(color3);
    return rgba(r2, g, b, a - amount);
  }
  function toHex(color3) {
    const [r2, g, b, a] = parseToRgba(color3);
    let hex2 = (x) => {
      const h = guard(0, 255, x).toString(16);
      return h.length === 1 ? `0${h}` : h;
    };
    return `#${hex2(r2)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(Math.round(a * 255)) : ""}`;
  }

  // remix/node_modules/.pnpm/@chakra-ui+theme-tools@2.2.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme-tools/dist/esm/color.mjs
  var isEmptyObject2 = (obj) => Object.keys(obj).length === 0;
  function get3(obj, key, def, p, undef) {
    key = key.split ? key.split(".") : key;
    for (p = 0; p < key.length; p++) {
      obj = obj ? obj[key[p]] : undef;
    }
    return obj === undef ? def : obj;
  }
  var getColor = (theme2, color3, fallback) => {
    const hex2 = get3(theme2, `colors.${color3}`, color3);
    try {
      toHex(hex2);
      return hex2;
    } catch {
      return fallback ?? "#000000";
    }
  };
  var getBrightness = (color3) => {
    const [r2, g, b] = parseToRgba(color3);
    return (r2 * 299 + g * 587 + b * 114) / 1e3;
  };
  var tone = (color3) => (theme2) => {
    const hex2 = getColor(theme2, color3);
    const brightness = getBrightness(hex2);
    const isDark2 = brightness < 128;
    return isDark2 ? "dark" : "light";
  };
  var isDark = (color3) => (theme2) => tone(color3)(theme2) === "dark";
  var transparentize2 = (color3, opacity) => (theme2) => {
    const raw = getColor(theme2, color3);
    return transparentize(raw, 1 - opacity);
  };
  function generateStripe(size2 = "1rem", color3 = "rgba(255, 255, 255, 0.15)") {
    return {
      backgroundImage: `linear-gradient(
    45deg,
    ${color3} 25%,
    transparent 25%,
    transparent 50%,
    ${color3} 50%,
    ${color3} 75%,
    transparent 75%,
    transparent
  )`,
      backgroundSize: `${size2} ${size2}`
    };
  }
  var randomHex = () => `#${Math.floor(Math.random() * 16777215).toString(16).padEnd(6, "0")}`;
  function randomColor(opts) {
    const fallback = randomHex();
    if (!opts || isEmptyObject2(opts)) {
      return fallback;
    }
    if (opts.string && opts.colors) {
      return randomColorFromList(opts.string, opts.colors);
    }
    if (opts.string && !opts.colors) {
      return randomColorFromString(opts.string);
    }
    if (opts.colors && !opts.string) {
      return randomFromList(opts.colors);
    }
    return fallback;
  }
  function randomColorFromString(str) {
    let hash3 = 0;
    if (str.length === 0)
      return hash3.toString();
    for (let i = 0; i < str.length; i += 1) {
      hash3 = str.charCodeAt(i) + ((hash3 << 5) - hash3);
      hash3 = hash3 & hash3;
    }
    let color3 = "#";
    for (let j = 0; j < 3; j += 1) {
      const value = hash3 >> j * 8 & 255;
      color3 += `00${value.toString(16)}`.substr(-2);
    }
    return color3;
  }
  function randomColorFromList(str, list2) {
    let index = 0;
    if (str.length === 0)
      return list2[0];
    for (let i = 0; i < str.length; i += 1) {
      index = str.charCodeAt(i) + ((index << 5) - index);
      index = index & index;
    }
    index = (index % list2.length + list2.length) % list2.length;
    return list2[index];
  }
  function randomFromList(list2) {
    return list2[Math.floor(Math.random() * list2.length)];
  }

  // remix/node_modules/.pnpm/@chakra-ui+theme-tools@2.2.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme-tools/dist/esm/component.mjs
  init_define_import_meta_env();
  function mode(light, dark) {
    return (props) => props.colorMode === "dark" ? dark : light;
  }
  function orient(options) {
    const { orientation, vertical, horizontal } = options;
    if (!orientation)
      return {};
    return orientation === "vertical" ? vertical : horizontal;
  }

  // remix/node_modules/.pnpm/@chakra-ui+theme-tools@2.2.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme-tools/dist/esm/css-calc.mjs
  init_define_import_meta_env();
  function toRef(operand) {
    if (isObject(operand) && operand.reference) {
      return operand.reference;
    }
    return String(operand);
  }
  var toExpr = (operator, ...operands) => operands.map(toRef).join(` ${operator} `).replace(/calc/g, "");
  var add2 = (...operands) => `calc(${toExpr("+", ...operands)})`;
  var subtract3 = (...operands) => `calc(${toExpr("-", ...operands)})`;
  var multiply2 = (...operands) => `calc(${toExpr("*", ...operands)})`;
  var divide2 = (...operands) => `calc(${toExpr("/", ...operands)})`;
  var negate2 = (x) => {
    const value = toRef(x);
    if (value != null && !Number.isNaN(parseFloat(value))) {
      return String(value).startsWith("-") ? String(value).slice(1) : `-${value}`;
    }
    return multiply2(value, -1);
  };
  var calc2 = Object.assign(
    (x) => ({
      add: (...operands) => calc2(add2(x, ...operands)),
      subtract: (...operands) => calc2(subtract3(x, ...operands)),
      multiply: (...operands) => calc2(multiply2(x, ...operands)),
      divide: (...operands) => calc2(divide2(x, ...operands)),
      negate: () => calc2(negate2(x)),
      toString: () => x.toString()
    }),
    {
      add: add2,
      subtract: subtract3,
      multiply: multiply2,
      divide: divide2,
      negate: negate2
    }
  );

  // remix/node_modules/.pnpm/@chakra-ui+theme-tools@2.2.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme-tools/dist/esm/css-var.mjs
  init_define_import_meta_env();
  function isDecimal(value) {
    return !Number.isInteger(parseFloat(value.toString()));
  }
  function replaceWhiteSpace2(value, replaceValue = "-") {
    return value.replace(/\s+/g, replaceValue);
  }
  function escape2(value) {
    const valueStr = replaceWhiteSpace2(value.toString());
    if (valueStr.includes("\\."))
      return value;
    return isDecimal(value) ? valueStr.replace(".", `\\.`) : value;
  }
  function addPrefix2(value, prefix2 = "") {
    return [prefix2, escape2(value)].filter(Boolean).join("-");
  }
  function toVarRef(name, fallback) {
    return `var(${escape2(name)}${fallback ? `, ${fallback}` : ""})`;
  }
  function toVar(value, prefix2 = "") {
    return `--${addPrefix2(value, prefix2)}`;
  }
  function cssVar2(name, options) {
    const cssVariable = toVar(name, options?.prefix);
    return {
      variable: cssVariable,
      reference: toVarRef(cssVariable, getFallback(options?.fallback))
    };
  }
  function getFallback(fallback) {
    if (typeof fallback === "string")
      return fallback;
    return fallback?.reference;
  }

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/alert.mjs
  var { definePartsStyle: definePartsStyle2, defineMultiStyleConfig: defineMultiStyleConfig2 } = createMultiStyleConfigHelpers(alertAnatomy.keys);
  var $fg = cssVar("alert-fg");
  var $bg = cssVar("alert-bg");
  var baseStyle2 = definePartsStyle2({
    container: {
      bg: $bg.reference,
      px: "4",
      py: "3"
    },
    title: {
      fontWeight: "bold",
      lineHeight: "6",
      marginEnd: "2"
    },
    description: {
      lineHeight: "6"
    },
    icon: {
      color: $fg.reference,
      flexShrink: 0,
      marginEnd: "3",
      w: "5",
      h: "6"
    },
    spinner: {
      color: $fg.reference,
      flexShrink: 0,
      marginEnd: "3",
      w: "5",
      h: "5"
    }
  });
  function getBg(props) {
    const { theme: theme2, colorScheme: c } = props;
    const darkBg = transparentize2(`${c}.200`, 0.16)(theme2);
    return {
      light: `colors.${c}.100`,
      dark: darkBg
    };
  }
  var variantSubtle = definePartsStyle2((props) => {
    const { colorScheme: c } = props;
    const bg = getBg(props);
    return {
      container: {
        [$fg.variable]: `colors.${c}.600`,
        [$bg.variable]: bg.light,
        _dark: {
          [$fg.variable]: `colors.${c}.200`,
          [$bg.variable]: bg.dark
        }
      }
    };
  });
  var variantLeftAccent = definePartsStyle2((props) => {
    const { colorScheme: c } = props;
    const bg = getBg(props);
    return {
      container: {
        [$fg.variable]: `colors.${c}.600`,
        [$bg.variable]: bg.light,
        _dark: {
          [$fg.variable]: `colors.${c}.200`,
          [$bg.variable]: bg.dark
        },
        paddingStart: "3",
        borderStartWidth: "4px",
        borderStartColor: $fg.reference
      }
    };
  });
  var variantTopAccent = definePartsStyle2((props) => {
    const { colorScheme: c } = props;
    const bg = getBg(props);
    return {
      container: {
        [$fg.variable]: `colors.${c}.600`,
        [$bg.variable]: bg.light,
        _dark: {
          [$fg.variable]: `colors.${c}.200`,
          [$bg.variable]: bg.dark
        },
        pt: "2",
        borderTopWidth: "4px",
        borderTopColor: $fg.reference
      }
    };
  });
  var variantSolid = definePartsStyle2((props) => {
    const { colorScheme: c } = props;
    return {
      container: {
        [$fg.variable]: `colors.white`,
        [$bg.variable]: `colors.${c}.600`,
        _dark: {
          [$fg.variable]: `colors.gray.900`,
          [$bg.variable]: `colors.${c}.200`
        },
        color: $fg.reference
      }
    };
  });
  var variants = {
    subtle: variantSubtle,
    "left-accent": variantLeftAccent,
    "top-accent": variantTopAccent,
    solid: variantSolid
  };
  var alertTheme = defineMultiStyleConfig2({
    baseStyle: baseStyle2,
    variants,
    defaultProps: {
      variant: "subtle",
      colorScheme: "blue"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/avatar.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/foundations/sizes.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/foundations/spacing.mjs
  init_define_import_meta_env();
  var spacing = {
    px: "1px",
    0.5: "0.125rem",
    1: "0.25rem",
    1.5: "0.375rem",
    2: "0.5rem",
    2.5: "0.625rem",
    3: "0.75rem",
    3.5: "0.875rem",
    4: "1rem",
    5: "1.25rem",
    6: "1.5rem",
    7: "1.75rem",
    8: "2rem",
    9: "2.25rem",
    10: "2.5rem",
    12: "3rem",
    14: "3.5rem",
    16: "4rem",
    20: "5rem",
    24: "6rem",
    28: "7rem",
    32: "8rem",
    36: "9rem",
    40: "10rem",
    44: "11rem",
    48: "12rem",
    52: "13rem",
    56: "14rem",
    60: "15rem",
    64: "16rem",
    72: "18rem",
    80: "20rem",
    96: "24rem"
  };

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/foundations/sizes.mjs
  var largeSizes = {
    max: "max-content",
    min: "min-content",
    full: "100%",
    "3xs": "14rem",
    "2xs": "16rem",
    xs: "20rem",
    sm: "24rem",
    md: "28rem",
    lg: "32rem",
    xl: "36rem",
    "2xl": "42rem",
    "3xl": "48rem",
    "4xl": "56rem",
    "5xl": "64rem",
    "6xl": "72rem",
    "7xl": "80rem",
    "8xl": "90rem",
    prose: "60ch"
  };
  var container = {
    sm: "640px",
    md: "768px",
    lg: "1024px",
    xl: "1280px"
  };
  var sizes = {
    ...spacing,
    ...largeSizes,
    container
  };

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/utils/run-if-fn.mjs
  init_define_import_meta_env();
  var isFunction3 = (value) => typeof value === "function";
  function runIfFn2(valueOrFn, ...args) {
    return isFunction3(valueOrFn) ? valueOrFn(...args) : valueOrFn;
  }

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/avatar.mjs
  var { definePartsStyle: definePartsStyle3, defineMultiStyleConfig: defineMultiStyleConfig3 } = createMultiStyleConfigHelpers(avatarAnatomy.keys);
  var $border = cssVar("avatar-border-color");
  var $bg2 = cssVar("avatar-bg");
  var $fs = cssVar("avatar-font-size");
  var $size = cssVar("avatar-size");
  var baseStyleBadge = defineStyle({
    borderRadius: "full",
    border: "0.2em solid",
    borderColor: $border.reference,
    [$border.variable]: "white",
    _dark: {
      [$border.variable]: "colors.gray.800"
    }
  });
  var baseStyleExcessLabel = defineStyle({
    bg: $bg2.reference,
    fontSize: $fs.reference,
    width: $size.reference,
    height: $size.reference,
    lineHeight: "1",
    [$bg2.variable]: "colors.gray.200",
    _dark: {
      [$bg2.variable]: "colors.whiteAlpha.400"
    }
  });
  var baseStyleContainer2 = defineStyle((props) => {
    const { name, theme: theme2 } = props;
    const bg = name ? randomColor({ string: name }) : "colors.gray.400";
    const isBgDark = isDark(bg)(theme2);
    let color3 = "white";
    if (!isBgDark)
      color3 = "gray.800";
    return {
      bg: $bg2.reference,
      fontSize: $fs.reference,
      color: color3,
      borderColor: $border.reference,
      verticalAlign: "top",
      width: $size.reference,
      height: $size.reference,
      "&:not([data-loaded])": {
        [$bg2.variable]: bg
      },
      [$border.variable]: "colors.white",
      _dark: {
        [$border.variable]: "colors.gray.800"
      }
    };
  });
  var baseStyleLabel = defineStyle({
    fontSize: $fs.reference,
    lineHeight: "1"
  });
  var baseStyle3 = definePartsStyle3((props) => ({
    badge: runIfFn2(baseStyleBadge, props),
    excessLabel: runIfFn2(baseStyleExcessLabel, props),
    container: runIfFn2(baseStyleContainer2, props),
    label: baseStyleLabel
  }));
  function getSize(size2) {
    const themeSize = size2 !== "100%" ? sizes[size2] : void 0;
    return definePartsStyle3({
      container: {
        [$size.variable]: themeSize ?? size2,
        [$fs.variable]: `calc(${themeSize ?? size2} / 2.5)`
      },
      excessLabel: {
        [$size.variable]: themeSize ?? size2,
        [$fs.variable]: `calc(${themeSize ?? size2} / 2.5)`
      }
    });
  }
  var sizes2 = {
    "2xs": getSize(4),
    xs: getSize(6),
    sm: getSize(8),
    md: getSize(12),
    lg: getSize(16),
    xl: getSize(24),
    "2xl": getSize(32),
    full: getSize("100%")
  };
  var avatarTheme = defineMultiStyleConfig3({
    baseStyle: baseStyle3,
    sizes: sizes2,
    defaultProps: {
      size: "md"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/badge.mjs
  init_define_import_meta_env();
  var vars = defineCssVars("badge", ["bg", "color", "shadow"]);
  var baseStyle4 = defineStyle({
    px: 1,
    textTransform: "uppercase",
    fontSize: "xs",
    borderRadius: "sm",
    fontWeight: "bold",
    bg: vars.bg.reference,
    color: vars.color.reference,
    boxShadow: vars.shadow.reference
  });
  var variantSolid2 = defineStyle((props) => {
    const { colorScheme: c, theme: theme2 } = props;
    const dark = transparentize2(`${c}.500`, 0.6)(theme2);
    return {
      [vars.bg.variable]: `colors.${c}.500`,
      [vars.color.variable]: `colors.white`,
      _dark: {
        [vars.bg.variable]: dark,
        [vars.color.variable]: `colors.whiteAlpha.800`
      }
    };
  });
  var variantSubtle2 = defineStyle((props) => {
    const { colorScheme: c, theme: theme2 } = props;
    const darkBg = transparentize2(`${c}.200`, 0.16)(theme2);
    return {
      [vars.bg.variable]: `colors.${c}.100`,
      [vars.color.variable]: `colors.${c}.800`,
      _dark: {
        [vars.bg.variable]: darkBg,
        [vars.color.variable]: `colors.${c}.200`
      }
    };
  });
  var variantOutline = defineStyle((props) => {
    const { colorScheme: c, theme: theme2 } = props;
    const darkColor = transparentize2(`${c}.200`, 0.8)(theme2);
    return {
      [vars.color.variable]: `colors.${c}.500`,
      _dark: {
        [vars.color.variable]: darkColor
      },
      [vars.shadow.variable]: `inset 0 0 0px 1px ${vars.color.reference}`
    };
  });
  var variants2 = {
    solid: variantSolid2,
    subtle: variantSubtle2,
    outline: variantOutline
  };
  var badgeTheme = defineStyleConfig({
    baseStyle: baseStyle4,
    variants: variants2,
    defaultProps: {
      variant: "subtle",
      colorScheme: "gray"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/breadcrumb.mjs
  init_define_import_meta_env();
  var { defineMultiStyleConfig: defineMultiStyleConfig4, definePartsStyle: definePartsStyle4 } = createMultiStyleConfigHelpers(breadcrumbAnatomy.keys);
  var $decor = cssVar("breadcrumb-link-decor");
  var baseStyleLink = defineStyle({
    transitionProperty: "common",
    transitionDuration: "fast",
    transitionTimingFunction: "ease-out",
    outline: "none",
    color: "inherit",
    textDecoration: $decor.reference,
    [$decor.variable]: "none",
    "&:not([aria-current=page])": {
      cursor: "pointer",
      _hover: {
        [$decor.variable]: "underline"
      },
      _focusVisible: {
        boxShadow: "outline"
      }
    }
  });
  var baseStyle5 = definePartsStyle4({
    link: baseStyleLink
  });
  var breadcrumbTheme = defineMultiStyleConfig4({
    baseStyle: baseStyle5
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/button.mjs
  init_define_import_meta_env();
  var baseStyle6 = defineStyle({
    lineHeight: "1.2",
    borderRadius: "md",
    fontWeight: "semibold",
    transitionProperty: "common",
    transitionDuration: "normal",
    _focusVisible: {
      boxShadow: "outline"
    },
    _disabled: {
      opacity: 0.4,
      cursor: "not-allowed",
      boxShadow: "none"
    },
    _hover: {
      _disabled: {
        bg: "initial"
      }
    }
  });
  var variantGhost = defineStyle((props) => {
    const { colorScheme: c, theme: theme2 } = props;
    if (c === "gray") {
      return {
        color: mode(`gray.800`, `whiteAlpha.900`)(props),
        _hover: {
          bg: mode(`gray.100`, `whiteAlpha.200`)(props)
        },
        _active: { bg: mode(`gray.200`, `whiteAlpha.300`)(props) }
      };
    }
    const darkHoverBg = transparentize2(`${c}.200`, 0.12)(theme2);
    const darkActiveBg = transparentize2(`${c}.200`, 0.24)(theme2);
    return {
      color: mode(`${c}.600`, `${c}.200`)(props),
      bg: "transparent",
      _hover: {
        bg: mode(`${c}.50`, darkHoverBg)(props)
      },
      _active: {
        bg: mode(`${c}.100`, darkActiveBg)(props)
      }
    };
  });
  var variantOutline2 = defineStyle((props) => {
    const { colorScheme: c } = props;
    const borderColor = mode(`gray.200`, `whiteAlpha.300`)(props);
    return {
      border: "1px solid",
      borderColor: c === "gray" ? borderColor : "currentColor",
      ".chakra-button__group[data-attached][data-orientation=horizontal] > &:not(:last-of-type)": { marginEnd: "-1px" },
      ".chakra-button__group[data-attached][data-orientation=vertical] > &:not(:last-of-type)": { marginBottom: "-1px" },
      ...runIfFn2(variantGhost, props)
    };
  });
  var accessibleColorMap = {
    yellow: {
      bg: "yellow.400",
      color: "black",
      hoverBg: "yellow.500",
      activeBg: "yellow.600"
    },
    cyan: {
      bg: "cyan.400",
      color: "black",
      hoverBg: "cyan.500",
      activeBg: "cyan.600"
    }
  };
  var variantSolid3 = defineStyle((props) => {
    const { colorScheme: c } = props;
    if (c === "gray") {
      const bg2 = mode(`gray.100`, `whiteAlpha.200`)(props);
      return {
        bg: bg2,
        color: mode(`gray.800`, `whiteAlpha.900`)(props),
        _hover: {
          bg: mode(`gray.200`, `whiteAlpha.300`)(props),
          _disabled: {
            bg: bg2
          }
        },
        _active: { bg: mode(`gray.300`, `whiteAlpha.400`)(props) }
      };
    }
    const {
      bg = `${c}.500`,
      color: color3 = "white",
      hoverBg = `${c}.600`,
      activeBg = `${c}.700`
    } = accessibleColorMap[c] ?? {};
    const background2 = mode(bg, `${c}.200`)(props);
    return {
      bg: background2,
      color: mode(color3, `gray.800`)(props),
      _hover: {
        bg: mode(hoverBg, `${c}.300`)(props),
        _disabled: {
          bg: background2
        }
      },
      _active: { bg: mode(activeBg, `${c}.400`)(props) }
    };
  });
  var variantLink = defineStyle((props) => {
    const { colorScheme: c } = props;
    return {
      padding: 0,
      height: "auto",
      lineHeight: "normal",
      verticalAlign: "baseline",
      color: mode(`${c}.500`, `${c}.200`)(props),
      _hover: {
        textDecoration: "underline",
        _disabled: {
          textDecoration: "none"
        }
      },
      _active: {
        color: mode(`${c}.700`, `${c}.500`)(props)
      }
    };
  });
  var variantUnstyled = defineStyle({
    bg: "none",
    color: "inherit",
    display: "inline",
    lineHeight: "inherit",
    m: "0",
    p: "0"
  });
  var variants3 = {
    ghost: variantGhost,
    outline: variantOutline2,
    solid: variantSolid3,
    link: variantLink,
    unstyled: variantUnstyled
  };
  var sizes3 = {
    lg: defineStyle({
      h: "12",
      minW: "12",
      fontSize: "lg",
      px: "6"
    }),
    md: defineStyle({
      h: "10",
      minW: "10",
      fontSize: "md",
      px: "4"
    }),
    sm: defineStyle({
      h: "8",
      minW: "8",
      fontSize: "sm",
      px: "3"
    }),
    xs: defineStyle({
      h: "6",
      minW: "6",
      fontSize: "xs",
      px: "2"
    })
  };
  var buttonTheme = defineStyleConfig({
    baseStyle: baseStyle6,
    variants: variants3,
    sizes: sizes3,
    defaultProps: {
      variant: "solid",
      size: "md",
      colorScheme: "gray"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/card.mjs
  init_define_import_meta_env();
  var { definePartsStyle: definePartsStyle5, defineMultiStyleConfig: defineMultiStyleConfig5 } = createMultiStyleConfigHelpers(cardAnatomy.keys);
  var $bg3 = cssVar("card-bg");
  var $padding = cssVar("card-padding");
  var $shadow = cssVar("card-shadow");
  var $radius = cssVar("card-radius");
  var $border2 = cssVar("card-border-width", "0");
  var $borderColor = cssVar("card-border-color");
  var baseStyle7 = definePartsStyle5({
    container: {
      [$bg3.variable]: "colors.chakra-body-bg",
      backgroundColor: $bg3.reference,
      boxShadow: $shadow.reference,
      borderRadius: $radius.reference,
      color: "chakra-body-text",
      borderWidth: $border2.reference,
      borderColor: $borderColor.reference
    },
    body: {
      padding: $padding.reference,
      flex: "1 1 0%"
    },
    header: {
      padding: $padding.reference
    },
    footer: {
      padding: $padding.reference
    }
  });
  var sizes4 = {
    sm: definePartsStyle5({
      container: {
        [$radius.variable]: "radii.base",
        [$padding.variable]: "space.3"
      }
    }),
    md: definePartsStyle5({
      container: {
        [$radius.variable]: "radii.md",
        [$padding.variable]: "space.5"
      }
    }),
    lg: definePartsStyle5({
      container: {
        [$radius.variable]: "radii.xl",
        [$padding.variable]: "space.7"
      }
    })
  };
  var variants4 = {
    elevated: definePartsStyle5({
      container: {
        [$shadow.variable]: "shadows.base",
        _dark: {
          [$bg3.variable]: "colors.gray.700"
        }
      }
    }),
    outline: definePartsStyle5({
      container: {
        [$border2.variable]: "1px",
        [$borderColor.variable]: "colors.chakra-border-color"
      }
    }),
    filled: definePartsStyle5({
      container: {
        [$bg3.variable]: "colors.chakra-subtle-bg"
      }
    }),
    unstyled: {
      body: {
        [$padding.variable]: 0
      },
      header: {
        [$padding.variable]: 0
      },
      footer: {
        [$padding.variable]: 0
      }
    }
  };
  var cardTheme = defineMultiStyleConfig5({
    baseStyle: baseStyle7,
    variants: variants4,
    sizes: sizes4,
    defaultProps: {
      variant: "elevated",
      size: "md"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/checkbox.mjs
  init_define_import_meta_env();
  var { definePartsStyle: definePartsStyle6, defineMultiStyleConfig: defineMultiStyleConfig6 } = createMultiStyleConfigHelpers(checkboxAnatomy.keys);
  var $size2 = cssVar("checkbox-size");
  var baseStyleControl = defineStyle((props) => {
    const { colorScheme: c } = props;
    return {
      w: $size2.reference,
      h: $size2.reference,
      transitionProperty: "box-shadow",
      transitionDuration: "normal",
      border: "2px solid",
      borderRadius: "sm",
      borderColor: "inherit",
      color: "white",
      _checked: {
        bg: mode(`${c}.500`, `${c}.200`)(props),
        borderColor: mode(`${c}.500`, `${c}.200`)(props),
        color: mode("white", "gray.900")(props),
        _hover: {
          bg: mode(`${c}.600`, `${c}.300`)(props),
          borderColor: mode(`${c}.600`, `${c}.300`)(props)
        },
        _disabled: {
          borderColor: mode("gray.200", "transparent")(props),
          bg: mode("gray.200", "whiteAlpha.300")(props),
          color: mode("gray.500", "whiteAlpha.500")(props)
        }
      },
      _indeterminate: {
        bg: mode(`${c}.500`, `${c}.200`)(props),
        borderColor: mode(`${c}.500`, `${c}.200`)(props),
        color: mode("white", "gray.900")(props)
      },
      _disabled: {
        bg: mode("gray.100", "whiteAlpha.100")(props),
        borderColor: mode("gray.100", "transparent")(props)
      },
      _focusVisible: {
        boxShadow: "outline"
      },
      _invalid: {
        borderColor: mode("red.500", "red.300")(props)
      }
    };
  });
  var baseStyleContainer3 = defineStyle({
    _disabled: { cursor: "not-allowed" }
  });
  var baseStyleLabel2 = defineStyle({
    userSelect: "none",
    _disabled: { opacity: 0.4 }
  });
  var baseStyleIcon2 = defineStyle({
    transitionProperty: "transform",
    transitionDuration: "normal"
  });
  var baseStyle8 = definePartsStyle6((props) => ({
    icon: baseStyleIcon2,
    container: baseStyleContainer3,
    control: runIfFn2(baseStyleControl, props),
    label: baseStyleLabel2
  }));
  var sizes5 = {
    sm: definePartsStyle6({
      control: { [$size2.variable]: "sizes.3" },
      label: { fontSize: "sm" },
      icon: { fontSize: "3xs" }
    }),
    md: definePartsStyle6({
      control: { [$size2.variable]: "sizes.4" },
      label: { fontSize: "md" },
      icon: { fontSize: "2xs" }
    }),
    lg: definePartsStyle6({
      control: { [$size2.variable]: "sizes.5" },
      label: { fontSize: "lg" },
      icon: { fontSize: "2xs" }
    })
  };
  var checkboxTheme = defineMultiStyleConfig6({
    baseStyle: baseStyle8,
    sizes: sizes5,
    defaultProps: {
      size: "md",
      colorScheme: "blue"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/close-button.mjs
  init_define_import_meta_env();
  var $size3 = cssVar2("close-button-size");
  var $bg4 = cssVar2("close-button-bg");
  var baseStyle9 = defineStyle({
    w: [$size3.reference],
    h: [$size3.reference],
    borderRadius: "md",
    transitionProperty: "common",
    transitionDuration: "normal",
    _disabled: {
      opacity: 0.4,
      cursor: "not-allowed",
      boxShadow: "none"
    },
    _hover: {
      [$bg4.variable]: "colors.blackAlpha.100",
      _dark: {
        [$bg4.variable]: "colors.whiteAlpha.100"
      }
    },
    _active: {
      [$bg4.variable]: "colors.blackAlpha.200",
      _dark: {
        [$bg4.variable]: "colors.whiteAlpha.200"
      }
    },
    _focusVisible: {
      boxShadow: "outline"
    },
    bg: $bg4.reference
  });
  var sizes6 = {
    lg: defineStyle({
      [$size3.variable]: "sizes.10",
      fontSize: "md"
    }),
    md: defineStyle({
      [$size3.variable]: "sizes.8",
      fontSize: "xs"
    }),
    sm: defineStyle({
      [$size3.variable]: "sizes.6",
      fontSize: "2xs"
    })
  };
  var closeButtonTheme = defineStyleConfig({
    baseStyle: baseStyle9,
    sizes: sizes6,
    defaultProps: {
      size: "md"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/code.mjs
  init_define_import_meta_env();
  var { variants: variants5, defaultProps } = badgeTheme;
  var baseStyle10 = defineStyle({
    fontFamily: "mono",
    fontSize: "sm",
    px: "0.2em",
    borderRadius: "sm",
    bg: vars.bg.reference,
    color: vars.color.reference,
    boxShadow: vars.shadow.reference
  });
  var codeTheme = defineStyleConfig({
    baseStyle: baseStyle10,
    variants: variants5,
    defaultProps
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/container.mjs
  init_define_import_meta_env();
  var baseStyle11 = defineStyle({
    w: "100%",
    mx: "auto",
    maxW: "prose",
    px: "4"
  });
  var containerTheme = defineStyleConfig({
    baseStyle: baseStyle11
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/divider.mjs
  init_define_import_meta_env();
  var baseStyle12 = defineStyle({
    opacity: 0.6,
    borderColor: "inherit"
  });
  var variantSolid4 = defineStyle({
    borderStyle: "solid"
  });
  var variantDashed = defineStyle({
    borderStyle: "dashed"
  });
  var variants6 = {
    solid: variantSolid4,
    dashed: variantDashed
  };
  var dividerTheme = defineStyleConfig({
    baseStyle: baseStyle12,
    variants: variants6,
    defaultProps: {
      variant: "solid"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/drawer.mjs
  init_define_import_meta_env();
  var { definePartsStyle: definePartsStyle7, defineMultiStyleConfig: defineMultiStyleConfig7 } = createMultiStyleConfigHelpers(drawerAnatomy.keys);
  var $bg5 = cssVar("drawer-bg");
  var $bs = cssVar("drawer-box-shadow");
  function getSize2(value) {
    if (value === "full") {
      return definePartsStyle7({
        dialog: { maxW: "100vw", h: "100vh" }
      });
    }
    return definePartsStyle7({
      dialog: { maxW: value }
    });
  }
  var baseStyleOverlay = defineStyle({
    bg: "blackAlpha.600",
    zIndex: "modal"
  });
  var baseStyleDialogContainer = defineStyle({
    display: "flex",
    zIndex: "modal",
    justifyContent: "center"
  });
  var baseStyleDialog = defineStyle((props) => {
    const { isFullHeight } = props;
    return {
      ...isFullHeight && { height: "100vh" },
      zIndex: "modal",
      maxH: "100vh",
      color: "inherit",
      [$bg5.variable]: "colors.white",
      [$bs.variable]: "shadows.lg",
      _dark: {
        [$bg5.variable]: "colors.gray.700",
        [$bs.variable]: "shadows.dark-lg"
      },
      bg: $bg5.reference,
      boxShadow: $bs.reference
    };
  });
  var baseStyleHeader = defineStyle({
    px: "6",
    py: "4",
    fontSize: "xl",
    fontWeight: "semibold"
  });
  var baseStyleCloseButton = defineStyle({
    position: "absolute",
    top: "2",
    insetEnd: "3"
  });
  var baseStyleBody = defineStyle({
    px: "6",
    py: "2",
    flex: "1",
    overflow: "auto"
  });
  var baseStyleFooter = defineStyle({
    px: "6",
    py: "4"
  });
  var baseStyle13 = definePartsStyle7((props) => ({
    overlay: baseStyleOverlay,
    dialogContainer: baseStyleDialogContainer,
    dialog: runIfFn2(baseStyleDialog, props),
    header: baseStyleHeader,
    closeButton: baseStyleCloseButton,
    body: baseStyleBody,
    footer: baseStyleFooter
  }));
  var sizes7 = {
    xs: getSize2("xs"),
    sm: getSize2("md"),
    md: getSize2("lg"),
    lg: getSize2("2xl"),
    xl: getSize2("4xl"),
    full: getSize2("full")
  };
  var drawerTheme = defineMultiStyleConfig7({
    baseStyle: baseStyle13,
    sizes: sizes7,
    defaultProps: {
      size: "xs"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/editable.mjs
  init_define_import_meta_env();
  var { definePartsStyle: definePartsStyle8, defineMultiStyleConfig: defineMultiStyleConfig8 } = createMultiStyleConfigHelpers(editableAnatomy.keys);
  var baseStylePreview = defineStyle({
    borderRadius: "md",
    py: "1",
    transitionProperty: "common",
    transitionDuration: "normal"
  });
  var baseStyleInput = defineStyle({
    borderRadius: "md",
    py: "1",
    transitionProperty: "common",
    transitionDuration: "normal",
    width: "full",
    _focusVisible: { boxShadow: "outline" },
    _placeholder: { opacity: 0.6 }
  });
  var baseStyleTextarea = defineStyle({
    borderRadius: "md",
    py: "1",
    transitionProperty: "common",
    transitionDuration: "normal",
    width: "full",
    _focusVisible: { boxShadow: "outline" },
    _placeholder: { opacity: 0.6 }
  });
  var baseStyle14 = definePartsStyle8({
    preview: baseStylePreview,
    input: baseStyleInput,
    textarea: baseStyleTextarea
  });
  var editableTheme = defineMultiStyleConfig8({
    baseStyle: baseStyle14
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/form-control.mjs
  init_define_import_meta_env();
  var { definePartsStyle: definePartsStyle9, defineMultiStyleConfig: defineMultiStyleConfig9 } = createMultiStyleConfigHelpers(formAnatomy.keys);
  var $fg2 = cssVar("form-control-color");
  var baseStyleRequiredIndicator = defineStyle({
    marginStart: "1",
    [$fg2.variable]: "colors.red.500",
    _dark: {
      [$fg2.variable]: "colors.red.300"
    },
    color: $fg2.reference
  });
  var baseStyleHelperText = defineStyle({
    mt: "2",
    [$fg2.variable]: "colors.gray.600",
    _dark: {
      [$fg2.variable]: "colors.whiteAlpha.600"
    },
    color: $fg2.reference,
    lineHeight: "normal",
    fontSize: "sm"
  });
  var baseStyle15 = definePartsStyle9({
    container: {
      width: "100%",
      position: "relative"
    },
    requiredIndicator: baseStyleRequiredIndicator,
    helperText: baseStyleHelperText
  });
  var formTheme = defineMultiStyleConfig9({
    baseStyle: baseStyle15
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/form-error.mjs
  init_define_import_meta_env();
  var { definePartsStyle: definePartsStyle10, defineMultiStyleConfig: defineMultiStyleConfig10 } = createMultiStyleConfigHelpers(formErrorAnatomy.keys);
  var $fg3 = cssVar("form-error-color");
  var baseStyleText = defineStyle({
    [$fg3.variable]: `colors.red.500`,
    _dark: {
      [$fg3.variable]: `colors.red.300`
    },
    color: $fg3.reference,
    mt: "2",
    fontSize: "sm",
    lineHeight: "normal"
  });
  var baseStyleIcon3 = defineStyle({
    marginEnd: "0.5em",
    [$fg3.variable]: `colors.red.500`,
    _dark: {
      [$fg3.variable]: `colors.red.300`
    },
    color: $fg3.reference
  });
  var baseStyle16 = definePartsStyle10({
    text: baseStyleText,
    icon: baseStyleIcon3
  });
  var formErrorTheme = defineMultiStyleConfig10({
    baseStyle: baseStyle16
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/form-label.mjs
  init_define_import_meta_env();
  var baseStyle17 = defineStyle({
    fontSize: "md",
    marginEnd: "3",
    mb: "2",
    fontWeight: "medium",
    transitionProperty: "common",
    transitionDuration: "normal",
    opacity: 1,
    _disabled: {
      opacity: 0.4
    }
  });
  var formLabelTheme = defineStyleConfig({
    baseStyle: baseStyle17
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/heading.mjs
  init_define_import_meta_env();
  var baseStyle18 = defineStyle({
    fontFamily: "heading",
    fontWeight: "bold"
  });
  var sizes8 = {
    "4xl": defineStyle({
      fontSize: ["6xl", null, "7xl"],
      lineHeight: 1
    }),
    "3xl": defineStyle({
      fontSize: ["5xl", null, "6xl"],
      lineHeight: 1
    }),
    "2xl": defineStyle({
      fontSize: ["4xl", null, "5xl"],
      lineHeight: [1.2, null, 1]
    }),
    xl: defineStyle({
      fontSize: ["3xl", null, "4xl"],
      lineHeight: [1.33, null, 1.2]
    }),
    lg: defineStyle({
      fontSize: ["2xl", null, "3xl"],
      lineHeight: [1.33, null, 1.2]
    }),
    md: defineStyle({
      fontSize: "xl",
      lineHeight: 1.2
    }),
    sm: defineStyle({
      fontSize: "md",
      lineHeight: 1.2
    }),
    xs: defineStyle({
      fontSize: "sm",
      lineHeight: 1.2
    })
  };
  var headingTheme = defineStyleConfig({
    baseStyle: baseStyle18,
    sizes: sizes8,
    defaultProps: {
      size: "xl"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/input.mjs
  init_define_import_meta_env();
  var { definePartsStyle: definePartsStyle11, defineMultiStyleConfig: defineMultiStyleConfig11 } = createMultiStyleConfigHelpers(inputAnatomy.keys);
  var $height = cssVar("input-height");
  var $fontSize = cssVar("input-font-size");
  var $padding2 = cssVar("input-padding");
  var $borderRadius = cssVar("input-border-radius");
  var baseStyle19 = definePartsStyle11({
    addon: {
      height: $height.reference,
      fontSize: $fontSize.reference,
      px: $padding2.reference,
      borderRadius: $borderRadius.reference
    },
    field: {
      width: "100%",
      height: $height.reference,
      fontSize: $fontSize.reference,
      px: $padding2.reference,
      borderRadius: $borderRadius.reference,
      minWidth: 0,
      outline: 0,
      position: "relative",
      appearance: "none",
      transitionProperty: "common",
      transitionDuration: "normal",
      _disabled: {
        opacity: 0.4,
        cursor: "not-allowed"
      }
    }
  });
  var size = {
    lg: defineStyle({
      [$fontSize.variable]: "fontSizes.lg",
      [$padding2.variable]: "space.4",
      [$borderRadius.variable]: "radii.md",
      [$height.variable]: "sizes.12"
    }),
    md: defineStyle({
      [$fontSize.variable]: "fontSizes.md",
      [$padding2.variable]: "space.4",
      [$borderRadius.variable]: "radii.md",
      [$height.variable]: "sizes.10"
    }),
    sm: defineStyle({
      [$fontSize.variable]: "fontSizes.sm",
      [$padding2.variable]: "space.3",
      [$borderRadius.variable]: "radii.sm",
      [$height.variable]: "sizes.8"
    }),
    xs: defineStyle({
      [$fontSize.variable]: "fontSizes.xs",
      [$padding2.variable]: "space.2",
      [$borderRadius.variable]: "radii.sm",
      [$height.variable]: "sizes.6"
    })
  };
  var sizes9 = {
    lg: definePartsStyle11({
      field: size.lg,
      group: size.lg
    }),
    md: definePartsStyle11({
      field: size.md,
      group: size.md
    }),
    sm: definePartsStyle11({
      field: size.sm,
      group: size.sm
    }),
    xs: definePartsStyle11({
      field: size.xs,
      group: size.xs
    })
  };
  function getDefaults(props) {
    const { focusBorderColor: fc, errorBorderColor: ec } = props;
    return {
      focusBorderColor: fc || mode("blue.500", "blue.300")(props),
      errorBorderColor: ec || mode("red.500", "red.300")(props)
    };
  }
  var variantOutline3 = definePartsStyle11((props) => {
    const { theme: theme2 } = props;
    const { focusBorderColor: fc, errorBorderColor: ec } = getDefaults(props);
    return {
      field: {
        border: "1px solid",
        borderColor: "inherit",
        bg: "inherit",
        _hover: {
          borderColor: mode("gray.300", "whiteAlpha.400")(props)
        },
        _readOnly: {
          boxShadow: "none !important",
          userSelect: "all"
        },
        _invalid: {
          borderColor: getColor(theme2, ec),
          boxShadow: `0 0 0 1px ${getColor(theme2, ec)}`
        },
        _focusVisible: {
          zIndex: 1,
          borderColor: getColor(theme2, fc),
          boxShadow: `0 0 0 1px ${getColor(theme2, fc)}`
        }
      },
      addon: {
        border: "1px solid",
        borderColor: mode("inherit", "whiteAlpha.50")(props),
        bg: mode("gray.100", "whiteAlpha.300")(props)
      }
    };
  });
  var variantFilled = definePartsStyle11((props) => {
    const { theme: theme2 } = props;
    const { focusBorderColor: fc, errorBorderColor: ec } = getDefaults(props);
    return {
      field: {
        border: "2px solid",
        borderColor: "transparent",
        bg: mode("gray.100", "whiteAlpha.50")(props),
        _hover: {
          bg: mode("gray.200", "whiteAlpha.100")(props)
        },
        _readOnly: {
          boxShadow: "none !important",
          userSelect: "all"
        },
        _invalid: {
          borderColor: getColor(theme2, ec)
        },
        _focusVisible: {
          bg: "transparent",
          borderColor: getColor(theme2, fc)
        }
      },
      addon: {
        border: "2px solid",
        borderColor: "transparent",
        bg: mode("gray.100", "whiteAlpha.50")(props)
      }
    };
  });
  var variantFlushed = definePartsStyle11((props) => {
    const { theme: theme2 } = props;
    const { focusBorderColor: fc, errorBorderColor: ec } = getDefaults(props);
    return {
      field: {
        borderBottom: "1px solid",
        borderColor: "inherit",
        borderRadius: "0",
        px: "0",
        bg: "transparent",
        _readOnly: {
          boxShadow: "none !important",
          userSelect: "all"
        },
        _invalid: {
          borderColor: getColor(theme2, ec),
          boxShadow: `0px 1px 0px 0px ${getColor(theme2, ec)}`
        },
        _focusVisible: {
          borderColor: getColor(theme2, fc),
          boxShadow: `0px 1px 0px 0px ${getColor(theme2, fc)}`
        }
      },
      addon: {
        borderBottom: "2px solid",
        borderColor: "inherit",
        borderRadius: "0",
        px: "0",
        bg: "transparent"
      }
    };
  });
  var variantUnstyled2 = definePartsStyle11({
    field: {
      bg: "transparent",
      px: "0",
      height: "auto"
    },
    addon: {
      bg: "transparent",
      px: "0",
      height: "auto"
    }
  });
  var variants7 = {
    outline: variantOutline3,
    filled: variantFilled,
    flushed: variantFlushed,
    unstyled: variantUnstyled2
  };
  var inputTheme = defineMultiStyleConfig11({
    baseStyle: baseStyle19,
    sizes: sizes9,
    variants: variants7,
    defaultProps: {
      size: "md",
      variant: "outline"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/kbd.mjs
  init_define_import_meta_env();
  var $bg6 = cssVar("kbd-bg");
  var baseStyle20 = defineStyle({
    [$bg6.variable]: "colors.gray.100",
    _dark: {
      [$bg6.variable]: "colors.whiteAlpha.100"
    },
    bg: $bg6.reference,
    borderRadius: "md",
    borderWidth: "1px",
    borderBottomWidth: "3px",
    fontSize: "0.8em",
    fontWeight: "bold",
    lineHeight: "normal",
    px: "0.4em",
    whiteSpace: "nowrap"
  });
  var kbdTheme = defineStyleConfig({
    baseStyle: baseStyle20
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/link.mjs
  init_define_import_meta_env();
  var baseStyle21 = defineStyle({
    transitionProperty: "common",
    transitionDuration: "fast",
    transitionTimingFunction: "ease-out",
    cursor: "pointer",
    textDecoration: "none",
    outline: "none",
    color: "inherit",
    _hover: {
      textDecoration: "underline"
    },
    _focusVisible: {
      boxShadow: "outline"
    }
  });
  var linkTheme = defineStyleConfig({
    baseStyle: baseStyle21
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/list.mjs
  init_define_import_meta_env();
  var { defineMultiStyleConfig: defineMultiStyleConfig12, definePartsStyle: definePartsStyle12 } = createMultiStyleConfigHelpers(listAnatomy.keys);
  var baseStyleIcon4 = defineStyle({
    marginEnd: "2",
    display: "inline",
    verticalAlign: "text-bottom"
  });
  var baseStyle22 = definePartsStyle12({
    icon: baseStyleIcon4
  });
  var listTheme = defineMultiStyleConfig12({
    baseStyle: baseStyle22
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/menu.mjs
  init_define_import_meta_env();
  var { defineMultiStyleConfig: defineMultiStyleConfig13, definePartsStyle: definePartsStyle13 } = createMultiStyleConfigHelpers(menuAnatomy.keys);
  var $bg7 = cssVar("menu-bg");
  var $shadow2 = cssVar("menu-shadow");
  var baseStyleList = defineStyle({
    [$bg7.variable]: "#fff",
    [$shadow2.variable]: "shadows.sm",
    _dark: {
      [$bg7.variable]: "colors.gray.700",
      [$shadow2.variable]: "shadows.dark-lg"
    },
    color: "inherit",
    minW: "3xs",
    py: "2",
    zIndex: "dropdown",
    borderRadius: "md",
    borderWidth: "1px",
    bg: $bg7.reference,
    boxShadow: $shadow2.reference
  });
  var baseStyleItem = defineStyle({
    py: "1.5",
    px: "3",
    transitionProperty: "background",
    transitionDuration: "ultra-fast",
    transitionTimingFunction: "ease-in",
    _focus: {
      [$bg7.variable]: "colors.gray.100",
      _dark: {
        [$bg7.variable]: "colors.whiteAlpha.100"
      }
    },
    _active: {
      [$bg7.variable]: "colors.gray.200",
      _dark: {
        [$bg7.variable]: "colors.whiteAlpha.200"
      }
    },
    _expanded: {
      [$bg7.variable]: "colors.gray.100",
      _dark: {
        [$bg7.variable]: "colors.whiteAlpha.100"
      }
    },
    _disabled: {
      opacity: 0.4,
      cursor: "not-allowed"
    },
    bg: $bg7.reference
  });
  var baseStyleGroupTitle = defineStyle({
    mx: 4,
    my: 2,
    fontWeight: "semibold",
    fontSize: "sm"
  });
  var baseStyleIcon5 = defineStyle({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0
  });
  var baseStyleCommand = defineStyle({
    opacity: 0.6
  });
  var baseStyleDivider = defineStyle({
    border: 0,
    borderBottom: "1px solid",
    borderColor: "inherit",
    my: "2",
    opacity: 0.6
  });
  var baseStyleButton2 = defineStyle({
    transitionProperty: "common",
    transitionDuration: "normal"
  });
  var baseStyle23 = definePartsStyle13({
    button: baseStyleButton2,
    list: baseStyleList,
    item: baseStyleItem,
    groupTitle: baseStyleGroupTitle,
    icon: baseStyleIcon5,
    command: baseStyleCommand,
    divider: baseStyleDivider
  });
  var menuTheme = defineMultiStyleConfig13({
    baseStyle: baseStyle23
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/modal.mjs
  init_define_import_meta_env();
  var { defineMultiStyleConfig: defineMultiStyleConfig14, definePartsStyle: definePartsStyle14 } = createMultiStyleConfigHelpers(modalAnatomy.keys);
  var $bg8 = cssVar("modal-bg");
  var $shadow3 = cssVar("modal-shadow");
  var baseStyleOverlay2 = defineStyle({
    bg: "blackAlpha.600",
    zIndex: "modal"
  });
  var baseStyleDialogContainer2 = defineStyle((props) => {
    const { isCentered, scrollBehavior } = props;
    return {
      display: "flex",
      zIndex: "modal",
      justifyContent: "center",
      alignItems: isCentered ? "center" : "flex-start",
      overflow: scrollBehavior === "inside" ? "hidden" : "auto",
      overscrollBehaviorY: "none"
    };
  });
  var baseStyleDialog2 = defineStyle((props) => {
    const { isCentered, scrollBehavior } = props;
    return {
      borderRadius: "md",
      color: "inherit",
      my: isCentered ? "auto" : "16",
      mx: isCentered ? "auto" : void 0,
      zIndex: "modal",
      maxH: scrollBehavior === "inside" ? "calc(100% - 7.5rem)" : void 0,
      [$bg8.variable]: "colors.white",
      [$shadow3.variable]: "shadows.lg",
      _dark: {
        [$bg8.variable]: "colors.gray.700",
        [$shadow3.variable]: "shadows.dark-lg"
      },
      bg: $bg8.reference,
      boxShadow: $shadow3.reference
    };
  });
  var baseStyleHeader2 = defineStyle({
    px: "6",
    py: "4",
    fontSize: "xl",
    fontWeight: "semibold"
  });
  var baseStyleCloseButton2 = defineStyle({
    position: "absolute",
    top: "2",
    insetEnd: "3"
  });
  var baseStyleBody2 = defineStyle((props) => {
    const { scrollBehavior } = props;
    return {
      px: "6",
      py: "2",
      flex: "1",
      overflow: scrollBehavior === "inside" ? "auto" : void 0
    };
  });
  var baseStyleFooter2 = defineStyle({
    px: "6",
    py: "4"
  });
  var baseStyle24 = definePartsStyle14((props) => ({
    overlay: baseStyleOverlay2,
    dialogContainer: runIfFn2(baseStyleDialogContainer2, props),
    dialog: runIfFn2(baseStyleDialog2, props),
    header: baseStyleHeader2,
    closeButton: baseStyleCloseButton2,
    body: runIfFn2(baseStyleBody2, props),
    footer: baseStyleFooter2
  }));
  function getSize3(value) {
    if (value === "full") {
      return definePartsStyle14({
        dialog: {
          maxW: "100vw",
          minH: "$100vh",
          my: "0",
          borderRadius: "0"
        }
      });
    }
    return definePartsStyle14({
      dialog: { maxW: value }
    });
  }
  var sizes10 = {
    xs: getSize3("xs"),
    sm: getSize3("sm"),
    md: getSize3("md"),
    lg: getSize3("lg"),
    xl: getSize3("xl"),
    "2xl": getSize3("2xl"),
    "3xl": getSize3("3xl"),
    "4xl": getSize3("4xl"),
    "5xl": getSize3("5xl"),
    "6xl": getSize3("6xl"),
    full: getSize3("full")
  };
  var modalTheme = defineMultiStyleConfig14({
    baseStyle: baseStyle24,
    sizes: sizes10,
    defaultProps: { size: "md" }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/number-input.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/foundations/typography.mjs
  init_define_import_meta_env();
  var typography2 = {
    letterSpacings: {
      tighter: "-0.05em",
      tight: "-0.025em",
      normal: "0",
      wide: "0.025em",
      wider: "0.05em",
      widest: "0.1em"
    },
    lineHeights: {
      normal: "normal",
      none: 1,
      shorter: 1.25,
      short: 1.375,
      base: 1.5,
      tall: 1.625,
      taller: "2",
      "3": ".75rem",
      "4": "1rem",
      "5": "1.25rem",
      "6": "1.5rem",
      "7": "1.75rem",
      "8": "2rem",
      "9": "2.25rem",
      "10": "2.5rem"
    },
    fontWeights: {
      hairline: 100,
      thin: 200,
      light: 300,
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      extrabold: 800,
      black: 900
    },
    fonts: {
      heading: `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"`,
      body: `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"`,
      mono: `SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace`
    },
    fontSizes: {
      "3xs": "0.45rem",
      "2xs": "0.625rem",
      xs: "0.75rem",
      sm: "0.875rem",
      md: "1rem",
      lg: "1.125rem",
      xl: "1.25rem",
      "2xl": "1.5rem",
      "3xl": "1.875rem",
      "4xl": "2.25rem",
      "5xl": "3rem",
      "6xl": "3.75rem",
      "7xl": "4.5rem",
      "8xl": "6rem",
      "9xl": "8rem"
    }
  };

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/number-input.mjs
  var { defineMultiStyleConfig: defineMultiStyleConfig15, definePartsStyle: definePartsStyle15 } = createMultiStyleConfigHelpers(numberInputAnatomy.keys);
  var $stepperWidth = cssVar2("number-input-stepper-width");
  var $inputPadding = cssVar2("number-input-input-padding");
  var inputPaddingValue = calc2($stepperWidth).add("0.5rem").toString();
  var $bg9 = cssVar2("number-input-bg");
  var $fg4 = cssVar2("number-input-color");
  var $border3 = cssVar2("number-input-border-color");
  var baseStyleRoot = defineStyle({
    [$stepperWidth.variable]: "sizes.6",
    [$inputPadding.variable]: inputPaddingValue
  });
  var baseStyleField = defineStyle(
    (props) => runIfFn2(inputTheme.baseStyle, props)?.field ?? {}
  );
  var baseStyleStepperGroup = defineStyle({
    width: $stepperWidth.reference
  });
  var baseStyleStepper = defineStyle({
    borderStart: "1px solid",
    borderStartColor: $border3.reference,
    color: $fg4.reference,
    bg: $bg9.reference,
    [$fg4.variable]: "colors.chakra-body-text",
    [$border3.variable]: "colors.chakra-border-color",
    _dark: {
      [$fg4.variable]: "colors.whiteAlpha.800",
      [$border3.variable]: "colors.whiteAlpha.300"
    },
    _active: {
      [$bg9.variable]: "colors.gray.200",
      _dark: {
        [$bg9.variable]: "colors.whiteAlpha.300"
      }
    },
    _disabled: {
      opacity: 0.4,
      cursor: "not-allowed"
    }
  });
  var baseStyle25 = definePartsStyle15((props) => ({
    root: baseStyleRoot,
    field: runIfFn2(baseStyleField, props) ?? {},
    stepperGroup: baseStyleStepperGroup,
    stepper: baseStyleStepper
  }));
  function getSize4(size2) {
    const sizeStyle = inputTheme.sizes?.[size2];
    const radius = {
      lg: "md",
      md: "md",
      sm: "sm",
      xs: "sm"
    };
    const _fontSize = sizeStyle.field?.fontSize ?? "md";
    const fontSize = typography2.fontSizes[_fontSize];
    return definePartsStyle15({
      field: {
        ...sizeStyle.field,
        paddingInlineEnd: $inputPadding.reference,
        verticalAlign: "top"
      },
      stepper: {
        fontSize: calc2(fontSize).multiply(0.75).toString(),
        _first: {
          borderTopEndRadius: radius[size2]
        },
        _last: {
          borderBottomEndRadius: radius[size2],
          mt: "-1px",
          borderTopWidth: 1
        }
      }
    });
  }
  var sizes11 = {
    xs: getSize4("xs"),
    sm: getSize4("sm"),
    md: getSize4("md"),
    lg: getSize4("lg")
  };
  var numberInputTheme = defineMultiStyleConfig15({
    baseStyle: baseStyle25,
    sizes: sizes11,
    variants: inputTheme.variants,
    defaultProps: inputTheme.defaultProps
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/pin-input.mjs
  init_define_import_meta_env();
  var baseStyle26 = defineStyle({
    ...inputTheme.baseStyle?.field,
    textAlign: "center"
  });
  var sizes12 = {
    lg: defineStyle({
      fontSize: "lg",
      w: 12,
      h: 12,
      borderRadius: "md"
    }),
    md: defineStyle({
      fontSize: "md",
      w: 10,
      h: 10,
      borderRadius: "md"
    }),
    sm: defineStyle({
      fontSize: "sm",
      w: 8,
      h: 8,
      borderRadius: "sm"
    }),
    xs: defineStyle({
      fontSize: "xs",
      w: 6,
      h: 6,
      borderRadius: "sm"
    })
  };
  var variants8 = {
    outline: defineStyle(
      (props) => runIfFn2(inputTheme.variants?.outline, props)?.field ?? {}
    ),
    flushed: defineStyle(
      (props) => runIfFn2(inputTheme.variants?.flushed, props)?.field ?? {}
    ),
    filled: defineStyle(
      (props) => runIfFn2(inputTheme.variants?.filled, props)?.field ?? {}
    ),
    unstyled: inputTheme.variants?.unstyled.field ?? {}
  };
  var pinInputTheme = defineStyleConfig({
    baseStyle: baseStyle26,
    sizes: sizes12,
    variants: variants8,
    defaultProps: inputTheme.defaultProps
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/popover.mjs
  init_define_import_meta_env();
  var { defineMultiStyleConfig: defineMultiStyleConfig16, definePartsStyle: definePartsStyle16 } = createMultiStyleConfigHelpers(popoverAnatomy.keys);
  var $popperBg = cssVar2("popper-bg");
  var $arrowBg = cssVar2("popper-arrow-bg");
  var $arrowShadowColor = cssVar2("popper-arrow-shadow-color");
  var baseStylePopper = defineStyle({
    zIndex: "popover"
  });
  var baseStyleContent = defineStyle({
    [$popperBg.variable]: `colors.white`,
    bg: $popperBg.reference,
    [$arrowBg.variable]: $popperBg.reference,
    [$arrowShadowColor.variable]: `colors.gray.200`,
    _dark: {
      [$popperBg.variable]: `colors.gray.700`,
      [$arrowShadowColor.variable]: `colors.whiteAlpha.300`
    },
    width: "xs",
    border: "1px solid",
    borderColor: "inherit",
    borderRadius: "md",
    boxShadow: "sm",
    zIndex: "inherit",
    _focusVisible: {
      outline: 0,
      boxShadow: "outline"
    }
  });
  var baseStyleHeader3 = defineStyle({
    px: 3,
    py: 2,
    borderBottomWidth: "1px"
  });
  var baseStyleBody3 = defineStyle({
    px: 3,
    py: 2
  });
  var baseStyleFooter3 = defineStyle({
    px: 3,
    py: 2,
    borderTopWidth: "1px"
  });
  var baseStyleCloseButton3 = defineStyle({
    position: "absolute",
    borderRadius: "md",
    top: 1,
    insetEnd: 2,
    padding: 2
  });
  var baseStyle27 = definePartsStyle16({
    popper: baseStylePopper,
    content: baseStyleContent,
    header: baseStyleHeader3,
    body: baseStyleBody3,
    footer: baseStyleFooter3,
    closeButton: baseStyleCloseButton3
  });
  var popoverTheme = defineMultiStyleConfig16({
    baseStyle: baseStyle27
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/progress.mjs
  init_define_import_meta_env();
  var { defineMultiStyleConfig: defineMultiStyleConfig17, definePartsStyle: definePartsStyle17 } = createMultiStyleConfigHelpers(progressAnatomy.keys);
  var filledStyle = defineStyle((props) => {
    const { colorScheme: c, theme: t2, isIndeterminate, hasStripe } = props;
    const stripeStyle = mode(
      generateStripe(),
      generateStripe("1rem", "rgba(0,0,0,0.1)")
    )(props);
    const bgColor = mode(`${c}.500`, `${c}.200`)(props);
    const gradient = `linear-gradient(
    to right,
    transparent 0%,
    ${getColor(t2, bgColor)} 50%,
    transparent 100%
  )`;
    const addStripe = !isIndeterminate && hasStripe;
    return {
      ...addStripe && stripeStyle,
      ...isIndeterminate ? { bgImage: gradient } : { bgColor }
    };
  });
  var baseStyleLabel3 = defineStyle({
    lineHeight: "1",
    fontSize: "0.25em",
    fontWeight: "bold",
    color: "white"
  });
  var baseStyleTrack = defineStyle((props) => {
    return {
      bg: mode("gray.100", "whiteAlpha.300")(props)
    };
  });
  var baseStyleFilledTrack = defineStyle((props) => {
    return {
      transitionProperty: "common",
      transitionDuration: "slow",
      ...filledStyle(props)
    };
  });
  var baseStyle28 = definePartsStyle17((props) => ({
    label: baseStyleLabel3,
    filledTrack: baseStyleFilledTrack(props),
    track: baseStyleTrack(props)
  }));
  var sizes13 = {
    xs: definePartsStyle17({
      track: { h: "1" }
    }),
    sm: definePartsStyle17({
      track: { h: "2" }
    }),
    md: definePartsStyle17({
      track: { h: "3" }
    }),
    lg: definePartsStyle17({
      track: { h: "4" }
    })
  };
  var progressTheme = defineMultiStyleConfig17({
    sizes: sizes13,
    baseStyle: baseStyle28,
    defaultProps: {
      size: "md",
      colorScheme: "blue"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/radio.mjs
  init_define_import_meta_env();
  var { defineMultiStyleConfig: defineMultiStyleConfig18, definePartsStyle: definePartsStyle18 } = createMultiStyleConfigHelpers(radioAnatomy.keys);
  var baseStyleControl2 = defineStyle((props) => {
    const controlStyle = runIfFn2(checkboxTheme.baseStyle, props)?.control;
    return {
      ...controlStyle,
      borderRadius: "full",
      _checked: {
        ...controlStyle?.["_checked"],
        _before: {
          content: `""`,
          display: "inline-block",
          pos: "relative",
          w: "50%",
          h: "50%",
          borderRadius: "50%",
          bg: "currentColor"
        }
      }
    };
  });
  var baseStyle29 = definePartsStyle18((props) => ({
    label: checkboxTheme.baseStyle?.(props).label,
    container: checkboxTheme.baseStyle?.(props).container,
    control: baseStyleControl2(props)
  }));
  var sizes14 = {
    md: definePartsStyle18({
      control: { w: "4", h: "4" },
      label: { fontSize: "md" }
    }),
    lg: definePartsStyle18({
      control: { w: "5", h: "5" },
      label: { fontSize: "lg" }
    }),
    sm: definePartsStyle18({
      control: { width: "3", height: "3" },
      label: { fontSize: "sm" }
    })
  };
  var radioTheme = defineMultiStyleConfig18({
    baseStyle: baseStyle29,
    sizes: sizes14,
    defaultProps: {
      size: "md",
      colorScheme: "blue"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/select.mjs
  init_define_import_meta_env();
  var { defineMultiStyleConfig: defineMultiStyleConfig19, definePartsStyle: definePartsStyle19 } = createMultiStyleConfigHelpers(selectAnatomy.keys);
  var $bg10 = cssVar("select-bg");
  var baseStyleField2 = defineStyle({
    ...inputTheme.baseStyle?.field,
    appearance: "none",
    paddingBottom: "1px",
    lineHeight: "normal",
    bg: $bg10.reference,
    [$bg10.variable]: "colors.white",
    _dark: {
      [$bg10.variable]: "colors.gray.700"
    },
    "> option, > optgroup": {
      bg: $bg10.reference
    }
  });
  var baseStyleIcon6 = defineStyle({
    width: "6",
    height: "100%",
    insetEnd: "2",
    position: "relative",
    color: "currentColor",
    fontSize: "xl",
    _disabled: {
      opacity: 0.5
    }
  });
  var baseStyle30 = definePartsStyle19({
    field: baseStyleField2,
    icon: baseStyleIcon6
  });
  var iconSpacing = defineStyle({
    paddingInlineEnd: "8"
  });
  var sizes15 = {
    lg: {
      ...inputTheme.sizes?.lg,
      field: {
        ...inputTheme.sizes?.lg.field,
        ...iconSpacing
      }
    },
    md: {
      ...inputTheme.sizes?.md,
      field: {
        ...inputTheme.sizes?.md.field,
        ...iconSpacing
      }
    },
    sm: {
      ...inputTheme.sizes?.sm,
      field: {
        ...inputTheme.sizes?.sm.field,
        ...iconSpacing
      }
    },
    xs: {
      ...inputTheme.sizes?.xs,
      field: {
        ...inputTheme.sizes?.xs.field,
        ...iconSpacing
      },
      icon: {
        insetEnd: "1"
      }
    }
  };
  var selectTheme = defineMultiStyleConfig19({
    baseStyle: baseStyle30,
    sizes: sizes15,
    variants: inputTheme.variants,
    defaultProps: inputTheme.defaultProps
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/skeleton.mjs
  init_define_import_meta_env();
  var $startColor = cssVar("skeleton-start-color");
  var $endColor = cssVar("skeleton-end-color");
  var baseStyle31 = defineStyle({
    [$startColor.variable]: "colors.gray.100",
    [$endColor.variable]: "colors.gray.400",
    _dark: {
      [$startColor.variable]: "colors.gray.800",
      [$endColor.variable]: "colors.gray.600"
    },
    background: $startColor.reference,
    borderColor: $endColor.reference,
    opacity: 0.7,
    borderRadius: "sm"
  });
  var skeletonTheme = defineStyleConfig({
    baseStyle: baseStyle31
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/skip-link.mjs
  init_define_import_meta_env();
  var $bg11 = cssVar("skip-link-bg");
  var baseStyle32 = defineStyle({
    borderRadius: "md",
    fontWeight: "semibold",
    _focusVisible: {
      boxShadow: "outline",
      padding: "4",
      position: "fixed",
      top: "6",
      insetStart: "6",
      [$bg11.variable]: "colors.white",
      _dark: {
        [$bg11.variable]: "colors.gray.700"
      },
      bg: $bg11.reference
    }
  });
  var skipLinkTheme = defineStyleConfig({
    baseStyle: baseStyle32
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/slider.mjs
  init_define_import_meta_env();
  var { defineMultiStyleConfig: defineMultiStyleConfig20, definePartsStyle: definePartsStyle20 } = createMultiStyleConfigHelpers(sliderAnatomy.keys);
  var $thumbSize = cssVar("slider-thumb-size");
  var $trackSize = cssVar("slider-track-size");
  var $bg12 = cssVar("slider-bg");
  var baseStyleContainer4 = defineStyle((props) => {
    const { orientation } = props;
    return {
      display: "inline-block",
      position: "relative",
      cursor: "pointer",
      _disabled: {
        opacity: 0.6,
        cursor: "default",
        pointerEvents: "none"
      },
      ...orient({
        orientation,
        vertical: {
          h: "100%",
          px: calc($thumbSize.reference).divide(2).toString()
        },
        horizontal: {
          w: "100%",
          py: calc($thumbSize.reference).divide(2).toString()
        }
      })
    };
  });
  var baseStyleTrack2 = defineStyle((props) => {
    const orientationStyles = orient({
      orientation: props.orientation,
      horizontal: { h: $trackSize.reference },
      vertical: { w: $trackSize.reference }
    });
    return {
      ...orientationStyles,
      overflow: "hidden",
      borderRadius: "sm",
      [$bg12.variable]: "colors.gray.200",
      _dark: {
        [$bg12.variable]: "colors.whiteAlpha.200"
      },
      _disabled: {
        [$bg12.variable]: "colors.gray.300",
        _dark: {
          [$bg12.variable]: "colors.whiteAlpha.300"
        }
      },
      bg: $bg12.reference
    };
  });
  var baseStyleThumb = defineStyle((props) => {
    const { orientation } = props;
    const orientationStyle = orient({
      orientation,
      vertical: { left: "50%" },
      horizontal: { top: "50%" }
    });
    return {
      ...orientationStyle,
      w: $thumbSize.reference,
      h: $thumbSize.reference,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      position: "absolute",
      outline: 0,
      zIndex: 1,
      borderRadius: "full",
      bg: "white",
      boxShadow: "base",
      border: "1px solid",
      borderColor: "transparent",
      transitionProperty: "transform",
      transitionDuration: "normal",
      _focusVisible: {
        boxShadow: "outline"
      },
      _active: {
        "--slider-thumb-scale": `1.15`
      },
      _disabled: {
        bg: "gray.300"
      }
    };
  });
  var baseStyleFilledTrack2 = defineStyle((props) => {
    const { colorScheme: c } = props;
    return {
      width: "inherit",
      height: "inherit",
      [$bg12.variable]: `colors.${c}.500`,
      _dark: {
        [$bg12.variable]: `colors.${c}.200`
      },
      bg: $bg12.reference
    };
  });
  var baseStyle33 = definePartsStyle20((props) => ({
    container: baseStyleContainer4(props),
    track: baseStyleTrack2(props),
    thumb: baseStyleThumb(props),
    filledTrack: baseStyleFilledTrack2(props)
  }));
  var sizeLg = definePartsStyle20({
    container: {
      [$thumbSize.variable]: `sizes.4`,
      [$trackSize.variable]: `sizes.1`
    }
  });
  var sizeMd = definePartsStyle20({
    container: {
      [$thumbSize.variable]: `sizes.3.5`,
      [$trackSize.variable]: `sizes.1`
    }
  });
  var sizeSm = definePartsStyle20({
    container: {
      [$thumbSize.variable]: `sizes.2.5`,
      [$trackSize.variable]: `sizes.0.5`
    }
  });
  var sizes16 = {
    lg: sizeLg,
    md: sizeMd,
    sm: sizeSm
  };
  var sliderTheme = defineMultiStyleConfig20({
    baseStyle: baseStyle33,
    sizes: sizes16,
    defaultProps: {
      size: "md",
      colorScheme: "blue"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/spinner.mjs
  init_define_import_meta_env();
  var $size4 = cssVar2("spinner-size");
  var baseStyle34 = defineStyle({
    width: [$size4.reference],
    height: [$size4.reference]
  });
  var sizes17 = {
    xs: defineStyle({
      [$size4.variable]: "sizes.3"
    }),
    sm: defineStyle({
      [$size4.variable]: "sizes.4"
    }),
    md: defineStyle({
      [$size4.variable]: "sizes.6"
    }),
    lg: defineStyle({
      [$size4.variable]: "sizes.8"
    }),
    xl: defineStyle({
      [$size4.variable]: "sizes.12"
    })
  };
  var spinnerTheme = defineStyleConfig({
    baseStyle: baseStyle34,
    sizes: sizes17,
    defaultProps: {
      size: "md"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/stat.mjs
  init_define_import_meta_env();
  var { defineMultiStyleConfig: defineMultiStyleConfig21, definePartsStyle: definePartsStyle21 } = createMultiStyleConfigHelpers(statAnatomy.keys);
  var baseStyleLabel4 = defineStyle({
    fontWeight: "medium"
  });
  var baseStyleHelpText = defineStyle({
    opacity: 0.8,
    marginBottom: "2"
  });
  var baseStyleNumber = defineStyle({
    verticalAlign: "baseline",
    fontWeight: "semibold"
  });
  var baseStyleIcon7 = defineStyle({
    marginEnd: 1,
    w: "3.5",
    h: "3.5",
    verticalAlign: "middle"
  });
  var baseStyle35 = definePartsStyle21({
    container: {},
    label: baseStyleLabel4,
    helpText: baseStyleHelpText,
    number: baseStyleNumber,
    icon: baseStyleIcon7
  });
  var sizes18 = {
    md: definePartsStyle21({
      label: { fontSize: "sm" },
      helpText: { fontSize: "sm" },
      number: { fontSize: "2xl" }
    })
  };
  var statTheme = defineMultiStyleConfig21({
    baseStyle: baseStyle35,
    sizes: sizes18,
    defaultProps: {
      size: "md"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/stepper.mjs
  init_define_import_meta_env();
  var { defineMultiStyleConfig: defineMultiStyleConfig22, definePartsStyle: definePartsStyle22 } = createMultiStyleConfigHelpers([
    "stepper",
    "step",
    "title",
    "description",
    "indicator",
    "separator",
    "icon",
    "number"
  ]);
  var $size5 = cssVar("stepper-indicator-size");
  var $iconSize = cssVar("stepper-icon-size");
  var $titleFontSize = cssVar("stepper-title-font-size");
  var $descFontSize = cssVar("stepper-description-font-size");
  var $accentColor = cssVar("stepper-accent-color");
  var baseStyle36 = definePartsStyle22(({ colorScheme: c }) => ({
    stepper: {
      display: "flex",
      justifyContent: "space-between",
      gap: "4",
      "&[data-orientation=vertical]": {
        flexDirection: "column",
        alignItems: "flex-start"
      },
      "&[data-orientation=horizontal]": {
        flexDirection: "row",
        alignItems: "center"
      },
      [$accentColor.variable]: `colors.${c}.500`,
      _dark: {
        [$accentColor.variable]: `colors.${c}.200`
      }
    },
    title: {
      fontSize: $titleFontSize.reference,
      fontWeight: "medium"
    },
    description: {
      fontSize: $descFontSize.reference,
      color: "chakra-subtle-text"
    },
    number: {
      fontSize: $titleFontSize.reference
    },
    step: {
      flexShrink: 0,
      position: "relative",
      display: "flex",
      gap: "2",
      "&[data-orientation=horizontal]": {
        alignItems: "center"
      },
      flex: "1",
      "&:last-of-type:not([data-stretch])": {
        flex: "initial"
      }
    },
    icon: {
      flexShrink: 0,
      width: $iconSize.reference,
      height: $iconSize.reference
    },
    indicator: {
      flexShrink: 0,
      borderRadius: "full",
      width: $size5.reference,
      height: $size5.reference,
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      "&[data-status=active]": {
        borderWidth: "2px",
        borderColor: $accentColor.reference
      },
      "&[data-status=complete]": {
        bg: $accentColor.reference,
        color: "chakra-inverse-text"
      },
      "&[data-status=incomplete]": {
        borderWidth: "2px"
      }
    },
    separator: {
      bg: "chakra-border-color",
      flex: "1",
      "&[data-status=complete]": {
        bg: $accentColor.reference
      },
      "&[data-orientation=horizontal]": {
        width: "100%",
        height: "2px",
        marginStart: "2"
      },
      "&[data-orientation=vertical]": {
        width: "2px",
        position: "absolute",
        height: "100%",
        maxHeight: `calc(100% - ${$size5.reference} - 8px)`,
        top: `calc(${$size5.reference} + 4px)`,
        insetStart: `calc(${$size5.reference} / 2 - 1px)`
      }
    }
  }));
  var stepperTheme = defineMultiStyleConfig22({
    baseStyle: baseStyle36,
    sizes: {
      xs: definePartsStyle22({
        stepper: {
          [$size5.variable]: "sizes.4",
          [$iconSize.variable]: "sizes.3",
          [$titleFontSize.variable]: "fontSizes.xs",
          [$descFontSize.variable]: "fontSizes.xs"
        }
      }),
      sm: definePartsStyle22({
        stepper: {
          [$size5.variable]: "sizes.6",
          [$iconSize.variable]: "sizes.4",
          [$titleFontSize.variable]: "fontSizes.sm",
          [$descFontSize.variable]: "fontSizes.xs"
        }
      }),
      md: definePartsStyle22({
        stepper: {
          [$size5.variable]: "sizes.8",
          [$iconSize.variable]: "sizes.5",
          [$titleFontSize.variable]: "fontSizes.md",
          [$descFontSize.variable]: "fontSizes.sm"
        }
      }),
      lg: definePartsStyle22({
        stepper: {
          [$size5.variable]: "sizes.10",
          [$iconSize.variable]: "sizes.6",
          [$titleFontSize.variable]: "fontSizes.lg",
          [$descFontSize.variable]: "fontSizes.md"
        }
      })
    },
    defaultProps: {
      size: "md",
      colorScheme: "blue"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/switch.mjs
  init_define_import_meta_env();
  var { defineMultiStyleConfig: defineMultiStyleConfig23, definePartsStyle: definePartsStyle23 } = createMultiStyleConfigHelpers(switchAnatomy.keys);
  var $width = cssVar2("switch-track-width");
  var $height2 = cssVar2("switch-track-height");
  var $diff = cssVar2("switch-track-diff");
  var diffValue = calc2.subtract($width, $height2);
  var $translateX = cssVar2("switch-thumb-x");
  var $bg13 = cssVar2("switch-bg");
  var baseStyleTrack3 = defineStyle((props) => {
    const { colorScheme: c } = props;
    return {
      borderRadius: "full",
      p: "0.5",
      width: [$width.reference],
      height: [$height2.reference],
      transitionProperty: "common",
      transitionDuration: "fast",
      [$bg13.variable]: "colors.gray.300",
      _dark: {
        [$bg13.variable]: "colors.whiteAlpha.400"
      },
      _focusVisible: {
        boxShadow: "outline"
      },
      _disabled: {
        opacity: 0.4,
        cursor: "not-allowed"
      },
      _checked: {
        [$bg13.variable]: `colors.${c}.500`,
        _dark: {
          [$bg13.variable]: `colors.${c}.200`
        }
      },
      bg: $bg13.reference
    };
  });
  var baseStyleThumb2 = defineStyle({
    bg: "white",
    transitionProperty: "transform",
    transitionDuration: "normal",
    borderRadius: "inherit",
    width: [$height2.reference],
    height: [$height2.reference],
    _checked: {
      transform: `translateX(${$translateX.reference})`
    }
  });
  var baseStyle37 = definePartsStyle23((props) => ({
    container: {
      [$diff.variable]: diffValue,
      [$translateX.variable]: $diff.reference,
      _rtl: {
        [$translateX.variable]: calc2($diff).negate().toString()
      }
    },
    track: baseStyleTrack3(props),
    thumb: baseStyleThumb2
  }));
  var sizes19 = {
    sm: definePartsStyle23({
      container: {
        [$width.variable]: "1.375rem",
        [$height2.variable]: "sizes.3"
      }
    }),
    md: definePartsStyle23({
      container: {
        [$width.variable]: "1.875rem",
        [$height2.variable]: "sizes.4"
      }
    }),
    lg: definePartsStyle23({
      container: {
        [$width.variable]: "2.875rem",
        [$height2.variable]: "sizes.6"
      }
    })
  };
  var switchTheme = defineMultiStyleConfig23({
    baseStyle: baseStyle37,
    sizes: sizes19,
    defaultProps: {
      size: "md",
      colorScheme: "blue"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/table.mjs
  init_define_import_meta_env();
  var { defineMultiStyleConfig: defineMultiStyleConfig24, definePartsStyle: definePartsStyle24 } = createMultiStyleConfigHelpers(tableAnatomy.keys);
  var baseStyle38 = definePartsStyle24({
    table: {
      fontVariantNumeric: "lining-nums tabular-nums",
      borderCollapse: "collapse",
      width: "full"
    },
    th: {
      fontFamily: "heading",
      fontWeight: "bold",
      textTransform: "uppercase",
      letterSpacing: "wider",
      textAlign: "start"
    },
    td: {
      textAlign: "start"
    },
    caption: {
      mt: 4,
      fontFamily: "heading",
      textAlign: "center",
      fontWeight: "medium"
    }
  });
  var numericStyles = defineStyle({
    "&[data-is-numeric=true]": {
      textAlign: "end"
    }
  });
  var variantSimple = definePartsStyle24((props) => {
    const { colorScheme: c } = props;
    return {
      th: {
        color: mode("gray.600", "gray.400")(props),
        borderBottom: "1px",
        borderColor: mode(`${c}.100`, `${c}.700`)(props),
        ...numericStyles
      },
      td: {
        borderBottom: "1px",
        borderColor: mode(`${c}.100`, `${c}.700`)(props),
        ...numericStyles
      },
      caption: {
        color: mode("gray.600", "gray.100")(props)
      },
      tfoot: {
        tr: {
          "&:last-of-type": {
            th: { borderBottomWidth: 0 }
          }
        }
      }
    };
  });
  var variantStripe = definePartsStyle24((props) => {
    const { colorScheme: c } = props;
    return {
      th: {
        color: mode("gray.600", "gray.400")(props),
        borderBottom: "1px",
        borderColor: mode(`${c}.100`, `${c}.700`)(props),
        ...numericStyles
      },
      td: {
        borderBottom: "1px",
        borderColor: mode(`${c}.100`, `${c}.700`)(props),
        ...numericStyles
      },
      caption: {
        color: mode("gray.600", "gray.100")(props)
      },
      tbody: {
        tr: {
          "&:nth-of-type(odd)": {
            "th, td": {
              borderBottomWidth: "1px",
              borderColor: mode(`${c}.100`, `${c}.700`)(props)
            },
            td: {
              background: mode(`${c}.100`, `${c}.700`)(props)
            }
          }
        }
      },
      tfoot: {
        tr: {
          "&:last-of-type": {
            th: { borderBottomWidth: 0 }
          }
        }
      }
    };
  });
  var variants9 = {
    simple: variantSimple,
    striped: variantStripe,
    unstyled: defineStyle({})
  };
  var sizes20 = {
    sm: definePartsStyle24({
      th: {
        px: "4",
        py: "1",
        lineHeight: "4",
        fontSize: "xs"
      },
      td: {
        px: "4",
        py: "2",
        fontSize: "sm",
        lineHeight: "4"
      },
      caption: {
        px: "4",
        py: "2",
        fontSize: "xs"
      }
    }),
    md: definePartsStyle24({
      th: {
        px: "6",
        py: "3",
        lineHeight: "4",
        fontSize: "xs"
      },
      td: {
        px: "6",
        py: "4",
        lineHeight: "5"
      },
      caption: {
        px: "6",
        py: "2",
        fontSize: "sm"
      }
    }),
    lg: definePartsStyle24({
      th: {
        px: "8",
        py: "4",
        lineHeight: "5",
        fontSize: "sm"
      },
      td: {
        px: "8",
        py: "5",
        lineHeight: "6"
      },
      caption: {
        px: "6",
        py: "2",
        fontSize: "md"
      }
    })
  };
  var tableTheme = defineMultiStyleConfig24({
    baseStyle: baseStyle38,
    variants: variants9,
    sizes: sizes20,
    defaultProps: {
      variant: "simple",
      size: "md",
      colorScheme: "gray"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/tabs.mjs
  init_define_import_meta_env();
  var $fg5 = cssVar("tabs-color");
  var $bg14 = cssVar("tabs-bg");
  var $border4 = cssVar("tabs-border-color");
  var { defineMultiStyleConfig: defineMultiStyleConfig25, definePartsStyle: definePartsStyle25 } = createMultiStyleConfigHelpers(tabsAnatomy.keys);
  var baseStyleRoot2 = defineStyle((props) => {
    const { orientation } = props;
    return {
      display: orientation === "vertical" ? "flex" : "block"
    };
  });
  var baseStyleTab = defineStyle((props) => {
    const { isFitted } = props;
    return {
      flex: isFitted ? 1 : void 0,
      transitionProperty: "common",
      transitionDuration: "normal",
      _focusVisible: {
        zIndex: 1,
        boxShadow: "outline"
      },
      _disabled: {
        cursor: "not-allowed",
        opacity: 0.4
      }
    };
  });
  var baseStyleTablist = defineStyle((props) => {
    const { align = "start", orientation } = props;
    const alignments = {
      end: "flex-end",
      center: "center",
      start: "flex-start"
    };
    return {
      justifyContent: alignments[align],
      flexDirection: orientation === "vertical" ? "column" : "row"
    };
  });
  var baseStyleTabpanel = defineStyle({
    p: 4
  });
  var baseStyle39 = definePartsStyle25((props) => ({
    root: baseStyleRoot2(props),
    tab: baseStyleTab(props),
    tablist: baseStyleTablist(props),
    tabpanel: baseStyleTabpanel
  }));
  var sizes21 = {
    sm: definePartsStyle25({
      tab: {
        py: 1,
        px: 4,
        fontSize: "sm"
      }
    }),
    md: definePartsStyle25({
      tab: {
        fontSize: "md",
        py: 2,
        px: 4
      }
    }),
    lg: definePartsStyle25({
      tab: {
        fontSize: "lg",
        py: 3,
        px: 4
      }
    })
  };
  var variantLine = definePartsStyle25((props) => {
    const { colorScheme: c, orientation } = props;
    const isVertical = orientation === "vertical";
    const borderProp = isVertical ? "borderStart" : "borderBottom";
    const marginProp = isVertical ? "marginStart" : "marginBottom";
    return {
      tablist: {
        [borderProp]: "2px solid",
        borderColor: "inherit"
      },
      tab: {
        [borderProp]: "2px solid",
        borderColor: "transparent",
        [marginProp]: "-2px",
        _selected: {
          [$fg5.variable]: `colors.${c}.600`,
          _dark: {
            [$fg5.variable]: `colors.${c}.300`
          },
          borderColor: "currentColor"
        },
        _active: {
          [$bg14.variable]: "colors.gray.200",
          _dark: {
            [$bg14.variable]: "colors.whiteAlpha.300"
          }
        },
        _disabled: {
          _active: { bg: "none" }
        },
        color: $fg5.reference,
        bg: $bg14.reference
      }
    };
  });
  var variantEnclosed = definePartsStyle25((props) => {
    const { colorScheme: c } = props;
    return {
      tab: {
        borderTopRadius: "md",
        border: "1px solid",
        borderColor: "transparent",
        mb: "-1px",
        [$border4.variable]: "transparent",
        _selected: {
          [$fg5.variable]: `colors.${c}.600`,
          [$border4.variable]: `colors.white`,
          _dark: {
            [$fg5.variable]: `colors.${c}.300`,
            [$border4.variable]: `colors.gray.800`
          },
          borderColor: "inherit",
          borderBottomColor: $border4.reference
        },
        color: $fg5.reference
      },
      tablist: {
        mb: "-1px",
        borderBottom: "1px solid",
        borderColor: "inherit"
      }
    };
  });
  var variantEnclosedColored = definePartsStyle25((props) => {
    const { colorScheme: c } = props;
    return {
      tab: {
        border: "1px solid",
        borderColor: "inherit",
        [$bg14.variable]: "colors.gray.50",
        _dark: {
          [$bg14.variable]: "colors.whiteAlpha.50"
        },
        mb: "-1px",
        _notLast: {
          marginEnd: "-1px"
        },
        _selected: {
          [$bg14.variable]: "colors.white",
          [$fg5.variable]: `colors.${c}.600`,
          _dark: {
            [$bg14.variable]: "colors.gray.800",
            [$fg5.variable]: `colors.${c}.300`
          },
          borderColor: "inherit",
          borderTopColor: "currentColor",
          borderBottomColor: "transparent"
        },
        color: $fg5.reference,
        bg: $bg14.reference
      },
      tablist: {
        mb: "-1px",
        borderBottom: "1px solid",
        borderColor: "inherit"
      }
    };
  });
  var variantSoftRounded = definePartsStyle25((props) => {
    const { colorScheme: c, theme: theme2 } = props;
    return {
      tab: {
        borderRadius: "full",
        fontWeight: "semibold",
        color: "gray.600",
        _selected: {
          color: getColor(theme2, `${c}.700`),
          bg: getColor(theme2, `${c}.100`)
        }
      }
    };
  });
  var variantSolidRounded = definePartsStyle25((props) => {
    const { colorScheme: c } = props;
    return {
      tab: {
        borderRadius: "full",
        fontWeight: "semibold",
        [$fg5.variable]: "colors.gray.600",
        _dark: {
          [$fg5.variable]: "inherit"
        },
        _selected: {
          [$fg5.variable]: "colors.white",
          [$bg14.variable]: `colors.${c}.600`,
          _dark: {
            [$fg5.variable]: "colors.gray.800",
            [$bg14.variable]: `colors.${c}.300`
          }
        },
        color: $fg5.reference,
        bg: $bg14.reference
      }
    };
  });
  var variantUnstyled3 = definePartsStyle25({});
  var variants10 = {
    line: variantLine,
    enclosed: variantEnclosed,
    "enclosed-colored": variantEnclosedColored,
    "soft-rounded": variantSoftRounded,
    "solid-rounded": variantSolidRounded,
    unstyled: variantUnstyled3
  };
  var tabsTheme = defineMultiStyleConfig25({
    baseStyle: baseStyle39,
    sizes: sizes21,
    variants: variants10,
    defaultProps: {
      size: "md",
      variant: "line",
      colorScheme: "blue"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/tag.mjs
  init_define_import_meta_env();
  var { defineMultiStyleConfig: defineMultiStyleConfig26, definePartsStyle: definePartsStyle26 } = createMultiStyleConfigHelpers(tagAnatomy.keys);
  var $bg15 = cssVar("tag-bg");
  var $color = cssVar("tag-color");
  var $shadow4 = cssVar("tag-shadow");
  var $minH = cssVar("tag-min-height");
  var $minW = cssVar("tag-min-width");
  var $fontSize2 = cssVar("tag-font-size");
  var $paddingX = cssVar("tag-padding-inline");
  var baseStyleContainer5 = defineStyle({
    fontWeight: "medium",
    lineHeight: 1.2,
    outline: 0,
    [$color.variable]: vars.color.reference,
    [$bg15.variable]: vars.bg.reference,
    [$shadow4.variable]: vars.shadow.reference,
    color: $color.reference,
    bg: $bg15.reference,
    boxShadow: $shadow4.reference,
    borderRadius: "md",
    minH: $minH.reference,
    minW: $minW.reference,
    fontSize: $fontSize2.reference,
    px: $paddingX.reference,
    _focusVisible: {
      [$shadow4.variable]: "shadows.outline"
    }
  });
  var baseStyleLabel5 = defineStyle({
    lineHeight: 1.2,
    overflow: "visible"
  });
  var baseStyleCloseButton4 = defineStyle({
    fontSize: "lg",
    w: "5",
    h: "5",
    transitionProperty: "common",
    transitionDuration: "normal",
    borderRadius: "full",
    marginStart: "1.5",
    marginEnd: "-1",
    opacity: 0.5,
    _disabled: {
      opacity: 0.4
    },
    _focusVisible: {
      boxShadow: "outline",
      bg: "rgba(0, 0, 0, 0.14)"
    },
    _hover: {
      opacity: 0.8
    },
    _active: {
      opacity: 1
    }
  });
  var baseStyle40 = definePartsStyle26({
    container: baseStyleContainer5,
    label: baseStyleLabel5,
    closeButton: baseStyleCloseButton4
  });
  var sizes22 = {
    sm: definePartsStyle26({
      container: {
        [$minH.variable]: "sizes.5",
        [$minW.variable]: "sizes.5",
        [$fontSize2.variable]: "fontSizes.xs",
        [$paddingX.variable]: "space.2"
      },
      closeButton: {
        marginEnd: "-2px",
        marginStart: "0.35rem"
      }
    }),
    md: definePartsStyle26({
      container: {
        [$minH.variable]: "sizes.6",
        [$minW.variable]: "sizes.6",
        [$fontSize2.variable]: "fontSizes.sm",
        [$paddingX.variable]: "space.2"
      }
    }),
    lg: definePartsStyle26({
      container: {
        [$minH.variable]: "sizes.8",
        [$minW.variable]: "sizes.8",
        [$fontSize2.variable]: "fontSizes.md",
        [$paddingX.variable]: "space.3"
      }
    })
  };
  var variants11 = {
    subtle: definePartsStyle26((props) => ({
      container: badgeTheme.variants?.subtle(props)
    })),
    solid: definePartsStyle26((props) => ({
      container: badgeTheme.variants?.solid(props)
    })),
    outline: definePartsStyle26((props) => ({
      container: badgeTheme.variants?.outline(props)
    }))
  };
  var tagTheme = defineMultiStyleConfig26({
    variants: variants11,
    baseStyle: baseStyle40,
    sizes: sizes22,
    defaultProps: {
      size: "md",
      variant: "subtle",
      colorScheme: "gray"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/textarea.mjs
  init_define_import_meta_env();
  var baseStyle41 = defineStyle({
    ...inputTheme.baseStyle?.field,
    paddingY: "2",
    minHeight: "20",
    lineHeight: "short",
    verticalAlign: "top"
  });
  var variants12 = {
    outline: defineStyle(
      (props) => inputTheme.variants?.outline(props).field ?? {}
    ),
    flushed: defineStyle(
      (props) => inputTheme.variants?.flushed(props).field ?? {}
    ),
    filled: defineStyle(
      (props) => inputTheme.variants?.filled(props).field ?? {}
    ),
    unstyled: inputTheme.variants?.unstyled.field ?? {}
  };
  var sizes23 = {
    xs: inputTheme.sizes?.xs.field ?? {},
    sm: inputTheme.sizes?.sm.field ?? {},
    md: inputTheme.sizes?.md.field ?? {},
    lg: inputTheme.sizes?.lg.field ?? {}
  };
  var textareaTheme = defineStyleConfig({
    baseStyle: baseStyle41,
    sizes: sizes23,
    variants: variants12,
    defaultProps: {
      size: "md",
      variant: "outline"
    }
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/tooltip.mjs
  init_define_import_meta_env();
  var $bg16 = cssVar2("tooltip-bg");
  var $fg6 = cssVar2("tooltip-fg");
  var $arrowBg2 = cssVar2("popper-arrow-bg");
  var baseStyle42 = defineStyle({
    bg: $bg16.reference,
    color: $fg6.reference,
    [$bg16.variable]: "colors.gray.700",
    [$fg6.variable]: "colors.whiteAlpha.900",
    _dark: {
      [$bg16.variable]: "colors.gray.300",
      [$fg6.variable]: "colors.gray.900"
    },
    [$arrowBg2.variable]: $bg16.reference,
    px: "2",
    py: "0.5",
    borderRadius: "sm",
    fontWeight: "medium",
    fontSize: "sm",
    boxShadow: "md",
    maxW: "xs",
    zIndex: "tooltip"
  });
  var tooltipTheme = defineStyleConfig({
    baseStyle: baseStyle42
  });

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/components/index.mjs
  var components = {
    Accordion: accordionTheme,
    Alert: alertTheme,
    Avatar: avatarTheme,
    Badge: badgeTheme,
    Breadcrumb: breadcrumbTheme,
    Button: buttonTheme,
    Checkbox: checkboxTheme,
    CloseButton: closeButtonTheme,
    Code: codeTheme,
    Container: containerTheme,
    Divider: dividerTheme,
    Drawer: drawerTheme,
    Editable: editableTheme,
    Form: formTheme,
    FormError: formErrorTheme,
    FormLabel: formLabelTheme,
    Heading: headingTheme,
    Input: inputTheme,
    Kbd: kbdTheme,
    Link: linkTheme,
    List: listTheme,
    Menu: menuTheme,
    Modal: modalTheme,
    NumberInput: numberInputTheme,
    PinInput: pinInputTheme,
    Popover: popoverTheme,
    Progress: progressTheme,
    Radio: radioTheme,
    Select: selectTheme,
    Skeleton: skeletonTheme,
    SkipLink: skipLinkTheme,
    Slider: sliderTheme,
    Spinner: spinnerTheme,
    Stat: statTheme,
    Switch: switchTheme,
    Table: tableTheme,
    Tabs: tabsTheme,
    Tag: tagTheme,
    Textarea: textareaTheme,
    Tooltip: tooltipTheme,
    Card: cardTheme,
    Stepper: stepperTheme
  };

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/foundations/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/foundations/borders.mjs
  init_define_import_meta_env();
  var borders = {
    none: 0,
    "1px": "1px solid",
    "2px": "2px solid",
    "4px": "4px solid",
    "8px": "8px solid"
  };

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/foundations/breakpoints.mjs
  init_define_import_meta_env();
  var breakpoints = {
    base: "0em",
    sm: "30em",
    md: "48em",
    lg: "62em",
    xl: "80em",
    "2xl": "96em"
  };

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/foundations/colors.mjs
  init_define_import_meta_env();
  var colors = {
    transparent: "transparent",
    current: "currentColor",
    black: "#000000",
    white: "#FFFFFF",
    whiteAlpha: {
      50: "rgba(255, 255, 255, 0.04)",
      100: "rgba(255, 255, 255, 0.06)",
      200: "rgba(255, 255, 255, 0.08)",
      300: "rgba(255, 255, 255, 0.16)",
      400: "rgba(255, 255, 255, 0.24)",
      500: "rgba(255, 255, 255, 0.36)",
      600: "rgba(255, 255, 255, 0.48)",
      700: "rgba(255, 255, 255, 0.64)",
      800: "rgba(255, 255, 255, 0.80)",
      900: "rgba(255, 255, 255, 0.92)"
    },
    blackAlpha: {
      50: "rgba(0, 0, 0, 0.04)",
      100: "rgba(0, 0, 0, 0.06)",
      200: "rgba(0, 0, 0, 0.08)",
      300: "rgba(0, 0, 0, 0.16)",
      400: "rgba(0, 0, 0, 0.24)",
      500: "rgba(0, 0, 0, 0.36)",
      600: "rgba(0, 0, 0, 0.48)",
      700: "rgba(0, 0, 0, 0.64)",
      800: "rgba(0, 0, 0, 0.80)",
      900: "rgba(0, 0, 0, 0.92)"
    },
    gray: {
      50: "#F7FAFC",
      100: "#EDF2F7",
      200: "#E2E8F0",
      300: "#CBD5E0",
      400: "#A0AEC0",
      500: "#718096",
      600: "#4A5568",
      700: "#2D3748",
      800: "#1A202C",
      900: "#171923"
    },
    red: {
      50: "#FFF5F5",
      100: "#FED7D7",
      200: "#FEB2B2",
      300: "#FC8181",
      400: "#F56565",
      500: "#E53E3E",
      600: "#C53030",
      700: "#9B2C2C",
      800: "#822727",
      900: "#63171B"
    },
    orange: {
      50: "#FFFAF0",
      100: "#FEEBC8",
      200: "#FBD38D",
      300: "#F6AD55",
      400: "#ED8936",
      500: "#DD6B20",
      600: "#C05621",
      700: "#9C4221",
      800: "#7B341E",
      900: "#652B19"
    },
    yellow: {
      50: "#FFFFF0",
      100: "#FEFCBF",
      200: "#FAF089",
      300: "#F6E05E",
      400: "#ECC94B",
      500: "#D69E2E",
      600: "#B7791F",
      700: "#975A16",
      800: "#744210",
      900: "#5F370E"
    },
    green: {
      50: "#F0FFF4",
      100: "#C6F6D5",
      200: "#9AE6B4",
      300: "#68D391",
      400: "#48BB78",
      500: "#38A169",
      600: "#2F855A",
      700: "#276749",
      800: "#22543D",
      900: "#1C4532"
    },
    teal: {
      50: "#E6FFFA",
      100: "#B2F5EA",
      200: "#81E6D9",
      300: "#4FD1C5",
      400: "#38B2AC",
      500: "#319795",
      600: "#2C7A7B",
      700: "#285E61",
      800: "#234E52",
      900: "#1D4044"
    },
    blue: {
      50: "#ebf8ff",
      100: "#bee3f8",
      200: "#90cdf4",
      300: "#63b3ed",
      400: "#4299e1",
      500: "#3182ce",
      600: "#2b6cb0",
      700: "#2c5282",
      800: "#2a4365",
      900: "#1A365D"
    },
    cyan: {
      50: "#EDFDFD",
      100: "#C4F1F9",
      200: "#9DECF9",
      300: "#76E4F7",
      400: "#0BC5EA",
      500: "#00B5D8",
      600: "#00A3C4",
      700: "#0987A0",
      800: "#086F83",
      900: "#065666"
    },
    purple: {
      50: "#FAF5FF",
      100: "#E9D8FD",
      200: "#D6BCFA",
      300: "#B794F4",
      400: "#9F7AEA",
      500: "#805AD5",
      600: "#6B46C1",
      700: "#553C9A",
      800: "#44337A",
      900: "#322659"
    },
    pink: {
      50: "#FFF5F7",
      100: "#FED7E2",
      200: "#FBB6CE",
      300: "#F687B3",
      400: "#ED64A6",
      500: "#D53F8C",
      600: "#B83280",
      700: "#97266D",
      800: "#702459",
      900: "#521B41"
    }
  };

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/foundations/radius.mjs
  init_define_import_meta_env();
  var radii = {
    none: "0",
    sm: "0.125rem",
    base: "0.25rem",
    md: "0.375rem",
    lg: "0.5rem",
    xl: "0.75rem",
    "2xl": "1rem",
    "3xl": "1.5rem",
    full: "9999px"
  };

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/foundations/shadows.mjs
  init_define_import_meta_env();
  var shadows = {
    xs: "0 0 0 1px rgba(0, 0, 0, 0.05)",
    sm: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
    base: "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)",
    md: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
    lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
    xl: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
    "2xl": "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
    outline: "0 0 0 3px rgba(66, 153, 225, 0.6)",
    inner: "inset 0 2px 4px 0 rgba(0,0,0,0.06)",
    none: "none",
    "dark-lg": "rgba(0, 0, 0, 0.1) 0px 0px 0px 1px, rgba(0, 0, 0, 0.2) 0px 5px 10px, rgba(0, 0, 0, 0.4) 0px 15px 40px"
  };

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/foundations/transition.mjs
  init_define_import_meta_env();
  var transitionProperty = {
    common: "background-color, border-color, color, fill, stroke, opacity, box-shadow, transform",
    colors: "background-color, border-color, color, fill, stroke",
    dimensions: "width, height",
    position: "left, right, top, bottom",
    background: "background-color, background-image, background-position"
  };
  var transitionTimingFunction = {
    "ease-in": "cubic-bezier(0.4, 0, 1, 1)",
    "ease-out": "cubic-bezier(0, 0, 0.2, 1)",
    "ease-in-out": "cubic-bezier(0.4, 0, 0.2, 1)"
  };
  var transitionDuration = {
    "ultra-fast": "50ms",
    faster: "100ms",
    fast: "150ms",
    normal: "200ms",
    slow: "300ms",
    slower: "400ms",
    "ultra-slow": "500ms"
  };
  var transition2 = {
    property: transitionProperty,
    easing: transitionTimingFunction,
    duration: transitionDuration
  };

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/foundations/z-index.mjs
  init_define_import_meta_env();
  var zIndices = {
    hide: -1,
    auto: "auto",
    base: 0,
    docked: 10,
    dropdown: 1e3,
    sticky: 1100,
    banner: 1200,
    overlay: 1300,
    modal: 1400,
    popover: 1500,
    skipLink: 1600,
    toast: 1700,
    tooltip: 1800
  };

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/foundations/blur.mjs
  init_define_import_meta_env();
  var blur = {
    none: 0,
    sm: "4px",
    base: "8px",
    md: "12px",
    lg: "16px",
    xl: "24px",
    "2xl": "40px",
    "3xl": "64px"
  };

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/foundations/index.mjs
  var foundations = {
    breakpoints,
    zIndices,
    radii,
    blur,
    colors,
    ...typography2,
    sizes,
    shadows,
    space: spacing,
    borders,
    transition: transition2
  };

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/semantic-tokens.mjs
  init_define_import_meta_env();
  var semanticTokens = {
    colors: {
      "chakra-body-text": { _light: "gray.800", _dark: "whiteAlpha.900" },
      "chakra-body-bg": { _light: "white", _dark: "gray.800" },
      "chakra-border-color": { _light: "gray.200", _dark: "whiteAlpha.300" },
      "chakra-inverse-text": { _light: "white", _dark: "gray.800" },
      "chakra-subtle-bg": { _light: "gray.100", _dark: "gray.700" },
      "chakra-subtle-text": { _light: "gray.600", _dark: "gray.400" },
      "chakra-placeholder-color": { _light: "gray.500", _dark: "whiteAlpha.400" }
    }
  };

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/styles.mjs
  init_define_import_meta_env();
  var styles = {
    global: {
      body: {
        fontFamily: "body",
        color: "chakra-body-text",
        bg: "chakra-body-bg",
        transitionProperty: "background-color",
        transitionDuration: "normal",
        lineHeight: "base"
      },
      "*::placeholder": {
        color: "chakra-placeholder-color"
      },
      "*, *::before, *::after": {
        borderColor: "chakra-border-color"
      }
    }
  };

  // remix/node_modules/.pnpm/@chakra-ui+theme@3.4.10_@chakra-ui+styled-system@2.12.5_react@18.3.1__react@18.3.1/node_modules/@chakra-ui/theme/dist/esm/index.mjs
  var direction = "ltr";
  var config = {
    useSystemColorMode: false,
    initialColorMode: "light",
    cssVarPrefix: "chakra"
  };
  var theme = {
    semanticTokens,
    direction,
    ...foundations,
    components,
    styles,
    config
  };
  var baseTheme = {
    semanticTokens,
    direction,
    components: {},
    ...foundations,
    styles,
    config
  };

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/provider/create-provider.mjs
  init_define_import_meta_env();
  var import_jsx_runtime24 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/provider/provider.mjs
  init_define_import_meta_env();
  var import_jsx_runtime6 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/color-mode/color-mode-provider.mjs
  init_define_import_meta_env();
  var import_jsx_runtime = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1/node_modules/@emotion/react/dist/emotion-react.browser.esm.js
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1/node_modules/@emotion/react/dist/emotion-element-f0de968e.browser.esm.js
  init_define_import_meta_env();
  var React2 = __toESM(require_react_shim());
  var import_react6 = __toESM(require_react_shim());

  // remix/node_modules/.pnpm/@emotion+cache@11.14.0/node_modules/@emotion/cache/dist/emotion-cache.browser.esm.js
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@emotion+sheet@1.4.0/node_modules/@emotion/sheet/dist/emotion-sheet.esm.js
  init_define_import_meta_env();
  var isDevelopment = false;
  function sheetForTag(tag) {
    if (tag.sheet) {
      return tag.sheet;
    }
    for (var i = 0; i < document.styleSheets.length; i++) {
      if (document.styleSheets[i].ownerNode === tag) {
        return document.styleSheets[i];
      }
    }
    return void 0;
  }
  function createStyleElement(options) {
    var tag = document.createElement("style");
    tag.setAttribute("data-emotion", options.key);
    if (options.nonce !== void 0) {
      tag.setAttribute("nonce", options.nonce);
    }
    tag.appendChild(document.createTextNode(""));
    tag.setAttribute("data-s", "");
    return tag;
  }
  var StyleSheet = /* @__PURE__ */ (function() {
    function StyleSheet2(options) {
      var _this = this;
      this._insertTag = function(tag) {
        var before;
        if (_this.tags.length === 0) {
          if (_this.insertionPoint) {
            before = _this.insertionPoint.nextSibling;
          } else if (_this.prepend) {
            before = _this.container.firstChild;
          } else {
            before = _this.before;
          }
        } else {
          before = _this.tags[_this.tags.length - 1].nextSibling;
        }
        _this.container.insertBefore(tag, before);
        _this.tags.push(tag);
      };
      this.isSpeedy = options.speedy === void 0 ? !isDevelopment : options.speedy;
      this.tags = [];
      this.ctr = 0;
      this.nonce = options.nonce;
      this.key = options.key;
      this.container = options.container;
      this.prepend = options.prepend;
      this.insertionPoint = options.insertionPoint;
      this.before = null;
    }
    var _proto = StyleSheet2.prototype;
    _proto.hydrate = function hydrate(nodes) {
      nodes.forEach(this._insertTag);
    };
    _proto.insert = function insert(rule) {
      if (this.ctr % (this.isSpeedy ? 65e3 : 1) === 0) {
        this._insertTag(createStyleElement(this));
      }
      var tag = this.tags[this.tags.length - 1];
      if (this.isSpeedy) {
        var sheet = sheetForTag(tag);
        try {
          sheet.insertRule(rule, sheet.cssRules.length);
        } catch (e) {
        }
      } else {
        tag.appendChild(document.createTextNode(rule));
      }
      this.ctr++;
    };
    _proto.flush = function flush() {
      this.tags.forEach(function(tag) {
        var _tag$parentNode;
        return (_tag$parentNode = tag.parentNode) == null ? void 0 : _tag$parentNode.removeChild(tag);
      });
      this.tags = [];
      this.ctr = 0;
    };
    return StyleSheet2;
  })();

  // remix/node_modules/.pnpm/stylis@4.2.0/node_modules/stylis/src/Enum.js
  init_define_import_meta_env();
  var MS = "-ms-";
  var MOZ = "-moz-";
  var WEBKIT = "-webkit-";
  var COMMENT = "comm";
  var RULESET = "rule";
  var DECLARATION = "decl";
  var IMPORT = "@import";
  var KEYFRAMES = "@keyframes";
  var LAYER = "@layer";

  // remix/node_modules/.pnpm/stylis@4.2.0/node_modules/stylis/src/Utility.js
  init_define_import_meta_env();
  var abs = Math.abs;
  var from = String.fromCharCode;
  var assign = Object.assign;
  function hash2(value, length2) {
    return charat(value, 0) ^ 45 ? (((length2 << 2 ^ charat(value, 0)) << 2 ^ charat(value, 1)) << 2 ^ charat(value, 2)) << 2 ^ charat(value, 3) : 0;
  }
  function trim(value) {
    return value.trim();
  }
  function match(value, pattern) {
    return (value = pattern.exec(value)) ? value[0] : value;
  }
  function replace(value, pattern, replacement) {
    return value.replace(pattern, replacement);
  }
  function indexof(value, search) {
    return value.indexOf(search);
  }
  function charat(value, index) {
    return value.charCodeAt(index) | 0;
  }
  function substr(value, begin, end) {
    return value.slice(begin, end);
  }
  function strlen(value) {
    return value.length;
  }
  function sizeof(value) {
    return value.length;
  }
  function append(value, array) {
    return array.push(value), value;
  }
  function combine(array, callback) {
    return array.map(callback).join("");
  }

  // remix/node_modules/.pnpm/stylis@4.2.0/node_modules/stylis/src/Parser.js
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/stylis@4.2.0/node_modules/stylis/src/Tokenizer.js
  init_define_import_meta_env();
  var line = 1;
  var column = 1;
  var length = 0;
  var position2 = 0;
  var character = 0;
  var characters = "";
  function node(value, root, parent, type, props, children, length2) {
    return { value, root, parent, type, props, children, line, column, length: length2, return: "" };
  }
  function copy(root, props) {
    return assign(node("", null, null, "", null, null, 0), root, { length: -root.length }, props);
  }
  function char() {
    return character;
  }
  function prev() {
    character = position2 > 0 ? charat(characters, --position2) : 0;
    if (column--, character === 10)
      column = 1, line--;
    return character;
  }
  function next() {
    character = position2 < length ? charat(characters, position2++) : 0;
    if (column++, character === 10)
      column = 1, line++;
    return character;
  }
  function peek() {
    return charat(characters, position2);
  }
  function caret() {
    return position2;
  }
  function slice(begin, end) {
    return substr(characters, begin, end);
  }
  function token(type) {
    switch (type) {
      // \0 \t \n \r \s whitespace token
      case 0:
      case 9:
      case 10:
      case 13:
      case 32:
        return 5;
      // ! + , / > @ ~ isolate token
      case 33:
      case 43:
      case 44:
      case 47:
      case 62:
      case 64:
      case 126:
      // ; { } breakpoint token
      case 59:
      case 123:
      case 125:
        return 4;
      // : accompanied token
      case 58:
        return 3;
      // " ' ( [ opening delimit token
      case 34:
      case 39:
      case 40:
      case 91:
        return 2;
      // ) ] closing delimit token
      case 41:
      case 93:
        return 1;
    }
    return 0;
  }
  function alloc(value) {
    return line = column = 1, length = strlen(characters = value), position2 = 0, [];
  }
  function dealloc(value) {
    return characters = "", value;
  }
  function delimit(type) {
    return trim(slice(position2 - 1, delimiter(type === 91 ? type + 2 : type === 40 ? type + 1 : type)));
  }
  function whitespace(type) {
    while (character = peek())
      if (character < 33)
        next();
      else
        break;
    return token(type) > 2 || token(character) > 3 ? "" : " ";
  }
  function escaping(index, count) {
    while (--count && next())
      if (character < 48 || character > 102 || character > 57 && character < 65 || character > 70 && character < 97)
        break;
    return slice(index, caret() + (count < 6 && peek() == 32 && next() == 32));
  }
  function delimiter(type) {
    while (next())
      switch (character) {
        // ] ) " '
        case type:
          return position2;
        // " '
        case 34:
        case 39:
          if (type !== 34 && type !== 39)
            delimiter(character);
          break;
        // (
        case 40:
          if (type === 41)
            delimiter(type);
          break;
        // \
        case 92:
          next();
          break;
      }
    return position2;
  }
  function commenter(type, index) {
    while (next())
      if (type + character === 47 + 10)
        break;
      else if (type + character === 42 + 42 && peek() === 47)
        break;
    return "/*" + slice(index, position2 - 1) + "*" + from(type === 47 ? type : next());
  }
  function identifier(index) {
    while (!token(peek()))
      next();
    return slice(index, position2);
  }

  // remix/node_modules/.pnpm/stylis@4.2.0/node_modules/stylis/src/Parser.js
  function compile(value) {
    return dealloc(parse("", null, null, null, [""], value = alloc(value), 0, [0], value));
  }
  function parse(value, root, parent, rule, rules, rulesets, pseudo, points, declarations) {
    var index = 0;
    var offset = 0;
    var length2 = pseudo;
    var atrule = 0;
    var property = 0;
    var previous = 0;
    var variable = 1;
    var scanning = 1;
    var ampersand = 1;
    var character2 = 0;
    var type = "";
    var props = rules;
    var children = rulesets;
    var reference = rule;
    var characters2 = type;
    while (scanning)
      switch (previous = character2, character2 = next()) {
        // (
        case 40:
          if (previous != 108 && charat(characters2, length2 - 1) == 58) {
            if (indexof(characters2 += replace(delimit(character2), "&", "&\f"), "&\f") != -1)
              ampersand = -1;
            break;
          }
        // " ' [
        case 34:
        case 39:
        case 91:
          characters2 += delimit(character2);
          break;
        // \t \n \r \s
        case 9:
        case 10:
        case 13:
        case 32:
          characters2 += whitespace(previous);
          break;
        // \
        case 92:
          characters2 += escaping(caret() - 1, 7);
          continue;
        // /
        case 47:
          switch (peek()) {
            case 42:
            case 47:
              append(comment(commenter(next(), caret()), root, parent), declarations);
              break;
            default:
              characters2 += "/";
          }
          break;
        // {
        case 123 * variable:
          points[index++] = strlen(characters2) * ampersand;
        // } ; \0
        case 125 * variable:
        case 59:
        case 0:
          switch (character2) {
            // \0 }
            case 0:
            case 125:
              scanning = 0;
            // ;
            case 59 + offset:
              if (ampersand == -1) characters2 = replace(characters2, /\f/g, "");
              if (property > 0 && strlen(characters2) - length2)
                append(property > 32 ? declaration(characters2 + ";", rule, parent, length2 - 1) : declaration(replace(characters2, " ", "") + ";", rule, parent, length2 - 2), declarations);
              break;
            // @ ;
            case 59:
              characters2 += ";";
            // { rule/at-rule
            default:
              append(reference = ruleset(characters2, root, parent, index, offset, rules, points, type, props = [], children = [], length2), rulesets);
              if (character2 === 123)
                if (offset === 0)
                  parse(characters2, root, reference, reference, props, rulesets, length2, points, children);
                else
                  switch (atrule === 99 && charat(characters2, 3) === 110 ? 100 : atrule) {
                    // d l m s
                    case 100:
                    case 108:
                    case 109:
                    case 115:
                      parse(value, reference, reference, rule && append(ruleset(value, reference, reference, 0, 0, rules, points, type, rules, props = [], length2), children), rules, children, length2, points, rule ? props : children);
                      break;
                    default:
                      parse(characters2, reference, reference, reference, [""], children, 0, points, children);
                  }
          }
          index = offset = property = 0, variable = ampersand = 1, type = characters2 = "", length2 = pseudo;
          break;
        // :
        case 58:
          length2 = 1 + strlen(characters2), property = previous;
        default:
          if (variable < 1) {
            if (character2 == 123)
              --variable;
            else if (character2 == 125 && variable++ == 0 && prev() == 125)
              continue;
          }
          switch (characters2 += from(character2), character2 * variable) {
            // &
            case 38:
              ampersand = offset > 0 ? 1 : (characters2 += "\f", -1);
              break;
            // ,
            case 44:
              points[index++] = (strlen(characters2) - 1) * ampersand, ampersand = 1;
              break;
            // @
            case 64:
              if (peek() === 45)
                characters2 += delimit(next());
              atrule = peek(), offset = length2 = strlen(type = characters2 += identifier(caret())), character2++;
              break;
            // -
            case 45:
              if (previous === 45 && strlen(characters2) == 2)
                variable = 0;
          }
      }
    return rulesets;
  }
  function ruleset(value, root, parent, index, offset, rules, points, type, props, children, length2) {
    var post = offset - 1;
    var rule = offset === 0 ? rules : [""];
    var size2 = sizeof(rule);
    for (var i = 0, j = 0, k = 0; i < index; ++i)
      for (var x = 0, y = substr(value, post + 1, post = abs(j = points[i])), z = value; x < size2; ++x)
        if (z = trim(j > 0 ? rule[x] + " " + y : replace(y, /&\f/g, rule[x])))
          props[k++] = z;
    return node(value, root, parent, offset === 0 ? RULESET : type, props, children, length2);
  }
  function comment(value, root, parent) {
    return node(value, root, parent, COMMENT, from(char()), substr(value, 2, -2), 0);
  }
  function declaration(value, root, parent, length2) {
    return node(value, root, parent, DECLARATION, substr(value, 0, length2), substr(value, length2 + 1, -1), length2);
  }

  // remix/node_modules/.pnpm/stylis@4.2.0/node_modules/stylis/src/Serializer.js
  init_define_import_meta_env();
  function serialize(children, callback) {
    var output = "";
    var length2 = sizeof(children);
    for (var i = 0; i < length2; i++)
      output += callback(children[i], i, children, callback) || "";
    return output;
  }
  function stringify(element, index, children, callback) {
    switch (element.type) {
      case LAYER:
        if (element.children.length) break;
      case IMPORT:
      case DECLARATION:
        return element.return = element.return || element.value;
      case COMMENT:
        return "";
      case KEYFRAMES:
        return element.return = element.value + "{" + serialize(element.children, callback) + "}";
      case RULESET:
        element.value = element.props.join(",");
    }
    return strlen(children = serialize(element.children, callback)) ? element.return = element.value + "{" + children + "}" : "";
  }

  // remix/node_modules/.pnpm/stylis@4.2.0/node_modules/stylis/src/Middleware.js
  init_define_import_meta_env();
  function middleware(collection) {
    var length2 = sizeof(collection);
    return function(element, index, children, callback) {
      var output = "";
      for (var i = 0; i < length2; i++)
        output += collection[i](element, index, children, callback) || "";
      return output;
    };
  }
  function rulesheet(callback) {
    return function(element) {
      if (!element.root) {
        if (element = element.return)
          callback(element);
      }
    };
  }

  // remix/node_modules/.pnpm/@emotion+weak-memoize@0.4.0/node_modules/@emotion/weak-memoize/dist/emotion-weak-memoize.esm.js
  init_define_import_meta_env();
  var weakMemoize = function weakMemoize2(func) {
    var cache = /* @__PURE__ */ new WeakMap();
    return function(arg) {
      if (cache.has(arg)) {
        return cache.get(arg);
      }
      var ret = func(arg);
      cache.set(arg, ret);
      return ret;
    };
  };

  // remix/node_modules/.pnpm/@emotion+cache@11.14.0/node_modules/@emotion/cache/dist/emotion-cache.browser.esm.js
  init_emotion_memoize_esm();
  var identifierWithPointTracking = function identifierWithPointTracking2(begin, points, index) {
    var previous = 0;
    var character2 = 0;
    while (true) {
      previous = character2;
      character2 = peek();
      if (previous === 38 && character2 === 12) {
        points[index] = 1;
      }
      if (token(character2)) {
        break;
      }
      next();
    }
    return slice(begin, position2);
  };
  var toRules = function toRules2(parsed, points) {
    var index = -1;
    var character2 = 44;
    do {
      switch (token(character2)) {
        case 0:
          if (character2 === 38 && peek() === 12) {
            points[index] = 1;
          }
          parsed[index] += identifierWithPointTracking(position2 - 1, points, index);
          break;
        case 2:
          parsed[index] += delimit(character2);
          break;
        case 4:
          if (character2 === 44) {
            parsed[++index] = peek() === 58 ? "&\f" : "";
            points[index] = parsed[index].length;
            break;
          }
        // fallthrough
        default:
          parsed[index] += from(character2);
      }
    } while (character2 = next());
    return parsed;
  };
  var getRules = function getRules2(value, points) {
    return dealloc(toRules(alloc(value), points));
  };
  var fixedElements = /* @__PURE__ */ new WeakMap();
  var compat = function compat2(element) {
    if (element.type !== "rule" || !element.parent || // positive .length indicates that this rule contains pseudo
    // negative .length indicates that this rule has been already prefixed
    element.length < 1) {
      return;
    }
    var value = element.value;
    var parent = element.parent;
    var isImplicitRule = element.column === parent.column && element.line === parent.line;
    while (parent.type !== "rule") {
      parent = parent.parent;
      if (!parent) return;
    }
    if (element.props.length === 1 && value.charCodeAt(0) !== 58 && !fixedElements.get(parent)) {
      return;
    }
    if (isImplicitRule) {
      return;
    }
    fixedElements.set(element, true);
    var points = [];
    var rules = getRules(value, points);
    var parentRules = parent.props;
    for (var i = 0, k = 0; i < rules.length; i++) {
      for (var j = 0; j < parentRules.length; j++, k++) {
        element.props[k] = points[i] ? rules[i].replace(/&\f/g, parentRules[j]) : parentRules[j] + " " + rules[i];
      }
    }
  };
  var removeLabel = function removeLabel2(element) {
    if (element.type === "decl") {
      var value = element.value;
      if (
        // charcode for l
        value.charCodeAt(0) === 108 && // charcode for b
        value.charCodeAt(2) === 98
      ) {
        element["return"] = "";
        element.value = "";
      }
    }
  };
  function prefix(value, length2) {
    switch (hash2(value, length2)) {
      // color-adjust
      case 5103:
        return WEBKIT + "print-" + value + value;
      // animation, animation-(delay|direction|duration|fill-mode|iteration-count|name|play-state|timing-function)
      case 5737:
      case 4201:
      case 3177:
      case 3433:
      case 1641:
      case 4457:
      case 2921:
      // text-decoration, filter, clip-path, backface-visibility, column, box-decoration-break
      case 5572:
      case 6356:
      case 5844:
      case 3191:
      case 6645:
      case 3005:
      // mask, mask-image, mask-(mode|clip|size), mask-(repeat|origin), mask-position, mask-composite,
      case 6391:
      case 5879:
      case 5623:
      case 6135:
      case 4599:
      case 4855:
      // background-clip, columns, column-(count|fill|gap|rule|rule-color|rule-style|rule-width|span|width)
      case 4215:
      case 6389:
      case 5109:
      case 5365:
      case 5621:
      case 3829:
        return WEBKIT + value + value;
      // appearance, user-select, transform, hyphens, text-size-adjust
      case 5349:
      case 4246:
      case 4810:
      case 6968:
      case 2756:
        return WEBKIT + value + MOZ + value + MS + value + value;
      // flex, flex-direction
      case 6828:
      case 4268:
        return WEBKIT + value + MS + value + value;
      // order
      case 6165:
        return WEBKIT + value + MS + "flex-" + value + value;
      // align-items
      case 5187:
        return WEBKIT + value + replace(value, /(\w+).+(:[^]+)/, WEBKIT + "box-$1$2" + MS + "flex-$1$2") + value;
      // align-self
      case 5443:
        return WEBKIT + value + MS + "flex-item-" + replace(value, /flex-|-self/, "") + value;
      // align-content
      case 4675:
        return WEBKIT + value + MS + "flex-line-pack" + replace(value, /align-content|flex-|-self/, "") + value;
      // flex-shrink
      case 5548:
        return WEBKIT + value + MS + replace(value, "shrink", "negative") + value;
      // flex-basis
      case 5292:
        return WEBKIT + value + MS + replace(value, "basis", "preferred-size") + value;
      // flex-grow
      case 6060:
        return WEBKIT + "box-" + replace(value, "-grow", "") + WEBKIT + value + MS + replace(value, "grow", "positive") + value;
      // transition
      case 4554:
        return WEBKIT + replace(value, /([^-])(transform)/g, "$1" + WEBKIT + "$2") + value;
      // cursor
      case 6187:
        return replace(replace(replace(value, /(zoom-|grab)/, WEBKIT + "$1"), /(image-set)/, WEBKIT + "$1"), value, "") + value;
      // background, background-image
      case 5495:
      case 3959:
        return replace(value, /(image-set\([^]*)/, WEBKIT + "$1$`$1");
      // justify-content
      case 4968:
        return replace(replace(value, /(.+:)(flex-)?(.*)/, WEBKIT + "box-pack:$3" + MS + "flex-pack:$3"), /s.+-b[^;]+/, "justify") + WEBKIT + value + value;
      // (margin|padding)-inline-(start|end)
      case 4095:
      case 3583:
      case 4068:
      case 2532:
        return replace(value, /(.+)-inline(.+)/, WEBKIT + "$1$2") + value;
      // (min|max)?(width|height|inline-size|block-size)
      case 8116:
      case 7059:
      case 5753:
      case 5535:
      case 5445:
      case 5701:
      case 4933:
      case 4677:
      case 5533:
      case 5789:
      case 5021:
      case 4765:
        if (strlen(value) - 1 - length2 > 6) switch (charat(value, length2 + 1)) {
          // (m)ax-content, (m)in-content
          case 109:
            if (charat(value, length2 + 4) !== 45) break;
          // (f)ill-available, (f)it-content
          case 102:
            return replace(value, /(.+:)(.+)-([^]+)/, "$1" + WEBKIT + "$2-$3$1" + MOZ + (charat(value, length2 + 3) == 108 ? "$3" : "$2-$3")) + value;
          // (s)tretch
          case 115:
            return ~indexof(value, "stretch") ? prefix(replace(value, "stretch", "fill-available"), length2) + value : value;
        }
        break;
      // position: sticky
      case 4949:
        if (charat(value, length2 + 1) !== 115) break;
      // display: (flex|inline-flex)
      case 6444:
        switch (charat(value, strlen(value) - 3 - (~indexof(value, "!important") && 10))) {
          // stic(k)y
          case 107:
            return replace(value, ":", ":" + WEBKIT) + value;
          // (inline-)?fl(e)x
          case 101:
            return replace(value, /(.+:)([^;!]+)(;|!.+)?/, "$1" + WEBKIT + (charat(value, 14) === 45 ? "inline-" : "") + "box$3$1" + WEBKIT + "$2$3$1" + MS + "$2box$3") + value;
        }
        break;
      // writing-mode
      case 5936:
        switch (charat(value, length2 + 11)) {
          // vertical-l(r)
          case 114:
            return WEBKIT + value + MS + replace(value, /[svh]\w+-[tblr]{2}/, "tb") + value;
          // vertical-r(l)
          case 108:
            return WEBKIT + value + MS + replace(value, /[svh]\w+-[tblr]{2}/, "tb-rl") + value;
          // horizontal(-)tb
          case 45:
            return WEBKIT + value + MS + replace(value, /[svh]\w+-[tblr]{2}/, "lr") + value;
        }
        return WEBKIT + value + MS + value + value;
    }
    return value;
  }
  var prefixer = function prefixer2(element, index, children, callback) {
    if (element.length > -1) {
      if (!element["return"]) switch (element.type) {
        case DECLARATION:
          element["return"] = prefix(element.value, element.length);
          break;
        case KEYFRAMES:
          return serialize([copy(element, {
            value: replace(element.value, "@", "@" + WEBKIT)
          })], callback);
        case RULESET:
          if (element.length) return combine(element.props, function(value) {
            switch (match(value, /(::plac\w+|:read-\w+)/)) {
              // :read-(only|write)
              case ":read-only":
              case ":read-write":
                return serialize([copy(element, {
                  props: [replace(value, /:(read-\w+)/, ":" + MOZ + "$1")]
                })], callback);
              // :placeholder
              case "::placeholder":
                return serialize([copy(element, {
                  props: [replace(value, /:(plac\w+)/, ":" + WEBKIT + "input-$1")]
                }), copy(element, {
                  props: [replace(value, /:(plac\w+)/, ":" + MOZ + "$1")]
                }), copy(element, {
                  props: [replace(value, /:(plac\w+)/, MS + "input-$1")]
                })], callback);
            }
            return "";
          });
      }
    }
  };
  var defaultStylisPlugins = [prefixer];
  var createCache = function createCache2(options) {
    var key = options.key;
    if (key === "css") {
      var ssrStyles = document.querySelectorAll("style[data-emotion]:not([data-s])");
      Array.prototype.forEach.call(ssrStyles, function(node2) {
        var dataEmotionAttribute = node2.getAttribute("data-emotion");
        if (dataEmotionAttribute.indexOf(" ") === -1) {
          return;
        }
        document.head.appendChild(node2);
        node2.setAttribute("data-s", "");
      });
    }
    var stylisPlugins = options.stylisPlugins || defaultStylisPlugins;
    var inserted = {};
    var container2;
    var nodesToHydrate = [];
    {
      container2 = options.container || document.head;
      Array.prototype.forEach.call(
        // this means we will ignore elements which don't have a space in them which
        // means that the style elements we're looking at are only Emotion 11 server-rendered style elements
        document.querySelectorAll('style[data-emotion^="' + key + ' "]'),
        function(node2) {
          var attrib = node2.getAttribute("data-emotion").split(" ");
          for (var i = 1; i < attrib.length; i++) {
            inserted[attrib[i]] = true;
          }
          nodesToHydrate.push(node2);
        }
      );
    }
    var _insert;
    var omnipresentPlugins = [compat, removeLabel];
    {
      var currentSheet;
      var finalizingPlugins = [stringify, rulesheet(function(rule) {
        currentSheet.insert(rule);
      })];
      var serializer = middleware(omnipresentPlugins.concat(stylisPlugins, finalizingPlugins));
      var stylis = function stylis2(styles2) {
        return serialize(compile(styles2), serializer);
      };
      _insert = function insert(selector, serialized, sheet, shouldCache) {
        currentSheet = sheet;
        stylis(selector ? selector + "{" + serialized.styles + "}" : serialized.styles);
        if (shouldCache) {
          cache.inserted[serialized.name] = true;
        }
      };
    }
    var cache = {
      key,
      sheet: new StyleSheet({
        key,
        container: container2,
        nonce: options.nonce,
        speedy: options.speedy,
        prepend: options.prepend,
        insertionPoint: options.insertionPoint
      }),
      nonce: options.nonce,
      inserted,
      registered: {},
      insert: _insert
    };
    cache.sheet.hydrate(nodesToHydrate);
    return cache;
  };

  // remix/node_modules/.pnpm/@babel+runtime@7.29.7/node_modules/@babel/runtime/helpers/esm/extends.js
  init_define_import_meta_env();
  function _extends() {
    return _extends = Object.assign ? Object.assign.bind() : function(n) {
      for (var e = 1; e < arguments.length; e++) {
        var t2 = arguments[e];
        for (var r2 in t2) ({}).hasOwnProperty.call(t2, r2) && (n[r2] = t2[r2]);
      }
      return n;
    }, _extends.apply(null, arguments);
  }

  // remix/node_modules/.pnpm/@emotion+utils@1.4.2/node_modules/@emotion/utils/dist/emotion-utils.browser.esm.js
  init_define_import_meta_env();
  var isBrowser2 = true;
  function getRegisteredStyles(registered, registeredStyles, classNames2) {
    var rawClassName = "";
    classNames2.split(" ").forEach(function(className) {
      if (registered[className] !== void 0) {
        registeredStyles.push(registered[className] + ";");
      } else if (className) {
        rawClassName += className + " ";
      }
    });
    return rawClassName;
  }
  var registerStyles = function registerStyles2(cache, serialized, isStringTag) {
    var className = cache.key + "-" + serialized.name;
    if (
      // we only need to add the styles to the registered cache if the
      // class name could be used further down
      // the tree but if it's a string tag, we know it won't
      // so we don't have to add it to registered cache.
      // this improves memory usage since we can avoid storing the whole style string
      (isStringTag === false || // we need to always store it if we're in compat mode and
      // in node since emotion-server relies on whether a style is in
      // the registered cache to know whether a style is global or not
      // also, note that this check will be dead code eliminated in the browser
      isBrowser2 === false) && cache.registered[className] === void 0
    ) {
      cache.registered[className] = serialized.styles;
    }
  };
  var insertStyles = function insertStyles2(cache, serialized, isStringTag) {
    registerStyles(cache, serialized, isStringTag);
    var className = cache.key + "-" + serialized.name;
    if (cache.inserted[serialized.name] === void 0) {
      var current = serialized;
      do {
        cache.insert(serialized === current ? "." + className : "", current, cache.sheet, true);
        current = current.next;
      } while (current !== void 0);
    }
  };

  // remix/node_modules/.pnpm/@emotion+serialize@1.3.3/node_modules/@emotion/serialize/dist/emotion-serialize.esm.js
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@emotion+hash@0.9.2/node_modules/@emotion/hash/dist/emotion-hash.esm.js
  init_define_import_meta_env();
  function murmur2(str) {
    var h = 0;
    var k, i = 0, len = str.length;
    for (; len >= 4; ++i, len -= 4) {
      k = str.charCodeAt(i) & 255 | (str.charCodeAt(++i) & 255) << 8 | (str.charCodeAt(++i) & 255) << 16 | (str.charCodeAt(++i) & 255) << 24;
      k = /* Math.imul(k, m): */
      (k & 65535) * 1540483477 + ((k >>> 16) * 59797 << 16);
      k ^= /* k >>> r: */
      k >>> 24;
      h = /* Math.imul(k, m): */
      (k & 65535) * 1540483477 + ((k >>> 16) * 59797 << 16) ^ /* Math.imul(h, m): */
      (h & 65535) * 1540483477 + ((h >>> 16) * 59797 << 16);
    }
    switch (len) {
      case 3:
        h ^= (str.charCodeAt(i + 2) & 255) << 16;
      case 2:
        h ^= (str.charCodeAt(i + 1) & 255) << 8;
      case 1:
        h ^= str.charCodeAt(i) & 255;
        h = /* Math.imul(h, m): */
        (h & 65535) * 1540483477 + ((h >>> 16) * 59797 << 16);
    }
    h ^= h >>> 13;
    h = /* Math.imul(h, m): */
    (h & 65535) * 1540483477 + ((h >>> 16) * 59797 << 16);
    return ((h ^ h >>> 15) >>> 0).toString(36);
  }

  // remix/node_modules/.pnpm/@emotion+unitless@0.10.0/node_modules/@emotion/unitless/dist/emotion-unitless.esm.js
  init_define_import_meta_env();
  var unitlessKeys = {
    animationIterationCount: 1,
    aspectRatio: 1,
    borderImageOutset: 1,
    borderImageSlice: 1,
    borderImageWidth: 1,
    boxFlex: 1,
    boxFlexGroup: 1,
    boxOrdinalGroup: 1,
    columnCount: 1,
    columns: 1,
    flex: 1,
    flexGrow: 1,
    flexPositive: 1,
    flexShrink: 1,
    flexNegative: 1,
    flexOrder: 1,
    gridRow: 1,
    gridRowEnd: 1,
    gridRowSpan: 1,
    gridRowStart: 1,
    gridColumn: 1,
    gridColumnEnd: 1,
    gridColumnSpan: 1,
    gridColumnStart: 1,
    msGridRow: 1,
    msGridRowSpan: 1,
    msGridColumn: 1,
    msGridColumnSpan: 1,
    fontWeight: 1,
    lineHeight: 1,
    opacity: 1,
    order: 1,
    orphans: 1,
    scale: 1,
    tabSize: 1,
    widows: 1,
    zIndex: 1,
    zoom: 1,
    WebkitLineClamp: 1,
    // SVG-related properties
    fillOpacity: 1,
    floodOpacity: 1,
    stopOpacity: 1,
    strokeDasharray: 1,
    strokeDashoffset: 1,
    strokeMiterlimit: 1,
    strokeOpacity: 1,
    strokeWidth: 1
  };

  // remix/node_modules/.pnpm/@emotion+serialize@1.3.3/node_modules/@emotion/serialize/dist/emotion-serialize.esm.js
  init_emotion_memoize_esm();
  var isDevelopment2 = false;
  var hyphenateRegex = /[A-Z]|^ms/g;
  var animationRegex = /_EMO_([^_]+?)_([^]*?)_EMO_/g;
  var isCustomProperty = function isCustomProperty2(property) {
    return property.charCodeAt(1) === 45;
  };
  var isProcessableValue = function isProcessableValue2(value) {
    return value != null && typeof value !== "boolean";
  };
  var processStyleName = /* @__PURE__ */ memoize3(function(styleName) {
    return isCustomProperty(styleName) ? styleName : styleName.replace(hyphenateRegex, "-$&").toLowerCase();
  });
  var processStyleValue = function processStyleValue2(key, value) {
    switch (key) {
      case "animation":
      case "animationName": {
        if (typeof value === "string") {
          return value.replace(animationRegex, function(match2, p1, p2) {
            cursor = {
              name: p1,
              styles: p2,
              next: cursor
            };
            return p1;
          });
        }
      }
    }
    if (unitlessKeys[key] !== 1 && !isCustomProperty(key) && typeof value === "number" && value !== 0) {
      return value + "px";
    }
    return value;
  };
  var noComponentSelectorMessage = "Component selectors can only be used in conjunction with @emotion/babel-plugin, the swc Emotion plugin, or another Emotion-aware compiler transform.";
  function handleInterpolation(mergedProps, registered, interpolation) {
    if (interpolation == null) {
      return "";
    }
    var componentSelector = interpolation;
    if (componentSelector.__emotion_styles !== void 0) {
      return componentSelector;
    }
    switch (typeof interpolation) {
      case "boolean": {
        return "";
      }
      case "object": {
        var keyframes3 = interpolation;
        if (keyframes3.anim === 1) {
          cursor = {
            name: keyframes3.name,
            styles: keyframes3.styles,
            next: cursor
          };
          return keyframes3.name;
        }
        var serializedStyles = interpolation;
        if (serializedStyles.styles !== void 0) {
          var next2 = serializedStyles.next;
          if (next2 !== void 0) {
            while (next2 !== void 0) {
              cursor = {
                name: next2.name,
                styles: next2.styles,
                next: cursor
              };
              next2 = next2.next;
            }
          }
          var styles2 = serializedStyles.styles + ";";
          return styles2;
        }
        return createStringFromObject(mergedProps, registered, interpolation);
      }
      case "function": {
        if (mergedProps !== void 0) {
          var previousCursor = cursor;
          var result = interpolation(mergedProps);
          cursor = previousCursor;
          return handleInterpolation(mergedProps, registered, result);
        }
        break;
      }
    }
    var asString = interpolation;
    if (registered == null) {
      return asString;
    }
    var cached = registered[asString];
    return cached !== void 0 ? cached : asString;
  }
  function createStringFromObject(mergedProps, registered, obj) {
    var string = "";
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) {
        string += handleInterpolation(mergedProps, registered, obj[i]) + ";";
      }
    } else {
      for (var key in obj) {
        var value = obj[key];
        if (typeof value !== "object") {
          var asString = value;
          if (registered != null && registered[asString] !== void 0) {
            string += key + "{" + registered[asString] + "}";
          } else if (isProcessableValue(asString)) {
            string += processStyleName(key) + ":" + processStyleValue(key, asString) + ";";
          }
        } else {
          if (key === "NO_COMPONENT_SELECTOR" && isDevelopment2) {
            throw new Error(noComponentSelectorMessage);
          }
          if (Array.isArray(value) && typeof value[0] === "string" && (registered == null || registered[value[0]] === void 0)) {
            for (var _i = 0; _i < value.length; _i++) {
              if (isProcessableValue(value[_i])) {
                string += processStyleName(key) + ":" + processStyleValue(key, value[_i]) + ";";
              }
            }
          } else {
            var interpolated = handleInterpolation(mergedProps, registered, value);
            switch (key) {
              case "animation":
              case "animationName": {
                string += processStyleName(key) + ":" + interpolated + ";";
                break;
              }
              default: {
                string += key + "{" + interpolated + "}";
              }
            }
          }
        }
      }
    }
    return string;
  }
  var labelPattern = /label:\s*([^\s;{]+)\s*(;|$)/g;
  var cursor;
  function serializeStyles(args, registered, mergedProps) {
    if (args.length === 1 && typeof args[0] === "object" && args[0] !== null && args[0].styles !== void 0) {
      return args[0];
    }
    var stringMode = true;
    var styles2 = "";
    cursor = void 0;
    var strings = args[0];
    if (strings == null || strings.raw === void 0) {
      stringMode = false;
      styles2 += handleInterpolation(mergedProps, registered, strings);
    } else {
      var asTemplateStringsArr = strings;
      styles2 += asTemplateStringsArr[0];
    }
    for (var i = 1; i < args.length; i++) {
      styles2 += handleInterpolation(mergedProps, registered, args[i]);
      if (stringMode) {
        var templateStringsArr = strings;
        styles2 += templateStringsArr[i];
      }
    }
    labelPattern.lastIndex = 0;
    var identifierName = "";
    var match2;
    while ((match2 = labelPattern.exec(styles2)) !== null) {
      identifierName += "-" + match2[1];
    }
    var name = murmur2(styles2) + identifierName;
    return {
      name,
      styles: styles2,
      next: cursor
    };
  }

  // remix/node_modules/.pnpm/@emotion+use-insertion-effect-with-fallbacks@1.2.0_react@18.3.1/node_modules/@emotion/use-insertion-effect-with-fallbacks/dist/emotion-use-insertion-effect-with-fallbacks.browser.esm.js
  init_define_import_meta_env();
  var React = __toESM(require_react_shim());
  var syncFallback = function syncFallback2(create) {
    return create();
  };
  var useInsertionEffect2 = React["useInsertionEffect"] ? React["useInsertionEffect"] : false;
  var useInsertionEffectAlwaysWithSyncFallback = useInsertionEffect2 || syncFallback;
  var useInsertionEffectWithLayoutFallback = useInsertionEffect2 || React.useLayoutEffect;

  // remix/node_modules/.pnpm/@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1/node_modules/@emotion/react/dist/emotion-element-f0de968e.browser.esm.js
  var isDevelopment3 = false;
  var EmotionCacheContext = /* @__PURE__ */ React2.createContext(
    // we're doing this to avoid preconstruct's dead code elimination in this one case
    // because this module is primarily intended for the browser and node
    // but it's also required in react native and similar environments sometimes
    // and we could have a special build just for that
    // but this is much easier and the native packages
    // might use a different theme context in the future anyway
    typeof HTMLElement !== "undefined" ? /* @__PURE__ */ createCache({
      key: "css"
    }) : null
  );
  var CacheProvider = EmotionCacheContext.Provider;
  var __unsafe_useEmotionCache = function useEmotionCache() {
    return (0, import_react6.useContext)(EmotionCacheContext);
  };
  var withEmotionCache = function withEmotionCache2(func) {
    return /* @__PURE__ */ (0, import_react6.forwardRef)(function(props, ref) {
      var cache = (0, import_react6.useContext)(EmotionCacheContext);
      return func(props, cache, ref);
    });
  };
  var ThemeContext = /* @__PURE__ */ React2.createContext({});
  var getTheme = function getTheme2(outerTheme, theme2) {
    if (typeof theme2 === "function") {
      var mergedTheme = theme2(outerTheme);
      return mergedTheme;
    }
    return _extends({}, outerTheme, theme2);
  };
  var createCacheWithTheme = /* @__PURE__ */ weakMemoize(function(outerTheme) {
    return weakMemoize(function(theme2) {
      return getTheme(outerTheme, theme2);
    });
  });
  var ThemeProvider = function ThemeProvider2(props) {
    var theme2 = React2.useContext(ThemeContext);
    if (props.theme !== theme2) {
      theme2 = createCacheWithTheme(theme2)(props.theme);
    }
    return /* @__PURE__ */ React2.createElement(ThemeContext.Provider, {
      value: theme2
    }, props.children);
  };
  var hasOwn = {}.hasOwnProperty;
  var typePropName = "__EMOTION_TYPE_PLEASE_DO_NOT_USE__";
  var createEmotionProps = function createEmotionProps2(type, props) {
    var newProps = {};
    for (var _key in props) {
      if (hasOwn.call(props, _key)) {
        newProps[_key] = props[_key];
      }
    }
    newProps[typePropName] = type;
    return newProps;
  };
  var Insertion = function Insertion2(_ref) {
    var cache = _ref.cache, serialized = _ref.serialized, isStringTag = _ref.isStringTag;
    registerStyles(cache, serialized, isStringTag);
    useInsertionEffectAlwaysWithSyncFallback(function() {
      return insertStyles(cache, serialized, isStringTag);
    });
    return null;
  };
  var Emotion = /* @__PURE__ */ withEmotionCache(function(props, cache, ref) {
    var cssProp = props.css;
    if (typeof cssProp === "string" && cache.registered[cssProp] !== void 0) {
      cssProp = cache.registered[cssProp];
    }
    var WrappedComponent = props[typePropName];
    var registeredStyles = [cssProp];
    var className = "";
    if (typeof props.className === "string") {
      className = getRegisteredStyles(cache.registered, registeredStyles, props.className);
    } else if (props.className != null) {
      className = props.className + " ";
    }
    var serialized = serializeStyles(registeredStyles, void 0, React2.useContext(ThemeContext));
    className += cache.key + "-" + serialized.name;
    var newProps = {};
    for (var _key2 in props) {
      if (hasOwn.call(props, _key2) && _key2 !== "css" && _key2 !== typePropName && !isDevelopment3) {
        newProps[_key2] = props[_key2];
      }
    }
    newProps.className = className;
    if (ref) {
      newProps.ref = ref;
    }
    return /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement(Insertion, {
      cache,
      serialized,
      isStringTag: typeof WrappedComponent === "string"
    }), /* @__PURE__ */ React2.createElement(WrappedComponent, newProps));
  });
  var Emotion$1 = Emotion;

  // remix/node_modules/.pnpm/@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1/node_modules/@emotion/react/dist/emotion-react.browser.esm.js
  var React3 = __toESM(require_react_shim());
  var import_hoist_non_react_statics = __toESM(require_hoist_non_react_statics_cjs());
  var jsx = function jsx2(type, props) {
    var args = arguments;
    if (props == null || !hasOwn.call(props, "css")) {
      return React3.createElement.apply(void 0, args);
    }
    var argsLength = args.length;
    var createElementArgArray = new Array(argsLength);
    createElementArgArray[0] = Emotion$1;
    createElementArgArray[1] = createEmotionProps(type, props);
    for (var i = 2; i < argsLength; i++) {
      createElementArgArray[i] = args[i];
    }
    return React3.createElement.apply(null, createElementArgArray);
  };
  (function(_jsx) {
    var JSX;
    /* @__PURE__ */ (function(_JSX) {
    })(JSX || (JSX = _jsx.JSX || (_jsx.JSX = {})));
  })(jsx || (jsx = {}));
  var Global = /* @__PURE__ */ withEmotionCache(function(props, cache) {
    var styles2 = props.styles;
    var serialized = serializeStyles([styles2], void 0, React3.useContext(ThemeContext));
    var sheetRef = React3.useRef();
    useInsertionEffectWithLayoutFallback(function() {
      var key = cache.key + "-global";
      var sheet = new cache.sheet.constructor({
        key,
        nonce: cache.sheet.nonce,
        container: cache.sheet.container,
        speedy: cache.sheet.isSpeedy
      });
      var rehydrating = false;
      var node2 = document.querySelector('style[data-emotion="' + key + " " + serialized.name + '"]');
      if (cache.sheet.tags.length) {
        sheet.before = cache.sheet.tags[0];
      }
      if (node2 !== null) {
        rehydrating = true;
        node2.setAttribute("data-emotion", key);
        sheet.hydrate([node2]);
      }
      sheetRef.current = [sheet, rehydrating];
      return function() {
        sheet.flush();
      };
    }, [cache]);
    useInsertionEffectWithLayoutFallback(function() {
      var sheetRefCurrent = sheetRef.current;
      var sheet = sheetRefCurrent[0], rehydrating = sheetRefCurrent[1];
      if (rehydrating) {
        sheetRefCurrent[1] = false;
        return;
      }
      if (serialized.next !== void 0) {
        insertStyles(cache, serialized.next, true);
      }
      if (sheet.tags.length) {
        var element = sheet.tags[sheet.tags.length - 1].nextElementSibling;
        sheet.before = element;
        sheet.flush();
      }
      cache.insert("", serialized, sheet, false);
    }, [cache, serialized.name]);
    return null;
  });
  function css2() {
    for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }
    return serializeStyles(args);
  }
  function keyframes() {
    var insertable = css2.apply(void 0, arguments);
    var name = "animation-" + insertable.name;
    return {
      name,
      styles: "@keyframes " + name + "{" + insertable.styles + "}",
      anim: 1,
      toString: function toString() {
        return "_EMO_" + this.name + "_" + this.styles + "_EMO_";
      }
    };
  }

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/color-mode/color-mode-provider.mjs
  var import_react9 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/color-mode/color-mode-context.mjs
  init_define_import_meta_env();
  var import_react7 = __toESM(require_react_shim(), 1);
  var ColorModeContext = (0, import_react7.createContext)({});
  ColorModeContext.displayName = "ColorModeContext";
  function useColorMode() {
    const context = (0, import_react7.useContext)(ColorModeContext);
    if (context === void 0) {
      throw new Error("useColorMode must be used within a ColorModeProvider");
    }
    return context;
  }

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/color-mode/color-mode.utils.mjs
  init_define_import_meta_env();
  var classNames = {
    light: "chakra-ui-light",
    dark: "chakra-ui-dark"
  };
  function getColorModeUtils(options = {}) {
    const { preventTransition = true, nonce } = options;
    const utils = {
      setDataset: (value) => {
        const cleanup = preventTransition ? utils.preventTransition() : void 0;
        document.documentElement.dataset.theme = value;
        document.documentElement.style.colorScheme = value;
        cleanup?.();
      },
      setClassName(dark) {
        document.body.classList.add(dark ? classNames.dark : classNames.light);
        document.body.classList.remove(dark ? classNames.light : classNames.dark);
      },
      query() {
        return window.matchMedia("(prefers-color-scheme: dark)");
      },
      getSystemTheme(fallback) {
        const dark = utils.query().matches ?? fallback === "dark";
        return dark ? "dark" : "light";
      },
      addListener(fn) {
        const mql = utils.query();
        const listener = (e) => {
          fn(e.matches ? "dark" : "light");
        };
        if (typeof mql.addListener === "function")
          mql.addListener(listener);
        else
          mql.addEventListener("change", listener);
        return () => {
          if (typeof mql.removeListener === "function")
            mql.removeListener(listener);
          else
            mql.removeEventListener("change", listener);
        };
      },
      preventTransition() {
        const css5 = document.createElement("style");
        css5.appendChild(
          document.createTextNode(
            `*{-webkit-transition:none!important;-moz-transition:none!important;-o-transition:none!important;-ms-transition:none!important;transition:none!important}`
          )
        );
        if (nonce !== void 0) {
          css5.nonce = nonce;
        }
        document.head.appendChild(css5);
        return () => {
          (() => window.getComputedStyle(document.body))();
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              document.head.removeChild(css5);
            });
          });
        };
      }
    };
    return utils;
  }

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/color-mode/storage-manager.mjs
  init_define_import_meta_env();
  var STORAGE_KEY = "chakra-ui-color-mode";
  function createLocalStorageManager(key) {
    return {
      ssr: false,
      type: "localStorage",
      get(init) {
        if (!globalThis?.document)
          return init;
        let value;
        try {
          value = localStorage.getItem(key) || init;
        } catch (e) {
        }
        return value || init;
      },
      set(value) {
        try {
          localStorage.setItem(key, value);
        } catch (e) {
        }
      }
    };
  }
  var localStorageManager = createLocalStorageManager(STORAGE_KEY);
  function parseCookie(cookie, key) {
    const match2 = cookie.match(new RegExp(`(^| )${key}=([^;]+)`));
    return match2?.[2];
  }
  function createCookieStorageManager(key, cookie) {
    return {
      ssr: !!cookie,
      type: "cookie",
      get(init) {
        if (cookie)
          return parseCookie(cookie, key);
        if (!globalThis?.document)
          return init;
        return parseCookie(document.cookie, key) || init;
      },
      set(value) {
        document.cookie = `${key}=${value}; max-age=31536000; path=/`;
      }
    };
  }
  var cookieStorageManager = createCookieStorageManager(STORAGE_KEY);

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/color-mode/color-mode-provider.mjs
  var noop = () => {
  };
  var useSafeLayoutEffect2 = isBrowser() ? import_react9.useLayoutEffect : import_react9.useEffect;
  function getTheme3(manager, fallback) {
    return manager.type === "cookie" && manager.ssr ? manager.get(fallback) : fallback;
  }
  var ColorModeProvider = function ColorModeProvider2(props) {
    const {
      value,
      children,
      options: {
        useSystemColorMode,
        initialColorMode,
        disableTransitionOnChange
      } = {},
      colorModeManager = localStorageManager
    } = props;
    const cache = __unsafe_useEmotionCache();
    const defaultColorMode = initialColorMode === "dark" ? "dark" : "light";
    const [colorMode, rawSetColorMode] = (0, import_react9.useState)(
      () => getTheme3(colorModeManager, defaultColorMode)
    );
    const [resolvedColorMode, setResolvedColorMode] = (0, import_react9.useState)(
      () => getTheme3(colorModeManager)
    );
    const { getSystemTheme, setClassName, setDataset, addListener } = (0, import_react9.useMemo)(
      () => getColorModeUtils({
        preventTransition: disableTransitionOnChange,
        nonce: cache?.nonce
      }),
      [disableTransitionOnChange, cache?.nonce]
    );
    const resolvedValue = initialColorMode === "system" && !colorMode ? resolvedColorMode : colorMode;
    const setColorMode = (0, import_react9.useCallback)(
      (value2) => {
        const resolved = value2 === "system" ? getSystemTheme() : value2;
        rawSetColorMode(resolved);
        setClassName(resolved === "dark");
        setDataset(resolved);
        colorModeManager.set(resolved);
      },
      [colorModeManager, getSystemTheme, setClassName, setDataset]
    );
    useSafeLayoutEffect2(() => {
      if (initialColorMode === "system") {
        setResolvedColorMode(getSystemTheme());
      }
    }, []);
    (0, import_react9.useEffect)(() => {
      const managerValue = colorModeManager.get();
      if (managerValue) {
        setColorMode(managerValue);
        return;
      }
      if (initialColorMode === "system") {
        setColorMode("system");
        return;
      }
      setColorMode(defaultColorMode);
    }, [colorModeManager, defaultColorMode, initialColorMode, setColorMode]);
    const toggleColorMode = (0, import_react9.useCallback)(() => {
      setColorMode(resolvedValue === "dark" ? "light" : "dark");
    }, [resolvedValue, setColorMode]);
    (0, import_react9.useEffect)(() => {
      if (!useSystemColorMode)
        return;
      return addListener(setColorMode);
    }, [useSystemColorMode, addListener, setColorMode]);
    const context = (0, import_react9.useMemo)(
      () => ({
        colorMode: value ?? resolvedValue,
        toggleColorMode: value ? noop : toggleColorMode,
        setColorMode: value ? noop : setColorMode,
        forced: value !== void 0
      }),
      [resolvedValue, toggleColorMode, setColorMode, value]
    );
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ColorModeContext.Provider, { value: context, children });
  };
  ColorModeProvider.displayName = "ColorModeProvider";
  function DarkMode(props) {
    const context = (0, import_react9.useMemo)(
      () => ({
        colorMode: "dark",
        toggleColorMode: noop,
        setColorMode: noop,
        forced: true
      }),
      []
    );
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ColorModeContext.Provider, { value: context, ...props });
  }
  DarkMode.displayName = "DarkMode";
  function LightMode(props) {
    const context = (0, import_react9.useMemo)(
      () => ({
        colorMode: "light",
        toggleColorMode: noop,
        setColorMode: noop,
        forced: true
      }),
      []
    );
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ColorModeContext.Provider, { value: context, ...props });
  }
  LightMode.displayName = "LightMode";

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/css-reset/css-reset.mjs
  init_define_import_meta_env();
  var import_jsx_runtime2 = __toESM(require_react_shim(), 1);
  var css3 = String.raw;
  var vhPolyfill = css3`
  :root,
  :host {
    --chakra-vh: 100vh;
  }

  @supports (height: -webkit-fill-available) {
    :root,
    :host {
      --chakra-vh: -webkit-fill-available;
    }
  }

  @supports (height: -moz-fill-available) {
    :root,
    :host {
      --chakra-vh: -moz-fill-available;
    }
  }

  @supports (height: 100dvh) {
    :root,
    :host {
      --chakra-vh: 100dvh;
    }
  }
`;
  var CSSPolyfill = () => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Global, { styles: vhPolyfill });
  var CSSReset = ({ scope = "" }) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    Global,
    {
      styles: css3`
      html {
        line-height: 1.5;
        -webkit-text-size-adjust: 100%;
        font-family: system-ui, sans-serif;
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
        -moz-osx-font-smoothing: grayscale;
        touch-action: manipulation;
      }

      body {
        position: relative;
        min-height: 100%;
        margin: 0;
        font-feature-settings: "kern";
      }

      ${scope} :where(*, *::before, *::after) {
        border-width: 0;
        border-style: solid;
        box-sizing: border-box;
        word-wrap: break-word;
      }

      main {
        display: block;
      }

      ${scope} hr {
        border-top-width: 1px;
        box-sizing: content-box;
        height: 0;
        overflow: visible;
      }

      ${scope} :where(pre, code, kbd,samp) {
        font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 1em;
      }

      ${scope} a {
        background-color: transparent;
        color: inherit;
        text-decoration: inherit;
      }

      ${scope} abbr[title] {
        border-bottom: none;
        text-decoration: underline;
        -webkit-text-decoration: underline dotted;
        text-decoration: underline dotted;
      }

      ${scope} :where(b, strong) {
        font-weight: bold;
      }

      ${scope} small {
        font-size: 80%;
      }

      ${scope} :where(sub,sup) {
        font-size: 75%;
        line-height: 0;
        position: relative;
        vertical-align: baseline;
      }

      ${scope} sub {
        bottom: -0.25em;
      }

      ${scope} sup {
        top: -0.5em;
      }

      ${scope} img {
        border-style: none;
      }

      ${scope} :where(button, input, optgroup, select, textarea) {
        font-family: inherit;
        font-size: 100%;
        line-height: 1.15;
        margin: 0;
      }

      ${scope} :where(button, input) {
        overflow: visible;
      }

      ${scope} :where(button, select) {
        text-transform: none;
      }

      ${scope} :where(
          button::-moz-focus-inner,
          [type="button"]::-moz-focus-inner,
          [type="reset"]::-moz-focus-inner,
          [type="submit"]::-moz-focus-inner
        ) {
        border-style: none;
        padding: 0;
      }

      ${scope} fieldset {
        padding: 0.35em 0.75em 0.625em;
      }

      ${scope} legend {
        box-sizing: border-box;
        color: inherit;
        display: table;
        max-width: 100%;
        padding: 0;
        white-space: normal;
      }

      ${scope} progress {
        vertical-align: baseline;
      }

      ${scope} textarea {
        overflow: auto;
      }

      ${scope} :where([type="checkbox"], [type="radio"]) {
        box-sizing: border-box;
        padding: 0;
      }

      ${scope} input[type="number"]::-webkit-inner-spin-button,
      ${scope} input[type="number"]::-webkit-outer-spin-button {
        -webkit-appearance: none !important;
      }

      ${scope} input[type="number"] {
        -moz-appearance: textfield;
      }

      ${scope} input[type="search"] {
        -webkit-appearance: textfield;
        outline-offset: -2px;
      }

      ${scope} input[type="search"]::-webkit-search-decoration {
        -webkit-appearance: none !important;
      }

      ${scope} ::-webkit-file-upload-button {
        -webkit-appearance: button;
        font: inherit;
      }

      ${scope} details {
        display: block;
      }

      ${scope} summary {
        display: list-item;
      }

      template {
        display: none;
      }

      [hidden] {
        display: none !important;
      }

      ${scope} :where(
          blockquote,
          dl,
          dd,
          h1,
          h2,
          h3,
          h4,
          h5,
          h6,
          hr,
          figure,
          p,
          pre
        ) {
        margin: 0;
      }

      ${scope} button {
        background: transparent;
        padding: 0;
      }

      ${scope} fieldset {
        margin: 0;
        padding: 0;
      }

      ${scope} :where(ol, ul) {
        margin: 0;
        padding: 0;
      }

      ${scope} textarea {
        resize: vertical;
      }

      ${scope} :where(button, [role="button"]) {
        cursor: pointer;
      }

      ${scope} button::-moz-focus-inner {
        border: 0 !important;
      }

      ${scope} table {
        border-collapse: collapse;
      }

      ${scope} :where(h1, h2, h3, h4, h5, h6) {
        font-size: inherit;
        font-weight: inherit;
      }

      ${scope} :where(button, input, optgroup, select, textarea) {
        padding: 0;
        line-height: inherit;
        color: inherit;
      }

      ${scope} :where(img, svg, video, canvas, audio, iframe, embed, object) {
        display: block;
      }

      ${scope} :where(img, video) {
        max-width: 100%;
        height: auto;
      }

      [data-js-focus-visible]
        :focus:not([data-focus-visible-added]):not(
          [data-focus-visible-disabled]
        ) {
        outline: none;
        box-shadow: none;
      }

      ${scope} select::-ms-expand {
        display: none;
      }

      ${vhPolyfill}
    `
    }
  );

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/system/providers.mjs
  init_define_import_meta_env();
  var import_jsx_runtime3 = __toESM(require_react_shim(), 1);
  var import_react12 = __toESM(require_react_shim(), 1);
  function ThemeProvider3(props) {
    const { cssVarsRoot, theme: theme2, children } = props;
    const computedTheme = (0, import_react12.useMemo)(() => toCSSVar(theme2), [theme2]);
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(ThemeProvider, { theme: computedTheme, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(CSSVars, { root: cssVarsRoot }),
      children
    ] });
  }
  function CSSVars({ root = ":host, :root" }) {
    const selector = [root, `[data-theme]`].join(",");
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Global, { styles: (theme2) => ({ [selector]: theme2.__cssVars }) });
  }
  var [StylesProvider, useStyles] = createContext({
    name: "StylesContext",
    errorMessage: "useStyles: `styles` is undefined. Seems you forgot to wrap the components in `<StylesProvider />` "
  });
  function GlobalStyle() {
    const { colorMode } = useColorMode();
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      Global,
      {
        styles: (theme2) => {
          const styleObjectOrFn = memoizedGet(theme2, "styles.global");
          const globalStyles = runIfFn(styleObjectOrFn, { theme: theme2, colorMode });
          if (!globalStyles)
            return void 0;
          const styles2 = css(globalStyles)(theme2);
          return styles2;
        }
      }
    );
  }

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/portal/portal-manager.mjs
  init_define_import_meta_env();
  var import_jsx_runtime4 = __toESM(require_react_shim(), 1);
  var [PortalManagerContextProvider, usePortalManager] = createContext({
    strict: false,
    name: "PortalManagerContext"
  });
  function PortalManager(props) {
    const { children, zIndex } = props;
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(PortalManagerContextProvider, { value: { zIndex }, children });
  }
  PortalManager.displayName = "PortalManager";

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/env/env.mjs
  init_define_import_meta_env();
  var import_jsx_runtime5 = __toESM(require_react_shim(), 1);
  var import_react13 = __toESM(require_react_shim(), 1);
  var EnvironmentContext = (0, import_react13.createContext)({
    getDocument() {
      return document;
    },
    getWindow() {
      return window;
    }
  });
  EnvironmentContext.displayName = "EnvironmentContext";
  function EnvironmentProvider(props) {
    const { children, environment: environmentProp, disabled } = props;
    const ref = (0, import_react13.useRef)(null);
    const context = (0, import_react13.useMemo)(() => {
      if (environmentProp)
        return environmentProp;
      return {
        getDocument: () => ref.current?.ownerDocument ?? document,
        getWindow: () => ref.current?.ownerDocument.defaultView ?? window
      };
    }, [environmentProp]);
    const showSpan = !disabled || !environmentProp;
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(EnvironmentContext.Provider, { value: context, children: [
      children,
      showSpan && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { id: "__chakra_env", hidden: true, ref })
    ] });
  }
  EnvironmentProvider.displayName = "EnvironmentProvider";

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/provider/provider.mjs
  var Provider = (props) => {
    const {
      children,
      colorModeManager,
      portalZIndex,
      resetScope,
      resetCSS = true,
      theme: theme2 = {},
      environment,
      cssVarsRoot,
      disableEnvironment,
      disableGlobalStyle
    } = props;
    const _children = /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      EnvironmentProvider,
      {
        environment,
        disabled: disableEnvironment,
        children
      }
    );
    return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(ThemeProvider3, { theme: theme2, cssVarsRoot, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
      ColorModeProvider,
      {
        colorModeManager,
        options: theme2.config,
        children: [
          resetCSS ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(CSSReset, { scope: resetScope }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(CSSPolyfill, {}),
          !disableGlobalStyle && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(GlobalStyle, {}),
          portalZIndex ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(PortalManager, { zIndex: portalZIndex, children: _children }) : _children
        ]
      }
    ) });
  };

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/toast/toast.provider.mjs
  init_define_import_meta_env();
  var import_jsx_runtime23 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/components/AnimatePresence/index.mjs
  init_define_import_meta_env();
  var import_jsx_runtime9 = __toESM(require_react_shim(), 1);
  var import_react23 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/context/LayoutGroupContext.mjs
  init_define_import_meta_env();
  var import_react14 = __toESM(require_react_shim(), 1);
  var LayoutGroupContext = (0, import_react14.createContext)({});

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/use-constant.mjs
  init_define_import_meta_env();
  var import_react15 = __toESM(require_react_shim(), 1);
  function useConstant(init) {
    const ref = (0, import_react15.useRef)(null);
    if (ref.current === null) {
      ref.current = init();
    }
    return ref.current;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/components/AnimatePresence/PresenceChild.mjs
  init_define_import_meta_env();
  var import_jsx_runtime8 = __toESM(require_react_shim(), 1);
  var React5 = __toESM(require_react_shim(), 1);
  var import_react19 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/context/PresenceContext.mjs
  init_define_import_meta_env();
  var import_react16 = __toESM(require_react_shim(), 1);
  var PresenceContext = (0, import_react16.createContext)(null);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/components/AnimatePresence/PopChild.mjs
  init_define_import_meta_env();
  var import_jsx_runtime7 = __toESM(require_react_shim(), 1);
  var React4 = __toESM(require_react_shim(), 1);
  var import_react18 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/context/MotionConfigContext.mjs
  init_define_import_meta_env();
  var import_react17 = __toESM(require_react_shim(), 1);
  var MotionConfigContext = (0, import_react17.createContext)({
    transformPagePoint: (p) => p,
    isStatic: false,
    reducedMotion: "never"
  });

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/components/AnimatePresence/PopChild.mjs
  var PopChildMeasure = class extends React4.Component {
    getSnapshotBeforeUpdate(prevProps) {
      const element = this.props.childRef.current;
      if (element && prevProps.isPresent && !this.props.isPresent) {
        const size2 = this.props.sizeRef.current;
        size2.height = element.offsetHeight || 0;
        size2.width = element.offsetWidth || 0;
        size2.top = element.offsetTop;
        size2.left = element.offsetLeft;
      }
      return null;
    }
    /**
     * Required with getSnapshotBeforeUpdate to stop React complaining.
     */
    componentDidUpdate() {
    }
    render() {
      return this.props.children;
    }
  };
  function PopChild({ children, isPresent: isPresent2 }) {
    const id3 = (0, import_react18.useId)();
    const ref = (0, import_react18.useRef)(null);
    const size2 = (0, import_react18.useRef)({
      width: 0,
      height: 0,
      top: 0,
      left: 0
    });
    const { nonce } = (0, import_react18.useContext)(MotionConfigContext);
    (0, import_react18.useInsertionEffect)(() => {
      const { width, height, top, left } = size2.current;
      if (isPresent2 || !ref.current || !width || !height)
        return;
      ref.current.dataset.motionPopId = id3;
      const style = document.createElement("style");
      if (nonce)
        style.nonce = nonce;
      document.head.appendChild(style);
      if (style.sheet) {
        style.sheet.insertRule(`
          [data-motion-pop-id="${id3}"] {
            position: absolute !important;
            width: ${width}px !important;
            height: ${height}px !important;
            top: ${top}px !important;
            left: ${left}px !important;
          }
        `);
      }
      return () => {
        document.head.removeChild(style);
      };
    }, [isPresent2]);
    return (0, import_jsx_runtime7.jsx)(PopChildMeasure, { isPresent: isPresent2, childRef: ref, sizeRef: size2, children: React4.cloneElement(children, { ref }) });
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/components/AnimatePresence/PresenceChild.mjs
  var PresenceChild = ({ children, initial, isPresent: isPresent2, onExitComplete, custom, presenceAffectsLayout, mode: mode2 }) => {
    const presenceChildren = useConstant(newChildrenMap);
    const id3 = (0, import_react19.useId)();
    const memoizedOnExitComplete = (0, import_react19.useCallback)((childId) => {
      presenceChildren.set(childId, true);
      for (const isComplete of presenceChildren.values()) {
        if (!isComplete)
          return;
      }
      onExitComplete && onExitComplete();
    }, [presenceChildren, onExitComplete]);
    const context = (0, import_react19.useMemo)(
      () => ({
        id: id3,
        initial,
        isPresent: isPresent2,
        custom,
        onExitComplete: memoizedOnExitComplete,
        register: (childId) => {
          presenceChildren.set(childId, false);
          return () => presenceChildren.delete(childId);
        }
      }),
      /**
       * If the presence of a child affects the layout of the components around it,
       * we want to make a new context value to ensure they get re-rendered
       * so they can detect that layout change.
       */
      presenceAffectsLayout ? [Math.random(), memoizedOnExitComplete] : [isPresent2, memoizedOnExitComplete]
    );
    (0, import_react19.useMemo)(() => {
      presenceChildren.forEach((_, key) => presenceChildren.set(key, false));
    }, [isPresent2]);
    React5.useEffect(() => {
      !isPresent2 && !presenceChildren.size && onExitComplete && onExitComplete();
    }, [isPresent2]);
    if (mode2 === "popLayout") {
      children = (0, import_jsx_runtime8.jsx)(PopChild, { isPresent: isPresent2, children });
    }
    return (0, import_jsx_runtime8.jsx)(PresenceContext.Provider, { value: context, children });
  };
  function newChildrenMap() {
    return /* @__PURE__ */ new Map();
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/components/AnimatePresence/use-presence.mjs
  init_define_import_meta_env();
  var import_react20 = __toESM(require_react_shim(), 1);
  function usePresence(subscribe = true) {
    const context = (0, import_react20.useContext)(PresenceContext);
    if (context === null)
      return [true, null];
    const { isPresent: isPresent2, onExitComplete, register } = context;
    const id3 = (0, import_react20.useId)();
    (0, import_react20.useEffect)(() => {
      if (subscribe)
        register(id3);
    }, [subscribe]);
    const safeToRemove = (0, import_react20.useCallback)(() => subscribe && onExitComplete && onExitComplete(id3), [id3, onExitComplete, subscribe]);
    return !isPresent2 && onExitComplete ? [false, safeToRemove] : [true];
  }
  function useIsPresent() {
    return isPresent((0, import_react20.useContext)(PresenceContext));
  }
  function isPresent(context) {
    return context === null ? true : context.isPresent;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/components/AnimatePresence/utils.mjs
  init_define_import_meta_env();
  var import_react21 = __toESM(require_react_shim(), 1);
  var getChildKey = (child) => child.key || "";
  function onlyElements(children) {
    const filtered = [];
    import_react21.Children.forEach(children, (child) => {
      if ((0, import_react21.isValidElement)(child))
        filtered.push(child);
    });
    return filtered;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/use-isomorphic-effect.mjs
  init_define_import_meta_env();
  var import_react22 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/is-browser.mjs
  init_define_import_meta_env();
  var isBrowser3 = typeof window !== "undefined";

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/use-isomorphic-effect.mjs
  var useIsomorphicLayoutEffect = isBrowser3 ? import_react22.useLayoutEffect : import_react22.useEffect;

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/components/AnimatePresence/index.mjs
  var AnimatePresence = ({ children, custom, initial = true, onExitComplete, presenceAffectsLayout = true, mode: mode2 = "sync", propagate = false }) => {
    const [isParentPresent, safeToRemove] = usePresence(propagate);
    const presentChildren = (0, import_react23.useMemo)(() => onlyElements(children), [children]);
    const presentKeys = propagate && !isParentPresent ? [] : presentChildren.map(getChildKey);
    const isInitialRender = (0, import_react23.useRef)(true);
    const pendingPresentChildren = (0, import_react23.useRef)(presentChildren);
    const exitComplete = useConstant(() => /* @__PURE__ */ new Map());
    const [diffedChildren, setDiffedChildren] = (0, import_react23.useState)(presentChildren);
    const [renderedChildren, setRenderedChildren] = (0, import_react23.useState)(presentChildren);
    useIsomorphicLayoutEffect(() => {
      isInitialRender.current = false;
      pendingPresentChildren.current = presentChildren;
      for (let i = 0; i < renderedChildren.length; i++) {
        const key = getChildKey(renderedChildren[i]);
        if (!presentKeys.includes(key)) {
          if (exitComplete.get(key) !== true) {
            exitComplete.set(key, false);
          }
        } else {
          exitComplete.delete(key);
        }
      }
    }, [renderedChildren, presentKeys.length, presentKeys.join("-")]);
    const exitingChildren = [];
    if (presentChildren !== diffedChildren) {
      let nextChildren = [...presentChildren];
      for (let i = 0; i < renderedChildren.length; i++) {
        const child = renderedChildren[i];
        const key = getChildKey(child);
        if (!presentKeys.includes(key)) {
          nextChildren.splice(i, 0, child);
          exitingChildren.push(child);
        }
      }
      if (mode2 === "wait" && exitingChildren.length) {
        nextChildren = exitingChildren;
      }
      setRenderedChildren(onlyElements(nextChildren));
      setDiffedChildren(presentChildren);
      return;
    }
    if (mode2 === "wait" && renderedChildren.length > 1) {
      console.warn(`You're attempting to animate multiple children within AnimatePresence, but its mode is set to "wait". This will lead to odd visual behaviour.`);
    }
    const { forceRender } = (0, import_react23.useContext)(LayoutGroupContext);
    return (0, import_jsx_runtime9.jsx)(import_jsx_runtime9.Fragment, { children: renderedChildren.map((child) => {
      const key = getChildKey(child);
      const isPresent2 = propagate && !isParentPresent ? false : presentChildren === renderedChildren || presentKeys.includes(key);
      const onExit = () => {
        if (exitComplete.has(key)) {
          exitComplete.set(key, true);
        } else {
          return;
        }
        let isEveryExitComplete = true;
        exitComplete.forEach((isExitComplete) => {
          if (!isExitComplete)
            isEveryExitComplete = false;
        });
        if (isEveryExitComplete) {
          forceRender === null || forceRender === void 0 ? void 0 : forceRender();
          setRenderedChildren(pendingPresentChildren.current);
          propagate && (safeToRemove === null || safeToRemove === void 0 ? void 0 : safeToRemove());
          onExitComplete && onExitComplete();
        }
      };
      return (0, import_jsx_runtime9.jsx)(PresenceChild, { isPresent: isPresent2, initial: !isInitialRender.current || initial ? void 0 : false, custom: isPresent2 ? void 0 : custom, presenceAffectsLayout, mode: mode2, onExitComplete: isPresent2 ? void 0 : onExit, children: child }, key);
    }) });
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/frameloop/frame.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-utils@11.18.1/node_modules/motion-utils/dist/es/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-utils@11.18.1/node_modules/motion-utils/dist/es/errors.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-utils@11.18.1/node_modules/motion-utils/dist/es/noop.mjs
  init_define_import_meta_env();
  var noop2 = /* @__NO_SIDE_EFFECTS__ */ (any) => any;

  // remix/node_modules/.pnpm/motion-utils@11.18.1/node_modules/motion-utils/dist/es/errors.mjs
  var warning = noop2;
  var invariant = noop2;
  if (true) {
    warning = (check, message) => {
      if (!check && typeof console !== "undefined") {
        console.warn(message);
      }
    };
    invariant = (check, message) => {
      if (!check) {
        throw new Error(message);
      }
    };
  }

  // remix/node_modules/.pnpm/motion-utils@11.18.1/node_modules/motion-utils/dist/es/memo.mjs
  init_define_import_meta_env();
  // @__NO_SIDE_EFFECTS__
  function memo(callback) {
    let result;
    return () => {
      if (result === void 0)
        result = callback();
      return result;
    };
  }

  // remix/node_modules/.pnpm/motion-utils@11.18.1/node_modules/motion-utils/dist/es/progress.mjs
  init_define_import_meta_env();
  var progress = /* @__NO_SIDE_EFFECTS__ */ (from2, to, value) => {
    const toFromDifference = to - from2;
    return toFromDifference === 0 ? 1 : (value - from2) / toFromDifference;
  };

  // remix/node_modules/.pnpm/motion-utils@11.18.1/node_modules/motion-utils/dist/es/time-conversion.mjs
  init_define_import_meta_env();
  var secondsToMilliseconds = /* @__NO_SIDE_EFFECTS__ */ (seconds) => seconds * 1e3;
  var millisecondsToSeconds = /* @__NO_SIDE_EFFECTS__ */ (milliseconds) => milliseconds / 1e3;

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/frameloop/batcher.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/GlobalConfig.mjs
  init_define_import_meta_env();
  var MotionGlobalConfig = {
    skipAnimations: false,
    useManualTiming: false
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/frameloop/render-step.mjs
  init_define_import_meta_env();
  function createRenderStep(runNextFrame) {
    let thisFrame = /* @__PURE__ */ new Set();
    let nextFrame = /* @__PURE__ */ new Set();
    let isProcessing = false;
    let flushNextFrame = false;
    const toKeepAlive = /* @__PURE__ */ new WeakSet();
    let latestFrameData = {
      delta: 0,
      timestamp: 0,
      isProcessing: false
    };
    function triggerCallback(callback) {
      if (toKeepAlive.has(callback)) {
        step.schedule(callback);
        runNextFrame();
      }
      callback(latestFrameData);
    }
    const step = {
      /**
       * Schedule a process to run on the next frame.
       */
      schedule: (callback, keepAlive = false, immediate = false) => {
        const addToCurrentFrame = immediate && isProcessing;
        const queue = addToCurrentFrame ? thisFrame : nextFrame;
        if (keepAlive)
          toKeepAlive.add(callback);
        if (!queue.has(callback))
          queue.add(callback);
        return callback;
      },
      /**
       * Cancel the provided callback from running on the next frame.
       */
      cancel: (callback) => {
        nextFrame.delete(callback);
        toKeepAlive.delete(callback);
      },
      /**
       * Execute all schedule callbacks.
       */
      process: (frameData2) => {
        latestFrameData = frameData2;
        if (isProcessing) {
          flushNextFrame = true;
          return;
        }
        isProcessing = true;
        [thisFrame, nextFrame] = [nextFrame, thisFrame];
        thisFrame.forEach(triggerCallback);
        thisFrame.clear();
        isProcessing = false;
        if (flushNextFrame) {
          flushNextFrame = false;
          step.process(frameData2);
        }
      }
    };
    return step;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/frameloop/batcher.mjs
  var stepsOrder = [
    "read",
    // Read
    "resolveKeyframes",
    // Write/Read/Write/Read
    "update",
    // Compute
    "preRender",
    // Compute
    "render",
    // Write
    "postRender"
    // Compute
  ];
  var maxElapsed = 40;
  function createRenderBatcher(scheduleNextBatch, allowKeepAlive) {
    let runNextFrame = false;
    let useDefaultElapsed = true;
    const state2 = {
      delta: 0,
      timestamp: 0,
      isProcessing: false
    };
    const flagRunNextFrame = () => runNextFrame = true;
    const steps = stepsOrder.reduce((acc, key) => {
      acc[key] = createRenderStep(flagRunNextFrame);
      return acc;
    }, {});
    const { read, resolveKeyframes, update, preRender, render, postRender } = steps;
    const processBatch = () => {
      const timestamp = MotionGlobalConfig.useManualTiming ? state2.timestamp : performance.now();
      runNextFrame = false;
      state2.delta = useDefaultElapsed ? 1e3 / 60 : Math.max(Math.min(timestamp - state2.timestamp, maxElapsed), 1);
      state2.timestamp = timestamp;
      state2.isProcessing = true;
      read.process(state2);
      resolveKeyframes.process(state2);
      update.process(state2);
      preRender.process(state2);
      render.process(state2);
      postRender.process(state2);
      state2.isProcessing = false;
      if (runNextFrame && allowKeepAlive) {
        useDefaultElapsed = false;
        scheduleNextBatch(processBatch);
      }
    };
    const wake = () => {
      runNextFrame = true;
      useDefaultElapsed = true;
      if (!state2.isProcessing) {
        scheduleNextBatch(processBatch);
      }
    };
    const schedule = stepsOrder.reduce((acc, key) => {
      const step = steps[key];
      acc[key] = (process2, keepAlive = false, immediate = false) => {
        if (!runNextFrame)
          wake();
        return step.schedule(process2, keepAlive, immediate);
      };
      return acc;
    }, {});
    const cancel = (process2) => {
      for (let i = 0; i < stepsOrder.length; i++) {
        steps[stepsOrder[i]].cancel(process2);
      }
    };
    return { schedule, cancel, state: state2, steps };
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/frameloop/frame.mjs
  var { schedule: frame, cancel: cancelFrame, state: frameData, steps: frameSteps } = createRenderBatcher(typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : noop2, true);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/context/LazyContext.mjs
  init_define_import_meta_env();
  var import_react24 = __toESM(require_react_shim(), 1);
  var LazyContext = (0, import_react24.createContext)({ strict: false });

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/features/load-features.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/features/definitions.mjs
  init_define_import_meta_env();
  var featureProps = {
    animation: [
      "animate",
      "variants",
      "whileHover",
      "whileTap",
      "exit",
      "whileInView",
      "whileFocus",
      "whileDrag"
    ],
    exit: ["exit"],
    drag: ["drag", "dragControls"],
    focus: ["whileFocus"],
    hover: ["whileHover", "onHoverStart", "onHoverEnd"],
    tap: ["whileTap", "onTap", "onTapStart", "onTapCancel"],
    pan: ["onPan", "onPanStart", "onPanSessionStart", "onPanEnd"],
    inView: ["whileInView", "onViewportEnter", "onViewportLeave"],
    layout: ["layout", "layoutId"]
  };
  var featureDefinitions = {};
  for (const key in featureProps) {
    featureDefinitions[key] = {
      isEnabled: (props) => featureProps[key].some((name) => !!props[name])
    };
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/features/load-features.mjs
  function loadFeatures(features) {
    for (const key in features) {
      featureDefinitions[key] = {
        ...featureDefinitions[key],
        ...features[key]
      };
    }
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/utils/filter-props.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/utils/valid-prop.mjs
  init_define_import_meta_env();
  var validMotionProps = /* @__PURE__ */ new Set([
    "animate",
    "exit",
    "variants",
    "initial",
    "style",
    "values",
    "variants",
    "transition",
    "transformTemplate",
    "custom",
    "inherit",
    "onBeforeLayoutMeasure",
    "onAnimationStart",
    "onAnimationComplete",
    "onUpdate",
    "onDragStart",
    "onDrag",
    "onDragEnd",
    "onMeasureDragConstraints",
    "onDirectionLock",
    "onDragTransitionEnd",
    "_dragX",
    "_dragY",
    "onHoverStart",
    "onHoverEnd",
    "onViewportEnter",
    "onViewportLeave",
    "globalTapTarget",
    "ignoreStrict",
    "viewport"
  ]);
  function isValidMotionProp(key) {
    return key.startsWith("while") || key.startsWith("drag") && key !== "draggable" || key.startsWith("layout") || key.startsWith("onTap") || key.startsWith("onPan") || key.startsWith("onLayout") || validMotionProps.has(key);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/utils/filter-props.mjs
  var shouldForward = (key) => !isValidMotionProp(key);
  function loadExternalIsValidProp(isValidProp) {
    if (!isValidProp)
      return;
    shouldForward = (key) => key.startsWith("on") ? !isValidMotionProp(key) : isValidProp(key);
  }
  try {
    loadExternalIsValidProp((init_emotion_is_prop_valid_esm(), __toCommonJS(emotion_is_prop_valid_esm_exports)).default);
  } catch (_a) {
  }
  function filterProps(props, isDom, forwardMotionProps) {
    const filteredProps = {};
    for (const key in props) {
      if (key === "values" && typeof props.values === "object")
        continue;
      if (shouldForward(key) || forwardMotionProps === true && isValidMotionProp(key) || !isDom && !isValidMotionProp(key) || // If trying to use native HTML drag events, forward drag listeners
      props["draggable"] && key.startsWith("onDrag")) {
        filteredProps[key] = props[key];
      }
    }
    return filteredProps;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/components/create-proxy.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/warn-once.mjs
  init_define_import_meta_env();
  var warned = /* @__PURE__ */ new Set();
  function warnOnce(condition, message, element) {
    if (condition || warned.has(message))
      return;
    console.warn(message);
    if (element)
      console.warn(element);
    warned.add(message);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/components/create-proxy.mjs
  function createDOMMotionComponentProxy(componentFactory) {
    if (typeof Proxy === "undefined") {
      return componentFactory;
    }
    const componentCache = /* @__PURE__ */ new Map();
    const deprecatedFactoryFunction = (...args) => {
      if (true) {
        warnOnce(false, "motion() is deprecated. Use motion.create() instead.");
      }
      return componentFactory(...args);
    };
    return new Proxy(deprecatedFactoryFunction, {
      /**
       * Called when `motion` is referenced with a prop: `motion.div`, `motion.input` etc.
       * The prop name is passed through as `key` and we can use that to generate a `motion`
       * DOM component with that name.
       */
      get: (_target, key) => {
        if (key === "create")
          return componentFactory;
        if (!componentCache.has(key)) {
          componentCache.set(key, componentFactory(key));
        }
        return componentCache.get(key);
      }
    });
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/components/create-factory.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/index.mjs
  init_define_import_meta_env();
  var import_jsx_runtime10 = __toESM(require_react_shim(), 1);
  var import_react30 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/context/MotionContext/index.mjs
  init_define_import_meta_env();
  var import_react25 = __toESM(require_react_shim(), 1);
  var MotionContext = (0, import_react25.createContext)({});

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/context/MotionContext/create.mjs
  init_define_import_meta_env();
  var import_react26 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/context/MotionContext/utils.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/utils/is-variant-label.mjs
  init_define_import_meta_env();
  function isVariantLabel(v) {
    return typeof v === "string" || Array.isArray(v);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/utils/is-controlling-variants.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/utils/is-animation-controls.mjs
  init_define_import_meta_env();
  function isAnimationControls(v) {
    return v !== null && typeof v === "object" && typeof v.start === "function";
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/utils/variant-props.mjs
  init_define_import_meta_env();
  var variantPriorityOrder = [
    "animate",
    "whileInView",
    "whileFocus",
    "whileHover",
    "whileTap",
    "whileDrag",
    "exit"
  ];
  var variantProps = ["initial", ...variantPriorityOrder];

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/utils/is-controlling-variants.mjs
  function isControllingVariants(props) {
    return isAnimationControls(props.animate) || variantProps.some((name) => isVariantLabel(props[name]));
  }
  function isVariantNode(props) {
    return Boolean(isControllingVariants(props) || props.variants);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/context/MotionContext/utils.mjs
  function getCurrentTreeVariants(props, context) {
    if (isControllingVariants(props)) {
      const { initial, animate } = props;
      return {
        initial: initial === false || isVariantLabel(initial) ? initial : void 0,
        animate: isVariantLabel(animate) ? animate : void 0
      };
    }
    return props.inherit !== false ? context : {};
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/context/MotionContext/create.mjs
  function useCreateMotionContext(props) {
    const { initial, animate } = getCurrentTreeVariants(props, (0, import_react26.useContext)(MotionContext));
    return (0, import_react26.useMemo)(() => ({ initial, animate }), [variantLabelsAsDependency(initial), variantLabelsAsDependency(animate)]);
  }
  function variantLabelsAsDependency(prop) {
    return Array.isArray(prop) ? prop.join(" ") : prop;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/utils/symbol.mjs
  init_define_import_meta_env();
  var motionComponentSymbol = /* @__PURE__ */ Symbol.for("motionComponentSymbol");

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/utils/use-motion-ref.mjs
  init_define_import_meta_env();
  var import_react27 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/is-ref-object.mjs
  init_define_import_meta_env();
  function isRefObject2(ref) {
    return ref && typeof ref === "object" && Object.prototype.hasOwnProperty.call(ref, "current");
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/utils/use-motion-ref.mjs
  function useMotionRef(visualState, visualElement, externalRef) {
    return (0, import_react27.useCallback)(
      (instance) => {
        if (instance) {
          visualState.onMount && visualState.onMount(instance);
        }
        if (visualElement) {
          if (instance) {
            visualElement.mount(instance);
          } else {
            visualElement.unmount();
          }
        }
        if (externalRef) {
          if (typeof externalRef === "function") {
            externalRef(instance);
          } else if (isRefObject2(externalRef)) {
            externalRef.current = instance;
          }
        }
      },
      /**
       * Only pass a new ref callback to React if we've received a visual element
       * factory. Otherwise we'll be mounting/remounting every time externalRef
       * or other dependencies change.
       */
      [visualElement]
    );
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/utils/use-visual-element.mjs
  init_define_import_meta_env();
  var import_react29 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/optimized-appear/data-id.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/utils/camel-to-dash.mjs
  init_define_import_meta_env();
  var camelToDash = (str) => str.replace(/([a-z])([A-Z])/gu, "$1-$2").toLowerCase();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/optimized-appear/data-id.mjs
  var optimizedAppearDataId = "framerAppearId";
  var optimizedAppearDataAttribute = "data-" + camelToDash(optimizedAppearDataId);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/frameloop/microtask.mjs
  init_define_import_meta_env();
  var { schedule: microtask, cancel: cancelMicrotask } = createRenderBatcher(queueMicrotask, false);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/context/SwitchLayoutGroupContext.mjs
  init_define_import_meta_env();
  var import_react28 = __toESM(require_react_shim(), 1);
  var SwitchLayoutGroupContext = (0, import_react28.createContext)({});

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/utils/use-visual-element.mjs
  function useVisualElement(Component3, visualState, props, createVisualElement, ProjectionNodeConstructor) {
    var _a, _b;
    const { visualElement: parent } = (0, import_react29.useContext)(MotionContext);
    const lazyContext = (0, import_react29.useContext)(LazyContext);
    const presenceContext = (0, import_react29.useContext)(PresenceContext);
    const reducedMotionConfig = (0, import_react29.useContext)(MotionConfigContext).reducedMotion;
    const visualElementRef = (0, import_react29.useRef)(null);
    createVisualElement = createVisualElement || lazyContext.renderer;
    if (!visualElementRef.current && createVisualElement) {
      visualElementRef.current = createVisualElement(Component3, {
        visualState,
        parent,
        props,
        presenceContext,
        blockInitialAnimation: presenceContext ? presenceContext.initial === false : false,
        reducedMotionConfig
      });
    }
    const visualElement = visualElementRef.current;
    const initialLayoutGroupConfig = (0, import_react29.useContext)(SwitchLayoutGroupContext);
    if (visualElement && !visualElement.projection && ProjectionNodeConstructor && (visualElement.type === "html" || visualElement.type === "svg")) {
      createProjectionNode(visualElementRef.current, props, ProjectionNodeConstructor, initialLayoutGroupConfig);
    }
    const isMounted = (0, import_react29.useRef)(false);
    (0, import_react29.useInsertionEffect)(() => {
      if (visualElement && isMounted.current) {
        visualElement.update(props, presenceContext);
      }
    });
    const optimisedAppearId = props[optimizedAppearDataAttribute];
    const wantsHandoff = (0, import_react29.useRef)(Boolean(optimisedAppearId) && !((_a = window.MotionHandoffIsComplete) === null || _a === void 0 ? void 0 : _a.call(window, optimisedAppearId)) && ((_b = window.MotionHasOptimisedAnimation) === null || _b === void 0 ? void 0 : _b.call(window, optimisedAppearId)));
    useIsomorphicLayoutEffect(() => {
      if (!visualElement)
        return;
      isMounted.current = true;
      window.MotionIsMounted = true;
      visualElement.updateFeatures();
      microtask.render(visualElement.render);
      if (wantsHandoff.current && visualElement.animationState) {
        visualElement.animationState.animateChanges();
      }
    });
    (0, import_react29.useEffect)(() => {
      if (!visualElement)
        return;
      if (!wantsHandoff.current && visualElement.animationState) {
        visualElement.animationState.animateChanges();
      }
      if (wantsHandoff.current) {
        queueMicrotask(() => {
          var _a2;
          (_a2 = window.MotionHandoffMarkAsComplete) === null || _a2 === void 0 ? void 0 : _a2.call(window, optimisedAppearId);
        });
        wantsHandoff.current = false;
      }
    });
    return visualElement;
  }
  function createProjectionNode(visualElement, props, ProjectionNodeConstructor, initialPromotionConfig) {
    const { layoutId, layout: layout3, drag: drag2, dragConstraints, layoutScroll, layoutRoot } = props;
    visualElement.projection = new ProjectionNodeConstructor(visualElement.latestValues, props["data-framer-portal-id"] ? void 0 : getClosestProjectingNode(visualElement.parent));
    visualElement.projection.setOptions({
      layoutId,
      layout: layout3,
      alwaysMeasureLayout: Boolean(drag2) || dragConstraints && isRefObject2(dragConstraints),
      visualElement,
      /**
       * TODO: Update options in an effect. This could be tricky as it'll be too late
       * to update by the time layout animations run.
       * We also need to fix this safeToRemove by linking it up to the one returned by usePresence,
       * ensuring it gets called if there's no potential layout animations.
       *
       */
      animationType: typeof layout3 === "string" ? layout3 : "both",
      initialPromotionConfig,
      layoutScroll,
      layoutRoot
    });
  }
  function getClosestProjectingNode(visualElement) {
    if (!visualElement)
      return void 0;
    return visualElement.options.allowProjection !== false ? visualElement.projection : getClosestProjectingNode(visualElement.parent);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/index.mjs
  function createRendererMotionComponent({ preloadedFeatures, createVisualElement, useRender, useVisualState, Component: Component3 }) {
    var _a, _b;
    preloadedFeatures && loadFeatures(preloadedFeatures);
    function MotionComponent(props, externalRef) {
      let MeasureLayout2;
      const configAndProps = {
        ...(0, import_react30.useContext)(MotionConfigContext),
        ...props,
        layoutId: useLayoutId(props)
      };
      const { isStatic } = configAndProps;
      const context = useCreateMotionContext(props);
      const visualState = useVisualState(props, isStatic);
      if (!isStatic && isBrowser3) {
        useStrictMode(configAndProps, preloadedFeatures);
        const layoutProjection = getProjectionFunctionality(configAndProps);
        MeasureLayout2 = layoutProjection.MeasureLayout;
        context.visualElement = useVisualElement(Component3, visualState, configAndProps, createVisualElement, layoutProjection.ProjectionNode);
      }
      return (0, import_jsx_runtime10.jsxs)(MotionContext.Provider, { value: context, children: [MeasureLayout2 && context.visualElement ? (0, import_jsx_runtime10.jsx)(MeasureLayout2, { visualElement: context.visualElement, ...configAndProps }) : null, useRender(Component3, props, useMotionRef(visualState, context.visualElement, externalRef), visualState, isStatic, context.visualElement)] });
    }
    MotionComponent.displayName = `motion.${typeof Component3 === "string" ? Component3 : `create(${(_b = (_a = Component3.displayName) !== null && _a !== void 0 ? _a : Component3.name) !== null && _b !== void 0 ? _b : ""})`}`;
    const ForwardRefMotionComponent = (0, import_react30.forwardRef)(MotionComponent);
    ForwardRefMotionComponent[motionComponentSymbol] = Component3;
    return ForwardRefMotionComponent;
  }
  function useLayoutId({ layoutId }) {
    const layoutGroupId = (0, import_react30.useContext)(LayoutGroupContext).id;
    return layoutGroupId && layoutId !== void 0 ? layoutGroupId + "-" + layoutId : layoutId;
  }
  function useStrictMode(configAndProps, preloadedFeatures) {
    const isStrict = (0, import_react30.useContext)(LazyContext).strict;
    if (preloadedFeatures && isStrict) {
      const strictMessage = "You have rendered a `motion` component within a `LazyMotion` component. This will break tree shaking. Import and render a `m` component instead.";
      configAndProps.ignoreStrict ? warning(false, strictMessage) : invariant(false, strictMessage);
    }
  }
  function getProjectionFunctionality(props) {
    const { drag: drag2, layout: layout3 } = featureDefinitions;
    if (!drag2 && !layout3)
      return {};
    const combined = { ...drag2, ...layout3 };
    return {
      MeasureLayout: (drag2 === null || drag2 === void 0 ? void 0 : drag2.isEnabled(props)) || (layout3 === null || layout3 === void 0 ? void 0 : layout3.isEnabled(props)) ? combined.MeasureLayout : void 0,
      ProjectionNode: combined.ProjectionNode
    };
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/utils/is-svg-component.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/svg/lowercase-elements.mjs
  init_define_import_meta_env();
  var lowercaseSVGElements = [
    "animate",
    "circle",
    "defs",
    "desc",
    "ellipse",
    "g",
    "image",
    "line",
    "filter",
    "marker",
    "mask",
    "metadata",
    "path",
    "pattern",
    "polygon",
    "polyline",
    "rect",
    "stop",
    "switch",
    "symbol",
    "svg",
    "text",
    "tspan",
    "use",
    "view"
  ];

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/utils/is-svg-component.mjs
  function isSVGComponent(Component3) {
    if (
      /**
       * If it's not a string, it's a custom React component. Currently we only support
       * HTML custom React components.
       */
      typeof Component3 !== "string" || /**
       * If it contains a dash, the element is a custom HTML webcomponent.
       */
      Component3.includes("-")
    ) {
      return false;
    } else if (
      /**
       * If it's in our list of lowercase SVG tags, it's an SVG component
       */
      lowercaseSVGElements.indexOf(Component3) > -1 || /**
       * If it contains a capital letter, it's an SVG component
       */
      /[A-Z]/u.test(Component3)
    ) {
      return true;
    }
    return false;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/svg/config-motion.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/utils/use-visual-state.mjs
  init_define_import_meta_env();
  var import_react31 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/utils/resolve-variants.mjs
  init_define_import_meta_env();
  function getValueState(visualElement) {
    const state2 = [{}, {}];
    visualElement === null || visualElement === void 0 ? void 0 : visualElement.values.forEach((value, key) => {
      state2[0][key] = value.get();
      state2[1][key] = value.getVelocity();
    });
    return state2;
  }
  function resolveVariantFromProps(props, definition, custom, visualElement) {
    if (typeof definition === "function") {
      const [current, velocity] = getValueState(visualElement);
      definition = definition(custom !== void 0 ? custom : props.custom, current, velocity);
    }
    if (typeof definition === "string") {
      definition = props.variants && props.variants[definition];
    }
    if (typeof definition === "function") {
      const [current, velocity] = getValueState(visualElement);
      definition = definition(custom !== void 0 ? custom : props.custom, current, velocity);
    }
    return definition;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/utils/resolve-motion-value.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/resolve-value.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/utils/is-keyframes-target.mjs
  init_define_import_meta_env();
  var isKeyframesTarget = (v) => {
    return Array.isArray(v);
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/resolve-value.mjs
  var isCustomValue = (v) => {
    return Boolean(v && typeof v === "object" && v.mix && v.toValue);
  };
  var resolveFinalValueInKeyframes = (v) => {
    return isKeyframesTarget(v) ? v[v.length - 1] || 0 : v;
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/utils/is-motion-value.mjs
  init_define_import_meta_env();
  var isMotionValue = (value) => Boolean(value && value.getVelocity);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/utils/resolve-motion-value.mjs
  function resolveMotionValue(value) {
    const unwrappedValue = isMotionValue(value) ? value.get() : value;
    return isCustomValue(unwrappedValue) ? unwrappedValue.toValue() : unwrappedValue;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/utils/use-visual-state.mjs
  function makeState({ scrapeMotionValuesFromProps: scrapeMotionValuesFromProps3, createRenderState, onUpdate }, props, context, presenceContext) {
    const state2 = {
      latestValues: makeLatestValues(props, context, presenceContext, scrapeMotionValuesFromProps3),
      renderState: createRenderState()
    };
    if (onUpdate) {
      state2.onMount = (instance) => onUpdate({ props, current: instance, ...state2 });
      state2.onUpdate = (visualElement) => onUpdate(visualElement);
    }
    return state2;
  }
  var makeUseVisualState = (config2) => (props, isStatic) => {
    const context = (0, import_react31.useContext)(MotionContext);
    const presenceContext = (0, import_react31.useContext)(PresenceContext);
    const make = () => makeState(config2, props, context, presenceContext);
    return isStatic ? make() : useConstant(make);
  };
  function makeLatestValues(props, context, presenceContext, scrapeMotionValues) {
    const values = {};
    const motionValues = scrapeMotionValues(props, {});
    for (const key in motionValues) {
      values[key] = resolveMotionValue(motionValues[key]);
    }
    let { initial, animate } = props;
    const isControllingVariants$1 = isControllingVariants(props);
    const isVariantNode$1 = isVariantNode(props);
    if (context && isVariantNode$1 && !isControllingVariants$1 && props.inherit !== false) {
      if (initial === void 0)
        initial = context.initial;
      if (animate === void 0)
        animate = context.animate;
    }
    let isInitialAnimationBlocked = presenceContext ? presenceContext.initial === false : false;
    isInitialAnimationBlocked = isInitialAnimationBlocked || initial === false;
    const variantToSet = isInitialAnimationBlocked ? animate : initial;
    if (variantToSet && typeof variantToSet !== "boolean" && !isAnimationControls(variantToSet)) {
      const list2 = Array.isArray(variantToSet) ? variantToSet : [variantToSet];
      for (let i = 0; i < list2.length; i++) {
        const resolved = resolveVariantFromProps(props, list2[i]);
        if (resolved) {
          const { transitionEnd, transition: transition3, ...target } = resolved;
          for (const key in target) {
            let valueTarget = target[key];
            if (Array.isArray(valueTarget)) {
              const index = isInitialAnimationBlocked ? valueTarget.length - 1 : 0;
              valueTarget = valueTarget[index];
            }
            if (valueTarget !== null) {
              values[key] = valueTarget;
            }
          }
          for (const key in transitionEnd) {
            values[key] = transitionEnd[key];
          }
        }
      }
    }
    return values;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/html/utils/keys-transform.mjs
  init_define_import_meta_env();
  var transformPropOrder = [
    "transformPerspective",
    "x",
    "y",
    "z",
    "translateX",
    "translateY",
    "translateZ",
    "scale",
    "scaleX",
    "scaleY",
    "rotate",
    "rotateX",
    "rotateY",
    "rotateZ",
    "skew",
    "skewX",
    "skewY"
  ];
  var transformProps = new Set(transformPropOrder);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/svg/utils/build-attrs.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/html/utils/build-styles.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/utils/is-css-variable.mjs
  init_define_import_meta_env();
  var checkStringStartsWith = (token2) => (key) => typeof key === "string" && key.startsWith(token2);
  var isCSSVariableName = /* @__PURE__ */ checkStringStartsWith("--");
  var startsAsVariableToken = /* @__PURE__ */ checkStringStartsWith("var(--");
  var isCSSVariableToken = (value) => {
    const startsWithToken = startsAsVariableToken(value);
    if (!startsWithToken)
      return false;
    return singleCssVariableRegex.test(value.split("/*")[0].trim());
  };
  var singleCssVariableRegex = /var\(--(?:[\w-]+\s*|[\w-]+\s*,(?:\s*[^)(\s]|\s*\((?:[^)(]|\([^)(]*\))*\))+\s*)\)$/iu;

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/value-types/get-as-type.mjs
  init_define_import_meta_env();
  var getValueAsType = (value, type) => {
    return type && typeof value === "number" ? type.transform(value) : value;
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/value-types/number.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/numbers/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/clamp.mjs
  init_define_import_meta_env();
  var clamp = (min, max, v) => {
    if (v > max)
      return max;
    if (v < min)
      return min;
    return v;
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/numbers/index.mjs
  var number = {
    test: (v) => typeof v === "number",
    parse: parseFloat,
    transform: (v) => v
  };
  var alpha = {
    ...number,
    transform: (v) => clamp(0, 1, v)
  };
  var scale = {
    ...number,
    default: 1
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/numbers/units.mjs
  init_define_import_meta_env();
  var createUnitType = (unit) => ({
    test: (v) => typeof v === "string" && v.endsWith(unit) && v.split(" ").length === 1,
    parse: parseFloat,
    transform: (v) => `${v}${unit}`
  });
  var degrees = /* @__PURE__ */ createUnitType("deg");
  var percent = /* @__PURE__ */ createUnitType("%");
  var px2 = /* @__PURE__ */ createUnitType("px");
  var vh = /* @__PURE__ */ createUnitType("vh");
  var vw = /* @__PURE__ */ createUnitType("vw");
  var progressPercentage = {
    ...percent,
    parse: (v) => percent.parse(v) / 100,
    transform: (v) => percent.transform(v * 100)
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/value-types/number-browser.mjs
  init_define_import_meta_env();
  var browserNumberValueTypes = {
    // Border props
    borderWidth: px2,
    borderTopWidth: px2,
    borderRightWidth: px2,
    borderBottomWidth: px2,
    borderLeftWidth: px2,
    borderRadius: px2,
    radius: px2,
    borderTopLeftRadius: px2,
    borderTopRightRadius: px2,
    borderBottomRightRadius: px2,
    borderBottomLeftRadius: px2,
    // Positioning props
    width: px2,
    maxWidth: px2,
    height: px2,
    maxHeight: px2,
    top: px2,
    right: px2,
    bottom: px2,
    left: px2,
    // Spacing props
    padding: px2,
    paddingTop: px2,
    paddingRight: px2,
    paddingBottom: px2,
    paddingLeft: px2,
    margin: px2,
    marginTop: px2,
    marginRight: px2,
    marginBottom: px2,
    marginLeft: px2,
    // Misc
    backgroundPositionX: px2,
    backgroundPositionY: px2
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/value-types/transform.mjs
  init_define_import_meta_env();
  var transformValueTypes = {
    rotate: degrees,
    rotateX: degrees,
    rotateY: degrees,
    rotateZ: degrees,
    scale,
    scaleX: scale,
    scaleY: scale,
    scaleZ: scale,
    skew: degrees,
    skewX: degrees,
    skewY: degrees,
    distance: px2,
    translateX: px2,
    translateY: px2,
    translateZ: px2,
    x: px2,
    y: px2,
    z: px2,
    perspective: px2,
    transformPerspective: px2,
    opacity: alpha,
    originX: progressPercentage,
    originY: progressPercentage,
    originZ: px2
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/value-types/type-int.mjs
  init_define_import_meta_env();
  var int = {
    ...number,
    transform: Math.round
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/value-types/number.mjs
  var numberValueTypes = {
    ...browserNumberValueTypes,
    ...transformValueTypes,
    zIndex: int,
    size: px2,
    // SVG
    fillOpacity: alpha,
    strokeOpacity: alpha,
    numOctaves: int
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/html/utils/build-transform.mjs
  init_define_import_meta_env();
  var translateAlias = {
    x: "translateX",
    y: "translateY",
    z: "translateZ",
    transformPerspective: "perspective"
  };
  var numTransforms = transformPropOrder.length;
  function buildTransform(latestValues, transform2, transformTemplate2) {
    let transformString = "";
    let transformIsDefault = true;
    for (let i = 0; i < numTransforms; i++) {
      const key = transformPropOrder[i];
      const value = latestValues[key];
      if (value === void 0)
        continue;
      let valueIsDefault = true;
      if (typeof value === "number") {
        valueIsDefault = value === (key.startsWith("scale") ? 1 : 0);
      } else {
        valueIsDefault = parseFloat(value) === 0;
      }
      if (!valueIsDefault || transformTemplate2) {
        const valueAsType = getValueAsType(value, numberValueTypes[key]);
        if (!valueIsDefault) {
          transformIsDefault = false;
          const transformName = translateAlias[key] || key;
          transformString += `${transformName}(${valueAsType}) `;
        }
        if (transformTemplate2) {
          transform2[key] = valueAsType;
        }
      }
    }
    transformString = transformString.trim();
    if (transformTemplate2) {
      transformString = transformTemplate2(transform2, transformIsDefault ? "" : transformString);
    } else if (transformIsDefault) {
      transformString = "none";
    }
    return transformString;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/html/utils/build-styles.mjs
  function buildHTMLStyles(state2, latestValues, transformTemplate2) {
    const { style, vars: vars2, transformOrigin } = state2;
    let hasTransform2 = false;
    let hasTransformOrigin = false;
    for (const key in latestValues) {
      const value = latestValues[key];
      if (transformProps.has(key)) {
        hasTransform2 = true;
        continue;
      } else if (isCSSVariableName(key)) {
        vars2[key] = value;
        continue;
      } else {
        const valueAsType = getValueAsType(value, numberValueTypes[key]);
        if (key.startsWith("origin")) {
          hasTransformOrigin = true;
          transformOrigin[key] = valueAsType;
        } else {
          style[key] = valueAsType;
        }
      }
    }
    if (!latestValues.transform) {
      if (hasTransform2 || transformTemplate2) {
        style.transform = buildTransform(latestValues, state2.transform, transformTemplate2);
      } else if (style.transform) {
        style.transform = "none";
      }
    }
    if (hasTransformOrigin) {
      const { originX = "50%", originY = "50%", originZ = 0 } = transformOrigin;
      style.transformOrigin = `${originX} ${originY} ${originZ}`;
    }
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/svg/utils/path.mjs
  init_define_import_meta_env();
  var dashKeys = {
    offset: "stroke-dashoffset",
    array: "stroke-dasharray"
  };
  var camelKeys = {
    offset: "strokeDashoffset",
    array: "strokeDasharray"
  };
  function buildSVGPath(attrs, length2, spacing2 = 1, offset = 0, useDashCase = true) {
    attrs.pathLength = 1;
    const keys2 = useDashCase ? dashKeys : camelKeys;
    attrs[keys2.offset] = px2.transform(-offset);
    const pathLength = px2.transform(length2);
    const pathSpacing = px2.transform(spacing2);
    attrs[keys2.array] = `${pathLength} ${pathSpacing}`;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/svg/utils/transform-origin.mjs
  init_define_import_meta_env();
  function calcOrigin(origin, offset, size2) {
    return typeof origin === "string" ? origin : px2.transform(offset + size2 * origin);
  }
  function calcSVGTransformOrigin(dimensions, originX, originY) {
    const pxOriginX = calcOrigin(originX, dimensions.x, dimensions.width);
    const pxOriginY = calcOrigin(originY, dimensions.y, dimensions.height);
    return `${pxOriginX} ${pxOriginY}`;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/svg/utils/build-attrs.mjs
  function buildSVGAttrs(state2, {
    attrX,
    attrY,
    attrScale,
    originX,
    originY,
    pathLength,
    pathSpacing = 1,
    pathOffset = 0,
    // This is object creation, which we try to avoid per-frame.
    ...latest
  }, isSVGTag2, transformTemplate2) {
    buildHTMLStyles(state2, latest, transformTemplate2);
    if (isSVGTag2) {
      if (state2.style.viewBox) {
        state2.attrs.viewBox = state2.style.viewBox;
      }
      return;
    }
    state2.attrs = state2.style;
    state2.style = {};
    const { attrs, style, dimensions } = state2;
    if (attrs.transform) {
      if (dimensions)
        style.transform = attrs.transform;
      delete attrs.transform;
    }
    if (dimensions && (originX !== void 0 || originY !== void 0 || style.transform)) {
      style.transformOrigin = calcSVGTransformOrigin(dimensions, originX !== void 0 ? originX : 0.5, originY !== void 0 ? originY : 0.5);
    }
    if (attrX !== void 0)
      attrs.x = attrX;
    if (attrY !== void 0)
      attrs.y = attrY;
    if (attrScale !== void 0)
      attrs.scale = attrScale;
    if (pathLength !== void 0) {
      buildSVGPath(attrs, pathLength, pathSpacing, pathOffset, false);
    }
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/svg/utils/create-render-state.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/html/utils/create-render-state.mjs
  init_define_import_meta_env();
  var createHtmlRenderState = () => ({
    style: {},
    transform: {},
    transformOrigin: {},
    vars: {}
  });

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/svg/utils/create-render-state.mjs
  var createSvgRenderState = () => ({
    ...createHtmlRenderState(),
    attrs: {}
  });

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/svg/utils/is-svg-tag.mjs
  init_define_import_meta_env();
  var isSVGTag = (tag) => typeof tag === "string" && tag.toLowerCase() === "svg";

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/svg/utils/render.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/html/utils/render.mjs
  init_define_import_meta_env();
  function renderHTML(element, { style, vars: vars2 }, styleProp, projection) {
    Object.assign(element.style, style, projection && projection.getProjectionStyles(styleProp));
    for (const key in vars2) {
      element.style.setProperty(key, vars2[key]);
    }
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/svg/utils/camel-case-attrs.mjs
  init_define_import_meta_env();
  var camelCaseAttributes = /* @__PURE__ */ new Set([
    "baseFrequency",
    "diffuseConstant",
    "kernelMatrix",
    "kernelUnitLength",
    "keySplines",
    "keyTimes",
    "limitingConeAngle",
    "markerHeight",
    "markerWidth",
    "numOctaves",
    "targetX",
    "targetY",
    "surfaceScale",
    "specularConstant",
    "specularExponent",
    "stdDeviation",
    "tableValues",
    "viewBox",
    "gradientTransform",
    "pathLength",
    "startOffset",
    "textLength",
    "lengthAdjust"
  ]);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/svg/utils/render.mjs
  function renderSVG(element, renderState, _styleProp, projection) {
    renderHTML(element, renderState, void 0, projection);
    for (const key in renderState.attrs) {
      element.setAttribute(!camelCaseAttributes.has(key) ? camelToDash(key) : key, renderState.attrs[key]);
    }
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/svg/utils/scrape-motion-values.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/html/utils/scrape-motion-values.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/utils/is-forced-motion-value.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/styles/scale-correction.mjs
  init_define_import_meta_env();
  var scaleCorrectors = {};
  function addScaleCorrector(correctors) {
    Object.assign(scaleCorrectors, correctors);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/utils/is-forced-motion-value.mjs
  function isForcedMotionValue(key, { layout: layout3, layoutId }) {
    return transformProps.has(key) || key.startsWith("origin") || (layout3 || layoutId !== void 0) && (!!scaleCorrectors[key] || key === "opacity");
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/html/utils/scrape-motion-values.mjs
  function scrapeMotionValuesFromProps(props, prevProps, visualElement) {
    var _a;
    const { style } = props;
    const newValues = {};
    for (const key in style) {
      if (isMotionValue(style[key]) || prevProps.style && isMotionValue(prevProps.style[key]) || isForcedMotionValue(key, props) || ((_a = visualElement === null || visualElement === void 0 ? void 0 : visualElement.getValue(key)) === null || _a === void 0 ? void 0 : _a.liveStyle) !== void 0) {
        newValues[key] = style[key];
      }
    }
    return newValues;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/svg/utils/scrape-motion-values.mjs
  function scrapeMotionValuesFromProps2(props, prevProps, visualElement) {
    const newValues = scrapeMotionValuesFromProps(props, prevProps, visualElement);
    for (const key in props) {
      if (isMotionValue(props[key]) || isMotionValue(prevProps[key])) {
        const targetKey = transformPropOrder.indexOf(key) !== -1 ? "attr" + key.charAt(0).toUpperCase() + key.substring(1) : key;
        newValues[targetKey] = props[key];
      }
    }
    return newValues;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/svg/config-motion.mjs
  function updateSVGDimensions(instance, renderState) {
    try {
      renderState.dimensions = typeof instance.getBBox === "function" ? instance.getBBox() : instance.getBoundingClientRect();
    } catch (e) {
      renderState.dimensions = {
        x: 0,
        y: 0,
        width: 0,
        height: 0
      };
    }
  }
  var layoutProps = ["x", "y", "width", "height", "cx", "cy", "r"];
  var svgMotionConfig = {
    useVisualState: makeUseVisualState({
      scrapeMotionValuesFromProps: scrapeMotionValuesFromProps2,
      createRenderState: createSvgRenderState,
      onUpdate: ({ props, prevProps, current, renderState, latestValues }) => {
        if (!current)
          return;
        let hasTransform2 = !!props.drag;
        if (!hasTransform2) {
          for (const key in latestValues) {
            if (transformProps.has(key)) {
              hasTransform2 = true;
              break;
            }
          }
        }
        if (!hasTransform2)
          return;
        let needsMeasure = !prevProps;
        if (prevProps) {
          for (let i = 0; i < layoutProps.length; i++) {
            const key = layoutProps[i];
            if (props[key] !== prevProps[key]) {
              needsMeasure = true;
            }
          }
        }
        if (!needsMeasure)
          return;
        frame.read(() => {
          updateSVGDimensions(current, renderState);
          frame.render(() => {
            buildSVGAttrs(renderState, latestValues, isSVGTag(current.tagName), props.transformTemplate);
            renderSVG(current, renderState);
          });
        });
      }
    })
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/html/config-motion.mjs
  init_define_import_meta_env();
  var htmlMotionConfig = {
    useVisualState: makeUseVisualState({
      scrapeMotionValuesFromProps,
      createRenderState: createHtmlRenderState
    })
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/use-render.mjs
  init_define_import_meta_env();
  var import_react34 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/html/use-props.mjs
  init_define_import_meta_env();
  var import_react32 = __toESM(require_react_shim(), 1);
  function copyRawValuesOnly(target, source, props) {
    for (const key in source) {
      if (!isMotionValue(source[key]) && !isForcedMotionValue(key, props)) {
        target[key] = source[key];
      }
    }
  }
  function useInitialMotionValues({ transformTemplate: transformTemplate2 }, visualState) {
    return (0, import_react32.useMemo)(() => {
      const state2 = createHtmlRenderState();
      buildHTMLStyles(state2, visualState, transformTemplate2);
      return Object.assign({}, state2.vars, state2.style);
    }, [visualState]);
  }
  function useStyle(props, visualState) {
    const styleProp = props.style || {};
    const style = {};
    copyRawValuesOnly(style, styleProp, props);
    Object.assign(style, useInitialMotionValues(props, visualState));
    return style;
  }
  function useHTMLProps(props, visualState) {
    const htmlProps = {};
    const style = useStyle(props, visualState);
    if (props.drag && props.dragListener !== false) {
      htmlProps.draggable = false;
      style.userSelect = style.WebkitUserSelect = style.WebkitTouchCallout = "none";
      style.touchAction = props.drag === true ? "none" : `pan-${props.drag === "x" ? "y" : "x"}`;
    }
    if (props.tabIndex === void 0 && (props.onTap || props.onTapStart || props.whileTap)) {
      htmlProps.tabIndex = 0;
    }
    htmlProps.style = style;
    return htmlProps;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/svg/use-props.mjs
  init_define_import_meta_env();
  var import_react33 = __toESM(require_react_shim(), 1);
  function useSVGProps(props, visualState, _isStatic, Component3) {
    const visualProps = (0, import_react33.useMemo)(() => {
      const state2 = createSvgRenderState();
      buildSVGAttrs(state2, visualState, isSVGTag(Component3), props.transformTemplate);
      return {
        ...state2.attrs,
        style: { ...state2.style }
      };
    }, [visualState]);
    if (props.style) {
      const rawStyles = {};
      copyRawValuesOnly(rawStyles, props.style, props);
      visualProps.style = { ...rawStyles, ...visualProps.style };
    }
    return visualProps;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/use-render.mjs
  function createUseRender(forwardMotionProps = false) {
    const useRender = (Component3, props, ref, { latestValues }, isStatic) => {
      const useVisualProps = isSVGComponent(Component3) ? useSVGProps : useHTMLProps;
      const visualProps = useVisualProps(props, latestValues, isStatic, Component3);
      const filteredProps = filterProps(props, typeof Component3 === "string", forwardMotionProps);
      const elementProps = Component3 !== import_react34.Fragment ? { ...filteredProps, ...visualProps, ref } : {};
      const { children } = props;
      const renderedChildren = (0, import_react34.useMemo)(() => isMotionValue(children) ? children.get() : children, [children]);
      return (0, import_react34.createElement)(Component3, {
        ...elementProps,
        children: renderedChildren
      });
    };
    return useRender;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/components/create-factory.mjs
  function createMotionComponentFactory(preloadedFeatures, createVisualElement) {
    return function createMotionComponent2(Component3, { forwardMotionProps } = { forwardMotionProps: false }) {
      const baseConfig = isSVGComponent(Component3) ? svgMotionConfig : htmlMotionConfig;
      const config2 = {
        ...baseConfig,
        preloadedFeatures,
        useRender: createUseRender(forwardMotionProps),
        createVisualElement,
        Component: Component3
      };
      return createRendererMotionComponent(config2);
    };
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/components/motion/proxy.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/components/motion/create.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/features/animations.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/features/animation/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/utils/animation-state.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/shallow-compare.mjs
  init_define_import_meta_env();
  function shallowCompare(next2, prev2) {
    if (!Array.isArray(prev2))
      return false;
    const prevLength = prev2.length;
    if (prevLength !== next2.length)
      return false;
    for (let i = 0; i < prevLength; i++) {
      if (prev2[i] !== next2[i])
        return false;
    }
    return true;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/utils/resolve-dynamic-variants.mjs
  init_define_import_meta_env();
  function resolveVariant(visualElement, definition, custom) {
    const props = visualElement.getProps();
    return resolveVariantFromProps(props, definition, custom !== void 0 ? custom : props.custom, visualElement);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/interfaces/visual-element.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/interfaces/visual-element-target.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/animation/controls/Group.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/animation/controls/BaseGroup.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/utils/supports/scroll-timeline.mjs
  init_define_import_meta_env();
  var supportsScrollTimeline = memo(() => window.ScrollTimeline !== void 0);

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/animation/controls/BaseGroup.mjs
  var BaseGroupPlaybackControls = class {
    constructor(animations2) {
      this.stop = () => this.runAll("stop");
      this.animations = animations2.filter(Boolean);
    }
    get finished() {
      return Promise.all(this.animations.map((animation) => "finished" in animation ? animation.finished : animation));
    }
    /**
     * TODO: Filter out cancelled or stopped animations before returning
     */
    getAll(propName) {
      return this.animations[0][propName];
    }
    setAll(propName, newValue) {
      for (let i = 0; i < this.animations.length; i++) {
        this.animations[i][propName] = newValue;
      }
    }
    attachTimeline(timeline, fallback) {
      const subscriptions = this.animations.map((animation) => {
        if (supportsScrollTimeline() && animation.attachTimeline) {
          return animation.attachTimeline(timeline);
        } else if (typeof fallback === "function") {
          return fallback(animation);
        }
      });
      return () => {
        subscriptions.forEach((cancel, i) => {
          cancel && cancel();
          this.animations[i].stop();
        });
      };
    }
    get time() {
      return this.getAll("time");
    }
    set time(time2) {
      this.setAll("time", time2);
    }
    get speed() {
      return this.getAll("speed");
    }
    set speed(speed) {
      this.setAll("speed", speed);
    }
    get startTime() {
      return this.getAll("startTime");
    }
    get duration() {
      let max = 0;
      for (let i = 0; i < this.animations.length; i++) {
        max = Math.max(max, this.animations[i].duration);
      }
      return max;
    }
    runAll(methodName) {
      this.animations.forEach((controls) => controls[methodName]());
    }
    flatten() {
      this.runAll("flatten");
    }
    play() {
      this.runAll("play");
    }
    pause() {
      this.runAll("pause");
    }
    cancel() {
      this.runAll("cancel");
    }
    complete() {
      this.runAll("complete");
    }
  };

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/animation/controls/Group.mjs
  var GroupPlaybackControls = class extends BaseGroupPlaybackControls {
    then(onResolve, onReject) {
      return Promise.all(this.animations).then(onResolve).catch(onReject);
    }
  };

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/animation/utils/get-value-transition.mjs
  init_define_import_meta_env();
  function getValueTransition(transition3, key) {
    return transition3 ? transition3[key] || transition3["default"] || transition3 : void 0;
  }

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/animation/generators/utils/calc-duration.mjs
  init_define_import_meta_env();
  var maxGeneratorDuration = 2e4;
  function calcGeneratorDuration(generator) {
    let duration = 0;
    const timeStep = 50;
    let state2 = generator.next(duration);
    while (!state2.done && duration < maxGeneratorDuration) {
      duration += timeStep;
      state2 = generator.next(duration);
    }
    return duration >= maxGeneratorDuration ? Infinity : duration;
  }

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/animation/generators/utils/create-generator-easing.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/animation/generators/utils/is-generator.mjs
  init_define_import_meta_env();
  function isGenerator(type) {
    return typeof type === "function";
  }

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/animation/waapi/NativeAnimationControls.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/animation/waapi/utils/attach-timeline.mjs
  init_define_import_meta_env();
  function attachTimeline(animation, timeline) {
    animation.timeline = timeline;
    animation.onfinish = null;
  }

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/animation/waapi/utils/easing.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/utils/is-bezier-definition.mjs
  init_define_import_meta_env();
  var isBezierDefinition = (easing) => Array.isArray(easing) && typeof easing[0] === "number";

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/utils/supports/linear-easing.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/utils/supports/memo.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/utils/supports/flags.mjs
  init_define_import_meta_env();
  var supportsFlags = {
    linearEasing: void 0
  };

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/utils/supports/memo.mjs
  function memoSupports(callback, supportsFlag) {
    const memoized = memo(callback);
    return () => {
      var _a;
      return (_a = supportsFlags[supportsFlag]) !== null && _a !== void 0 ? _a : memoized();
    };
  }

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/utils/supports/linear-easing.mjs
  var supportsLinearEasing = /* @__PURE__ */ memoSupports(() => {
    try {
      document.createElement("div").animate({ opacity: 0 }, { easing: "linear(0, 1)" });
    } catch (e) {
      return false;
    }
    return true;
  }, "linearEasing");

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/animation/waapi/utils/linear.mjs
  init_define_import_meta_env();
  var generateLinearEasing = (easing, duration, resolution = 10) => {
    let points = "";
    const numPoints = Math.max(Math.round(duration / resolution), 2);
    for (let i = 0; i < numPoints; i++) {
      points += easing(progress(0, numPoints - 1, i)) + ", ";
    }
    return `linear(${points.substring(0, points.length - 2)})`;
  };

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/animation/waapi/utils/easing.mjs
  function isWaapiSupportedEasing(easing) {
    return Boolean(typeof easing === "function" && supportsLinearEasing() || !easing || typeof easing === "string" && (easing in supportedWaapiEasing || supportsLinearEasing()) || isBezierDefinition(easing) || Array.isArray(easing) && easing.every(isWaapiSupportedEasing));
  }
  var cubicBezierAsString = ([a, b, c, d]) => `cubic-bezier(${a}, ${b}, ${c}, ${d})`;
  var supportedWaapiEasing = {
    linear: "linear",
    ease: "ease",
    easeIn: "ease-in",
    easeOut: "ease-out",
    easeInOut: "ease-in-out",
    circIn: /* @__PURE__ */ cubicBezierAsString([0, 0.65, 0.55, 1]),
    circOut: /* @__PURE__ */ cubicBezierAsString([0.55, 0, 1, 0.45]),
    backIn: /* @__PURE__ */ cubicBezierAsString([0.31, 0.01, 0.66, -0.59]),
    backOut: /* @__PURE__ */ cubicBezierAsString([0.33, 1.53, 0.69, 0.99])
  };
  function mapEasingToNativeEasing(easing, duration) {
    if (!easing) {
      return void 0;
    } else if (typeof easing === "function" && supportsLinearEasing()) {
      return generateLinearEasing(easing, duration);
    } else if (isBezierDefinition(easing)) {
      return cubicBezierAsString(easing);
    } else if (Array.isArray(easing)) {
      return easing.map((segmentEasing) => mapEasingToNativeEasing(segmentEasing, duration) || supportedWaapiEasing.easeOut);
    } else {
      return supportedWaapiEasing[easing];
    }
  }

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/gestures/hover.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/gestures/drag/state/is-active.mjs
  init_define_import_meta_env();
  var isDragging = {
    x: false,
    y: false
  };
  function isDragActive() {
    return isDragging.x || isDragging.y;
  }

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/gestures/utils/setup.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/utils/resolve-elements.mjs
  init_define_import_meta_env();
  function resolveElements(elementOrSelector, scope, selectorCache) {
    var _a;
    if (elementOrSelector instanceof Element) {
      return [elementOrSelector];
    } else if (typeof elementOrSelector === "string") {
      let root = document;
      if (scope) {
        root = scope.current;
      }
      const elements = (_a = selectorCache === null || selectorCache === void 0 ? void 0 : selectorCache[elementOrSelector]) !== null && _a !== void 0 ? _a : root.querySelectorAll(elementOrSelector);
      return elements ? Array.from(elements) : [];
    }
    return Array.from(elementOrSelector);
  }

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/gestures/utils/setup.mjs
  function setupGesture(elementOrSelector, options) {
    const elements = resolveElements(elementOrSelector);
    const gestureAbortController = new AbortController();
    const eventOptions = {
      passive: true,
      ...options,
      signal: gestureAbortController.signal
    };
    const cancel = () => gestureAbortController.abort();
    return [elements, eventOptions, cancel];
  }

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/gestures/hover.mjs
  function filterEvents(callback) {
    return (event) => {
      if (event.pointerType === "touch" || isDragActive())
        return;
      callback(event);
    };
  }
  function hover(elementOrSelector, onHoverStart, options = {}) {
    const [elements, eventOptions, cancel] = setupGesture(elementOrSelector, options);
    const onPointerEnter = filterEvents((enterEvent) => {
      const { target } = enterEvent;
      const onHoverEnd = onHoverStart(enterEvent);
      if (typeof onHoverEnd !== "function" || !target)
        return;
      const onPointerLeave = filterEvents((leaveEvent) => {
        onHoverEnd(leaveEvent);
        target.removeEventListener("pointerleave", onPointerLeave);
      });
      target.addEventListener("pointerleave", onPointerLeave, eventOptions);
    });
    elements.forEach((element) => {
      element.addEventListener("pointerenter", onPointerEnter, eventOptions);
    });
    return cancel;
  }

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/gestures/press/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/gestures/utils/is-node-or-child.mjs
  init_define_import_meta_env();
  var isNodeOrChild = (parent, child) => {
    if (!child) {
      return false;
    } else if (parent === child) {
      return true;
    } else {
      return isNodeOrChild(parent, child.parentElement);
    }
  };

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/gestures/utils/is-primary-pointer.mjs
  init_define_import_meta_env();
  var isPrimaryPointer = (event) => {
    if (event.pointerType === "mouse") {
      return typeof event.button !== "number" || event.button <= 0;
    } else {
      return event.isPrimary !== false;
    }
  };

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/gestures/press/utils/is-keyboard-accessible.mjs
  init_define_import_meta_env();
  var focusableElements = /* @__PURE__ */ new Set([
    "BUTTON",
    "INPUT",
    "SELECT",
    "TEXTAREA",
    "A"
  ]);
  function isElementKeyboardAccessible(element) {
    return focusableElements.has(element.tagName) || element.tabIndex !== -1;
  }

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/gestures/press/utils/keyboard.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/gestures/press/utils/state.mjs
  init_define_import_meta_env();
  var isPressing = /* @__PURE__ */ new WeakSet();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/gestures/press/utils/keyboard.mjs
  function filterEvents2(callback) {
    return (event) => {
      if (event.key !== "Enter")
        return;
      callback(event);
    };
  }
  function firePointerEvent(target, type) {
    target.dispatchEvent(new PointerEvent("pointer" + type, { isPrimary: true, bubbles: true }));
  }
  var enableKeyboardPress = (focusEvent, eventOptions) => {
    const element = focusEvent.currentTarget;
    if (!element)
      return;
    const handleKeydown = filterEvents2(() => {
      if (isPressing.has(element))
        return;
      firePointerEvent(element, "down");
      const handleKeyup = filterEvents2(() => {
        firePointerEvent(element, "up");
      });
      const handleBlur = () => firePointerEvent(element, "cancel");
      element.addEventListener("keyup", handleKeyup, eventOptions);
      element.addEventListener("blur", handleBlur, eventOptions);
    });
    element.addEventListener("keydown", handleKeydown, eventOptions);
    element.addEventListener("blur", () => element.removeEventListener("keydown", handleKeydown), eventOptions);
  };

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/gestures/press/index.mjs
  function isValidPressEvent(event) {
    return isPrimaryPointer(event) && !isDragActive();
  }
  function press(elementOrSelector, onPressStart, options = {}) {
    const [elements, eventOptions, cancelEvents] = setupGesture(elementOrSelector, options);
    const startPress = (startEvent) => {
      const element = startEvent.currentTarget;
      if (!isValidPressEvent(startEvent) || isPressing.has(element))
        return;
      isPressing.add(element);
      const onPressEnd = onPressStart(startEvent);
      const onPointerEnd = (endEvent, success) => {
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        if (!isValidPressEvent(endEvent) || !isPressing.has(element)) {
          return;
        }
        isPressing.delete(element);
        if (typeof onPressEnd === "function") {
          onPressEnd(endEvent, { success });
        }
      };
      const onPointerUp = (upEvent) => {
        onPointerEnd(upEvent, options.useGlobalTarget || isNodeOrChild(element, upEvent.target));
      };
      const onPointerCancel = (cancelEvent) => {
        onPointerEnd(cancelEvent, false);
      };
      window.addEventListener("pointerup", onPointerUp, eventOptions);
      window.addEventListener("pointercancel", onPointerCancel, eventOptions);
    };
    elements.forEach((element) => {
      if (!isElementKeyboardAccessible(element) && element.getAttribute("tabindex") === null) {
        element.tabIndex = 0;
      }
      const target = options.useGlobalTarget ? window : element;
      target.addEventListener("pointerdown", startPress, eventOptions);
      element.addEventListener("focus", (event) => enableKeyboardPress(event, eventOptions), eventOptions);
    });
    return cancelEvents;
  }

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/view/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/view/start.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/animation/waapi/PseudoAnimation.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/animation/waapi/utils/convert-options.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/view/utils/choose-layer-type.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/view/utils/css.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/view/utils/get-layer-name.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/view/utils/get-view-animations.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/view/utils/has-target.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/motion-dom@11.18.1/node_modules/motion-dom/dist/es/gestures/drag/state/set-active.mjs
  init_define_import_meta_env();
  function setDragLock(axis) {
    if (axis === "x" || axis === "y") {
      if (isDragging[axis]) {
        return null;
      } else {
        isDragging[axis] = true;
        return () => {
          isDragging[axis] = false;
        };
      }
    } else {
      if (isDragging.x || isDragging.y) {
        return null;
      } else {
        isDragging.x = isDragging.y = true;
        return () => {
          isDragging.x = isDragging.y = false;
        };
      }
    }
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/html/utils/keys-position.mjs
  init_define_import_meta_env();
  var positionalKeys = /* @__PURE__ */ new Set([
    "width",
    "height",
    "top",
    "left",
    "right",
    "bottom",
    ...transformPropOrder
  ]);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/utils/setters.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/frameloop/sync-time.mjs
  init_define_import_meta_env();
  var now;
  function clearTime() {
    now = void 0;
  }
  var time = {
    now: () => {
      if (now === void 0) {
        time.set(frameData.isProcessing || MotionGlobalConfig.useManualTiming ? frameData.timestamp : performance.now());
      }
      return now;
    },
    set: (newTime) => {
      now = newTime;
      queueMicrotask(clearTime);
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/subscription-manager.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/array.mjs
  init_define_import_meta_env();
  function addUniqueItem(arr, item) {
    if (arr.indexOf(item) === -1)
      arr.push(item);
  }
  function removeItem(arr, item) {
    const index = arr.indexOf(item);
    if (index > -1)
      arr.splice(index, 1);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/subscription-manager.mjs
  var SubscriptionManager = class {
    constructor() {
      this.subscriptions = [];
    }
    add(handler) {
      addUniqueItem(this.subscriptions, handler);
      return () => removeItem(this.subscriptions, handler);
    }
    notify(a, b, c) {
      const numSubscriptions = this.subscriptions.length;
      if (!numSubscriptions)
        return;
      if (numSubscriptions === 1) {
        this.subscriptions[0](a, b, c);
      } else {
        for (let i = 0; i < numSubscriptions; i++) {
          const handler = this.subscriptions[i];
          handler && handler(a, b, c);
        }
      }
    }
    getSize() {
      return this.subscriptions.length;
    }
    clear() {
      this.subscriptions.length = 0;
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/velocity-per-second.mjs
  init_define_import_meta_env();
  function velocityPerSecond(velocity, frameDuration) {
    return frameDuration ? velocity * (1e3 / frameDuration) : 0;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/index.mjs
  var MAX_VELOCITY_DELTA = 30;
  var isFloat = (value) => {
    return !isNaN(parseFloat(value));
  };
  var collectMotionValues = {
    current: void 0
  };
  var MotionValue = class {
    /**
     * @param init - The initiating value
     * @param config - Optional configuration options
     *
     * -  `transformer`: A function to transform incoming values with.
     *
     * @internal
     */
    constructor(init, options = {}) {
      this.version = "11.18.2";
      this.canTrackVelocity = null;
      this.events = {};
      this.updateAndNotify = (v, render = true) => {
        const currentTime = time.now();
        if (this.updatedAt !== currentTime) {
          this.setPrevFrameValue();
        }
        this.prev = this.current;
        this.setCurrent(v);
        if (this.current !== this.prev && this.events.change) {
          this.events.change.notify(this.current);
        }
        if (render && this.events.renderRequest) {
          this.events.renderRequest.notify(this.current);
        }
      };
      this.hasAnimated = false;
      this.setCurrent(init);
      this.owner = options.owner;
    }
    setCurrent(current) {
      this.current = current;
      this.updatedAt = time.now();
      if (this.canTrackVelocity === null && current !== void 0) {
        this.canTrackVelocity = isFloat(this.current);
      }
    }
    setPrevFrameValue(prevFrameValue = this.current) {
      this.prevFrameValue = prevFrameValue;
      this.prevUpdatedAt = this.updatedAt;
    }
    /**
     * Adds a function that will be notified when the `MotionValue` is updated.
     *
     * It returns a function that, when called, will cancel the subscription.
     *
     * When calling `onChange` inside a React component, it should be wrapped with the
     * `useEffect` hook. As it returns an unsubscribe function, this should be returned
     * from the `useEffect` function to ensure you don't add duplicate subscribers..
     *
     * ```jsx
     * export const MyComponent = () => {
     *   const x = useMotionValue(0)
     *   const y = useMotionValue(0)
     *   const opacity = useMotionValue(1)
     *
     *   useEffect(() => {
     *     function updateOpacity() {
     *       const maxXY = Math.max(x.get(), y.get())
     *       const newOpacity = transform(maxXY, [0, 100], [1, 0])
     *       opacity.set(newOpacity)
     *     }
     *
     *     const unsubscribeX = x.on("change", updateOpacity)
     *     const unsubscribeY = y.on("change", updateOpacity)
     *
     *     return () => {
     *       unsubscribeX()
     *       unsubscribeY()
     *     }
     *   }, [])
     *
     *   return <motion.div style={{ x }} />
     * }
     * ```
     *
     * @param subscriber - A function that receives the latest value.
     * @returns A function that, when called, will cancel this subscription.
     *
     * @deprecated
     */
    onChange(subscription) {
      if (true) {
        warnOnce(false, `value.onChange(callback) is deprecated. Switch to value.on("change", callback).`);
      }
      return this.on("change", subscription);
    }
    on(eventName, callback) {
      if (!this.events[eventName]) {
        this.events[eventName] = new SubscriptionManager();
      }
      const unsubscribe = this.events[eventName].add(callback);
      if (eventName === "change") {
        return () => {
          unsubscribe();
          frame.read(() => {
            if (!this.events.change.getSize()) {
              this.stop();
            }
          });
        };
      }
      return unsubscribe;
    }
    clearListeners() {
      for (const eventManagers in this.events) {
        this.events[eventManagers].clear();
      }
    }
    /**
     * Attaches a passive effect to the `MotionValue`.
     *
     * @internal
     */
    attach(passiveEffect, stopPassiveEffect) {
      this.passiveEffect = passiveEffect;
      this.stopPassiveEffect = stopPassiveEffect;
    }
    /**
     * Sets the state of the `MotionValue`.
     *
     * @remarks
     *
     * ```jsx
     * const x = useMotionValue(0)
     * x.set(10)
     * ```
     *
     * @param latest - Latest value to set.
     * @param render - Whether to notify render subscribers. Defaults to `true`
     *
     * @public
     */
    set(v, render = true) {
      if (!render || !this.passiveEffect) {
        this.updateAndNotify(v, render);
      } else {
        this.passiveEffect(v, this.updateAndNotify);
      }
    }
    setWithVelocity(prev2, current, delta) {
      this.set(current);
      this.prev = void 0;
      this.prevFrameValue = prev2;
      this.prevUpdatedAt = this.updatedAt - delta;
    }
    /**
     * Set the state of the `MotionValue`, stopping any active animations,
     * effects, and resets velocity to `0`.
     */
    jump(v, endAnimation = true) {
      this.updateAndNotify(v);
      this.prev = v;
      this.prevUpdatedAt = this.prevFrameValue = void 0;
      endAnimation && this.stop();
      if (this.stopPassiveEffect)
        this.stopPassiveEffect();
    }
    /**
     * Returns the latest state of `MotionValue`
     *
     * @returns - The latest state of `MotionValue`
     *
     * @public
     */
    get() {
      if (collectMotionValues.current) {
        collectMotionValues.current.push(this);
      }
      return this.current;
    }
    /**
     * @public
     */
    getPrevious() {
      return this.prev;
    }
    /**
     * Returns the latest velocity of `MotionValue`
     *
     * @returns - The latest velocity of `MotionValue`. Returns `0` if the state is non-numerical.
     *
     * @public
     */
    getVelocity() {
      const currentTime = time.now();
      if (!this.canTrackVelocity || this.prevFrameValue === void 0 || currentTime - this.updatedAt > MAX_VELOCITY_DELTA) {
        return 0;
      }
      const delta = Math.min(this.updatedAt - this.prevUpdatedAt, MAX_VELOCITY_DELTA);
      return velocityPerSecond(parseFloat(this.current) - parseFloat(this.prevFrameValue), delta);
    }
    /**
     * Registers a new animation to control this `MotionValue`. Only one
     * animation can drive a `MotionValue` at one time.
     *
     * ```jsx
     * value.start()
     * ```
     *
     * @param animation - A function that starts the provided animation
     *
     * @internal
     */
    start(startAnimation) {
      this.stop();
      return new Promise((resolve) => {
        this.hasAnimated = true;
        this.animation = startAnimation(resolve);
        if (this.events.animationStart) {
          this.events.animationStart.notify();
        }
      }).then(() => {
        if (this.events.animationComplete) {
          this.events.animationComplete.notify();
        }
        this.clearAnimation();
      });
    }
    /**
     * Stop the currently active animation.
     *
     * @public
     */
    stop() {
      if (this.animation) {
        this.animation.stop();
        if (this.events.animationCancel) {
          this.events.animationCancel.notify();
        }
      }
      this.clearAnimation();
    }
    /**
     * Returns `true` if this value is currently animating.
     *
     * @public
     */
    isAnimating() {
      return !!this.animation;
    }
    clearAnimation() {
      delete this.animation;
    }
    /**
     * Destroy and clean up subscribers to this `MotionValue`.
     *
     * The `MotionValue` hooks like `useMotionValue` and `useTransform` automatically
     * handle the lifecycle of the returned `MotionValue`, so this method is only necessary if you've manually
     * created a `MotionValue` via the `motionValue` function.
     *
     * @public
     */
    destroy() {
      this.clearListeners();
      this.stop();
      if (this.stopPassiveEffect) {
        this.stopPassiveEffect();
      }
    }
  };
  function motionValue(init, options) {
    return new MotionValue(init, options);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/utils/setters.mjs
  function setMotionValue(visualElement, key, value) {
    if (visualElement.hasValue(key)) {
      visualElement.getValue(key).set(value);
    } else {
      visualElement.addValue(key, motionValue(value));
    }
  }
  function setTarget(visualElement, definition) {
    const resolved = resolveVariant(visualElement, definition);
    let { transitionEnd = {}, transition: transition3 = {}, ...target } = resolved || {};
    target = { ...target, ...transitionEnd };
    for (const key in target) {
      const value = resolveFinalValueInKeyframes(target[key]);
      setMotionValue(visualElement, key, value);
    }
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/use-will-change/add-will-change.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/use-will-change/is.mjs
  init_define_import_meta_env();
  function isWillChangeMotionValue(value) {
    return Boolean(isMotionValue(value) && value.add);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/use-will-change/add-will-change.mjs
  function addValueToWillChange(visualElement, key) {
    const willChange = visualElement.getValue("willChange");
    if (isWillChangeMotionValue(willChange)) {
      return willChange.add(key);
    }
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/optimized-appear/get-appear-id.mjs
  init_define_import_meta_env();
  function getOptimisedAppearId(visualElement) {
    return visualElement.props[optimizedAppearDataAttribute];
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/interfaces/motion-value.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/use-instant-transition-state.mjs
  init_define_import_meta_env();
  var instantAnimationState = {
    current: false
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/animators/AcceleratedAnimation.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/easing/anticipate.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/easing/back.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/easing/cubic-bezier.mjs
  init_define_import_meta_env();
  var calcBezier = (t2, a1, a2) => (((1 - 3 * a2 + 3 * a1) * t2 + (3 * a2 - 6 * a1)) * t2 + 3 * a1) * t2;
  var subdivisionPrecision = 1e-7;
  var subdivisionMaxIterations = 12;
  function binarySubdivide(x, lowerBound, upperBound, mX1, mX2) {
    let currentX;
    let currentT;
    let i = 0;
    do {
      currentT = lowerBound + (upperBound - lowerBound) / 2;
      currentX = calcBezier(currentT, mX1, mX2) - x;
      if (currentX > 0) {
        upperBound = currentT;
      } else {
        lowerBound = currentT;
      }
    } while (Math.abs(currentX) > subdivisionPrecision && ++i < subdivisionMaxIterations);
    return currentT;
  }
  function cubicBezier(mX1, mY1, mX2, mY2) {
    if (mX1 === mY1 && mX2 === mY2)
      return noop2;
    const getTForX = (aX) => binarySubdivide(aX, 0, 1, mX1, mX2);
    return (t2) => t2 === 0 || t2 === 1 ? t2 : calcBezier(getTForX(t2), mY1, mY2);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/easing/modifiers/mirror.mjs
  init_define_import_meta_env();
  var mirrorEasing = (easing) => (p) => p <= 0.5 ? easing(2 * p) / 2 : (2 - easing(2 * (1 - p))) / 2;

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/easing/modifiers/reverse.mjs
  init_define_import_meta_env();
  var reverseEasing = (easing) => (p) => 1 - easing(1 - p);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/easing/back.mjs
  var backOut = /* @__PURE__ */ cubicBezier(0.33, 1.53, 0.69, 0.99);
  var backIn = /* @__PURE__ */ reverseEasing(backOut);
  var backInOut = /* @__PURE__ */ mirrorEasing(backIn);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/easing/anticipate.mjs
  var anticipate = (p) => (p *= 2) < 1 ? 0.5 * backIn(p) : 0.5 * (2 - Math.pow(2, -10 * (p - 1)));

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/easing/circ.mjs
  init_define_import_meta_env();
  var circIn = (p) => 1 - Math.sin(Math.acos(p));
  var circOut = reverseEasing(circIn);
  var circInOut = mirrorEasing(circIn);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/DOMKeyframesResolver.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/utils/is-none.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/is-zero-value-string.mjs
  init_define_import_meta_env();
  var isZeroValueString = (v) => /^0[^.\s]+$/u.test(v);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/utils/is-none.mjs
  function isNone(value) {
    if (typeof value === "number") {
      return value === 0;
    } else if (value !== null) {
      return value === "none" || value === "0" || isZeroValueString(value);
    } else {
      return true;
    }
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/html/utils/make-none-animatable.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/complex/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/color/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/color/hex.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/color/rgba.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/utils/sanitize.mjs
  init_define_import_meta_env();
  var sanitize = (v) => Math.round(v * 1e5) / 1e5;

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/color/utils.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/utils/float-regex.mjs
  init_define_import_meta_env();
  var floatRegex = /-?(?:\d+(?:\.\d+)?|\.\d+)/gu;

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/utils/is-nullish.mjs
  init_define_import_meta_env();
  function isNullish(v) {
    return v == null;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/utils/single-color-regex.mjs
  init_define_import_meta_env();
  var singleColorRegex = /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\))$/iu;

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/color/utils.mjs
  var isColorString = (type, testProp) => (v) => {
    return Boolean(typeof v === "string" && singleColorRegex.test(v) && v.startsWith(type) || testProp && !isNullish(v) && Object.prototype.hasOwnProperty.call(v, testProp));
  };
  var splitColor = (aName, bName, cName) => (v) => {
    if (typeof v !== "string")
      return v;
    const [a, b, c, alpha2] = v.match(floatRegex);
    return {
      [aName]: parseFloat(a),
      [bName]: parseFloat(b),
      [cName]: parseFloat(c),
      alpha: alpha2 !== void 0 ? parseFloat(alpha2) : 1
    };
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/color/rgba.mjs
  var clampRgbUnit = (v) => clamp(0, 255, v);
  var rgbUnit = {
    ...number,
    transform: (v) => Math.round(clampRgbUnit(v))
  };
  var rgba2 = {
    test: /* @__PURE__ */ isColorString("rgb", "red"),
    parse: /* @__PURE__ */ splitColor("red", "green", "blue"),
    transform: ({ red, green, blue, alpha: alpha$1 = 1 }) => "rgba(" + rgbUnit.transform(red) + ", " + rgbUnit.transform(green) + ", " + rgbUnit.transform(blue) + ", " + sanitize(alpha.transform(alpha$1)) + ")"
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/color/hex.mjs
  function parseHex(v) {
    let r2 = "";
    let g = "";
    let b = "";
    let a = "";
    if (v.length > 5) {
      r2 = v.substring(1, 3);
      g = v.substring(3, 5);
      b = v.substring(5, 7);
      a = v.substring(7, 9);
    } else {
      r2 = v.substring(1, 2);
      g = v.substring(2, 3);
      b = v.substring(3, 4);
      a = v.substring(4, 5);
      r2 += r2;
      g += g;
      b += b;
      a += a;
    }
    return {
      red: parseInt(r2, 16),
      green: parseInt(g, 16),
      blue: parseInt(b, 16),
      alpha: a ? parseInt(a, 16) / 255 : 1
    };
  }
  var hex = {
    test: /* @__PURE__ */ isColorString("#"),
    parse: parseHex,
    transform: rgba2.transform
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/color/hsla.mjs
  init_define_import_meta_env();
  var hsla2 = {
    test: /* @__PURE__ */ isColorString("hsl", "hue"),
    parse: /* @__PURE__ */ splitColor("hue", "saturation", "lightness"),
    transform: ({ hue, saturation, lightness, alpha: alpha$1 = 1 }) => {
      return "hsla(" + Math.round(hue) + ", " + percent.transform(sanitize(saturation)) + ", " + percent.transform(sanitize(lightness)) + ", " + sanitize(alpha.transform(alpha$1)) + ")";
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/color/index.mjs
  var color2 = {
    test: (v) => rgba2.test(v) || hex.test(v) || hsla2.test(v),
    parse: (v) => {
      if (rgba2.test(v)) {
        return rgba2.parse(v);
      } else if (hsla2.test(v)) {
        return hsla2.parse(v);
      } else {
        return hex.parse(v);
      }
    },
    transform: (v) => {
      return typeof v === "string" ? v : v.hasOwnProperty("red") ? rgba2.transform(v) : hsla2.transform(v);
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/utils/color-regex.mjs
  init_define_import_meta_env();
  var colorRegex = /(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\))/giu;

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/complex/index.mjs
  function test(v) {
    var _a, _b;
    return isNaN(v) && typeof v === "string" && (((_a = v.match(floatRegex)) === null || _a === void 0 ? void 0 : _a.length) || 0) + (((_b = v.match(colorRegex)) === null || _b === void 0 ? void 0 : _b.length) || 0) > 0;
  }
  var NUMBER_TOKEN = "number";
  var COLOR_TOKEN = "color";
  var VAR_TOKEN = "var";
  var VAR_FUNCTION_TOKEN = "var(";
  var SPLIT_TOKEN = "${}";
  var complexRegex = /var\s*\(\s*--(?:[\w-]+\s*|[\w-]+\s*,(?:\s*[^)(\s]|\s*\((?:[^)(]|\([^)(]*\))*\))+\s*)\)|#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\)|-?(?:\d+(?:\.\d+)?|\.\d+)/giu;
  function analyseComplexValue(value) {
    const originalValue = value.toString();
    const values = [];
    const indexes = {
      color: [],
      number: [],
      var: []
    };
    const types = [];
    let i = 0;
    const tokenised = originalValue.replace(complexRegex, (parsedValue) => {
      if (color2.test(parsedValue)) {
        indexes.color.push(i);
        types.push(COLOR_TOKEN);
        values.push(color2.parse(parsedValue));
      } else if (parsedValue.startsWith(VAR_FUNCTION_TOKEN)) {
        indexes.var.push(i);
        types.push(VAR_TOKEN);
        values.push(parsedValue);
      } else {
        indexes.number.push(i);
        types.push(NUMBER_TOKEN);
        values.push(parseFloat(parsedValue));
      }
      ++i;
      return SPLIT_TOKEN;
    });
    const split = tokenised.split(SPLIT_TOKEN);
    return { values, split, indexes, types };
  }
  function parseComplexValue(v) {
    return analyseComplexValue(v).values;
  }
  function createTransformer(source) {
    const { split, types } = analyseComplexValue(source);
    const numSections = split.length;
    return (v) => {
      let output = "";
      for (let i = 0; i < numSections; i++) {
        output += split[i];
        if (v[i] !== void 0) {
          const type = types[i];
          if (type === NUMBER_TOKEN) {
            output += sanitize(v[i]);
          } else if (type === COLOR_TOKEN) {
            output += color2.transform(v[i]);
          } else {
            output += v[i];
          }
        }
      }
      return output;
    };
  }
  var convertNumbersToZero = (v) => typeof v === "number" ? 0 : v;
  function getAnimatableNone(v) {
    const parsed = parseComplexValue(v);
    const transformer = createTransformer(v);
    return transformer(parsed.map(convertNumbersToZero));
  }
  var complex = {
    test,
    parse: parseComplexValue,
    createTransformer,
    getAnimatableNone
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/value-types/animatable-none.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/value/types/complex/filter.mjs
  init_define_import_meta_env();
  var maxDefaults = /* @__PURE__ */ new Set(["brightness", "contrast", "saturate", "opacity"]);
  function applyDefaultFilter(v) {
    const [name, value] = v.slice(0, -1).split("(");
    if (name === "drop-shadow")
      return v;
    const [number2] = value.match(floatRegex) || [];
    if (!number2)
      return v;
    const unit = value.replace(number2, "");
    let defaultValue = maxDefaults.has(name) ? 1 : 0;
    if (number2 !== value)
      defaultValue *= 100;
    return name + "(" + defaultValue + unit + ")";
  }
  var functionRegex = /\b([a-z-]*)\(.*?\)/gu;
  var filter2 = {
    ...complex,
    getAnimatableNone: (v) => {
      const functions = v.match(functionRegex);
      return functions ? functions.map(applyDefaultFilter).join(" ") : v;
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/value-types/defaults.mjs
  init_define_import_meta_env();
  var defaultValueTypes = {
    ...numberValueTypes,
    // Color props
    color: color2,
    backgroundColor: color2,
    outlineColor: color2,
    fill: color2,
    stroke: color2,
    // Border props
    borderColor: color2,
    borderTopColor: color2,
    borderRightColor: color2,
    borderBottomColor: color2,
    borderLeftColor: color2,
    filter: filter2,
    WebkitFilter: filter2
  };
  var getDefaultValueType = (key) => defaultValueTypes[key];

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/value-types/animatable-none.mjs
  function getAnimatableNone2(key, value) {
    let defaultValueType = getDefaultValueType(key);
    if (defaultValueType !== filter2)
      defaultValueType = complex;
    return defaultValueType.getAnimatableNone ? defaultValueType.getAnimatableNone(value) : void 0;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/html/utils/make-none-animatable.mjs
  var invalidTemplates = /* @__PURE__ */ new Set(["auto", "none", "0"]);
  function makeNoneKeyframesAnimatable(unresolvedKeyframes, noneKeyframeIndexes, name) {
    let i = 0;
    let animatableTemplate = void 0;
    while (i < unresolvedKeyframes.length && !animatableTemplate) {
      const keyframe = unresolvedKeyframes[i];
      if (typeof keyframe === "string" && !invalidTemplates.has(keyframe) && analyseComplexValue(keyframe).values.length) {
        animatableTemplate = unresolvedKeyframes[i];
      }
      i++;
    }
    if (animatableTemplate && name) {
      for (const noneIndex of noneKeyframeIndexes) {
        unresolvedKeyframes[noneIndex] = getAnimatableNone2(name, animatableTemplate);
      }
    }
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/utils/KeyframesResolver.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/utils/unit-conversion.mjs
  init_define_import_meta_env();
  var isNumOrPxType = (v) => v === number || v === px2;
  var getPosFromMatrix = (matrix, pos) => parseFloat(matrix.split(", ")[pos]);
  var getTranslateFromMatrix = (pos2, pos3) => (_bbox, { transform: transform2 }) => {
    if (transform2 === "none" || !transform2)
      return 0;
    const matrix3d = transform2.match(/^matrix3d\((.+)\)$/u);
    if (matrix3d) {
      return getPosFromMatrix(matrix3d[1], pos3);
    } else {
      const matrix = transform2.match(/^matrix\((.+)\)$/u);
      if (matrix) {
        return getPosFromMatrix(matrix[1], pos2);
      } else {
        return 0;
      }
    }
  };
  var transformKeys = /* @__PURE__ */ new Set(["x", "y", "z"]);
  var nonTranslationalTransformKeys = transformPropOrder.filter((key) => !transformKeys.has(key));
  function removeNonTranslationalTransform(visualElement) {
    const removedTransforms = [];
    nonTranslationalTransformKeys.forEach((key) => {
      const value = visualElement.getValue(key);
      if (value !== void 0) {
        removedTransforms.push([key, value.get()]);
        value.set(key.startsWith("scale") ? 1 : 0);
      }
    });
    return removedTransforms;
  }
  var positionalValues = {
    // Dimensions
    width: ({ x }, { paddingLeft = "0", paddingRight = "0" }) => x.max - x.min - parseFloat(paddingLeft) - parseFloat(paddingRight),
    height: ({ y }, { paddingTop = "0", paddingBottom = "0" }) => y.max - y.min - parseFloat(paddingTop) - parseFloat(paddingBottom),
    top: (_bbox, { top }) => parseFloat(top),
    left: (_bbox, { left }) => parseFloat(left),
    bottom: ({ y }, { top }) => parseFloat(top) + (y.max - y.min),
    right: ({ x }, { left }) => parseFloat(left) + (x.max - x.min),
    // Transform
    x: getTranslateFromMatrix(4, 13),
    y: getTranslateFromMatrix(5, 14)
  };
  positionalValues.translateX = positionalValues.x;
  positionalValues.translateY = positionalValues.y;

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/utils/KeyframesResolver.mjs
  var toResolve = /* @__PURE__ */ new Set();
  var isScheduled = false;
  var anyNeedsMeasurement = false;
  function measureAllKeyframes() {
    if (anyNeedsMeasurement) {
      const resolversToMeasure = Array.from(toResolve).filter((resolver) => resolver.needsMeasurement);
      const elementsToMeasure = new Set(resolversToMeasure.map((resolver) => resolver.element));
      const transformsToRestore = /* @__PURE__ */ new Map();
      elementsToMeasure.forEach((element) => {
        const removedTransforms = removeNonTranslationalTransform(element);
        if (!removedTransforms.length)
          return;
        transformsToRestore.set(element, removedTransforms);
        element.render();
      });
      resolversToMeasure.forEach((resolver) => resolver.measureInitialState());
      elementsToMeasure.forEach((element) => {
        element.render();
        const restore = transformsToRestore.get(element);
        if (restore) {
          restore.forEach(([key, value]) => {
            var _a;
            (_a = element.getValue(key)) === null || _a === void 0 ? void 0 : _a.set(value);
          });
        }
      });
      resolversToMeasure.forEach((resolver) => resolver.measureEndState());
      resolversToMeasure.forEach((resolver) => {
        if (resolver.suspendedScrollY !== void 0) {
          window.scrollTo(0, resolver.suspendedScrollY);
        }
      });
    }
    anyNeedsMeasurement = false;
    isScheduled = false;
    toResolve.forEach((resolver) => resolver.complete());
    toResolve.clear();
  }
  function readAllKeyframes() {
    toResolve.forEach((resolver) => {
      resolver.readKeyframes();
      if (resolver.needsMeasurement) {
        anyNeedsMeasurement = true;
      }
    });
  }
  function flushKeyframeResolvers() {
    readAllKeyframes();
    measureAllKeyframes();
  }
  var KeyframeResolver = class {
    constructor(unresolvedKeyframes, onComplete, name, motionValue2, element, isAsync = false) {
      this.isComplete = false;
      this.isAsync = false;
      this.needsMeasurement = false;
      this.isScheduled = false;
      this.unresolvedKeyframes = [...unresolvedKeyframes];
      this.onComplete = onComplete;
      this.name = name;
      this.motionValue = motionValue2;
      this.element = element;
      this.isAsync = isAsync;
    }
    scheduleResolve() {
      this.isScheduled = true;
      if (this.isAsync) {
        toResolve.add(this);
        if (!isScheduled) {
          isScheduled = true;
          frame.read(readAllKeyframes);
          frame.resolveKeyframes(measureAllKeyframes);
        }
      } else {
        this.readKeyframes();
        this.complete();
      }
    }
    readKeyframes() {
      const { unresolvedKeyframes, name, element, motionValue: motionValue2 } = this;
      for (let i = 0; i < unresolvedKeyframes.length; i++) {
        if (unresolvedKeyframes[i] === null) {
          if (i === 0) {
            const currentValue = motionValue2 === null || motionValue2 === void 0 ? void 0 : motionValue2.get();
            const finalKeyframe = unresolvedKeyframes[unresolvedKeyframes.length - 1];
            if (currentValue !== void 0) {
              unresolvedKeyframes[0] = currentValue;
            } else if (element && name) {
              const valueAsRead = element.readValue(name, finalKeyframe);
              if (valueAsRead !== void 0 && valueAsRead !== null) {
                unresolvedKeyframes[0] = valueAsRead;
              }
            }
            if (unresolvedKeyframes[0] === void 0) {
              unresolvedKeyframes[0] = finalKeyframe;
            }
            if (motionValue2 && currentValue === void 0) {
              motionValue2.set(unresolvedKeyframes[0]);
            }
          } else {
            unresolvedKeyframes[i] = unresolvedKeyframes[i - 1];
          }
        }
      }
    }
    setFinalKeyframe() {
    }
    measureInitialState() {
    }
    renderEndStyles() {
    }
    measureEndState() {
    }
    complete() {
      this.isComplete = true;
      this.onComplete(this.unresolvedKeyframes, this.finalKeyframe);
      toResolve.delete(this);
    }
    cancel() {
      if (!this.isComplete) {
        this.isScheduled = false;
        toResolve.delete(this);
      }
    }
    resume() {
      if (!this.isComplete)
        this.scheduleResolve();
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/utils/css-variables-conversion.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/is-numerical-string.mjs
  init_define_import_meta_env();
  var isNumericalString = (v) => /^-?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(v);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/utils/css-variables-conversion.mjs
  var splitCSSVariableRegex = (
    // eslint-disable-next-line redos-detector/no-unsafe-regex -- false positive, as it can match a lot of words
    /^var\(--(?:([\w-]+)|([\w-]+), ?([a-zA-Z\d ()%#.,-]+))\)/u
  );
  function parseCSSVariable(current) {
    const match2 = splitCSSVariableRegex.exec(current);
    if (!match2)
      return [,];
    const [, token1, token2, fallback] = match2;
    return [`--${token1 !== null && token1 !== void 0 ? token1 : token2}`, fallback];
  }
  var maxDepth = 4;
  function getVariableValue(current, element, depth = 1) {
    invariant(depth <= maxDepth, `Max CSS variable fallback depth detected in property "${current}". This may indicate a circular fallback dependency.`);
    const [token2, fallback] = parseCSSVariable(current);
    if (!token2)
      return;
    const resolved = window.getComputedStyle(element).getPropertyValue(token2);
    if (resolved) {
      const trimmed = resolved.trim();
      return isNumericalString(trimmed) ? parseFloat(trimmed) : trimmed;
    }
    return isCSSVariableToken(fallback) ? getVariableValue(fallback, element, depth + 1) : fallback;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/value-types/dimensions.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/value-types/test.mjs
  init_define_import_meta_env();
  var testValueType = (v) => (type) => type.test(v);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/value-types/type-auto.mjs
  init_define_import_meta_env();
  var auto = {
    test: (v) => v === "auto",
    parse: (v) => v
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/value-types/dimensions.mjs
  var dimensionValueTypes = [number, px2, percent, degrees, vw, vh, auto];
  var findDimensionValueType = (v) => dimensionValueTypes.find(testValueType(v));

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/DOMKeyframesResolver.mjs
  var DOMKeyframesResolver = class extends KeyframeResolver {
    constructor(unresolvedKeyframes, onComplete, name, motionValue2, element) {
      super(unresolvedKeyframes, onComplete, name, motionValue2, element, true);
    }
    readKeyframes() {
      const { unresolvedKeyframes, element, name } = this;
      if (!element || !element.current)
        return;
      super.readKeyframes();
      for (let i = 0; i < unresolvedKeyframes.length; i++) {
        let keyframe = unresolvedKeyframes[i];
        if (typeof keyframe === "string") {
          keyframe = keyframe.trim();
          if (isCSSVariableToken(keyframe)) {
            const resolved = getVariableValue(keyframe, element.current);
            if (resolved !== void 0) {
              unresolvedKeyframes[i] = resolved;
            }
            if (i === unresolvedKeyframes.length - 1) {
              this.finalKeyframe = keyframe;
            }
          }
        }
      }
      this.resolveNoneKeyframes();
      if (!positionalKeys.has(name) || unresolvedKeyframes.length !== 2) {
        return;
      }
      const [origin, target] = unresolvedKeyframes;
      const originType = findDimensionValueType(origin);
      const targetType = findDimensionValueType(target);
      if (originType === targetType)
        return;
      if (isNumOrPxType(originType) && isNumOrPxType(targetType)) {
        for (let i = 0; i < unresolvedKeyframes.length; i++) {
          const value = unresolvedKeyframes[i];
          if (typeof value === "string") {
            unresolvedKeyframes[i] = parseFloat(value);
          }
        }
      } else {
        this.needsMeasurement = true;
      }
    }
    resolveNoneKeyframes() {
      const { unresolvedKeyframes, name } = this;
      const noneKeyframeIndexes = [];
      for (let i = 0; i < unresolvedKeyframes.length; i++) {
        if (isNone(unresolvedKeyframes[i])) {
          noneKeyframeIndexes.push(i);
        }
      }
      if (noneKeyframeIndexes.length) {
        makeNoneKeyframesAnimatable(unresolvedKeyframes, noneKeyframeIndexes, name);
      }
    }
    measureInitialState() {
      const { element, unresolvedKeyframes, name } = this;
      if (!element || !element.current)
        return;
      if (name === "height") {
        this.suspendedScrollY = window.pageYOffset;
      }
      this.measuredOrigin = positionalValues[name](element.measureViewportBox(), window.getComputedStyle(element.current));
      unresolvedKeyframes[0] = this.measuredOrigin;
      const measureKeyframe = unresolvedKeyframes[unresolvedKeyframes.length - 1];
      if (measureKeyframe !== void 0) {
        element.getValue(name, measureKeyframe).jump(measureKeyframe, false);
      }
    }
    measureEndState() {
      var _a;
      const { element, name, unresolvedKeyframes } = this;
      if (!element || !element.current)
        return;
      const value = element.getValue(name);
      value && value.jump(this.measuredOrigin, false);
      const finalKeyframeIndex = unresolvedKeyframes.length - 1;
      const finalKeyframe = unresolvedKeyframes[finalKeyframeIndex];
      unresolvedKeyframes[finalKeyframeIndex] = positionalValues[name](element.measureViewportBox(), window.getComputedStyle(element.current));
      if (finalKeyframe !== null && this.finalKeyframe === void 0) {
        this.finalKeyframe = finalKeyframe;
      }
      if ((_a = this.removedTransforms) === null || _a === void 0 ? void 0 : _a.length) {
        this.removedTransforms.forEach(([unsetTransformName, unsetTransformValue]) => {
          element.getValue(unsetTransformName).set(unsetTransformValue);
        });
      }
      this.resolveNoneKeyframes();
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/animators/BaseAnimation.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/animators/utils/can-animate.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/utils/is-animatable.mjs
  init_define_import_meta_env();
  var isAnimatable = (value, name) => {
    if (name === "zIndex")
      return false;
    if (typeof value === "number" || Array.isArray(value))
      return true;
    if (typeof value === "string" && // It's animatable if we have a string
    (complex.test(value) || value === "0") && // And it contains numbers and/or colors
    !value.startsWith("url(")) {
      return true;
    }
    return false;
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/animators/utils/can-animate.mjs
  function hasKeyframesChanged(keyframes3) {
    const current = keyframes3[0];
    if (keyframes3.length === 1)
      return true;
    for (let i = 0; i < keyframes3.length; i++) {
      if (keyframes3[i] !== current)
        return true;
    }
  }
  function canAnimate(keyframes3, name, type, velocity) {
    const originKeyframe = keyframes3[0];
    if (originKeyframe === null)
      return false;
    if (name === "display" || name === "visibility")
      return true;
    const targetKeyframe = keyframes3[keyframes3.length - 1];
    const isOriginAnimatable = isAnimatable(originKeyframe, name);
    const isTargetAnimatable = isAnimatable(targetKeyframe, name);
    warning(isOriginAnimatable === isTargetAnimatable, `You are trying to animate ${name} from "${originKeyframe}" to "${targetKeyframe}". ${originKeyframe} is not an animatable value - to enable this animation set ${originKeyframe} to a value animatable to ${targetKeyframe} via the \`style\` property.`);
    if (!isOriginAnimatable || !isTargetAnimatable) {
      return false;
    }
    return hasKeyframesChanged(keyframes3) || (type === "spring" || isGenerator(type)) && velocity;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/animators/waapi/utils/get-final-keyframe.mjs
  init_define_import_meta_env();
  var isNotNull = (value) => value !== null;
  function getFinalKeyframe(keyframes3, { repeat, repeatType = "loop" }, finalKeyframe) {
    const resolvedKeyframes = keyframes3.filter(isNotNull);
    const index = repeat && repeatType !== "loop" && repeat % 2 === 1 ? 0 : resolvedKeyframes.length - 1;
    return !index || finalKeyframe === void 0 ? resolvedKeyframes[index] : finalKeyframe;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/animators/BaseAnimation.mjs
  var MAX_RESOLVE_DELAY = 40;
  var BaseAnimation = class {
    constructor({ autoplay = true, delay: delay2 = 0, type = "keyframes", repeat = 0, repeatDelay = 0, repeatType = "loop", ...options }) {
      this.isStopped = false;
      this.hasAttemptedResolve = false;
      this.createdAt = time.now();
      this.options = {
        autoplay,
        delay: delay2,
        type,
        repeat,
        repeatDelay,
        repeatType,
        ...options
      };
      this.updateFinishedPromise();
    }
    /**
     * This method uses the createdAt and resolvedAt to calculate the
     * animation startTime. *Ideally*, we would use the createdAt time as t=0
     * as the following frame would then be the first frame of the animation in
     * progress, which would feel snappier.
     *
     * However, if there's a delay (main thread work) between the creation of
     * the animation and the first commited frame, we prefer to use resolvedAt
     * to avoid a sudden jump into the animation.
     */
    calcStartTime() {
      if (!this.resolvedAt)
        return this.createdAt;
      return this.resolvedAt - this.createdAt > MAX_RESOLVE_DELAY ? this.resolvedAt : this.createdAt;
    }
    /**
     * A getter for resolved data. If keyframes are not yet resolved, accessing
     * this.resolved will synchronously flush all pending keyframe resolvers.
     * This is a deoptimisation, but at its worst still batches read/writes.
     */
    get resolved() {
      if (!this._resolved && !this.hasAttemptedResolve) {
        flushKeyframeResolvers();
      }
      return this._resolved;
    }
    /**
     * A method to be called when the keyframes resolver completes. This method
     * will check if its possible to run the animation and, if not, skip it.
     * Otherwise, it will call initPlayback on the implementing class.
     */
    onKeyframesResolved(keyframes3, finalKeyframe) {
      this.resolvedAt = time.now();
      this.hasAttemptedResolve = true;
      const { name, type, velocity, delay: delay2, onComplete, onUpdate, isGenerator: isGenerator2 } = this.options;
      if (!isGenerator2 && !canAnimate(keyframes3, name, type, velocity)) {
        if (instantAnimationState.current || !delay2) {
          onUpdate && onUpdate(getFinalKeyframe(keyframes3, this.options, finalKeyframe));
          onComplete && onComplete();
          this.resolveFinishedPromise();
          return;
        } else {
          this.options.duration = 0;
        }
      }
      const resolvedAnimation = this.initPlayback(keyframes3, finalKeyframe);
      if (resolvedAnimation === false)
        return;
      this._resolved = {
        keyframes: keyframes3,
        finalKeyframe,
        ...resolvedAnimation
      };
      this.onPostResolved();
    }
    onPostResolved() {
    }
    /**
     * Allows the returned animation to be awaited or promise-chained. Currently
     * resolves when the animation finishes at all but in a future update could/should
     * reject if its cancels.
     */
    then(resolve, reject) {
      return this.currentFinishedPromise.then(resolve, reject);
    }
    flatten() {
      this.options.type = "keyframes";
      this.options.ease = "linear";
    }
    updateFinishedPromise() {
      this.currentFinishedPromise = new Promise((resolve) => {
        this.resolveFinishedPromise = resolve;
      });
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/animators/MainThreadAnimation.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/mix/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/mix/complex.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/mix/number.mjs
  init_define_import_meta_env();
  var mixNumber = (from2, to, progress2) => {
    return from2 + (to - from2) * progress2;
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/mix/color.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/hsla-to-rgba.mjs
  init_define_import_meta_env();
  function hueToRgb(p, q, t2) {
    if (t2 < 0)
      t2 += 1;
    if (t2 > 1)
      t2 -= 1;
    if (t2 < 1 / 6)
      return p + (q - p) * 6 * t2;
    if (t2 < 1 / 2)
      return q;
    if (t2 < 2 / 3)
      return p + (q - p) * (2 / 3 - t2) * 6;
    return p;
  }
  function hslaToRgba({ hue, saturation, lightness, alpha: alpha2 }) {
    hue /= 360;
    saturation /= 100;
    lightness /= 100;
    let red = 0;
    let green = 0;
    let blue = 0;
    if (!saturation) {
      red = green = blue = lightness;
    } else {
      const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
      const p = 2 * lightness - q;
      red = hueToRgb(p, q, hue + 1 / 3);
      green = hueToRgb(p, q, hue);
      blue = hueToRgb(p, q, hue - 1 / 3);
    }
    return {
      red: Math.round(red * 255),
      green: Math.round(green * 255),
      blue: Math.round(blue * 255),
      alpha: alpha2
    };
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/mix/immediate.mjs
  init_define_import_meta_env();
  function mixImmediate(a, b) {
    return (p) => p > 0 ? b : a;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/mix/color.mjs
  var mixLinearColor = (from2, to, v) => {
    const fromExpo = from2 * from2;
    const expo = v * (to * to - fromExpo) + fromExpo;
    return expo < 0 ? 0 : Math.sqrt(expo);
  };
  var colorTypes = [hex, rgba2, hsla2];
  var getColorType = (v) => colorTypes.find((type) => type.test(v));
  function asRGBA(color3) {
    const type = getColorType(color3);
    warning(Boolean(type), `'${color3}' is not an animatable color. Use the equivalent color code instead.`);
    if (!Boolean(type))
      return false;
    let model = type.parse(color3);
    if (type === hsla2) {
      model = hslaToRgba(model);
    }
    return model;
  }
  var mixColor = (from2, to) => {
    const fromRGBA = asRGBA(from2);
    const toRGBA = asRGBA(to);
    if (!fromRGBA || !toRGBA) {
      return mixImmediate(from2, to);
    }
    const blended = { ...fromRGBA };
    return (v) => {
      blended.red = mixLinearColor(fromRGBA.red, toRGBA.red, v);
      blended.green = mixLinearColor(fromRGBA.green, toRGBA.green, v);
      blended.blue = mixLinearColor(fromRGBA.blue, toRGBA.blue, v);
      blended.alpha = mixNumber(fromRGBA.alpha, toRGBA.alpha, v);
      return rgba2.transform(blended);
    };
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/pipe.mjs
  init_define_import_meta_env();
  var combineFunctions = (a, b) => (v) => b(a(v));
  var pipe2 = (...transformers) => transformers.reduce(combineFunctions);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/mix/visibility.mjs
  init_define_import_meta_env();
  var invisibleValues = /* @__PURE__ */ new Set(["none", "hidden"]);
  function mixVisibility(origin, target) {
    if (invisibleValues.has(origin)) {
      return (p) => p <= 0 ? origin : target;
    } else {
      return (p) => p >= 1 ? target : origin;
    }
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/mix/complex.mjs
  function mixNumber2(a, b) {
    return (p) => mixNumber(a, b, p);
  }
  function getMixer(a) {
    if (typeof a === "number") {
      return mixNumber2;
    } else if (typeof a === "string") {
      return isCSSVariableToken(a) ? mixImmediate : color2.test(a) ? mixColor : mixComplex;
    } else if (Array.isArray(a)) {
      return mixArray;
    } else if (typeof a === "object") {
      return color2.test(a) ? mixColor : mixObject;
    }
    return mixImmediate;
  }
  function mixArray(a, b) {
    const output = [...a];
    const numValues = output.length;
    const blendValue = a.map((v, i) => getMixer(v)(v, b[i]));
    return (p) => {
      for (let i = 0; i < numValues; i++) {
        output[i] = blendValue[i](p);
      }
      return output;
    };
  }
  function mixObject(a, b) {
    const output = { ...a, ...b };
    const blendValue = {};
    for (const key in output) {
      if (a[key] !== void 0 && b[key] !== void 0) {
        blendValue[key] = getMixer(a[key])(a[key], b[key]);
      }
    }
    return (v) => {
      for (const key in blendValue) {
        output[key] = blendValue[key](v);
      }
      return output;
    };
  }
  function matchOrder(origin, target) {
    var _a;
    const orderedOrigin = [];
    const pointers = { color: 0, var: 0, number: 0 };
    for (let i = 0; i < target.values.length; i++) {
      const type = target.types[i];
      const originIndex = origin.indexes[type][pointers[type]];
      const originValue = (_a = origin.values[originIndex]) !== null && _a !== void 0 ? _a : 0;
      orderedOrigin[i] = originValue;
      pointers[type]++;
    }
    return orderedOrigin;
  }
  var mixComplex = (origin, target) => {
    const template = complex.createTransformer(target);
    const originStats = analyseComplexValue(origin);
    const targetStats = analyseComplexValue(target);
    const canInterpolate = originStats.indexes.var.length === targetStats.indexes.var.length && originStats.indexes.color.length === targetStats.indexes.color.length && originStats.indexes.number.length >= targetStats.indexes.number.length;
    if (canInterpolate) {
      if (invisibleValues.has(origin) && !targetStats.values.length || invisibleValues.has(target) && !originStats.values.length) {
        return mixVisibility(origin, target);
      }
      return pipe2(mixArray(matchOrder(originStats, targetStats), targetStats.values), template);
    } else {
      warning(true, `Complex values '${origin}' and '${target}' too different to mix. Ensure all colors are of the same type, and that each contains the same quantity of number and color values. Falling back to instant transition.`);
      return mixImmediate(origin, target);
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/mix/index.mjs
  function mix2(from2, to, p) {
    if (typeof from2 === "number" && typeof to === "number" && typeof p === "number") {
      return mixNumber(from2, to, p);
    }
    const mixer = getMixer(from2);
    return mixer(from2, to);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/generators/inertia.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/generators/spring/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/generators/utils/velocity.mjs
  init_define_import_meta_env();
  var velocitySampleDuration = 5;
  function calcGeneratorVelocity(resolveValue, t2, current) {
    const prevT = Math.max(t2 - velocitySampleDuration, 0);
    return velocityPerSecond(current - resolveValue(prevT), t2 - prevT);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/generators/spring/defaults.mjs
  init_define_import_meta_env();
  var springDefaults = {
    // Default spring physics
    stiffness: 100,
    damping: 10,
    mass: 1,
    velocity: 0,
    // Default duration/bounce-based options
    duration: 800,
    // in ms
    bounce: 0.3,
    visualDuration: 0.3,
    // in seconds
    // Rest thresholds
    restSpeed: {
      granular: 0.01,
      default: 2
    },
    restDelta: {
      granular: 5e-3,
      default: 0.5
    },
    // Limits
    minDuration: 0.01,
    // in seconds
    maxDuration: 10,
    // in seconds
    minDamping: 0.05,
    maxDamping: 1
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/generators/spring/find.mjs
  init_define_import_meta_env();
  var safeMin = 1e-3;
  function findSpring({ duration = springDefaults.duration, bounce = springDefaults.bounce, velocity = springDefaults.velocity, mass = springDefaults.mass }) {
    let envelope;
    let derivative;
    warning(duration <= secondsToMilliseconds(springDefaults.maxDuration), "Spring duration must be 10 seconds or less");
    let dampingRatio = 1 - bounce;
    dampingRatio = clamp(springDefaults.minDamping, springDefaults.maxDamping, dampingRatio);
    duration = clamp(springDefaults.minDuration, springDefaults.maxDuration, millisecondsToSeconds(duration));
    if (dampingRatio < 1) {
      envelope = (undampedFreq2) => {
        const exponentialDecay = undampedFreq2 * dampingRatio;
        const delta = exponentialDecay * duration;
        const a = exponentialDecay - velocity;
        const b = calcAngularFreq(undampedFreq2, dampingRatio);
        const c = Math.exp(-delta);
        return safeMin - a / b * c;
      };
      derivative = (undampedFreq2) => {
        const exponentialDecay = undampedFreq2 * dampingRatio;
        const delta = exponentialDecay * duration;
        const d = delta * velocity + velocity;
        const e = Math.pow(dampingRatio, 2) * Math.pow(undampedFreq2, 2) * duration;
        const f = Math.exp(-delta);
        const g = calcAngularFreq(Math.pow(undampedFreq2, 2), dampingRatio);
        const factor = -envelope(undampedFreq2) + safeMin > 0 ? -1 : 1;
        return factor * ((d - e) * f) / g;
      };
    } else {
      envelope = (undampedFreq2) => {
        const a = Math.exp(-undampedFreq2 * duration);
        const b = (undampedFreq2 - velocity) * duration + 1;
        return -safeMin + a * b;
      };
      derivative = (undampedFreq2) => {
        const a = Math.exp(-undampedFreq2 * duration);
        const b = (velocity - undampedFreq2) * (duration * duration);
        return a * b;
      };
    }
    const initialGuess = 5 / duration;
    const undampedFreq = approximateRoot(envelope, derivative, initialGuess);
    duration = secondsToMilliseconds(duration);
    if (isNaN(undampedFreq)) {
      return {
        stiffness: springDefaults.stiffness,
        damping: springDefaults.damping,
        duration
      };
    } else {
      const stiffness = Math.pow(undampedFreq, 2) * mass;
      return {
        stiffness,
        damping: dampingRatio * 2 * Math.sqrt(mass * stiffness),
        duration
      };
    }
  }
  var rootIterations = 12;
  function approximateRoot(envelope, derivative, initialGuess) {
    let result = initialGuess;
    for (let i = 1; i < rootIterations; i++) {
      result = result - envelope(result) / derivative(result);
    }
    return result;
  }
  function calcAngularFreq(undampedFreq, dampingRatio) {
    return undampedFreq * Math.sqrt(1 - dampingRatio * dampingRatio);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/generators/spring/index.mjs
  var durationKeys = ["duration", "bounce"];
  var physicsKeys = ["stiffness", "damping", "mass"];
  function isSpringType(options, keys2) {
    return keys2.some((key) => options[key] !== void 0);
  }
  function getSpringOptions(options) {
    let springOptions = {
      velocity: springDefaults.velocity,
      stiffness: springDefaults.stiffness,
      damping: springDefaults.damping,
      mass: springDefaults.mass,
      isResolvedFromDuration: false,
      ...options
    };
    if (!isSpringType(options, physicsKeys) && isSpringType(options, durationKeys)) {
      if (options.visualDuration) {
        const visualDuration = options.visualDuration;
        const root = 2 * Math.PI / (visualDuration * 1.2);
        const stiffness = root * root;
        const damping = 2 * clamp(0.05, 1, 1 - (options.bounce || 0)) * Math.sqrt(stiffness);
        springOptions = {
          ...springOptions,
          mass: springDefaults.mass,
          stiffness,
          damping
        };
      } else {
        const derived = findSpring(options);
        springOptions = {
          ...springOptions,
          ...derived,
          mass: springDefaults.mass
        };
        springOptions.isResolvedFromDuration = true;
      }
    }
    return springOptions;
  }
  function spring(optionsOrVisualDuration = springDefaults.visualDuration, bounce = springDefaults.bounce) {
    const options = typeof optionsOrVisualDuration !== "object" ? {
      visualDuration: optionsOrVisualDuration,
      keyframes: [0, 1],
      bounce
    } : optionsOrVisualDuration;
    let { restSpeed, restDelta } = options;
    const origin = options.keyframes[0];
    const target = options.keyframes[options.keyframes.length - 1];
    const state2 = { done: false, value: origin };
    const { stiffness, damping, mass, duration, velocity, isResolvedFromDuration } = getSpringOptions({
      ...options,
      velocity: -millisecondsToSeconds(options.velocity || 0)
    });
    const initialVelocity = velocity || 0;
    const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));
    const initialDelta = target - origin;
    const undampedAngularFreq = millisecondsToSeconds(Math.sqrt(stiffness / mass));
    const isGranularScale = Math.abs(initialDelta) < 5;
    restSpeed || (restSpeed = isGranularScale ? springDefaults.restSpeed.granular : springDefaults.restSpeed.default);
    restDelta || (restDelta = isGranularScale ? springDefaults.restDelta.granular : springDefaults.restDelta.default);
    let resolveSpring;
    if (dampingRatio < 1) {
      const angularFreq = calcAngularFreq(undampedAngularFreq, dampingRatio);
      resolveSpring = (t2) => {
        const envelope = Math.exp(-dampingRatio * undampedAngularFreq * t2);
        return target - envelope * ((initialVelocity + dampingRatio * undampedAngularFreq * initialDelta) / angularFreq * Math.sin(angularFreq * t2) + initialDelta * Math.cos(angularFreq * t2));
      };
    } else if (dampingRatio === 1) {
      resolveSpring = (t2) => target - Math.exp(-undampedAngularFreq * t2) * (initialDelta + (initialVelocity + undampedAngularFreq * initialDelta) * t2);
    } else {
      const dampedAngularFreq = undampedAngularFreq * Math.sqrt(dampingRatio * dampingRatio - 1);
      resolveSpring = (t2) => {
        const envelope = Math.exp(-dampingRatio * undampedAngularFreq * t2);
        const freqForT = Math.min(dampedAngularFreq * t2, 300);
        return target - envelope * ((initialVelocity + dampingRatio * undampedAngularFreq * initialDelta) * Math.sinh(freqForT) + dampedAngularFreq * initialDelta * Math.cosh(freqForT)) / dampedAngularFreq;
      };
    }
    const generator = {
      calculatedDuration: isResolvedFromDuration ? duration || null : null,
      next: (t2) => {
        const current = resolveSpring(t2);
        if (!isResolvedFromDuration) {
          let currentVelocity = 0;
          if (dampingRatio < 1) {
            currentVelocity = t2 === 0 ? secondsToMilliseconds(initialVelocity) : calcGeneratorVelocity(resolveSpring, t2, current);
          }
          const isBelowVelocityThreshold = Math.abs(currentVelocity) <= restSpeed;
          const isBelowDisplacementThreshold = Math.abs(target - current) <= restDelta;
          state2.done = isBelowVelocityThreshold && isBelowDisplacementThreshold;
        } else {
          state2.done = t2 >= duration;
        }
        state2.value = state2.done ? target : current;
        return state2;
      },
      toString: () => {
        const calculatedDuration = Math.min(calcGeneratorDuration(generator), maxGeneratorDuration);
        const easing = generateLinearEasing((progress2) => generator.next(calculatedDuration * progress2).value, calculatedDuration, 30);
        return calculatedDuration + "ms " + easing;
      }
    };
    return generator;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/generators/inertia.mjs
  function inertia({ keyframes: keyframes3, velocity = 0, power = 0.8, timeConstant = 325, bounceDamping = 10, bounceStiffness = 500, modifyTarget, min, max, restDelta = 0.5, restSpeed }) {
    const origin = keyframes3[0];
    const state2 = {
      done: false,
      value: origin
    };
    const isOutOfBounds = (v) => min !== void 0 && v < min || max !== void 0 && v > max;
    const nearestBoundary = (v) => {
      if (min === void 0)
        return max;
      if (max === void 0)
        return min;
      return Math.abs(min - v) < Math.abs(max - v) ? min : max;
    };
    let amplitude = power * velocity;
    const ideal = origin + amplitude;
    const target = modifyTarget === void 0 ? ideal : modifyTarget(ideal);
    if (target !== ideal)
      amplitude = target - origin;
    const calcDelta = (t2) => -amplitude * Math.exp(-t2 / timeConstant);
    const calcLatest = (t2) => target + calcDelta(t2);
    const applyFriction = (t2) => {
      const delta = calcDelta(t2);
      const latest = calcLatest(t2);
      state2.done = Math.abs(delta) <= restDelta;
      state2.value = state2.done ? target : latest;
    };
    let timeReachedBoundary;
    let spring$1;
    const checkCatchBoundary = (t2) => {
      if (!isOutOfBounds(state2.value))
        return;
      timeReachedBoundary = t2;
      spring$1 = spring({
        keyframes: [state2.value, nearestBoundary(state2.value)],
        velocity: calcGeneratorVelocity(calcLatest, t2, state2.value),
        // TODO: This should be passing * 1000
        damping: bounceDamping,
        stiffness: bounceStiffness,
        restDelta,
        restSpeed
      });
    };
    checkCatchBoundary(0);
    return {
      calculatedDuration: null,
      next: (t2) => {
        let hasUpdatedFrame = false;
        if (!spring$1 && timeReachedBoundary === void 0) {
          hasUpdatedFrame = true;
          applyFriction(t2);
          checkCatchBoundary(t2);
        }
        if (timeReachedBoundary !== void 0 && t2 >= timeReachedBoundary) {
          return spring$1.next(t2 - timeReachedBoundary);
        } else {
          !hasUpdatedFrame && applyFriction(t2);
          return state2;
        }
      }
    };
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/generators/keyframes.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/easing/ease.mjs
  init_define_import_meta_env();
  var easeIn = /* @__PURE__ */ cubicBezier(0.42, 0, 1, 1);
  var easeOut = /* @__PURE__ */ cubicBezier(0, 0, 0.58, 1);
  var easeInOut = /* @__PURE__ */ cubicBezier(0.42, 0, 0.58, 1);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/easing/utils/is-easing-array.mjs
  init_define_import_meta_env();
  var isEasingArray = (ease2) => {
    return Array.isArray(ease2) && typeof ease2[0] !== "number";
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/easing/utils/map.mjs
  init_define_import_meta_env();
  var easingLookup = {
    linear: noop2,
    easeIn,
    easeInOut,
    easeOut,
    circIn,
    circInOut,
    circOut,
    backIn,
    backInOut,
    backOut,
    anticipate
  };
  var easingDefinitionToFunction = (definition) => {
    if (isBezierDefinition(definition)) {
      invariant(definition.length === 4, `Cubic bezier arrays must contain four numerical values.`);
      const [x1, y1, x2, y2] = definition;
      return cubicBezier(x1, y1, x2, y2);
    } else if (typeof definition === "string") {
      invariant(easingLookup[definition] !== void 0, `Invalid easing type '${definition}'`);
      return easingLookup[definition];
    }
    return definition;
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/interpolate.mjs
  init_define_import_meta_env();
  function createMixers(output, ease2, customMixer) {
    const mixers = [];
    const mixerFactory = customMixer || mix2;
    const numMixers = output.length - 1;
    for (let i = 0; i < numMixers; i++) {
      let mixer = mixerFactory(output[i], output[i + 1]);
      if (ease2) {
        const easingFunction = Array.isArray(ease2) ? ease2[i] || noop2 : ease2;
        mixer = pipe2(easingFunction, mixer);
      }
      mixers.push(mixer);
    }
    return mixers;
  }
  function interpolate(input, output, { clamp: isClamp = true, ease: ease2, mixer } = {}) {
    const inputLength = input.length;
    invariant(inputLength === output.length, "Both input and output ranges must be the same length");
    if (inputLength === 1)
      return () => output[0];
    if (inputLength === 2 && output[0] === output[1])
      return () => output[1];
    const isZeroDeltaRange = input[0] === input[1];
    if (input[0] > input[inputLength - 1]) {
      input = [...input].reverse();
      output = [...output].reverse();
    }
    const mixers = createMixers(output, ease2, mixer);
    const numMixers = mixers.length;
    const interpolator = (v) => {
      if (isZeroDeltaRange && v < input[0])
        return output[0];
      let i = 0;
      if (numMixers > 1) {
        for (; i < input.length - 2; i++) {
          if (v < input[i + 1])
            break;
        }
      }
      const progressInRange = progress(input[i], input[i + 1], v);
      return mixers[i](progressInRange);
    };
    return isClamp ? (v) => interpolator(clamp(input[0], input[inputLength - 1], v)) : interpolator;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/offsets/default.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/offsets/fill.mjs
  init_define_import_meta_env();
  function fillOffset(offset, remaining) {
    const min = offset[offset.length - 1];
    for (let i = 1; i <= remaining; i++) {
      const offsetProgress = progress(0, remaining, i);
      offset.push(mixNumber(min, 1, offsetProgress));
    }
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/offsets/default.mjs
  function defaultOffset(arr) {
    const offset = [0];
    fillOffset(offset, arr.length - 1);
    return offset;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/offsets/time.mjs
  init_define_import_meta_env();
  function convertOffsetToTimes(offset, duration) {
    return offset.map((o) => o * duration);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/generators/keyframes.mjs
  function defaultEasing(values, easing) {
    return values.map(() => easing || easeInOut).splice(0, values.length - 1);
  }
  function keyframes2({ duration = 300, keyframes: keyframeValues, times, ease: ease2 = "easeInOut" }) {
    const easingFunctions = isEasingArray(ease2) ? ease2.map(easingDefinitionToFunction) : easingDefinitionToFunction(ease2);
    const state2 = {
      done: false,
      value: keyframeValues[0]
    };
    const absoluteTimes = convertOffsetToTimes(
      // Only use the provided offsets if they're the correct length
      // TODO Maybe we should warn here if there's a length mismatch
      times && times.length === keyframeValues.length ? times : defaultOffset(keyframeValues),
      duration
    );
    const mapTimeToKeyframe = interpolate(absoluteTimes, keyframeValues, {
      ease: Array.isArray(easingFunctions) ? easingFunctions : defaultEasing(keyframeValues, easingFunctions)
    });
    return {
      calculatedDuration: duration,
      next: (t2) => {
        state2.value = mapTimeToKeyframe(t2);
        state2.done = t2 >= duration;
        return state2;
      }
    };
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/animators/drivers/driver-frameloop.mjs
  init_define_import_meta_env();
  var frameloopDriver = (update) => {
    const passTimestamp = ({ timestamp }) => update(timestamp);
    return {
      start: () => frame.update(passTimestamp, true),
      stop: () => cancelFrame(passTimestamp),
      /**
       * If we're processing this frame we can use the
       * framelocked timestamp to keep things in sync.
       */
      now: () => frameData.isProcessing ? frameData.timestamp : time.now()
    };
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/animators/MainThreadAnimation.mjs
  var generators = {
    decay: inertia,
    inertia,
    tween: keyframes2,
    keyframes: keyframes2,
    spring
  };
  var percentToProgress = (percent2) => percent2 / 100;
  var MainThreadAnimation = class extends BaseAnimation {
    constructor(options) {
      super(options);
      this.holdTime = null;
      this.cancelTime = null;
      this.currentTime = 0;
      this.playbackSpeed = 1;
      this.pendingPlayState = "running";
      this.startTime = null;
      this.state = "idle";
      this.stop = () => {
        this.resolver.cancel();
        this.isStopped = true;
        if (this.state === "idle")
          return;
        this.teardown();
        const { onStop } = this.options;
        onStop && onStop();
      };
      const { name, motionValue: motionValue2, element, keyframes: keyframes3 } = this.options;
      const KeyframeResolver$1 = (element === null || element === void 0 ? void 0 : element.KeyframeResolver) || KeyframeResolver;
      const onResolved = (resolvedKeyframes, finalKeyframe) => this.onKeyframesResolved(resolvedKeyframes, finalKeyframe);
      this.resolver = new KeyframeResolver$1(keyframes3, onResolved, name, motionValue2, element);
      this.resolver.scheduleResolve();
    }
    flatten() {
      super.flatten();
      if (this._resolved) {
        Object.assign(this._resolved, this.initPlayback(this._resolved.keyframes));
      }
    }
    initPlayback(keyframes$1) {
      const { type = "keyframes", repeat = 0, repeatDelay = 0, repeatType, velocity = 0 } = this.options;
      const generatorFactory = isGenerator(type) ? type : generators[type] || keyframes2;
      let mapPercentToKeyframes;
      let mirroredGenerator;
      if (generatorFactory !== keyframes2 && typeof keyframes$1[0] !== "number") {
        if (true) {
          invariant(keyframes$1.length === 2, `Only two keyframes currently supported with spring and inertia animations. Trying to animate ${keyframes$1}`);
        }
        mapPercentToKeyframes = pipe2(percentToProgress, mix2(keyframes$1[0], keyframes$1[1]));
        keyframes$1 = [0, 100];
      }
      const generator = generatorFactory({ ...this.options, keyframes: keyframes$1 });
      if (repeatType === "mirror") {
        mirroredGenerator = generatorFactory({
          ...this.options,
          keyframes: [...keyframes$1].reverse(),
          velocity: -velocity
        });
      }
      if (generator.calculatedDuration === null) {
        generator.calculatedDuration = calcGeneratorDuration(generator);
      }
      const { calculatedDuration } = generator;
      const resolvedDuration = calculatedDuration + repeatDelay;
      const totalDuration = resolvedDuration * (repeat + 1) - repeatDelay;
      return {
        generator,
        mirroredGenerator,
        mapPercentToKeyframes,
        calculatedDuration,
        resolvedDuration,
        totalDuration
      };
    }
    onPostResolved() {
      const { autoplay = true } = this.options;
      this.play();
      if (this.pendingPlayState === "paused" || !autoplay) {
        this.pause();
      } else {
        this.state = this.pendingPlayState;
      }
    }
    tick(timestamp, sample = false) {
      const { resolved } = this;
      if (!resolved) {
        const { keyframes: keyframes4 } = this.options;
        return { done: true, value: keyframes4[keyframes4.length - 1] };
      }
      const { finalKeyframe, generator, mirroredGenerator, mapPercentToKeyframes, keyframes: keyframes3, calculatedDuration, totalDuration, resolvedDuration } = resolved;
      if (this.startTime === null)
        return generator.next(0);
      const { delay: delay2, repeat, repeatType, repeatDelay, onUpdate } = this.options;
      if (this.speed > 0) {
        this.startTime = Math.min(this.startTime, timestamp);
      } else if (this.speed < 0) {
        this.startTime = Math.min(timestamp - totalDuration / this.speed, this.startTime);
      }
      if (sample) {
        this.currentTime = timestamp;
      } else if (this.holdTime !== null) {
        this.currentTime = this.holdTime;
      } else {
        this.currentTime = Math.round(timestamp - this.startTime) * this.speed;
      }
      const timeWithoutDelay = this.currentTime - delay2 * (this.speed >= 0 ? 1 : -1);
      const isInDelayPhase = this.speed >= 0 ? timeWithoutDelay < 0 : timeWithoutDelay > totalDuration;
      this.currentTime = Math.max(timeWithoutDelay, 0);
      if (this.state === "finished" && this.holdTime === null) {
        this.currentTime = totalDuration;
      }
      let elapsed = this.currentTime;
      let frameGenerator = generator;
      if (repeat) {
        const progress2 = Math.min(this.currentTime, totalDuration) / resolvedDuration;
        let currentIteration = Math.floor(progress2);
        let iterationProgress = progress2 % 1;
        if (!iterationProgress && progress2 >= 1) {
          iterationProgress = 1;
        }
        iterationProgress === 1 && currentIteration--;
        currentIteration = Math.min(currentIteration, repeat + 1);
        const isOddIteration = Boolean(currentIteration % 2);
        if (isOddIteration) {
          if (repeatType === "reverse") {
            iterationProgress = 1 - iterationProgress;
            if (repeatDelay) {
              iterationProgress -= repeatDelay / resolvedDuration;
            }
          } else if (repeatType === "mirror") {
            frameGenerator = mirroredGenerator;
          }
        }
        elapsed = clamp(0, 1, iterationProgress) * resolvedDuration;
      }
      const state2 = isInDelayPhase ? { done: false, value: keyframes3[0] } : frameGenerator.next(elapsed);
      if (mapPercentToKeyframes) {
        state2.value = mapPercentToKeyframes(state2.value);
      }
      let { done } = state2;
      if (!isInDelayPhase && calculatedDuration !== null) {
        done = this.speed >= 0 ? this.currentTime >= totalDuration : this.currentTime <= 0;
      }
      const isAnimationFinished = this.holdTime === null && (this.state === "finished" || this.state === "running" && done);
      if (isAnimationFinished && finalKeyframe !== void 0) {
        state2.value = getFinalKeyframe(keyframes3, this.options, finalKeyframe);
      }
      if (onUpdate) {
        onUpdate(state2.value);
      }
      if (isAnimationFinished) {
        this.finish();
      }
      return state2;
    }
    get duration() {
      const { resolved } = this;
      return resolved ? millisecondsToSeconds(resolved.calculatedDuration) : 0;
    }
    get time() {
      return millisecondsToSeconds(this.currentTime);
    }
    set time(newTime) {
      newTime = secondsToMilliseconds(newTime);
      this.currentTime = newTime;
      if (this.holdTime !== null || this.speed === 0) {
        this.holdTime = newTime;
      } else if (this.driver) {
        this.startTime = this.driver.now() - newTime / this.speed;
      }
    }
    get speed() {
      return this.playbackSpeed;
    }
    set speed(newSpeed) {
      const hasChanged = this.playbackSpeed !== newSpeed;
      this.playbackSpeed = newSpeed;
      if (hasChanged) {
        this.time = millisecondsToSeconds(this.currentTime);
      }
    }
    play() {
      if (!this.resolver.isScheduled) {
        this.resolver.resume();
      }
      if (!this._resolved) {
        this.pendingPlayState = "running";
        return;
      }
      if (this.isStopped)
        return;
      const { driver = frameloopDriver, onPlay, startTime } = this.options;
      if (!this.driver) {
        this.driver = driver((timestamp) => this.tick(timestamp));
      }
      onPlay && onPlay();
      const now2 = this.driver.now();
      if (this.holdTime !== null) {
        this.startTime = now2 - this.holdTime;
      } else if (!this.startTime) {
        this.startTime = startTime !== null && startTime !== void 0 ? startTime : this.calcStartTime();
      } else if (this.state === "finished") {
        this.startTime = now2;
      }
      if (this.state === "finished") {
        this.updateFinishedPromise();
      }
      this.cancelTime = this.startTime;
      this.holdTime = null;
      this.state = "running";
      this.driver.start();
    }
    pause() {
      var _a;
      if (!this._resolved) {
        this.pendingPlayState = "paused";
        return;
      }
      this.state = "paused";
      this.holdTime = (_a = this.currentTime) !== null && _a !== void 0 ? _a : 0;
    }
    complete() {
      if (this.state !== "running") {
        this.play();
      }
      this.pendingPlayState = this.state = "finished";
      this.holdTime = null;
    }
    finish() {
      this.teardown();
      this.state = "finished";
      const { onComplete } = this.options;
      onComplete && onComplete();
    }
    cancel() {
      if (this.cancelTime !== null) {
        this.tick(this.cancelTime);
      }
      this.teardown();
      this.updateFinishedPromise();
    }
    teardown() {
      this.state = "idle";
      this.stopDriver();
      this.resolveFinishedPromise();
      this.updateFinishedPromise();
      this.startTime = this.cancelTime = null;
      this.resolver.cancel();
    }
    stopDriver() {
      if (!this.driver)
        return;
      this.driver.stop();
      this.driver = void 0;
    }
    sample(time2) {
      this.startTime = 0;
      return this.tick(time2, true);
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/animators/utils/accelerated-values.mjs
  init_define_import_meta_env();
  var acceleratedValues = /* @__PURE__ */ new Set([
    "opacity",
    "clipPath",
    "filter",
    "transform"
    // TODO: Can be accelerated but currently disabled until https://issues.chromium.org/issues/41491098 is resolved
    // or until we implement support for linear() easing.
    // "background-color"
  ]);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/animators/waapi/index.mjs
  init_define_import_meta_env();
  function startWaapiAnimation(element, valueName, keyframes3, { delay: delay2 = 0, duration = 300, repeat = 0, repeatType = "loop", ease: ease2 = "easeInOut", times } = {}) {
    const keyframeOptions = { [valueName]: keyframes3 };
    if (times)
      keyframeOptions.offset = times;
    const easing = mapEasingToNativeEasing(ease2, duration);
    if (Array.isArray(easing))
      keyframeOptions.easing = easing;
    return element.animate(keyframeOptions, {
      delay: delay2,
      duration,
      easing: !Array.isArray(easing) ? easing : "linear",
      fill: "both",
      iterations: repeat + 1,
      direction: repeatType === "reverse" ? "alternate" : "normal"
    });
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/animators/waapi/utils/supports-waapi.mjs
  init_define_import_meta_env();
  var supportsWaapi = /* @__PURE__ */ memo(() => Object.hasOwnProperty.call(Element.prototype, "animate"));

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/animators/AcceleratedAnimation.mjs
  var sampleDelta = 10;
  var maxDuration = 2e4;
  function requiresPregeneratedKeyframes(options) {
    return isGenerator(options.type) || options.type === "spring" || !isWaapiSupportedEasing(options.ease);
  }
  function pregenerateKeyframes(keyframes3, options) {
    const sampleAnimation = new MainThreadAnimation({
      ...options,
      keyframes: keyframes3,
      repeat: 0,
      delay: 0,
      isGenerator: true
    });
    let state2 = { done: false, value: keyframes3[0] };
    const pregeneratedKeyframes = [];
    let t2 = 0;
    while (!state2.done && t2 < maxDuration) {
      state2 = sampleAnimation.sample(t2);
      pregeneratedKeyframes.push(state2.value);
      t2 += sampleDelta;
    }
    return {
      times: void 0,
      keyframes: pregeneratedKeyframes,
      duration: t2 - sampleDelta,
      ease: "linear"
    };
  }
  var unsupportedEasingFunctions = {
    anticipate,
    backInOut,
    circInOut
  };
  function isUnsupportedEase(key) {
    return key in unsupportedEasingFunctions;
  }
  var AcceleratedAnimation = class extends BaseAnimation {
    constructor(options) {
      super(options);
      const { name, motionValue: motionValue2, element, keyframes: keyframes3 } = this.options;
      this.resolver = new DOMKeyframesResolver(keyframes3, (resolvedKeyframes, finalKeyframe) => this.onKeyframesResolved(resolvedKeyframes, finalKeyframe), name, motionValue2, element);
      this.resolver.scheduleResolve();
    }
    initPlayback(keyframes3, finalKeyframe) {
      let { duration = 300, times, ease: ease2, type, motionValue: motionValue2, name, startTime } = this.options;
      if (!motionValue2.owner || !motionValue2.owner.current) {
        return false;
      }
      if (typeof ease2 === "string" && supportsLinearEasing() && isUnsupportedEase(ease2)) {
        ease2 = unsupportedEasingFunctions[ease2];
      }
      if (requiresPregeneratedKeyframes(this.options)) {
        const { onComplete, onUpdate, motionValue: motionValue3, element, ...options } = this.options;
        const pregeneratedAnimation = pregenerateKeyframes(keyframes3, options);
        keyframes3 = pregeneratedAnimation.keyframes;
        if (keyframes3.length === 1) {
          keyframes3[1] = keyframes3[0];
        }
        duration = pregeneratedAnimation.duration;
        times = pregeneratedAnimation.times;
        ease2 = pregeneratedAnimation.ease;
        type = "keyframes";
      }
      const animation = startWaapiAnimation(motionValue2.owner.current, name, keyframes3, { ...this.options, duration, times, ease: ease2 });
      animation.startTime = startTime !== null && startTime !== void 0 ? startTime : this.calcStartTime();
      if (this.pendingTimeline) {
        attachTimeline(animation, this.pendingTimeline);
        this.pendingTimeline = void 0;
      } else {
        animation.onfinish = () => {
          const { onComplete } = this.options;
          motionValue2.set(getFinalKeyframe(keyframes3, this.options, finalKeyframe));
          onComplete && onComplete();
          this.cancel();
          this.resolveFinishedPromise();
        };
      }
      return {
        animation,
        duration,
        times,
        type,
        ease: ease2,
        keyframes: keyframes3
      };
    }
    get duration() {
      const { resolved } = this;
      if (!resolved)
        return 0;
      const { duration } = resolved;
      return millisecondsToSeconds(duration);
    }
    get time() {
      const { resolved } = this;
      if (!resolved)
        return 0;
      const { animation } = resolved;
      return millisecondsToSeconds(animation.currentTime || 0);
    }
    set time(newTime) {
      const { resolved } = this;
      if (!resolved)
        return;
      const { animation } = resolved;
      animation.currentTime = secondsToMilliseconds(newTime);
    }
    get speed() {
      const { resolved } = this;
      if (!resolved)
        return 1;
      const { animation } = resolved;
      return animation.playbackRate;
    }
    set speed(newSpeed) {
      const { resolved } = this;
      if (!resolved)
        return;
      const { animation } = resolved;
      animation.playbackRate = newSpeed;
    }
    get state() {
      const { resolved } = this;
      if (!resolved)
        return "idle";
      const { animation } = resolved;
      return animation.playState;
    }
    get startTime() {
      const { resolved } = this;
      if (!resolved)
        return null;
      const { animation } = resolved;
      return animation.startTime;
    }
    /**
     * Replace the default DocumentTimeline with another AnimationTimeline.
     * Currently used for scroll animations.
     */
    attachTimeline(timeline) {
      if (!this._resolved) {
        this.pendingTimeline = timeline;
      } else {
        const { resolved } = this;
        if (!resolved)
          return noop2;
        const { animation } = resolved;
        attachTimeline(animation, timeline);
      }
      return noop2;
    }
    play() {
      if (this.isStopped)
        return;
      const { resolved } = this;
      if (!resolved)
        return;
      const { animation } = resolved;
      if (animation.playState === "finished") {
        this.updateFinishedPromise();
      }
      animation.play();
    }
    pause() {
      const { resolved } = this;
      if (!resolved)
        return;
      const { animation } = resolved;
      animation.pause();
    }
    stop() {
      this.resolver.cancel();
      this.isStopped = true;
      if (this.state === "idle")
        return;
      this.resolveFinishedPromise();
      this.updateFinishedPromise();
      const { resolved } = this;
      if (!resolved)
        return;
      const { animation, keyframes: keyframes3, duration, type, ease: ease2, times } = resolved;
      if (animation.playState === "idle" || animation.playState === "finished") {
        return;
      }
      if (this.time) {
        const { motionValue: motionValue2, onUpdate, onComplete, element, ...options } = this.options;
        const sampleAnimation = new MainThreadAnimation({
          ...options,
          keyframes: keyframes3,
          duration,
          type,
          ease: ease2,
          times,
          isGenerator: true
        });
        const sampleTime = secondsToMilliseconds(this.time);
        motionValue2.setWithVelocity(sampleAnimation.sample(sampleTime - sampleDelta).value, sampleAnimation.sample(sampleTime).value, sampleDelta);
      }
      const { onStop } = this.options;
      onStop && onStop();
      this.cancel();
    }
    complete() {
      const { resolved } = this;
      if (!resolved)
        return;
      resolved.animation.finish();
    }
    cancel() {
      const { resolved } = this;
      if (!resolved)
        return;
      resolved.animation.cancel();
    }
    static supports(options) {
      const { motionValue: motionValue2, name, repeatDelay, repeatType, damping, type } = options;
      if (!motionValue2 || !motionValue2.owner || !(motionValue2.owner.current instanceof HTMLElement)) {
        return false;
      }
      const { onUpdate, transformTemplate: transformTemplate2 } = motionValue2.owner.getProps();
      return supportsWaapi() && name && acceleratedValues.has(name) && /**
       * If we're outputting values to onUpdate then we can't use WAAPI as there's
       * no way to read the value from WAAPI every frame.
       */
      !onUpdate && !transformTemplate2 && !repeatDelay && repeatType !== "mirror" && damping !== 0 && type !== "inertia";
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/utils/default-transitions.mjs
  init_define_import_meta_env();
  var underDampedSpring = {
    type: "spring",
    stiffness: 500,
    damping: 25,
    restSpeed: 10
  };
  var criticallyDampedSpring = (target) => ({
    type: "spring",
    stiffness: 550,
    damping: target === 0 ? 2 * Math.sqrt(550) : 30,
    restSpeed: 10
  });
  var keyframesTransition = {
    type: "keyframes",
    duration: 0.8
  };
  var ease = {
    type: "keyframes",
    ease: [0.25, 0.1, 0.35, 1],
    duration: 0.3
  };
  var getDefaultTransition = (valueKey, { keyframes: keyframes3 }) => {
    if (keyframes3.length > 2) {
      return keyframesTransition;
    } else if (transformProps.has(valueKey)) {
      return valueKey.startsWith("scale") ? criticallyDampedSpring(keyframes3[1]) : underDampedSpring;
    }
    return ease;
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/utils/is-transition-defined.mjs
  init_define_import_meta_env();
  function isTransitionDefined({ when, delay: _delay, delayChildren, staggerChildren, staggerDirection, repeat, repeatType, repeatDelay, from: from2, elapsed, ...transition3 }) {
    return !!Object.keys(transition3).length;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/interfaces/motion-value.mjs
  var animateMotionValue = (name, value, target, transition3 = {}, element, isHandoff) => (onComplete) => {
    const valueTransition = getValueTransition(transition3, name) || {};
    const delay2 = valueTransition.delay || transition3.delay || 0;
    let { elapsed = 0 } = transition3;
    elapsed = elapsed - secondsToMilliseconds(delay2);
    let options = {
      keyframes: Array.isArray(target) ? target : [null, target],
      ease: "easeOut",
      velocity: value.getVelocity(),
      ...valueTransition,
      delay: -elapsed,
      onUpdate: (v) => {
        value.set(v);
        valueTransition.onUpdate && valueTransition.onUpdate(v);
      },
      onComplete: () => {
        onComplete();
        valueTransition.onComplete && valueTransition.onComplete();
      },
      name,
      motionValue: value,
      element: isHandoff ? void 0 : element
    };
    if (!isTransitionDefined(valueTransition)) {
      options = {
        ...options,
        ...getDefaultTransition(name, options)
      };
    }
    if (options.duration) {
      options.duration = secondsToMilliseconds(options.duration);
    }
    if (options.repeatDelay) {
      options.repeatDelay = secondsToMilliseconds(options.repeatDelay);
    }
    if (options.from !== void 0) {
      options.keyframes[0] = options.from;
    }
    let shouldSkip = false;
    if (options.type === false || options.duration === 0 && !options.repeatDelay) {
      options.duration = 0;
      if (options.delay === 0) {
        shouldSkip = true;
      }
    }
    if (instantAnimationState.current || MotionGlobalConfig.skipAnimations) {
      shouldSkip = true;
      options.duration = 0;
      options.delay = 0;
    }
    if (shouldSkip && !isHandoff && value.get() !== void 0) {
      const finalKeyframe = getFinalKeyframe(options.keyframes, valueTransition);
      if (finalKeyframe !== void 0) {
        frame.update(() => {
          options.onUpdate(finalKeyframe);
          options.onComplete();
        });
        return new GroupPlaybackControls([]);
      }
    }
    if (!isHandoff && AcceleratedAnimation.supports(options)) {
      return new AcceleratedAnimation(options);
    } else {
      return new MainThreadAnimation(options);
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/interfaces/visual-element-target.mjs
  function shouldBlockAnimation({ protectedKeys, needsAnimating }, key) {
    const shouldBlock = protectedKeys.hasOwnProperty(key) && needsAnimating[key] !== true;
    needsAnimating[key] = false;
    return shouldBlock;
  }
  function animateTarget(visualElement, targetAndTransition, { delay: delay2 = 0, transitionOverride, type } = {}) {
    var _a;
    let { transition: transition3 = visualElement.getDefaultTransition(), transitionEnd, ...target } = targetAndTransition;
    if (transitionOverride)
      transition3 = transitionOverride;
    const animations2 = [];
    const animationTypeState = type && visualElement.animationState && visualElement.animationState.getState()[type];
    for (const key in target) {
      const value = visualElement.getValue(key, (_a = visualElement.latestValues[key]) !== null && _a !== void 0 ? _a : null);
      const valueTarget = target[key];
      if (valueTarget === void 0 || animationTypeState && shouldBlockAnimation(animationTypeState, key)) {
        continue;
      }
      const valueTransition = {
        delay: delay2,
        ...getValueTransition(transition3 || {}, key)
      };
      let isHandoff = false;
      if (window.MotionHandoffAnimation) {
        const appearId = getOptimisedAppearId(visualElement);
        if (appearId) {
          const startTime = window.MotionHandoffAnimation(appearId, key, frame);
          if (startTime !== null) {
            valueTransition.startTime = startTime;
            isHandoff = true;
          }
        }
      }
      addValueToWillChange(visualElement, key);
      value.start(animateMotionValue(key, value, valueTarget, visualElement.shouldReduceMotion && positionalKeys.has(key) ? { type: false } : valueTransition, visualElement, isHandoff));
      const animation = value.animation;
      if (animation) {
        animations2.push(animation);
      }
    }
    if (transitionEnd) {
      Promise.all(animations2).then(() => {
        frame.update(() => {
          transitionEnd && setTarget(visualElement, transitionEnd);
        });
      });
    }
    return animations2;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/interfaces/visual-element-variant.mjs
  init_define_import_meta_env();
  function animateVariant(visualElement, variant, options = {}) {
    var _a;
    const resolved = resolveVariant(visualElement, variant, options.type === "exit" ? (_a = visualElement.presenceContext) === null || _a === void 0 ? void 0 : _a.custom : void 0);
    let { transition: transition3 = visualElement.getDefaultTransition() || {} } = resolved || {};
    if (options.transitionOverride) {
      transition3 = options.transitionOverride;
    }
    const getAnimation = resolved ? () => Promise.all(animateTarget(visualElement, resolved, options)) : () => Promise.resolve();
    const getChildAnimations = visualElement.variantChildren && visualElement.variantChildren.size ? (forwardDelay = 0) => {
      const { delayChildren = 0, staggerChildren, staggerDirection } = transition3;
      return animateChildren(visualElement, variant, delayChildren + forwardDelay, staggerChildren, staggerDirection, options);
    } : () => Promise.resolve();
    const { when } = transition3;
    if (when) {
      const [first, last] = when === "beforeChildren" ? [getAnimation, getChildAnimations] : [getChildAnimations, getAnimation];
      return first().then(() => last());
    } else {
      return Promise.all([getAnimation(), getChildAnimations(options.delay)]);
    }
  }
  function animateChildren(visualElement, variant, delayChildren = 0, staggerChildren = 0, staggerDirection = 1, options) {
    const animations2 = [];
    const maxStaggerDuration = (visualElement.variantChildren.size - 1) * staggerChildren;
    const generateStaggerDuration = staggerDirection === 1 ? (i = 0) => i * staggerChildren : (i = 0) => maxStaggerDuration - i * staggerChildren;
    Array.from(visualElement.variantChildren).sort(sortByTreeOrder).forEach((child, i) => {
      child.notify("AnimationStart", variant);
      animations2.push(animateVariant(child, variant, {
        ...options,
        delay: delayChildren + generateStaggerDuration(i)
      }).then(() => child.notify("AnimationComplete", variant)));
    });
    return Promise.all(animations2);
  }
  function sortByTreeOrder(a, b) {
    return a.sortNodePosition(b);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/interfaces/visual-element.mjs
  function animateVisualElement(visualElement, definition, options = {}) {
    visualElement.notify("AnimationStart", definition);
    let animation;
    if (Array.isArray(definition)) {
      const animations2 = definition.map((variant) => animateVariant(visualElement, variant, options));
      animation = Promise.all(animations2);
    } else if (typeof definition === "string") {
      animation = animateVariant(visualElement, definition, options);
    } else {
      const resolvedDefinition = typeof definition === "function" ? resolveVariant(visualElement, definition, options.custom) : definition;
      animation = Promise.all(animateTarget(visualElement, resolvedDefinition, options));
    }
    return animation.then(() => {
      visualElement.notify("AnimationComplete", definition);
    });
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/utils/get-variant-context.mjs
  init_define_import_meta_env();
  var numVariantProps = variantProps.length;
  function getVariantContext(visualElement) {
    if (!visualElement)
      return void 0;
    if (!visualElement.isControllingVariants) {
      const context2 = visualElement.parent ? getVariantContext(visualElement.parent) || {} : {};
      if (visualElement.props.initial !== void 0) {
        context2.initial = visualElement.props.initial;
      }
      return context2;
    }
    const context = {};
    for (let i = 0; i < numVariantProps; i++) {
      const name = variantProps[i];
      const prop = visualElement.props[name];
      if (isVariantLabel(prop) || prop === false) {
        context[name] = prop;
      }
    }
    return context;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/utils/animation-state.mjs
  var reversePriorityOrder = [...variantPriorityOrder].reverse();
  var numAnimationTypes = variantPriorityOrder.length;
  function animateList(visualElement) {
    return (animations2) => Promise.all(animations2.map(({ animation, options }) => animateVisualElement(visualElement, animation, options)));
  }
  function createAnimationState(visualElement) {
    let animate = animateList(visualElement);
    let state2 = createState();
    let isInitialRender = true;
    const buildResolvedTypeValues = (type) => (acc, definition) => {
      var _a;
      const resolved = resolveVariant(visualElement, definition, type === "exit" ? (_a = visualElement.presenceContext) === null || _a === void 0 ? void 0 : _a.custom : void 0);
      if (resolved) {
        const { transition: transition3, transitionEnd, ...target } = resolved;
        acc = { ...acc, ...target, ...transitionEnd };
      }
      return acc;
    };
    function setAnimateFunction(makeAnimator) {
      animate = makeAnimator(visualElement);
    }
    function animateChanges(changedActiveType) {
      const { props } = visualElement;
      const context = getVariantContext(visualElement.parent) || {};
      const animations2 = [];
      const removedKeys = /* @__PURE__ */ new Set();
      let encounteredKeys = {};
      let removedVariantIndex = Infinity;
      for (let i = 0; i < numAnimationTypes; i++) {
        const type = reversePriorityOrder[i];
        const typeState = state2[type];
        const prop = props[type] !== void 0 ? props[type] : context[type];
        const propIsVariant = isVariantLabel(prop);
        const activeDelta = type === changedActiveType ? typeState.isActive : null;
        if (activeDelta === false)
          removedVariantIndex = i;
        let isInherited = prop === context[type] && prop !== props[type] && propIsVariant;
        if (isInherited && isInitialRender && visualElement.manuallyAnimateOnMount) {
          isInherited = false;
        }
        typeState.protectedKeys = { ...encounteredKeys };
        if (
          // If it isn't active and hasn't *just* been set as inactive
          !typeState.isActive && activeDelta === null || // If we didn't and don't have any defined prop for this animation type
          !prop && !typeState.prevProp || // Or if the prop doesn't define an animation
          isAnimationControls(prop) || typeof prop === "boolean"
        ) {
          continue;
        }
        const variantDidChange = checkVariantsDidChange(typeState.prevProp, prop);
        let shouldAnimateType = variantDidChange || // If we're making this variant active, we want to always make it active
        type === changedActiveType && typeState.isActive && !isInherited && propIsVariant || // If we removed a higher-priority variant (i is in reverse order)
        i > removedVariantIndex && propIsVariant;
        let handledRemovedValues = false;
        const definitionList = Array.isArray(prop) ? prop : [prop];
        let resolvedValues = definitionList.reduce(buildResolvedTypeValues(type), {});
        if (activeDelta === false)
          resolvedValues = {};
        const { prevResolvedValues = {} } = typeState;
        const allKeys = {
          ...prevResolvedValues,
          ...resolvedValues
        };
        const markToAnimate = (key) => {
          shouldAnimateType = true;
          if (removedKeys.has(key)) {
            handledRemovedValues = true;
            removedKeys.delete(key);
          }
          typeState.needsAnimating[key] = true;
          const motionValue2 = visualElement.getValue(key);
          if (motionValue2)
            motionValue2.liveStyle = false;
        };
        for (const key in allKeys) {
          const next2 = resolvedValues[key];
          const prev2 = prevResolvedValues[key];
          if (encounteredKeys.hasOwnProperty(key))
            continue;
          let valueHasChanged = false;
          if (isKeyframesTarget(next2) && isKeyframesTarget(prev2)) {
            valueHasChanged = !shallowCompare(next2, prev2);
          } else {
            valueHasChanged = next2 !== prev2;
          }
          if (valueHasChanged) {
            if (next2 !== void 0 && next2 !== null) {
              markToAnimate(key);
            } else {
              removedKeys.add(key);
            }
          } else if (next2 !== void 0 && removedKeys.has(key)) {
            markToAnimate(key);
          } else {
            typeState.protectedKeys[key] = true;
          }
        }
        typeState.prevProp = prop;
        typeState.prevResolvedValues = resolvedValues;
        if (typeState.isActive) {
          encounteredKeys = { ...encounteredKeys, ...resolvedValues };
        }
        if (isInitialRender && visualElement.blockInitialAnimation) {
          shouldAnimateType = false;
        }
        const willAnimateViaParent = isInherited && variantDidChange;
        const needsAnimating = !willAnimateViaParent || handledRemovedValues;
        if (shouldAnimateType && needsAnimating) {
          animations2.push(...definitionList.map((animation) => ({
            animation,
            options: { type }
          })));
        }
      }
      if (removedKeys.size) {
        const fallbackAnimation = {};
        removedKeys.forEach((key) => {
          const fallbackTarget = visualElement.getBaseTarget(key);
          const motionValue2 = visualElement.getValue(key);
          if (motionValue2)
            motionValue2.liveStyle = true;
          fallbackAnimation[key] = fallbackTarget !== null && fallbackTarget !== void 0 ? fallbackTarget : null;
        });
        animations2.push({ animation: fallbackAnimation });
      }
      let shouldAnimate = Boolean(animations2.length);
      if (isInitialRender && (props.initial === false || props.initial === props.animate) && !visualElement.manuallyAnimateOnMount) {
        shouldAnimate = false;
      }
      isInitialRender = false;
      return shouldAnimate ? animate(animations2) : Promise.resolve();
    }
    function setActive(type, isActive) {
      var _a;
      if (state2[type].isActive === isActive)
        return Promise.resolve();
      (_a = visualElement.variantChildren) === null || _a === void 0 ? void 0 : _a.forEach((child) => {
        var _a2;
        return (_a2 = child.animationState) === null || _a2 === void 0 ? void 0 : _a2.setActive(type, isActive);
      });
      state2[type].isActive = isActive;
      const animations2 = animateChanges(type);
      for (const key in state2) {
        state2[key].protectedKeys = {};
      }
      return animations2;
    }
    return {
      animateChanges,
      setActive,
      setAnimateFunction,
      getState: () => state2,
      reset: () => {
        state2 = createState();
        isInitialRender = true;
      }
    };
  }
  function checkVariantsDidChange(prev2, next2) {
    if (typeof next2 === "string") {
      return next2 !== prev2;
    } else if (Array.isArray(next2)) {
      return !shallowCompare(next2, prev2);
    }
    return false;
  }
  function createTypeState(isActive = false) {
    return {
      isActive,
      protectedKeys: {},
      needsAnimating: {},
      prevResolvedValues: {}
    };
  }
  function createState() {
    return {
      animate: createTypeState(true),
      whileInView: createTypeState(),
      whileHover: createTypeState(),
      whileTap: createTypeState(),
      whileDrag: createTypeState(),
      whileFocus: createTypeState(),
      exit: createTypeState()
    };
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/features/Feature.mjs
  init_define_import_meta_env();
  var Feature = class {
    constructor(node2) {
      this.isMounted = false;
      this.node = node2;
    }
    update() {
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/features/animation/index.mjs
  var AnimationFeature = class extends Feature {
    /**
     * We dynamically generate the AnimationState manager as it contains a reference
     * to the underlying animation library. We only want to load that if we load this,
     * so people can optionally code split it out using the `m` component.
     */
    constructor(node2) {
      super(node2);
      node2.animationState || (node2.animationState = createAnimationState(node2));
    }
    updateAnimationControlsSubscription() {
      const { animate } = this.node.getProps();
      if (isAnimationControls(animate)) {
        this.unmountControls = animate.subscribe(this.node);
      }
    }
    /**
     * Subscribe any provided AnimationControls to the component's VisualElement
     */
    mount() {
      this.updateAnimationControlsSubscription();
    }
    update() {
      const { animate } = this.node.getProps();
      const { animate: prevAnimate } = this.node.prevProps || {};
      if (animate !== prevAnimate) {
        this.updateAnimationControlsSubscription();
      }
    }
    unmount() {
      var _a;
      this.node.animationState.reset();
      (_a = this.unmountControls) === null || _a === void 0 ? void 0 : _a.call(this);
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/features/animation/exit.mjs
  init_define_import_meta_env();
  var id = 0;
  var ExitAnimationFeature = class extends Feature {
    constructor() {
      super(...arguments);
      this.id = id++;
    }
    update() {
      if (!this.node.presenceContext)
        return;
      const { isPresent: isPresent2, onExitComplete } = this.node.presenceContext;
      const { isPresent: prevIsPresent } = this.node.prevPresenceContext || {};
      if (!this.node.animationState || isPresent2 === prevIsPresent) {
        return;
      }
      const exitAnimation = this.node.animationState.setActive("exit", !isPresent2);
      if (onExitComplete && !isPresent2) {
        exitAnimation.then(() => onExitComplete(this.id));
      }
    }
    mount() {
      const { register } = this.node.presenceContext || {};
      if (register) {
        this.unmount = register(this.id);
      }
    }
    unmount() {
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/features/animations.mjs
  var animations = {
    animation: {
      Feature: AnimationFeature
    },
    exit: {
      Feature: ExitAnimationFeature
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/features/drag.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/gestures/drag/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/gestures/drag/VisualElementDragControls.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/gestures/pan/PanSession.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/events/add-pointer-event.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/events/add-dom-event.mjs
  init_define_import_meta_env();
  function addDomEvent(target, eventName, handler, options = { passive: true }) {
    target.addEventListener(eventName, handler, options);
    return () => target.removeEventListener(eventName, handler);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/events/event-info.mjs
  init_define_import_meta_env();
  function extractEventInfo(event) {
    return {
      point: {
        x: event.pageX,
        y: event.pageY
      }
    };
  }
  var addPointerInfo = (handler) => {
    return (event) => isPrimaryPointer(event) && handler(event, extractEventInfo(event));
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/events/add-pointer-event.mjs
  function addPointerEvent(target, eventName, handler, options) {
    return addDomEvent(target, eventName, addPointerInfo(handler), options);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/distance.mjs
  init_define_import_meta_env();
  var distance = (a, b) => Math.abs(a - b);
  function distance2D(a, b) {
    const xDelta = distance(a.x, b.x);
    const yDelta = distance(a.y, b.y);
    return Math.sqrt(xDelta ** 2 + yDelta ** 2);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/gestures/pan/PanSession.mjs
  var PanSession = class {
    constructor(event, handlers, { transformPagePoint, contextWindow, dragSnapToOrigin = false } = {}) {
      this.startEvent = null;
      this.lastMoveEvent = null;
      this.lastMoveEventInfo = null;
      this.handlers = {};
      this.contextWindow = window;
      this.updatePoint = () => {
        if (!(this.lastMoveEvent && this.lastMoveEventInfo))
          return;
        const info2 = getPanInfo(this.lastMoveEventInfo, this.history);
        const isPanStarted = this.startEvent !== null;
        const isDistancePastThreshold = distance2D(info2.offset, { x: 0, y: 0 }) >= 3;
        if (!isPanStarted && !isDistancePastThreshold)
          return;
        const { point: point2 } = info2;
        const { timestamp: timestamp2 } = frameData;
        this.history.push({ ...point2, timestamp: timestamp2 });
        const { onStart, onMove } = this.handlers;
        if (!isPanStarted) {
          onStart && onStart(this.lastMoveEvent, info2);
          this.startEvent = this.lastMoveEvent;
        }
        onMove && onMove(this.lastMoveEvent, info2);
      };
      this.handlePointerMove = (event2, info2) => {
        this.lastMoveEvent = event2;
        this.lastMoveEventInfo = transformPoint(info2, this.transformPagePoint);
        frame.update(this.updatePoint, true);
      };
      this.handlePointerUp = (event2, info2) => {
        this.end();
        const { onEnd, onSessionEnd, resumeAnimation } = this.handlers;
        if (this.dragSnapToOrigin)
          resumeAnimation && resumeAnimation();
        if (!(this.lastMoveEvent && this.lastMoveEventInfo))
          return;
        const panInfo = getPanInfo(event2.type === "pointercancel" ? this.lastMoveEventInfo : transformPoint(info2, this.transformPagePoint), this.history);
        if (this.startEvent && onEnd) {
          onEnd(event2, panInfo);
        }
        onSessionEnd && onSessionEnd(event2, panInfo);
      };
      if (!isPrimaryPointer(event))
        return;
      this.dragSnapToOrigin = dragSnapToOrigin;
      this.handlers = handlers;
      this.transformPagePoint = transformPagePoint;
      this.contextWindow = contextWindow || window;
      const info = extractEventInfo(event);
      const initialInfo = transformPoint(info, this.transformPagePoint);
      const { point } = initialInfo;
      const { timestamp } = frameData;
      this.history = [{ ...point, timestamp }];
      const { onSessionStart } = handlers;
      onSessionStart && onSessionStart(event, getPanInfo(initialInfo, this.history));
      this.removeListeners = pipe2(addPointerEvent(this.contextWindow, "pointermove", this.handlePointerMove), addPointerEvent(this.contextWindow, "pointerup", this.handlePointerUp), addPointerEvent(this.contextWindow, "pointercancel", this.handlePointerUp));
    }
    updateHandlers(handlers) {
      this.handlers = handlers;
    }
    end() {
      this.removeListeners && this.removeListeners();
      cancelFrame(this.updatePoint);
    }
  };
  function transformPoint(info, transformPagePoint) {
    return transformPagePoint ? { point: transformPagePoint(info.point) } : info;
  }
  function subtractPoint(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
  }
  function getPanInfo({ point }, history) {
    return {
      point,
      delta: subtractPoint(point, lastDevicePoint(history)),
      offset: subtractPoint(point, startDevicePoint(history)),
      velocity: getVelocity(history, 0.1)
    };
  }
  function startDevicePoint(history) {
    return history[0];
  }
  function lastDevicePoint(history) {
    return history[history.length - 1];
  }
  function getVelocity(history, timeDelta) {
    if (history.length < 2) {
      return { x: 0, y: 0 };
    }
    let i = history.length - 1;
    let timestampedPoint = null;
    const lastPoint = lastDevicePoint(history);
    while (i >= 0) {
      timestampedPoint = history[i];
      if (lastPoint.timestamp - timestampedPoint.timestamp > secondsToMilliseconds(timeDelta)) {
        break;
      }
      i--;
    }
    if (!timestampedPoint) {
      return { x: 0, y: 0 };
    }
    const time2 = millisecondsToSeconds(lastPoint.timestamp - timestampedPoint.timestamp);
    if (time2 === 0) {
      return { x: 0, y: 0 };
    }
    const currentVelocity = {
      x: (lastPoint.x - timestampedPoint.x) / time2,
      y: (lastPoint.y - timestampedPoint.y) / time2
    };
    if (currentVelocity.x === Infinity) {
      currentVelocity.x = 0;
    }
    if (currentVelocity.y === Infinity) {
      currentVelocity.y = 0;
    }
    return currentVelocity;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/gestures/drag/utils/constraints.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/geometry/delta-calc.mjs
  init_define_import_meta_env();
  var SCALE_PRECISION = 1e-4;
  var SCALE_MIN = 1 - SCALE_PRECISION;
  var SCALE_MAX = 1 + SCALE_PRECISION;
  var TRANSLATE_PRECISION = 0.01;
  var TRANSLATE_MIN = 0 - TRANSLATE_PRECISION;
  var TRANSLATE_MAX = 0 + TRANSLATE_PRECISION;
  function calcLength(axis) {
    return axis.max - axis.min;
  }
  function isNear(value, target, maxDistance) {
    return Math.abs(value - target) <= maxDistance;
  }
  function calcAxisDelta(delta, source, target, origin = 0.5) {
    delta.origin = origin;
    delta.originPoint = mixNumber(source.min, source.max, delta.origin);
    delta.scale = calcLength(target) / calcLength(source);
    delta.translate = mixNumber(target.min, target.max, delta.origin) - delta.originPoint;
    if (delta.scale >= SCALE_MIN && delta.scale <= SCALE_MAX || isNaN(delta.scale)) {
      delta.scale = 1;
    }
    if (delta.translate >= TRANSLATE_MIN && delta.translate <= TRANSLATE_MAX || isNaN(delta.translate)) {
      delta.translate = 0;
    }
  }
  function calcBoxDelta(delta, source, target, origin) {
    calcAxisDelta(delta.x, source.x, target.x, origin ? origin.originX : void 0);
    calcAxisDelta(delta.y, source.y, target.y, origin ? origin.originY : void 0);
  }
  function calcRelativeAxis(target, relative, parent) {
    target.min = parent.min + relative.min;
    target.max = target.min + calcLength(relative);
  }
  function calcRelativeBox(target, relative, parent) {
    calcRelativeAxis(target.x, relative.x, parent.x);
    calcRelativeAxis(target.y, relative.y, parent.y);
  }
  function calcRelativeAxisPosition(target, layout3, parent) {
    target.min = layout3.min - parent.min;
    target.max = target.min + calcLength(layout3);
  }
  function calcRelativePosition(target, layout3, parent) {
    calcRelativeAxisPosition(target.x, layout3.x, parent.x);
    calcRelativeAxisPosition(target.y, layout3.y, parent.y);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/gestures/drag/utils/constraints.mjs
  function applyConstraints(point, { min, max }, elastic) {
    if (min !== void 0 && point < min) {
      point = elastic ? mixNumber(min, point, elastic.min) : Math.max(point, min);
    } else if (max !== void 0 && point > max) {
      point = elastic ? mixNumber(max, point, elastic.max) : Math.min(point, max);
    }
    return point;
  }
  function calcRelativeAxisConstraints(axis, min, max) {
    return {
      min: min !== void 0 ? axis.min + min : void 0,
      max: max !== void 0 ? axis.max + max - (axis.max - axis.min) : void 0
    };
  }
  function calcRelativeConstraints(layoutBox, { top, left, bottom, right }) {
    return {
      x: calcRelativeAxisConstraints(layoutBox.x, left, right),
      y: calcRelativeAxisConstraints(layoutBox.y, top, bottom)
    };
  }
  function calcViewportAxisConstraints(layoutAxis, constraintsAxis) {
    let min = constraintsAxis.min - layoutAxis.min;
    let max = constraintsAxis.max - layoutAxis.max;
    if (constraintsAxis.max - constraintsAxis.min < layoutAxis.max - layoutAxis.min) {
      [min, max] = [max, min];
    }
    return { min, max };
  }
  function calcViewportConstraints(layoutBox, constraintsBox) {
    return {
      x: calcViewportAxisConstraints(layoutBox.x, constraintsBox.x),
      y: calcViewportAxisConstraints(layoutBox.y, constraintsBox.y)
    };
  }
  function calcOrigin2(source, target) {
    let origin = 0.5;
    const sourceLength = calcLength(source);
    const targetLength = calcLength(target);
    if (targetLength > sourceLength) {
      origin = progress(target.min, target.max - sourceLength, source.min);
    } else if (sourceLength > targetLength) {
      origin = progress(source.min, source.max - targetLength, target.min);
    }
    return clamp(0, 1, origin);
  }
  function rebaseAxisConstraints(layout3, constraints) {
    const relativeConstraints = {};
    if (constraints.min !== void 0) {
      relativeConstraints.min = constraints.min - layout3.min;
    }
    if (constraints.max !== void 0) {
      relativeConstraints.max = constraints.max - layout3.min;
    }
    return relativeConstraints;
  }
  var defaultElastic = 0.35;
  function resolveDragElastic(dragElastic = defaultElastic) {
    if (dragElastic === false) {
      dragElastic = 0;
    } else if (dragElastic === true) {
      dragElastic = defaultElastic;
    }
    return {
      x: resolveAxisElastic(dragElastic, "left", "right"),
      y: resolveAxisElastic(dragElastic, "top", "bottom")
    };
  }
  function resolveAxisElastic(dragElastic, minLabel, maxLabel) {
    return {
      min: resolvePointElastic(dragElastic, minLabel),
      max: resolvePointElastic(dragElastic, maxLabel)
    };
  }
  function resolvePointElastic(dragElastic, label) {
    return typeof dragElastic === "number" ? dragElastic : dragElastic[label] || 0;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/geometry/models.mjs
  init_define_import_meta_env();
  var createAxisDelta = () => ({
    translate: 0,
    scale: 1,
    origin: 0,
    originPoint: 0
  });
  var createDelta = () => ({
    x: createAxisDelta(),
    y: createAxisDelta()
  });
  var createAxis = () => ({ min: 0, max: 0 });
  var createBox = () => ({
    x: createAxis(),
    y: createAxis()
  });

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/utils/each-axis.mjs
  init_define_import_meta_env();
  function eachAxis(callback) {
    return [callback("x"), callback("y")];
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/utils/measure.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/geometry/conversion.mjs
  init_define_import_meta_env();
  function convertBoundingBoxToBox({ top, left, right, bottom }) {
    return {
      x: { min: left, max: right },
      y: { min: top, max: bottom }
    };
  }
  function convertBoxToBoundingBox({ x, y }) {
    return { top: y.min, right: x.max, bottom: y.max, left: x.min };
  }
  function transformBoxPoints(point, transformPoint2) {
    if (!transformPoint2)
      return point;
    const topLeft = transformPoint2({ x: point.left, y: point.top });
    const bottomRight = transformPoint2({ x: point.right, y: point.bottom });
    return {
      top: topLeft.y,
      left: topLeft.x,
      bottom: bottomRight.y,
      right: bottomRight.x
    };
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/geometry/delta-apply.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/utils/has-transform.mjs
  init_define_import_meta_env();
  function isIdentityScale(scale2) {
    return scale2 === void 0 || scale2 === 1;
  }
  function hasScale({ scale: scale2, scaleX, scaleY }) {
    return !isIdentityScale(scale2) || !isIdentityScale(scaleX) || !isIdentityScale(scaleY);
  }
  function hasTransform(values) {
    return hasScale(values) || has2DTranslate(values) || values.z || values.rotate || values.rotateX || values.rotateY || values.skewX || values.skewY;
  }
  function has2DTranslate(values) {
    return is2DTranslate(values.x) || is2DTranslate(values.y);
  }
  function is2DTranslate(value) {
    return value && value !== "0%";
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/geometry/delta-apply.mjs
  function scalePoint(point, scale2, originPoint) {
    const distanceFromOrigin = point - originPoint;
    const scaled = scale2 * distanceFromOrigin;
    return originPoint + scaled;
  }
  function applyPointDelta(point, translate, scale2, originPoint, boxScale) {
    if (boxScale !== void 0) {
      point = scalePoint(point, boxScale, originPoint);
    }
    return scalePoint(point, scale2, originPoint) + translate;
  }
  function applyAxisDelta(axis, translate = 0, scale2 = 1, originPoint, boxScale) {
    axis.min = applyPointDelta(axis.min, translate, scale2, originPoint, boxScale);
    axis.max = applyPointDelta(axis.max, translate, scale2, originPoint, boxScale);
  }
  function applyBoxDelta(box, { x, y }) {
    applyAxisDelta(box.x, x.translate, x.scale, x.originPoint);
    applyAxisDelta(box.y, y.translate, y.scale, y.originPoint);
  }
  var TREE_SCALE_SNAP_MIN = 0.999999999999;
  var TREE_SCALE_SNAP_MAX = 1.0000000000001;
  function applyTreeDeltas(box, treeScale, treePath, isSharedTransition = false) {
    const treeLength = treePath.length;
    if (!treeLength)
      return;
    treeScale.x = treeScale.y = 1;
    let node2;
    let delta;
    for (let i = 0; i < treeLength; i++) {
      node2 = treePath[i];
      delta = node2.projectionDelta;
      const { visualElement } = node2.options;
      if (visualElement && visualElement.props.style && visualElement.props.style.display === "contents") {
        continue;
      }
      if (isSharedTransition && node2.options.layoutScroll && node2.scroll && node2 !== node2.root) {
        transformBox(box, {
          x: -node2.scroll.offset.x,
          y: -node2.scroll.offset.y
        });
      }
      if (delta) {
        treeScale.x *= delta.x.scale;
        treeScale.y *= delta.y.scale;
        applyBoxDelta(box, delta);
      }
      if (isSharedTransition && hasTransform(node2.latestValues)) {
        transformBox(box, node2.latestValues);
      }
    }
    if (treeScale.x < TREE_SCALE_SNAP_MAX && treeScale.x > TREE_SCALE_SNAP_MIN) {
      treeScale.x = 1;
    }
    if (treeScale.y < TREE_SCALE_SNAP_MAX && treeScale.y > TREE_SCALE_SNAP_MIN) {
      treeScale.y = 1;
    }
  }
  function translateAxis(axis, distance2) {
    axis.min = axis.min + distance2;
    axis.max = axis.max + distance2;
  }
  function transformAxis(axis, axisTranslate, axisScale, boxScale, axisOrigin = 0.5) {
    const originPoint = mixNumber(axis.min, axis.max, axisOrigin);
    applyAxisDelta(axis, axisTranslate, axisScale, originPoint, boxScale);
  }
  function transformBox(box, transform2) {
    transformAxis(box.x, transform2.x, transform2.scaleX, transform2.scale, transform2.originX);
    transformAxis(box.y, transform2.y, transform2.scaleY, transform2.scale, transform2.originY);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/utils/measure.mjs
  function measureViewportBox(instance, transformPoint2) {
    return convertBoundingBoxToBox(transformBoxPoints(instance.getBoundingClientRect(), transformPoint2));
  }
  function measurePageBox(element, rootProjectionNode2, transformPagePoint) {
    const viewportBox = measureViewportBox(element, transformPagePoint);
    const { scroll: scroll2 } = rootProjectionNode2;
    if (scroll2) {
      translateAxis(viewportBox.x, scroll2.offset.x);
      translateAxis(viewportBox.y, scroll2.offset.y);
    }
    return viewportBox;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/get-context-window.mjs
  init_define_import_meta_env();
  var getContextWindow = ({ current }) => {
    return current ? current.ownerDocument.defaultView : null;
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/gestures/drag/VisualElementDragControls.mjs
  var elementDragControls = /* @__PURE__ */ new WeakMap();
  var VisualElementDragControls = class {
    constructor(visualElement) {
      this.openDragLock = null;
      this.isDragging = false;
      this.currentDirection = null;
      this.originPoint = { x: 0, y: 0 };
      this.constraints = false;
      this.hasMutatedConstraints = false;
      this.elastic = createBox();
      this.visualElement = visualElement;
    }
    start(originEvent, { snapToCursor = false } = {}) {
      const { presenceContext } = this.visualElement;
      if (presenceContext && presenceContext.isPresent === false)
        return;
      const onSessionStart = (event) => {
        const { dragSnapToOrigin: dragSnapToOrigin2 } = this.getProps();
        dragSnapToOrigin2 ? this.pauseAnimation() : this.stopAnimation();
        if (snapToCursor) {
          this.snapToCursor(extractEventInfo(event).point);
        }
      };
      const onStart = (event, info) => {
        const { drag: drag2, dragPropagation, onDragStart } = this.getProps();
        if (drag2 && !dragPropagation) {
          if (this.openDragLock)
            this.openDragLock();
          this.openDragLock = setDragLock(drag2);
          if (!this.openDragLock)
            return;
        }
        this.isDragging = true;
        this.currentDirection = null;
        this.resolveConstraints();
        if (this.visualElement.projection) {
          this.visualElement.projection.isAnimationBlocked = true;
          this.visualElement.projection.target = void 0;
        }
        eachAxis((axis) => {
          let current = this.getAxisMotionValue(axis).get() || 0;
          if (percent.test(current)) {
            const { projection } = this.visualElement;
            if (projection && projection.layout) {
              const measuredAxis = projection.layout.layoutBox[axis];
              if (measuredAxis) {
                const length2 = calcLength(measuredAxis);
                current = length2 * (parseFloat(current) / 100);
              }
            }
          }
          this.originPoint[axis] = current;
        });
        if (onDragStart) {
          frame.postRender(() => onDragStart(event, info));
        }
        addValueToWillChange(this.visualElement, "transform");
        const { animationState } = this.visualElement;
        animationState && animationState.setActive("whileDrag", true);
      };
      const onMove = (event, info) => {
        const { dragPropagation, dragDirectionLock, onDirectionLock, onDrag } = this.getProps();
        if (!dragPropagation && !this.openDragLock)
          return;
        const { offset } = info;
        if (dragDirectionLock && this.currentDirection === null) {
          this.currentDirection = getCurrentDirection(offset);
          if (this.currentDirection !== null) {
            onDirectionLock && onDirectionLock(this.currentDirection);
          }
          return;
        }
        this.updateAxis("x", info.point, offset);
        this.updateAxis("y", info.point, offset);
        this.visualElement.render();
        onDrag && onDrag(event, info);
      };
      const onSessionEnd = (event, info) => this.stop(event, info);
      const resumeAnimation = () => eachAxis((axis) => {
        var _a;
        return this.getAnimationState(axis) === "paused" && ((_a = this.getAxisMotionValue(axis).animation) === null || _a === void 0 ? void 0 : _a.play());
      });
      const { dragSnapToOrigin } = this.getProps();
      this.panSession = new PanSession(originEvent, {
        onSessionStart,
        onStart,
        onMove,
        onSessionEnd,
        resumeAnimation
      }, {
        transformPagePoint: this.visualElement.getTransformPagePoint(),
        dragSnapToOrigin,
        contextWindow: getContextWindow(this.visualElement)
      });
    }
    stop(event, info) {
      const isDragging2 = this.isDragging;
      this.cancel();
      if (!isDragging2)
        return;
      const { velocity } = info;
      this.startAnimation(velocity);
      const { onDragEnd } = this.getProps();
      if (onDragEnd) {
        frame.postRender(() => onDragEnd(event, info));
      }
    }
    cancel() {
      this.isDragging = false;
      const { projection, animationState } = this.visualElement;
      if (projection) {
        projection.isAnimationBlocked = false;
      }
      this.panSession && this.panSession.end();
      this.panSession = void 0;
      const { dragPropagation } = this.getProps();
      if (!dragPropagation && this.openDragLock) {
        this.openDragLock();
        this.openDragLock = null;
      }
      animationState && animationState.setActive("whileDrag", false);
    }
    updateAxis(axis, _point, offset) {
      const { drag: drag2 } = this.getProps();
      if (!offset || !shouldDrag(axis, drag2, this.currentDirection))
        return;
      const axisValue = this.getAxisMotionValue(axis);
      let next2 = this.originPoint[axis] + offset[axis];
      if (this.constraints && this.constraints[axis]) {
        next2 = applyConstraints(next2, this.constraints[axis], this.elastic[axis]);
      }
      axisValue.set(next2);
    }
    resolveConstraints() {
      var _a;
      const { dragConstraints, dragElastic } = this.getProps();
      const layout3 = this.visualElement.projection && !this.visualElement.projection.layout ? this.visualElement.projection.measure(false) : (_a = this.visualElement.projection) === null || _a === void 0 ? void 0 : _a.layout;
      const prevConstraints = this.constraints;
      if (dragConstraints && isRefObject2(dragConstraints)) {
        if (!this.constraints) {
          this.constraints = this.resolveRefConstraints();
        }
      } else {
        if (dragConstraints && layout3) {
          this.constraints = calcRelativeConstraints(layout3.layoutBox, dragConstraints);
        } else {
          this.constraints = false;
        }
      }
      this.elastic = resolveDragElastic(dragElastic);
      if (prevConstraints !== this.constraints && layout3 && this.constraints && !this.hasMutatedConstraints) {
        eachAxis((axis) => {
          if (this.constraints !== false && this.getAxisMotionValue(axis)) {
            this.constraints[axis] = rebaseAxisConstraints(layout3.layoutBox[axis], this.constraints[axis]);
          }
        });
      }
    }
    resolveRefConstraints() {
      const { dragConstraints: constraints, onMeasureDragConstraints } = this.getProps();
      if (!constraints || !isRefObject2(constraints))
        return false;
      const constraintsElement = constraints.current;
      invariant(constraintsElement !== null, "If `dragConstraints` is set as a React ref, that ref must be passed to another component's `ref` prop.");
      const { projection } = this.visualElement;
      if (!projection || !projection.layout)
        return false;
      const constraintsBox = measurePageBox(constraintsElement, projection.root, this.visualElement.getTransformPagePoint());
      let measuredConstraints = calcViewportConstraints(projection.layout.layoutBox, constraintsBox);
      if (onMeasureDragConstraints) {
        const userConstraints = onMeasureDragConstraints(convertBoxToBoundingBox(measuredConstraints));
        this.hasMutatedConstraints = !!userConstraints;
        if (userConstraints) {
          measuredConstraints = convertBoundingBoxToBox(userConstraints);
        }
      }
      return measuredConstraints;
    }
    startAnimation(velocity) {
      const { drag: drag2, dragMomentum, dragElastic, dragTransition, dragSnapToOrigin, onDragTransitionEnd } = this.getProps();
      const constraints = this.constraints || {};
      const momentumAnimations = eachAxis((axis) => {
        if (!shouldDrag(axis, drag2, this.currentDirection)) {
          return;
        }
        let transition3 = constraints && constraints[axis] || {};
        if (dragSnapToOrigin)
          transition3 = { min: 0, max: 0 };
        const bounceStiffness = dragElastic ? 200 : 1e6;
        const bounceDamping = dragElastic ? 40 : 1e7;
        const inertia2 = {
          type: "inertia",
          velocity: dragMomentum ? velocity[axis] : 0,
          bounceStiffness,
          bounceDamping,
          timeConstant: 750,
          restDelta: 1,
          restSpeed: 10,
          ...dragTransition,
          ...transition3
        };
        return this.startAxisValueAnimation(axis, inertia2);
      });
      return Promise.all(momentumAnimations).then(onDragTransitionEnd);
    }
    startAxisValueAnimation(axis, transition3) {
      const axisValue = this.getAxisMotionValue(axis);
      addValueToWillChange(this.visualElement, axis);
      return axisValue.start(animateMotionValue(axis, axisValue, 0, transition3, this.visualElement, false));
    }
    stopAnimation() {
      eachAxis((axis) => this.getAxisMotionValue(axis).stop());
    }
    pauseAnimation() {
      eachAxis((axis) => {
        var _a;
        return (_a = this.getAxisMotionValue(axis).animation) === null || _a === void 0 ? void 0 : _a.pause();
      });
    }
    getAnimationState(axis) {
      var _a;
      return (_a = this.getAxisMotionValue(axis).animation) === null || _a === void 0 ? void 0 : _a.state;
    }
    /**
     * Drag works differently depending on which props are provided.
     *
     * - If _dragX and _dragY are provided, we output the gesture delta directly to those motion values.
     * - Otherwise, we apply the delta to the x/y motion values.
     */
    getAxisMotionValue(axis) {
      const dragKey = `_drag${axis.toUpperCase()}`;
      const props = this.visualElement.getProps();
      const externalMotionValue = props[dragKey];
      return externalMotionValue ? externalMotionValue : this.visualElement.getValue(axis, (props.initial ? props.initial[axis] : void 0) || 0);
    }
    snapToCursor(point) {
      eachAxis((axis) => {
        const { drag: drag2 } = this.getProps();
        if (!shouldDrag(axis, drag2, this.currentDirection))
          return;
        const { projection } = this.visualElement;
        const axisValue = this.getAxisMotionValue(axis);
        if (projection && projection.layout) {
          const { min, max } = projection.layout.layoutBox[axis];
          axisValue.set(point[axis] - mixNumber(min, max, 0.5));
        }
      });
    }
    /**
     * When the viewport resizes we want to check if the measured constraints
     * have changed and, if so, reposition the element within those new constraints
     * relative to where it was before the resize.
     */
    scalePositionWithinConstraints() {
      if (!this.visualElement.current)
        return;
      const { drag: drag2, dragConstraints } = this.getProps();
      const { projection } = this.visualElement;
      if (!isRefObject2(dragConstraints) || !projection || !this.constraints)
        return;
      this.stopAnimation();
      const boxProgress = { x: 0, y: 0 };
      eachAxis((axis) => {
        const axisValue = this.getAxisMotionValue(axis);
        if (axisValue && this.constraints !== false) {
          const latest = axisValue.get();
          boxProgress[axis] = calcOrigin2({ min: latest, max: latest }, this.constraints[axis]);
        }
      });
      const { transformTemplate: transformTemplate2 } = this.visualElement.getProps();
      this.visualElement.current.style.transform = transformTemplate2 ? transformTemplate2({}, "") : "none";
      projection.root && projection.root.updateScroll();
      projection.updateLayout();
      this.resolveConstraints();
      eachAxis((axis) => {
        if (!shouldDrag(axis, drag2, null))
          return;
        const axisValue = this.getAxisMotionValue(axis);
        const { min, max } = this.constraints[axis];
        axisValue.set(mixNumber(min, max, boxProgress[axis]));
      });
    }
    addListeners() {
      if (!this.visualElement.current)
        return;
      elementDragControls.set(this.visualElement, this);
      const element = this.visualElement.current;
      const stopPointerListener = addPointerEvent(element, "pointerdown", (event) => {
        const { drag: drag2, dragListener = true } = this.getProps();
        drag2 && dragListener && this.start(event);
      });
      const measureDragConstraints = () => {
        const { dragConstraints } = this.getProps();
        if (isRefObject2(dragConstraints) && dragConstraints.current) {
          this.constraints = this.resolveRefConstraints();
        }
      };
      const { projection } = this.visualElement;
      const stopMeasureLayoutListener = projection.addEventListener("measure", measureDragConstraints);
      if (projection && !projection.layout) {
        projection.root && projection.root.updateScroll();
        projection.updateLayout();
      }
      frame.read(measureDragConstraints);
      const stopResizeListener = addDomEvent(window, "resize", () => this.scalePositionWithinConstraints());
      const stopLayoutUpdateListener = projection.addEventListener("didUpdate", (({ delta, hasLayoutChanged }) => {
        if (this.isDragging && hasLayoutChanged) {
          eachAxis((axis) => {
            const motionValue2 = this.getAxisMotionValue(axis);
            if (!motionValue2)
              return;
            this.originPoint[axis] += delta[axis].translate;
            motionValue2.set(motionValue2.get() + delta[axis].translate);
          });
          this.visualElement.render();
        }
      }));
      return () => {
        stopResizeListener();
        stopPointerListener();
        stopMeasureLayoutListener();
        stopLayoutUpdateListener && stopLayoutUpdateListener();
      };
    }
    getProps() {
      const props = this.visualElement.getProps();
      const { drag: drag2 = false, dragDirectionLock = false, dragPropagation = false, dragConstraints = false, dragElastic = defaultElastic, dragMomentum = true } = props;
      return {
        ...props,
        drag: drag2,
        dragDirectionLock,
        dragPropagation,
        dragConstraints,
        dragElastic,
        dragMomentum
      };
    }
  };
  function shouldDrag(direction2, drag2, currentDirection) {
    return (drag2 === true || drag2 === direction2) && (currentDirection === null || currentDirection === direction2);
  }
  function getCurrentDirection(offset, lockThreshold = 10) {
    let direction2 = null;
    if (Math.abs(offset.y) > lockThreshold) {
      direction2 = "y";
    } else if (Math.abs(offset.x) > lockThreshold) {
      direction2 = "x";
    }
    return direction2;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/gestures/drag/index.mjs
  var DragGesture = class extends Feature {
    constructor(node2) {
      super(node2);
      this.removeGroupControls = noop2;
      this.removeListeners = noop2;
      this.controls = new VisualElementDragControls(node2);
    }
    mount() {
      const { dragControls } = this.node.getProps();
      if (dragControls) {
        this.removeGroupControls = dragControls.subscribe(this.controls);
      }
      this.removeListeners = this.controls.addListeners() || noop2;
    }
    unmount() {
      this.removeGroupControls();
      this.removeListeners();
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/gestures/pan/index.mjs
  init_define_import_meta_env();
  var asyncHandler = (handler) => (event, info) => {
    if (handler) {
      frame.postRender(() => handler(event, info));
    }
  };
  var PanGesture = class extends Feature {
    constructor() {
      super(...arguments);
      this.removePointerDownListener = noop2;
    }
    onPointerDown(pointerDownEvent) {
      this.session = new PanSession(pointerDownEvent, this.createPanHandlers(), {
        transformPagePoint: this.node.getTransformPagePoint(),
        contextWindow: getContextWindow(this.node)
      });
    }
    createPanHandlers() {
      const { onPanSessionStart, onPanStart, onPan, onPanEnd } = this.node.getProps();
      return {
        onSessionStart: asyncHandler(onPanSessionStart),
        onStart: asyncHandler(onPanStart),
        onMove: onPan,
        onEnd: (event, info) => {
          delete this.session;
          if (onPanEnd) {
            frame.postRender(() => onPanEnd(event, info));
          }
        }
      };
    }
    mount() {
      this.removePointerDownListener = addPointerEvent(this.node.current, "pointerdown", (event) => this.onPointerDown(event));
    }
    update() {
      this.session && this.session.updateHandlers(this.createPanHandlers());
    }
    unmount() {
      this.removePointerDownListener();
      this.session && this.session.end();
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/features/layout/MeasureLayout.mjs
  init_define_import_meta_env();
  var import_jsx_runtime11 = __toESM(require_react_shim(), 1);
  var import_react35 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/node/state.mjs
  init_define_import_meta_env();
  var globalProjectionState = {
    /**
     * Global flag as to whether the tree has animated since the last time
     * we resized the window
     */
    hasAnimatedSinceResize: true,
    /**
     * We set this to true once, on the first update. Any nodes added to the tree beyond that
     * update will be given a `data-projection-id` attribute.
     */
    hasEverUpdated: false
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/styles/scale-border-radius.mjs
  init_define_import_meta_env();
  function pixelsToPercent(pixels, axis) {
    if (axis.max === axis.min)
      return 0;
    return pixels / (axis.max - axis.min) * 100;
  }
  var correctBorderRadius = {
    correct: (latest, node2) => {
      if (!node2.target)
        return latest;
      if (typeof latest === "string") {
        if (px2.test(latest)) {
          latest = parseFloat(latest);
        } else {
          return latest;
        }
      }
      const x = pixelsToPercent(latest, node2.target.x);
      const y = pixelsToPercent(latest, node2.target.y);
      return `${x}% ${y}%`;
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/styles/scale-box-shadow.mjs
  init_define_import_meta_env();
  var correctBoxShadow = {
    correct: (latest, { treeScale, projectionDelta }) => {
      const original = latest;
      const shadow = complex.parse(latest);
      if (shadow.length > 5)
        return original;
      const template = complex.createTransformer(latest);
      const offset = typeof shadow[0] !== "number" ? 1 : 0;
      const xScale = projectionDelta.x.scale * treeScale.x;
      const yScale = projectionDelta.y.scale * treeScale.y;
      shadow[0 + offset] /= xScale;
      shadow[1 + offset] /= yScale;
      const averageScale = mixNumber(xScale, yScale, 0.5);
      if (typeof shadow[2 + offset] === "number")
        shadow[2 + offset] /= averageScale;
      if (typeof shadow[3 + offset] === "number")
        shadow[3 + offset] /= averageScale;
      return template(shadow);
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/features/layout/MeasureLayout.mjs
  var MeasureLayoutWithContext = class extends import_react35.Component {
    /**
     * This only mounts projection nodes for components that
     * need measuring, we might want to do it for all components
     * in order to incorporate transforms
     */
    componentDidMount() {
      const { visualElement, layoutGroup, switchLayoutGroup, layoutId } = this.props;
      const { projection } = visualElement;
      addScaleCorrector(defaultScaleCorrectors);
      if (projection) {
        if (layoutGroup.group)
          layoutGroup.group.add(projection);
        if (switchLayoutGroup && switchLayoutGroup.register && layoutId) {
          switchLayoutGroup.register(projection);
        }
        projection.root.didUpdate();
        projection.addEventListener("animationComplete", () => {
          this.safeToRemove();
        });
        projection.setOptions({
          ...projection.options,
          onExitComplete: () => this.safeToRemove()
        });
      }
      globalProjectionState.hasEverUpdated = true;
    }
    getSnapshotBeforeUpdate(prevProps) {
      const { layoutDependency, visualElement, drag: drag2, isPresent: isPresent2 } = this.props;
      const projection = visualElement.projection;
      if (!projection)
        return null;
      projection.isPresent = isPresent2;
      if (drag2 || prevProps.layoutDependency !== layoutDependency || layoutDependency === void 0) {
        projection.willUpdate();
      } else {
        this.safeToRemove();
      }
      if (prevProps.isPresent !== isPresent2) {
        if (isPresent2) {
          projection.promote();
        } else if (!projection.relegate()) {
          frame.postRender(() => {
            const stack = projection.getStack();
            if (!stack || !stack.members.length) {
              this.safeToRemove();
            }
          });
        }
      }
      return null;
    }
    componentDidUpdate() {
      const { projection } = this.props.visualElement;
      if (projection) {
        projection.root.didUpdate();
        microtask.postRender(() => {
          if (!projection.currentAnimation && projection.isLead()) {
            this.safeToRemove();
          }
        });
      }
    }
    componentWillUnmount() {
      const { visualElement, layoutGroup, switchLayoutGroup: promoteContext } = this.props;
      const { projection } = visualElement;
      if (projection) {
        projection.scheduleCheckAfterUnmount();
        if (layoutGroup && layoutGroup.group)
          layoutGroup.group.remove(projection);
        if (promoteContext && promoteContext.deregister)
          promoteContext.deregister(projection);
      }
    }
    safeToRemove() {
      const { safeToRemove } = this.props;
      safeToRemove && safeToRemove();
    }
    render() {
      return null;
    }
  };
  function MeasureLayout(props) {
    const [isPresent2, safeToRemove] = usePresence();
    const layoutGroup = (0, import_react35.useContext)(LayoutGroupContext);
    return (0, import_jsx_runtime11.jsx)(MeasureLayoutWithContext, { ...props, layoutGroup, switchLayoutGroup: (0, import_react35.useContext)(SwitchLayoutGroupContext), isPresent: isPresent2, safeToRemove });
  }
  var defaultScaleCorrectors = {
    borderRadius: {
      ...correctBorderRadius,
      applyTo: [
        "borderTopLeftRadius",
        "borderTopRightRadius",
        "borderBottomLeftRadius",
        "borderBottomRightRadius"
      ]
    },
    borderTopLeftRadius: correctBorderRadius,
    borderTopRightRadius: correctBorderRadius,
    borderBottomLeftRadius: correctBorderRadius,
    borderBottomRightRadius: correctBorderRadius,
    boxShadow: correctBoxShadow
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/node/HTMLProjectionNode.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/node/create-projection-node.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/animation/animate/single-value.mjs
  init_define_import_meta_env();
  function animateSingleValue(value, keyframes3, options) {
    const motionValue$1 = isMotionValue(value) ? value : motionValue(value);
    motionValue$1.start(animateMotionValue("", motionValue$1, keyframes3, options));
    return motionValue$1.animation;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/utils/is-svg-element.mjs
  init_define_import_meta_env();
  function isSVGElement(element) {
    return element instanceof SVGElement && element.tagName !== "svg";
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/utils/flat-tree.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/utils/compare-by-depth.mjs
  init_define_import_meta_env();
  var compareByDepth = (a, b) => a.depth - b.depth;

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/utils/flat-tree.mjs
  var FlatTree = class {
    constructor() {
      this.children = [];
      this.isDirty = false;
    }
    add(child) {
      addUniqueItem(this.children, child);
      this.isDirty = true;
    }
    remove(child) {
      removeItem(this.children, child);
      this.isDirty = true;
    }
    forEach(callback) {
      this.isDirty && this.children.sort(compareByDepth);
      this.isDirty = false;
      this.children.forEach(callback);
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/delay.mjs
  init_define_import_meta_env();
  function delay(callback, timeout) {
    const start = time.now();
    const checkElapsed = ({ timestamp }) => {
      const elapsed = timestamp - start;
      if (elapsed >= timeout) {
        cancelFrame(checkElapsed);
        callback(elapsed - timeout);
      }
    };
    frame.read(checkElapsed, true);
    return () => cancelFrame(checkElapsed);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/animation/mix-values.mjs
  init_define_import_meta_env();
  var borders2 = ["TopLeft", "TopRight", "BottomLeft", "BottomRight"];
  var numBorders = borders2.length;
  var asNumber = (value) => typeof value === "string" ? parseFloat(value) : value;
  var isPx = (value) => typeof value === "number" || px2.test(value);
  function mixValues(target, follow, lead, progress2, shouldCrossfadeOpacity, isOnlyMember) {
    if (shouldCrossfadeOpacity) {
      target.opacity = mixNumber(
        0,
        // TODO Reinstate this if only child
        lead.opacity !== void 0 ? lead.opacity : 1,
        easeCrossfadeIn(progress2)
      );
      target.opacityExit = mixNumber(follow.opacity !== void 0 ? follow.opacity : 1, 0, easeCrossfadeOut(progress2));
    } else if (isOnlyMember) {
      target.opacity = mixNumber(follow.opacity !== void 0 ? follow.opacity : 1, lead.opacity !== void 0 ? lead.opacity : 1, progress2);
    }
    for (let i = 0; i < numBorders; i++) {
      const borderLabel = `border${borders2[i]}Radius`;
      let followRadius = getRadius(follow, borderLabel);
      let leadRadius = getRadius(lead, borderLabel);
      if (followRadius === void 0 && leadRadius === void 0)
        continue;
      followRadius || (followRadius = 0);
      leadRadius || (leadRadius = 0);
      const canMix = followRadius === 0 || leadRadius === 0 || isPx(followRadius) === isPx(leadRadius);
      if (canMix) {
        target[borderLabel] = Math.max(mixNumber(asNumber(followRadius), asNumber(leadRadius), progress2), 0);
        if (percent.test(leadRadius) || percent.test(followRadius)) {
          target[borderLabel] += "%";
        }
      } else {
        target[borderLabel] = leadRadius;
      }
    }
    if (follow.rotate || lead.rotate) {
      target.rotate = mixNumber(follow.rotate || 0, lead.rotate || 0, progress2);
    }
  }
  function getRadius(values, radiusName) {
    return values[radiusName] !== void 0 ? values[radiusName] : values.borderRadius;
  }
  var easeCrossfadeIn = /* @__PURE__ */ compress(0, 0.5, circOut);
  var easeCrossfadeOut = /* @__PURE__ */ compress(0.5, 0.95, noop2);
  function compress(min, max, easing) {
    return (p) => {
      if (p < min)
        return 0;
      if (p > max)
        return 1;
      return easing(progress(min, max, p));
    };
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/geometry/copy.mjs
  init_define_import_meta_env();
  function copyAxisInto(axis, originAxis) {
    axis.min = originAxis.min;
    axis.max = originAxis.max;
  }
  function copyBoxInto(box, originBox) {
    copyAxisInto(box.x, originBox.x);
    copyAxisInto(box.y, originBox.y);
  }
  function copyAxisDeltaInto(delta, originDelta) {
    delta.translate = originDelta.translate;
    delta.scale = originDelta.scale;
    delta.originPoint = originDelta.originPoint;
    delta.origin = originDelta.origin;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/geometry/delta-remove.mjs
  init_define_import_meta_env();
  function removePointDelta(point, translate, scale2, originPoint, boxScale) {
    point -= translate;
    point = scalePoint(point, 1 / scale2, originPoint);
    if (boxScale !== void 0) {
      point = scalePoint(point, 1 / boxScale, originPoint);
    }
    return point;
  }
  function removeAxisDelta(axis, translate = 0, scale2 = 1, origin = 0.5, boxScale, originAxis = axis, sourceAxis = axis) {
    if (percent.test(translate)) {
      translate = parseFloat(translate);
      const relativeProgress = mixNumber(sourceAxis.min, sourceAxis.max, translate / 100);
      translate = relativeProgress - sourceAxis.min;
    }
    if (typeof translate !== "number")
      return;
    let originPoint = mixNumber(originAxis.min, originAxis.max, origin);
    if (axis === originAxis)
      originPoint -= translate;
    axis.min = removePointDelta(axis.min, translate, scale2, originPoint, boxScale);
    axis.max = removePointDelta(axis.max, translate, scale2, originPoint, boxScale);
  }
  function removeAxisTransforms(axis, transforms, [key, scaleKey, originKey], origin, sourceAxis) {
    removeAxisDelta(axis, transforms[key], transforms[scaleKey], transforms[originKey], transforms.scale, origin, sourceAxis);
  }
  var xKeys = ["x", "scaleX", "originX"];
  var yKeys = ["y", "scaleY", "originY"];
  function removeBoxTransforms(box, transforms, originBox, sourceBox) {
    removeAxisTransforms(box.x, transforms, xKeys, originBox ? originBox.x : void 0, sourceBox ? sourceBox.x : void 0);
    removeAxisTransforms(box.y, transforms, yKeys, originBox ? originBox.y : void 0, sourceBox ? sourceBox.y : void 0);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/geometry/utils.mjs
  init_define_import_meta_env();
  function isAxisDeltaZero(delta) {
    return delta.translate === 0 && delta.scale === 1;
  }
  function isDeltaZero(delta) {
    return isAxisDeltaZero(delta.x) && isAxisDeltaZero(delta.y);
  }
  function axisEquals(a, b) {
    return a.min === b.min && a.max === b.max;
  }
  function boxEquals(a, b) {
    return axisEquals(a.x, b.x) && axisEquals(a.y, b.y);
  }
  function axisEqualsRounded(a, b) {
    return Math.round(a.min) === Math.round(b.min) && Math.round(a.max) === Math.round(b.max);
  }
  function boxEqualsRounded(a, b) {
    return axisEqualsRounded(a.x, b.x) && axisEqualsRounded(a.y, b.y);
  }
  function aspectRatio(box) {
    return calcLength(box.x) / calcLength(box.y);
  }
  function axisDeltaEquals(a, b) {
    return a.translate === b.translate && a.scale === b.scale && a.originPoint === b.originPoint;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/shared/stack.mjs
  init_define_import_meta_env();
  var NodeStack = class {
    constructor() {
      this.members = [];
    }
    add(node2) {
      addUniqueItem(this.members, node2);
      node2.scheduleRender();
    }
    remove(node2) {
      removeItem(this.members, node2);
      if (node2 === this.prevLead) {
        this.prevLead = void 0;
      }
      if (node2 === this.lead) {
        const prevLead = this.members[this.members.length - 1];
        if (prevLead) {
          this.promote(prevLead);
        }
      }
    }
    relegate(node2) {
      const indexOfNode = this.members.findIndex((member) => node2 === member);
      if (indexOfNode === 0)
        return false;
      let prevLead;
      for (let i = indexOfNode; i >= 0; i--) {
        const member = this.members[i];
        if (member.isPresent !== false) {
          prevLead = member;
          break;
        }
      }
      if (prevLead) {
        this.promote(prevLead);
        return true;
      } else {
        return false;
      }
    }
    promote(node2, preserveFollowOpacity) {
      const prevLead = this.lead;
      if (node2 === prevLead)
        return;
      this.prevLead = prevLead;
      this.lead = node2;
      node2.show();
      if (prevLead) {
        prevLead.instance && prevLead.scheduleRender();
        node2.scheduleRender();
        node2.resumeFrom = prevLead;
        if (preserveFollowOpacity) {
          node2.resumeFrom.preserveOpacity = true;
        }
        if (prevLead.snapshot) {
          node2.snapshot = prevLead.snapshot;
          node2.snapshot.latestValues = prevLead.animationValues || prevLead.latestValues;
        }
        if (node2.root && node2.root.isUpdating) {
          node2.isLayoutDirty = true;
        }
        const { crossfade } = node2.options;
        if (crossfade === false) {
          prevLead.hide();
        }
      }
    }
    exitAnimationComplete() {
      this.members.forEach((node2) => {
        const { options, resumingFrom } = node2;
        options.onExitComplete && options.onExitComplete();
        if (resumingFrom) {
          resumingFrom.options.onExitComplete && resumingFrom.options.onExitComplete();
        }
      });
    }
    scheduleRender() {
      this.members.forEach((node2) => {
        node2.instance && node2.scheduleRender(false);
      });
    }
    /**
     * Clear any leads that have been removed this render to prevent them from being
     * used in future animations and to prevent memory leaks
     */
    removeLeadSnapshot() {
      if (this.lead && this.lead.snapshot) {
        this.lead.snapshot = void 0;
      }
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/styles/transform.mjs
  init_define_import_meta_env();
  function buildProjectionTransform(delta, treeScale, latestTransform) {
    let transform2 = "";
    const xTranslate = delta.x.translate / treeScale.x;
    const yTranslate = delta.y.translate / treeScale.y;
    const zTranslate = (latestTransform === null || latestTransform === void 0 ? void 0 : latestTransform.z) || 0;
    if (xTranslate || yTranslate || zTranslate) {
      transform2 = `translate3d(${xTranslate}px, ${yTranslate}px, ${zTranslate}px) `;
    }
    if (treeScale.x !== 1 || treeScale.y !== 1) {
      transform2 += `scale(${1 / treeScale.x}, ${1 / treeScale.y}) `;
    }
    if (latestTransform) {
      const { transformPerspective, rotate, rotateX, rotateY, skewX, skewY } = latestTransform;
      if (transformPerspective)
        transform2 = `perspective(${transformPerspective}px) ${transform2}`;
      if (rotate)
        transform2 += `rotate(${rotate}deg) `;
      if (rotateX)
        transform2 += `rotateX(${rotateX}deg) `;
      if (rotateY)
        transform2 += `rotateY(${rotateY}deg) `;
      if (skewX)
        transform2 += `skewX(${skewX}deg) `;
      if (skewY)
        transform2 += `skewY(${skewY}deg) `;
    }
    const elementScaleX = delta.x.scale * treeScale.x;
    const elementScaleY = delta.y.scale * treeScale.y;
    if (elementScaleX !== 1 || elementScaleY !== 1) {
      transform2 += `scale(${elementScaleX}, ${elementScaleY})`;
    }
    return transform2 || "none";
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/node/create-projection-node.mjs
  var metrics = {
    type: "projectionFrame",
    totalNodes: 0,
    resolvedTargetDeltas: 0,
    recalculatedProjection: 0
  };
  var isDebug = typeof window !== "undefined" && window.MotionDebug !== void 0;
  var transformAxes = ["", "X", "Y", "Z"];
  var hiddenVisibility = { visibility: "hidden" };
  var animationTarget = 1e3;
  var id2 = 0;
  function resetDistortingTransform(key, visualElement, values, sharedAnimationValues) {
    const { latestValues } = visualElement;
    if (latestValues[key]) {
      values[key] = latestValues[key];
      visualElement.setStaticValue(key, 0);
      if (sharedAnimationValues) {
        sharedAnimationValues[key] = 0;
      }
    }
  }
  function cancelTreeOptimisedTransformAnimations(projectionNode) {
    projectionNode.hasCheckedOptimisedAppear = true;
    if (projectionNode.root === projectionNode)
      return;
    const { visualElement } = projectionNode.options;
    if (!visualElement)
      return;
    const appearId = getOptimisedAppearId(visualElement);
    if (window.MotionHasOptimisedAnimation(appearId, "transform")) {
      const { layout: layout3, layoutId } = projectionNode.options;
      window.MotionCancelOptimisedAnimation(appearId, "transform", frame, !(layout3 || layoutId));
    }
    const { parent } = projectionNode;
    if (parent && !parent.hasCheckedOptimisedAppear) {
      cancelTreeOptimisedTransformAnimations(parent);
    }
  }
  function createProjectionNode2({ attachResizeListener, defaultParent, measureScroll, checkIsScrollRoot, resetTransform }) {
    return class ProjectionNode {
      constructor(latestValues = {}, parent = defaultParent === null || defaultParent === void 0 ? void 0 : defaultParent()) {
        this.id = id2++;
        this.animationId = 0;
        this.children = /* @__PURE__ */ new Set();
        this.options = {};
        this.isTreeAnimating = false;
        this.isAnimationBlocked = false;
        this.isLayoutDirty = false;
        this.isProjectionDirty = false;
        this.isSharedProjectionDirty = false;
        this.isTransformDirty = false;
        this.updateManuallyBlocked = false;
        this.updateBlockedByResize = false;
        this.isUpdating = false;
        this.isSVG = false;
        this.needsReset = false;
        this.shouldResetTransform = false;
        this.hasCheckedOptimisedAppear = false;
        this.treeScale = { x: 1, y: 1 };
        this.eventHandlers = /* @__PURE__ */ new Map();
        this.hasTreeAnimated = false;
        this.updateScheduled = false;
        this.scheduleUpdate = () => this.update();
        this.projectionUpdateScheduled = false;
        this.checkUpdateFailed = () => {
          if (this.isUpdating) {
            this.isUpdating = false;
            this.clearAllSnapshots();
          }
        };
        this.updateProjection = () => {
          this.projectionUpdateScheduled = false;
          if (isDebug) {
            metrics.totalNodes = metrics.resolvedTargetDeltas = metrics.recalculatedProjection = 0;
          }
          this.nodes.forEach(propagateDirtyNodes);
          this.nodes.forEach(resolveTargetDelta);
          this.nodes.forEach(calcProjection);
          this.nodes.forEach(cleanDirtyNodes);
          if (isDebug) {
            window.MotionDebug.record(metrics);
          }
        };
        this.resolvedRelativeTargetAt = 0;
        this.hasProjected = false;
        this.isVisible = true;
        this.animationProgress = 0;
        this.sharedNodes = /* @__PURE__ */ new Map();
        this.latestValues = latestValues;
        this.root = parent ? parent.root || parent : this;
        this.path = parent ? [...parent.path, parent] : [];
        this.parent = parent;
        this.depth = parent ? parent.depth + 1 : 0;
        for (let i = 0; i < this.path.length; i++) {
          this.path[i].shouldResetTransform = true;
        }
        if (this.root === this)
          this.nodes = new FlatTree();
      }
      addEventListener(name, handler) {
        if (!this.eventHandlers.has(name)) {
          this.eventHandlers.set(name, new SubscriptionManager());
        }
        return this.eventHandlers.get(name).add(handler);
      }
      notifyListeners(name, ...args) {
        const subscriptionManager = this.eventHandlers.get(name);
        subscriptionManager && subscriptionManager.notify(...args);
      }
      hasListeners(name) {
        return this.eventHandlers.has(name);
      }
      /**
       * Lifecycles
       */
      mount(instance, isLayoutDirty = this.root.hasTreeAnimated) {
        if (this.instance)
          return;
        this.isSVG = isSVGElement(instance);
        this.instance = instance;
        const { layoutId, layout: layout3, visualElement } = this.options;
        if (visualElement && !visualElement.current) {
          visualElement.mount(instance);
        }
        this.root.nodes.add(this);
        this.parent && this.parent.children.add(this);
        if (isLayoutDirty && (layout3 || layoutId)) {
          this.isLayoutDirty = true;
        }
        if (attachResizeListener) {
          let cancelDelay;
          const resizeUnblockUpdate = () => this.root.updateBlockedByResize = false;
          attachResizeListener(instance, () => {
            this.root.updateBlockedByResize = true;
            cancelDelay && cancelDelay();
            cancelDelay = delay(resizeUnblockUpdate, 250);
            if (globalProjectionState.hasAnimatedSinceResize) {
              globalProjectionState.hasAnimatedSinceResize = false;
              this.nodes.forEach(finishAnimation);
            }
          });
        }
        if (layoutId) {
          this.root.registerSharedNode(layoutId, this);
        }
        if (this.options.animate !== false && visualElement && (layoutId || layout3)) {
          this.addEventListener("didUpdate", ({ delta, hasLayoutChanged, hasRelativeTargetChanged, layout: newLayout }) => {
            if (this.isTreeAnimationBlocked()) {
              this.target = void 0;
              this.relativeTarget = void 0;
              return;
            }
            const layoutTransition = this.options.transition || visualElement.getDefaultTransition() || defaultLayoutTransition;
            const { onLayoutAnimationStart, onLayoutAnimationComplete } = visualElement.getProps();
            const targetChanged = !this.targetLayout || !boxEqualsRounded(this.targetLayout, newLayout) || hasRelativeTargetChanged;
            const hasOnlyRelativeTargetChanged = !hasLayoutChanged && hasRelativeTargetChanged;
            if (this.options.layoutRoot || this.resumeFrom && this.resumeFrom.instance || hasOnlyRelativeTargetChanged || hasLayoutChanged && (targetChanged || !this.currentAnimation)) {
              if (this.resumeFrom) {
                this.resumingFrom = this.resumeFrom;
                this.resumingFrom.resumingFrom = void 0;
              }
              this.setAnimationOrigin(delta, hasOnlyRelativeTargetChanged);
              const animationOptions = {
                ...getValueTransition(layoutTransition, "layout"),
                onPlay: onLayoutAnimationStart,
                onComplete: onLayoutAnimationComplete
              };
              if (visualElement.shouldReduceMotion || this.options.layoutRoot) {
                animationOptions.delay = 0;
                animationOptions.type = false;
              }
              this.startAnimation(animationOptions);
            } else {
              if (!hasLayoutChanged) {
                finishAnimation(this);
              }
              if (this.isLead() && this.options.onExitComplete) {
                this.options.onExitComplete();
              }
            }
            this.targetLayout = newLayout;
          });
        }
      }
      unmount() {
        this.options.layoutId && this.willUpdate();
        this.root.nodes.remove(this);
        const stack = this.getStack();
        stack && stack.remove(this);
        this.parent && this.parent.children.delete(this);
        this.instance = void 0;
        cancelFrame(this.updateProjection);
      }
      // only on the root
      blockUpdate() {
        this.updateManuallyBlocked = true;
      }
      unblockUpdate() {
        this.updateManuallyBlocked = false;
      }
      isUpdateBlocked() {
        return this.updateManuallyBlocked || this.updateBlockedByResize;
      }
      isTreeAnimationBlocked() {
        return this.isAnimationBlocked || this.parent && this.parent.isTreeAnimationBlocked() || false;
      }
      // Note: currently only running on root node
      startUpdate() {
        if (this.isUpdateBlocked())
          return;
        this.isUpdating = true;
        this.nodes && this.nodes.forEach(resetSkewAndRotation);
        this.animationId++;
      }
      getTransformTemplate() {
        const { visualElement } = this.options;
        return visualElement && visualElement.getProps().transformTemplate;
      }
      willUpdate(shouldNotifyListeners = true) {
        this.root.hasTreeAnimated = true;
        if (this.root.isUpdateBlocked()) {
          this.options.onExitComplete && this.options.onExitComplete();
          return;
        }
        if (window.MotionCancelOptimisedAnimation && !this.hasCheckedOptimisedAppear) {
          cancelTreeOptimisedTransformAnimations(this);
        }
        !this.root.isUpdating && this.root.startUpdate();
        if (this.isLayoutDirty)
          return;
        this.isLayoutDirty = true;
        for (let i = 0; i < this.path.length; i++) {
          const node2 = this.path[i];
          node2.shouldResetTransform = true;
          node2.updateScroll("snapshot");
          if (node2.options.layoutRoot) {
            node2.willUpdate(false);
          }
        }
        const { layoutId, layout: layout3 } = this.options;
        if (layoutId === void 0 && !layout3)
          return;
        const transformTemplate2 = this.getTransformTemplate();
        this.prevTransformTemplateValue = transformTemplate2 ? transformTemplate2(this.latestValues, "") : void 0;
        this.updateSnapshot();
        shouldNotifyListeners && this.notifyListeners("willUpdate");
      }
      update() {
        this.updateScheduled = false;
        const updateWasBlocked = this.isUpdateBlocked();
        if (updateWasBlocked) {
          this.unblockUpdate();
          this.clearAllSnapshots();
          this.nodes.forEach(clearMeasurements);
          return;
        }
        if (!this.isUpdating) {
          this.nodes.forEach(clearIsLayoutDirty);
        }
        this.isUpdating = false;
        this.nodes.forEach(resetTransformStyle);
        this.nodes.forEach(updateLayout);
        this.nodes.forEach(notifyLayoutUpdate);
        this.clearAllSnapshots();
        const now2 = time.now();
        frameData.delta = clamp(0, 1e3 / 60, now2 - frameData.timestamp);
        frameData.timestamp = now2;
        frameData.isProcessing = true;
        frameSteps.update.process(frameData);
        frameSteps.preRender.process(frameData);
        frameSteps.render.process(frameData);
        frameData.isProcessing = false;
      }
      didUpdate() {
        if (!this.updateScheduled) {
          this.updateScheduled = true;
          microtask.read(this.scheduleUpdate);
        }
      }
      clearAllSnapshots() {
        this.nodes.forEach(clearSnapshot);
        this.sharedNodes.forEach(removeLeadSnapshots);
      }
      scheduleUpdateProjection() {
        if (!this.projectionUpdateScheduled) {
          this.projectionUpdateScheduled = true;
          frame.preRender(this.updateProjection, false, true);
        }
      }
      scheduleCheckAfterUnmount() {
        frame.postRender(() => {
          if (this.isLayoutDirty) {
            this.root.didUpdate();
          } else {
            this.root.checkUpdateFailed();
          }
        });
      }
      /**
       * Update measurements
       */
      updateSnapshot() {
        if (this.snapshot || !this.instance)
          return;
        this.snapshot = this.measure();
      }
      updateLayout() {
        if (!this.instance)
          return;
        this.updateScroll();
        if (!(this.options.alwaysMeasureLayout && this.isLead()) && !this.isLayoutDirty) {
          return;
        }
        if (this.resumeFrom && !this.resumeFrom.instance) {
          for (let i = 0; i < this.path.length; i++) {
            const node2 = this.path[i];
            node2.updateScroll();
          }
        }
        const prevLayout = this.layout;
        this.layout = this.measure(false);
        this.layoutCorrected = createBox();
        this.isLayoutDirty = false;
        this.projectionDelta = void 0;
        this.notifyListeners("measure", this.layout.layoutBox);
        const { visualElement } = this.options;
        visualElement && visualElement.notify("LayoutMeasure", this.layout.layoutBox, prevLayout ? prevLayout.layoutBox : void 0);
      }
      updateScroll(phase = "measure") {
        let needsMeasurement = Boolean(this.options.layoutScroll && this.instance);
        if (this.scroll && this.scroll.animationId === this.root.animationId && this.scroll.phase === phase) {
          needsMeasurement = false;
        }
        if (needsMeasurement) {
          const isRoot = checkIsScrollRoot(this.instance);
          this.scroll = {
            animationId: this.root.animationId,
            phase,
            isRoot,
            offset: measureScroll(this.instance),
            wasRoot: this.scroll ? this.scroll.isRoot : isRoot
          };
        }
      }
      resetTransform() {
        if (!resetTransform)
          return;
        const isResetRequested = this.isLayoutDirty || this.shouldResetTransform || this.options.alwaysMeasureLayout;
        const hasProjection = this.projectionDelta && !isDeltaZero(this.projectionDelta);
        const transformTemplate2 = this.getTransformTemplate();
        const transformTemplateValue = transformTemplate2 ? transformTemplate2(this.latestValues, "") : void 0;
        const transformTemplateHasChanged = transformTemplateValue !== this.prevTransformTemplateValue;
        if (isResetRequested && (hasProjection || hasTransform(this.latestValues) || transformTemplateHasChanged)) {
          resetTransform(this.instance, transformTemplateValue);
          this.shouldResetTransform = false;
          this.scheduleRender();
        }
      }
      measure(removeTransform = true) {
        const pageBox = this.measurePageBox();
        let layoutBox = this.removeElementScroll(pageBox);
        if (removeTransform) {
          layoutBox = this.removeTransform(layoutBox);
        }
        roundBox(layoutBox);
        return {
          animationId: this.root.animationId,
          measuredBox: pageBox,
          layoutBox,
          latestValues: {},
          source: this.id
        };
      }
      measurePageBox() {
        var _a;
        const { visualElement } = this.options;
        if (!visualElement)
          return createBox();
        const box = visualElement.measureViewportBox();
        const wasInScrollRoot = ((_a = this.scroll) === null || _a === void 0 ? void 0 : _a.wasRoot) || this.path.some(checkNodeWasScrollRoot);
        if (!wasInScrollRoot) {
          const { scroll: scroll2 } = this.root;
          if (scroll2) {
            translateAxis(box.x, scroll2.offset.x);
            translateAxis(box.y, scroll2.offset.y);
          }
        }
        return box;
      }
      removeElementScroll(box) {
        var _a;
        const boxWithoutScroll = createBox();
        copyBoxInto(boxWithoutScroll, box);
        if ((_a = this.scroll) === null || _a === void 0 ? void 0 : _a.wasRoot) {
          return boxWithoutScroll;
        }
        for (let i = 0; i < this.path.length; i++) {
          const node2 = this.path[i];
          const { scroll: scroll2, options } = node2;
          if (node2 !== this.root && scroll2 && options.layoutScroll) {
            if (scroll2.wasRoot) {
              copyBoxInto(boxWithoutScroll, box);
            }
            translateAxis(boxWithoutScroll.x, scroll2.offset.x);
            translateAxis(boxWithoutScroll.y, scroll2.offset.y);
          }
        }
        return boxWithoutScroll;
      }
      applyTransform(box, transformOnly = false) {
        const withTransforms = createBox();
        copyBoxInto(withTransforms, box);
        for (let i = 0; i < this.path.length; i++) {
          const node2 = this.path[i];
          if (!transformOnly && node2.options.layoutScroll && node2.scroll && node2 !== node2.root) {
            transformBox(withTransforms, {
              x: -node2.scroll.offset.x,
              y: -node2.scroll.offset.y
            });
          }
          if (!hasTransform(node2.latestValues))
            continue;
          transformBox(withTransforms, node2.latestValues);
        }
        if (hasTransform(this.latestValues)) {
          transformBox(withTransforms, this.latestValues);
        }
        return withTransforms;
      }
      removeTransform(box) {
        const boxWithoutTransform = createBox();
        copyBoxInto(boxWithoutTransform, box);
        for (let i = 0; i < this.path.length; i++) {
          const node2 = this.path[i];
          if (!node2.instance)
            continue;
          if (!hasTransform(node2.latestValues))
            continue;
          hasScale(node2.latestValues) && node2.updateSnapshot();
          const sourceBox = createBox();
          const nodeBox = node2.measurePageBox();
          copyBoxInto(sourceBox, nodeBox);
          removeBoxTransforms(boxWithoutTransform, node2.latestValues, node2.snapshot ? node2.snapshot.layoutBox : void 0, sourceBox);
        }
        if (hasTransform(this.latestValues)) {
          removeBoxTransforms(boxWithoutTransform, this.latestValues);
        }
        return boxWithoutTransform;
      }
      setTargetDelta(delta) {
        this.targetDelta = delta;
        this.root.scheduleUpdateProjection();
        this.isProjectionDirty = true;
      }
      setOptions(options) {
        this.options = {
          ...this.options,
          ...options,
          crossfade: options.crossfade !== void 0 ? options.crossfade : true
        };
      }
      clearMeasurements() {
        this.scroll = void 0;
        this.layout = void 0;
        this.snapshot = void 0;
        this.prevTransformTemplateValue = void 0;
        this.targetDelta = void 0;
        this.target = void 0;
        this.isLayoutDirty = false;
      }
      forceRelativeParentToResolveTarget() {
        if (!this.relativeParent)
          return;
        if (this.relativeParent.resolvedRelativeTargetAt !== frameData.timestamp) {
          this.relativeParent.resolveTargetDelta(true);
        }
      }
      resolveTargetDelta(forceRecalculation = false) {
        var _a;
        const lead = this.getLead();
        this.isProjectionDirty || (this.isProjectionDirty = lead.isProjectionDirty);
        this.isTransformDirty || (this.isTransformDirty = lead.isTransformDirty);
        this.isSharedProjectionDirty || (this.isSharedProjectionDirty = lead.isSharedProjectionDirty);
        const isShared = Boolean(this.resumingFrom) || this !== lead;
        const canSkip = !(forceRecalculation || isShared && this.isSharedProjectionDirty || this.isProjectionDirty || ((_a = this.parent) === null || _a === void 0 ? void 0 : _a.isProjectionDirty) || this.attemptToResolveRelativeTarget || this.root.updateBlockedByResize);
        if (canSkip)
          return;
        const { layout: layout3, layoutId } = this.options;
        if (!this.layout || !(layout3 || layoutId))
          return;
        this.resolvedRelativeTargetAt = frameData.timestamp;
        if (!this.targetDelta && !this.relativeTarget) {
          const relativeParent = this.getClosestProjectingParent();
          if (relativeParent && relativeParent.layout && this.animationProgress !== 1) {
            this.relativeParent = relativeParent;
            this.forceRelativeParentToResolveTarget();
            this.relativeTarget = createBox();
            this.relativeTargetOrigin = createBox();
            calcRelativePosition(this.relativeTargetOrigin, this.layout.layoutBox, relativeParent.layout.layoutBox);
            copyBoxInto(this.relativeTarget, this.relativeTargetOrigin);
          } else {
            this.relativeParent = this.relativeTarget = void 0;
          }
        }
        if (!this.relativeTarget && !this.targetDelta)
          return;
        if (!this.target) {
          this.target = createBox();
          this.targetWithTransforms = createBox();
        }
        if (this.relativeTarget && this.relativeTargetOrigin && this.relativeParent && this.relativeParent.target) {
          this.forceRelativeParentToResolveTarget();
          calcRelativeBox(this.target, this.relativeTarget, this.relativeParent.target);
        } else if (this.targetDelta) {
          if (Boolean(this.resumingFrom)) {
            this.target = this.applyTransform(this.layout.layoutBox);
          } else {
            copyBoxInto(this.target, this.layout.layoutBox);
          }
          applyBoxDelta(this.target, this.targetDelta);
        } else {
          copyBoxInto(this.target, this.layout.layoutBox);
        }
        if (this.attemptToResolveRelativeTarget) {
          this.attemptToResolveRelativeTarget = false;
          const relativeParent = this.getClosestProjectingParent();
          if (relativeParent && Boolean(relativeParent.resumingFrom) === Boolean(this.resumingFrom) && !relativeParent.options.layoutScroll && relativeParent.target && this.animationProgress !== 1) {
            this.relativeParent = relativeParent;
            this.forceRelativeParentToResolveTarget();
            this.relativeTarget = createBox();
            this.relativeTargetOrigin = createBox();
            calcRelativePosition(this.relativeTargetOrigin, this.target, relativeParent.target);
            copyBoxInto(this.relativeTarget, this.relativeTargetOrigin);
          } else {
            this.relativeParent = this.relativeTarget = void 0;
          }
        }
        if (isDebug) {
          metrics.resolvedTargetDeltas++;
        }
      }
      getClosestProjectingParent() {
        if (!this.parent || hasScale(this.parent.latestValues) || has2DTranslate(this.parent.latestValues)) {
          return void 0;
        }
        if (this.parent.isProjecting()) {
          return this.parent;
        } else {
          return this.parent.getClosestProjectingParent();
        }
      }
      isProjecting() {
        return Boolean((this.relativeTarget || this.targetDelta || this.options.layoutRoot) && this.layout);
      }
      calcProjection() {
        var _a;
        const lead = this.getLead();
        const isShared = Boolean(this.resumingFrom) || this !== lead;
        let canSkip = true;
        if (this.isProjectionDirty || ((_a = this.parent) === null || _a === void 0 ? void 0 : _a.isProjectionDirty)) {
          canSkip = false;
        }
        if (isShared && (this.isSharedProjectionDirty || this.isTransformDirty)) {
          canSkip = false;
        }
        if (this.resolvedRelativeTargetAt === frameData.timestamp) {
          canSkip = false;
        }
        if (canSkip)
          return;
        const { layout: layout3, layoutId } = this.options;
        this.isTreeAnimating = Boolean(this.parent && this.parent.isTreeAnimating || this.currentAnimation || this.pendingAnimation);
        if (!this.isTreeAnimating) {
          this.targetDelta = this.relativeTarget = void 0;
        }
        if (!this.layout || !(layout3 || layoutId))
          return;
        copyBoxInto(this.layoutCorrected, this.layout.layoutBox);
        const prevTreeScaleX = this.treeScale.x;
        const prevTreeScaleY = this.treeScale.y;
        applyTreeDeltas(this.layoutCorrected, this.treeScale, this.path, isShared);
        if (lead.layout && !lead.target && (this.treeScale.x !== 1 || this.treeScale.y !== 1)) {
          lead.target = lead.layout.layoutBox;
          lead.targetWithTransforms = createBox();
        }
        const { target } = lead;
        if (!target) {
          if (this.prevProjectionDelta) {
            this.createProjectionDeltas();
            this.scheduleRender();
          }
          return;
        }
        if (!this.projectionDelta || !this.prevProjectionDelta) {
          this.createProjectionDeltas();
        } else {
          copyAxisDeltaInto(this.prevProjectionDelta.x, this.projectionDelta.x);
          copyAxisDeltaInto(this.prevProjectionDelta.y, this.projectionDelta.y);
        }
        calcBoxDelta(this.projectionDelta, this.layoutCorrected, target, this.latestValues);
        if (this.treeScale.x !== prevTreeScaleX || this.treeScale.y !== prevTreeScaleY || !axisDeltaEquals(this.projectionDelta.x, this.prevProjectionDelta.x) || !axisDeltaEquals(this.projectionDelta.y, this.prevProjectionDelta.y)) {
          this.hasProjected = true;
          this.scheduleRender();
          this.notifyListeners("projectionUpdate", target);
        }
        if (isDebug) {
          metrics.recalculatedProjection++;
        }
      }
      hide() {
        this.isVisible = false;
      }
      show() {
        this.isVisible = true;
      }
      scheduleRender(notifyAll = true) {
        var _a;
        (_a = this.options.visualElement) === null || _a === void 0 ? void 0 : _a.scheduleRender();
        if (notifyAll) {
          const stack = this.getStack();
          stack && stack.scheduleRender();
        }
        if (this.resumingFrom && !this.resumingFrom.instance) {
          this.resumingFrom = void 0;
        }
      }
      createProjectionDeltas() {
        this.prevProjectionDelta = createDelta();
        this.projectionDelta = createDelta();
        this.projectionDeltaWithTransform = createDelta();
      }
      setAnimationOrigin(delta, hasOnlyRelativeTargetChanged = false) {
        const snapshot = this.snapshot;
        const snapshotLatestValues = snapshot ? snapshot.latestValues : {};
        const mixedValues = { ...this.latestValues };
        const targetDelta = createDelta();
        if (!this.relativeParent || !this.relativeParent.options.layoutRoot) {
          this.relativeTarget = this.relativeTargetOrigin = void 0;
        }
        this.attemptToResolveRelativeTarget = !hasOnlyRelativeTargetChanged;
        const relativeLayout = createBox();
        const snapshotSource = snapshot ? snapshot.source : void 0;
        const layoutSource = this.layout ? this.layout.source : void 0;
        const isSharedLayoutAnimation = snapshotSource !== layoutSource;
        const stack = this.getStack();
        const isOnlyMember = !stack || stack.members.length <= 1;
        const shouldCrossfadeOpacity = Boolean(isSharedLayoutAnimation && !isOnlyMember && this.options.crossfade === true && !this.path.some(hasOpacityCrossfade));
        this.animationProgress = 0;
        let prevRelativeTarget;
        this.mixTargetDelta = (latest) => {
          const progress2 = latest / 1e3;
          mixAxisDelta(targetDelta.x, delta.x, progress2);
          mixAxisDelta(targetDelta.y, delta.y, progress2);
          this.setTargetDelta(targetDelta);
          if (this.relativeTarget && this.relativeTargetOrigin && this.layout && this.relativeParent && this.relativeParent.layout) {
            calcRelativePosition(relativeLayout, this.layout.layoutBox, this.relativeParent.layout.layoutBox);
            mixBox(this.relativeTarget, this.relativeTargetOrigin, relativeLayout, progress2);
            if (prevRelativeTarget && boxEquals(this.relativeTarget, prevRelativeTarget)) {
              this.isProjectionDirty = false;
            }
            if (!prevRelativeTarget)
              prevRelativeTarget = createBox();
            copyBoxInto(prevRelativeTarget, this.relativeTarget);
          }
          if (isSharedLayoutAnimation) {
            this.animationValues = mixedValues;
            mixValues(mixedValues, snapshotLatestValues, this.latestValues, progress2, shouldCrossfadeOpacity, isOnlyMember);
          }
          this.root.scheduleUpdateProjection();
          this.scheduleRender();
          this.animationProgress = progress2;
        };
        this.mixTargetDelta(this.options.layoutRoot ? 1e3 : 0);
      }
      startAnimation(options) {
        this.notifyListeners("animationStart");
        this.currentAnimation && this.currentAnimation.stop();
        if (this.resumingFrom && this.resumingFrom.currentAnimation) {
          this.resumingFrom.currentAnimation.stop();
        }
        if (this.pendingAnimation) {
          cancelFrame(this.pendingAnimation);
          this.pendingAnimation = void 0;
        }
        this.pendingAnimation = frame.update(() => {
          globalProjectionState.hasAnimatedSinceResize = true;
          this.currentAnimation = animateSingleValue(0, animationTarget, {
            ...options,
            onUpdate: (latest) => {
              this.mixTargetDelta(latest);
              options.onUpdate && options.onUpdate(latest);
            },
            onComplete: () => {
              options.onComplete && options.onComplete();
              this.completeAnimation();
            }
          });
          if (this.resumingFrom) {
            this.resumingFrom.currentAnimation = this.currentAnimation;
          }
          this.pendingAnimation = void 0;
        });
      }
      completeAnimation() {
        if (this.resumingFrom) {
          this.resumingFrom.currentAnimation = void 0;
          this.resumingFrom.preserveOpacity = void 0;
        }
        const stack = this.getStack();
        stack && stack.exitAnimationComplete();
        this.resumingFrom = this.currentAnimation = this.animationValues = void 0;
        this.notifyListeners("animationComplete");
      }
      finishAnimation() {
        if (this.currentAnimation) {
          this.mixTargetDelta && this.mixTargetDelta(animationTarget);
          this.currentAnimation.stop();
        }
        this.completeAnimation();
      }
      applyTransformsToTarget() {
        const lead = this.getLead();
        let { targetWithTransforms, target, layout: layout3, latestValues } = lead;
        if (!targetWithTransforms || !target || !layout3)
          return;
        if (this !== lead && this.layout && layout3 && shouldAnimatePositionOnly(this.options.animationType, this.layout.layoutBox, layout3.layoutBox)) {
          target = this.target || createBox();
          const xLength = calcLength(this.layout.layoutBox.x);
          target.x.min = lead.target.x.min;
          target.x.max = target.x.min + xLength;
          const yLength = calcLength(this.layout.layoutBox.y);
          target.y.min = lead.target.y.min;
          target.y.max = target.y.min + yLength;
        }
        copyBoxInto(targetWithTransforms, target);
        transformBox(targetWithTransforms, latestValues);
        calcBoxDelta(this.projectionDeltaWithTransform, this.layoutCorrected, targetWithTransforms, latestValues);
      }
      registerSharedNode(layoutId, node2) {
        if (!this.sharedNodes.has(layoutId)) {
          this.sharedNodes.set(layoutId, new NodeStack());
        }
        const stack = this.sharedNodes.get(layoutId);
        stack.add(node2);
        const config2 = node2.options.initialPromotionConfig;
        node2.promote({
          transition: config2 ? config2.transition : void 0,
          preserveFollowOpacity: config2 && config2.shouldPreserveFollowOpacity ? config2.shouldPreserveFollowOpacity(node2) : void 0
        });
      }
      isLead() {
        const stack = this.getStack();
        return stack ? stack.lead === this : true;
      }
      getLead() {
        var _a;
        const { layoutId } = this.options;
        return layoutId ? ((_a = this.getStack()) === null || _a === void 0 ? void 0 : _a.lead) || this : this;
      }
      getPrevLead() {
        var _a;
        const { layoutId } = this.options;
        return layoutId ? (_a = this.getStack()) === null || _a === void 0 ? void 0 : _a.prevLead : void 0;
      }
      getStack() {
        const { layoutId } = this.options;
        if (layoutId)
          return this.root.sharedNodes.get(layoutId);
      }
      promote({ needsReset, transition: transition3, preserveFollowOpacity } = {}) {
        const stack = this.getStack();
        if (stack)
          stack.promote(this, preserveFollowOpacity);
        if (needsReset) {
          this.projectionDelta = void 0;
          this.needsReset = true;
        }
        if (transition3)
          this.setOptions({ transition: transition3 });
      }
      relegate() {
        const stack = this.getStack();
        if (stack) {
          return stack.relegate(this);
        } else {
          return false;
        }
      }
      resetSkewAndRotation() {
        const { visualElement } = this.options;
        if (!visualElement)
          return;
        let hasDistortingTransform = false;
        const { latestValues } = visualElement;
        if (latestValues.z || latestValues.rotate || latestValues.rotateX || latestValues.rotateY || latestValues.rotateZ || latestValues.skewX || latestValues.skewY) {
          hasDistortingTransform = true;
        }
        if (!hasDistortingTransform)
          return;
        const resetValues = {};
        if (latestValues.z) {
          resetDistortingTransform("z", visualElement, resetValues, this.animationValues);
        }
        for (let i = 0; i < transformAxes.length; i++) {
          resetDistortingTransform(`rotate${transformAxes[i]}`, visualElement, resetValues, this.animationValues);
          resetDistortingTransform(`skew${transformAxes[i]}`, visualElement, resetValues, this.animationValues);
        }
        visualElement.render();
        for (const key in resetValues) {
          visualElement.setStaticValue(key, resetValues[key]);
          if (this.animationValues) {
            this.animationValues[key] = resetValues[key];
          }
        }
        visualElement.scheduleRender();
      }
      getProjectionStyles(styleProp) {
        var _a, _b;
        if (!this.instance || this.isSVG)
          return void 0;
        if (!this.isVisible) {
          return hiddenVisibility;
        }
        const styles2 = {
          visibility: ""
        };
        const transformTemplate2 = this.getTransformTemplate();
        if (this.needsReset) {
          this.needsReset = false;
          styles2.opacity = "";
          styles2.pointerEvents = resolveMotionValue(styleProp === null || styleProp === void 0 ? void 0 : styleProp.pointerEvents) || "";
          styles2.transform = transformTemplate2 ? transformTemplate2(this.latestValues, "") : "none";
          return styles2;
        }
        const lead = this.getLead();
        if (!this.projectionDelta || !this.layout || !lead.target) {
          const emptyStyles = {};
          if (this.options.layoutId) {
            emptyStyles.opacity = this.latestValues.opacity !== void 0 ? this.latestValues.opacity : 1;
            emptyStyles.pointerEvents = resolveMotionValue(styleProp === null || styleProp === void 0 ? void 0 : styleProp.pointerEvents) || "";
          }
          if (this.hasProjected && !hasTransform(this.latestValues)) {
            emptyStyles.transform = transformTemplate2 ? transformTemplate2({}, "") : "none";
            this.hasProjected = false;
          }
          return emptyStyles;
        }
        const valuesToRender = lead.animationValues || lead.latestValues;
        this.applyTransformsToTarget();
        styles2.transform = buildProjectionTransform(this.projectionDeltaWithTransform, this.treeScale, valuesToRender);
        if (transformTemplate2) {
          styles2.transform = transformTemplate2(valuesToRender, styles2.transform);
        }
        const { x, y } = this.projectionDelta;
        styles2.transformOrigin = `${x.origin * 100}% ${y.origin * 100}% 0`;
        if (lead.animationValues) {
          styles2.opacity = lead === this ? (_b = (_a = valuesToRender.opacity) !== null && _a !== void 0 ? _a : this.latestValues.opacity) !== null && _b !== void 0 ? _b : 1 : this.preserveOpacity ? this.latestValues.opacity : valuesToRender.opacityExit;
        } else {
          styles2.opacity = lead === this ? valuesToRender.opacity !== void 0 ? valuesToRender.opacity : "" : valuesToRender.opacityExit !== void 0 ? valuesToRender.opacityExit : 0;
        }
        for (const key in scaleCorrectors) {
          if (valuesToRender[key] === void 0)
            continue;
          const { correct, applyTo } = scaleCorrectors[key];
          const corrected = styles2.transform === "none" ? valuesToRender[key] : correct(valuesToRender[key], lead);
          if (applyTo) {
            const num = applyTo.length;
            for (let i = 0; i < num; i++) {
              styles2[applyTo[i]] = corrected;
            }
          } else {
            styles2[key] = corrected;
          }
        }
        if (this.options.layoutId) {
          styles2.pointerEvents = lead === this ? resolveMotionValue(styleProp === null || styleProp === void 0 ? void 0 : styleProp.pointerEvents) || "" : "none";
        }
        return styles2;
      }
      clearSnapshot() {
        this.resumeFrom = this.snapshot = void 0;
      }
      // Only run on root
      resetTree() {
        this.root.nodes.forEach((node2) => {
          var _a;
          return (_a = node2.currentAnimation) === null || _a === void 0 ? void 0 : _a.stop();
        });
        this.root.nodes.forEach(clearMeasurements);
        this.root.sharedNodes.clear();
      }
    };
  }
  function updateLayout(node2) {
    node2.updateLayout();
  }
  function notifyLayoutUpdate(node2) {
    var _a;
    const snapshot = ((_a = node2.resumeFrom) === null || _a === void 0 ? void 0 : _a.snapshot) || node2.snapshot;
    if (node2.isLead() && node2.layout && snapshot && node2.hasListeners("didUpdate")) {
      const { layoutBox: layout3, measuredBox: measuredLayout } = node2.layout;
      const { animationType } = node2.options;
      const isShared = snapshot.source !== node2.layout.source;
      if (animationType === "size") {
        eachAxis((axis) => {
          const axisSnapshot = isShared ? snapshot.measuredBox[axis] : snapshot.layoutBox[axis];
          const length2 = calcLength(axisSnapshot);
          axisSnapshot.min = layout3[axis].min;
          axisSnapshot.max = axisSnapshot.min + length2;
        });
      } else if (shouldAnimatePositionOnly(animationType, snapshot.layoutBox, layout3)) {
        eachAxis((axis) => {
          const axisSnapshot = isShared ? snapshot.measuredBox[axis] : snapshot.layoutBox[axis];
          const length2 = calcLength(layout3[axis]);
          axisSnapshot.max = axisSnapshot.min + length2;
          if (node2.relativeTarget && !node2.currentAnimation) {
            node2.isProjectionDirty = true;
            node2.relativeTarget[axis].max = node2.relativeTarget[axis].min + length2;
          }
        });
      }
      const layoutDelta = createDelta();
      calcBoxDelta(layoutDelta, layout3, snapshot.layoutBox);
      const visualDelta = createDelta();
      if (isShared) {
        calcBoxDelta(visualDelta, node2.applyTransform(measuredLayout, true), snapshot.measuredBox);
      } else {
        calcBoxDelta(visualDelta, layout3, snapshot.layoutBox);
      }
      const hasLayoutChanged = !isDeltaZero(layoutDelta);
      let hasRelativeTargetChanged = false;
      if (!node2.resumeFrom) {
        const relativeParent = node2.getClosestProjectingParent();
        if (relativeParent && !relativeParent.resumeFrom) {
          const { snapshot: parentSnapshot, layout: parentLayout } = relativeParent;
          if (parentSnapshot && parentLayout) {
            const relativeSnapshot = createBox();
            calcRelativePosition(relativeSnapshot, snapshot.layoutBox, parentSnapshot.layoutBox);
            const relativeLayout = createBox();
            calcRelativePosition(relativeLayout, layout3, parentLayout.layoutBox);
            if (!boxEqualsRounded(relativeSnapshot, relativeLayout)) {
              hasRelativeTargetChanged = true;
            }
            if (relativeParent.options.layoutRoot) {
              node2.relativeTarget = relativeLayout;
              node2.relativeTargetOrigin = relativeSnapshot;
              node2.relativeParent = relativeParent;
            }
          }
        }
      }
      node2.notifyListeners("didUpdate", {
        layout: layout3,
        snapshot,
        delta: visualDelta,
        layoutDelta,
        hasLayoutChanged,
        hasRelativeTargetChanged
      });
    } else if (node2.isLead()) {
      const { onExitComplete } = node2.options;
      onExitComplete && onExitComplete();
    }
    node2.options.transition = void 0;
  }
  function propagateDirtyNodes(node2) {
    if (isDebug) {
      metrics.totalNodes++;
    }
    if (!node2.parent)
      return;
    if (!node2.isProjecting()) {
      node2.isProjectionDirty = node2.parent.isProjectionDirty;
    }
    node2.isSharedProjectionDirty || (node2.isSharedProjectionDirty = Boolean(node2.isProjectionDirty || node2.parent.isProjectionDirty || node2.parent.isSharedProjectionDirty));
    node2.isTransformDirty || (node2.isTransformDirty = node2.parent.isTransformDirty);
  }
  function cleanDirtyNodes(node2) {
    node2.isProjectionDirty = node2.isSharedProjectionDirty = node2.isTransformDirty = false;
  }
  function clearSnapshot(node2) {
    node2.clearSnapshot();
  }
  function clearMeasurements(node2) {
    node2.clearMeasurements();
  }
  function clearIsLayoutDirty(node2) {
    node2.isLayoutDirty = false;
  }
  function resetTransformStyle(node2) {
    const { visualElement } = node2.options;
    if (visualElement && visualElement.getProps().onBeforeLayoutMeasure) {
      visualElement.notify("BeforeLayoutMeasure");
    }
    node2.resetTransform();
  }
  function finishAnimation(node2) {
    node2.finishAnimation();
    node2.targetDelta = node2.relativeTarget = node2.target = void 0;
    node2.isProjectionDirty = true;
  }
  function resolveTargetDelta(node2) {
    node2.resolveTargetDelta();
  }
  function calcProjection(node2) {
    node2.calcProjection();
  }
  function resetSkewAndRotation(node2) {
    node2.resetSkewAndRotation();
  }
  function removeLeadSnapshots(stack) {
    stack.removeLeadSnapshot();
  }
  function mixAxisDelta(output, delta, p) {
    output.translate = mixNumber(delta.translate, 0, p);
    output.scale = mixNumber(delta.scale, 1, p);
    output.origin = delta.origin;
    output.originPoint = delta.originPoint;
  }
  function mixAxis(output, from2, to, p) {
    output.min = mixNumber(from2.min, to.min, p);
    output.max = mixNumber(from2.max, to.max, p);
  }
  function mixBox(output, from2, to, p) {
    mixAxis(output.x, from2.x, to.x, p);
    mixAxis(output.y, from2.y, to.y, p);
  }
  function hasOpacityCrossfade(node2) {
    return node2.animationValues && node2.animationValues.opacityExit !== void 0;
  }
  var defaultLayoutTransition = {
    duration: 0.45,
    ease: [0.4, 0, 0.1, 1]
  };
  var userAgentContains = (string) => typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().includes(string);
  var roundPoint = userAgentContains("applewebkit/") && !userAgentContains("chrome/") ? Math.round : noop2;
  function roundAxis(axis) {
    axis.min = roundPoint(axis.min);
    axis.max = roundPoint(axis.max);
  }
  function roundBox(box) {
    roundAxis(box.x);
    roundAxis(box.y);
  }
  function shouldAnimatePositionOnly(animationType, snapshot, layout3) {
    return animationType === "position" || animationType === "preserve-aspect" && !isNear(aspectRatio(snapshot), aspectRatio(layout3), 0.2);
  }
  function checkNodeWasScrollRoot(node2) {
    var _a;
    return node2 !== node2.root && ((_a = node2.scroll) === null || _a === void 0 ? void 0 : _a.wasRoot);
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/node/DocumentProjectionNode.mjs
  init_define_import_meta_env();
  var DocumentProjectionNode = createProjectionNode2({
    attachResizeListener: (ref, notify) => addDomEvent(ref, "resize", notify),
    measureScroll: () => ({
      x: document.documentElement.scrollLeft || document.body.scrollLeft,
      y: document.documentElement.scrollTop || document.body.scrollTop
    }),
    checkIsScrollRoot: () => true
  });

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/projection/node/HTMLProjectionNode.mjs
  var rootProjectionNode = {
    current: void 0
  };
  var HTMLProjectionNode = createProjectionNode2({
    measureScroll: (instance) => ({
      x: instance.scrollLeft,
      y: instance.scrollTop
    }),
    defaultParent: () => {
      if (!rootProjectionNode.current) {
        const documentNode = new DocumentProjectionNode({});
        documentNode.mount(window);
        documentNode.setOptions({ layoutScroll: true });
        rootProjectionNode.current = documentNode;
      }
      return rootProjectionNode.current;
    },
    resetTransform: (instance, value) => {
      instance.style.transform = value !== void 0 ? value : "none";
    },
    checkIsScrollRoot: (instance) => Boolean(window.getComputedStyle(instance).position === "fixed")
  });

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/features/drag.mjs
  var drag = {
    pan: {
      Feature: PanGesture
    },
    drag: {
      Feature: DragGesture,
      ProjectionNode: HTMLProjectionNode,
      MeasureLayout
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/features/gestures.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/gestures/hover.mjs
  init_define_import_meta_env();
  function handleHoverEvent(node2, event, lifecycle) {
    const { props } = node2;
    if (node2.animationState && props.whileHover) {
      node2.animationState.setActive("whileHover", lifecycle === "Start");
    }
    const eventName = "onHover" + lifecycle;
    const callback = props[eventName];
    if (callback) {
      frame.postRender(() => callback(event, extractEventInfo(event)));
    }
  }
  var HoverGesture = class extends Feature {
    mount() {
      const { current } = this.node;
      if (!current)
        return;
      this.unmount = hover(current, (startEvent) => {
        handleHoverEvent(this.node, startEvent, "Start");
        return (endEvent) => handleHoverEvent(this.node, endEvent, "End");
      });
    }
    unmount() {
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/gestures/focus.mjs
  init_define_import_meta_env();
  var FocusGesture = class extends Feature {
    constructor() {
      super(...arguments);
      this.isActive = false;
    }
    onFocus() {
      let isFocusVisible = false;
      try {
        isFocusVisible = this.node.current.matches(":focus-visible");
      } catch (e) {
        isFocusVisible = true;
      }
      if (!isFocusVisible || !this.node.animationState)
        return;
      this.node.animationState.setActive("whileFocus", true);
      this.isActive = true;
    }
    onBlur() {
      if (!this.isActive || !this.node.animationState)
        return;
      this.node.animationState.setActive("whileFocus", false);
      this.isActive = false;
    }
    mount() {
      this.unmount = pipe2(addDomEvent(this.node.current, "focus", () => this.onFocus()), addDomEvent(this.node.current, "blur", () => this.onBlur()));
    }
    unmount() {
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/gestures/press.mjs
  init_define_import_meta_env();
  function handlePressEvent(node2, event, lifecycle) {
    const { props } = node2;
    if (node2.animationState && props.whileTap) {
      node2.animationState.setActive("whileTap", lifecycle === "Start");
    }
    const eventName = "onTap" + (lifecycle === "End" ? "" : lifecycle);
    const callback = props[eventName];
    if (callback) {
      frame.postRender(() => callback(event, extractEventInfo(event)));
    }
  }
  var PressGesture = class extends Feature {
    mount() {
      const { current } = this.node;
      if (!current)
        return;
      this.unmount = press(current, (startEvent) => {
        handlePressEvent(this.node, startEvent, "Start");
        return (endEvent, { success }) => handlePressEvent(this.node, endEvent, success ? "End" : "Cancel");
      }, { useGlobalTarget: this.node.props.globalTapTarget });
    }
    unmount() {
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/features/viewport/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/features/viewport/observers.mjs
  init_define_import_meta_env();
  var observerCallbacks = /* @__PURE__ */ new WeakMap();
  var observers = /* @__PURE__ */ new WeakMap();
  var fireObserverCallback = (entry) => {
    const callback = observerCallbacks.get(entry.target);
    callback && callback(entry);
  };
  var fireAllObserverCallbacks = (entries) => {
    entries.forEach(fireObserverCallback);
  };
  function initIntersectionObserver({ root, ...options }) {
    const lookupRoot = root || document;
    if (!observers.has(lookupRoot)) {
      observers.set(lookupRoot, {});
    }
    const rootObservers = observers.get(lookupRoot);
    const key = JSON.stringify(options);
    if (!rootObservers[key]) {
      rootObservers[key] = new IntersectionObserver(fireAllObserverCallbacks, { root, ...options });
    }
    return rootObservers[key];
  }
  function observeIntersection(element, options, callback) {
    const rootInteresectionObserver = initIntersectionObserver(options);
    observerCallbacks.set(element, callback);
    rootInteresectionObserver.observe(element);
    return () => {
      observerCallbacks.delete(element);
      rootInteresectionObserver.unobserve(element);
    };
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/features/viewport/index.mjs
  var thresholdNames = {
    some: 0,
    all: 1
  };
  var InViewFeature = class extends Feature {
    constructor() {
      super(...arguments);
      this.hasEnteredView = false;
      this.isInView = false;
    }
    startObserver() {
      this.unmount();
      const { viewport = {} } = this.node.getProps();
      const { root, margin: rootMargin, amount = "some", once } = viewport;
      const options = {
        root: root ? root.current : void 0,
        rootMargin,
        threshold: typeof amount === "number" ? amount : thresholdNames[amount]
      };
      const onIntersectionUpdate = (entry) => {
        const { isIntersecting } = entry;
        if (this.isInView === isIntersecting)
          return;
        this.isInView = isIntersecting;
        if (once && !isIntersecting && this.hasEnteredView) {
          return;
        } else if (isIntersecting) {
          this.hasEnteredView = true;
        }
        if (this.node.animationState) {
          this.node.animationState.setActive("whileInView", isIntersecting);
        }
        const { onViewportEnter, onViewportLeave } = this.node.getProps();
        const callback = isIntersecting ? onViewportEnter : onViewportLeave;
        callback && callback(entry);
      };
      return observeIntersection(this.node.current, options, onIntersectionUpdate);
    }
    mount() {
      this.startObserver();
    }
    update() {
      if (typeof IntersectionObserver === "undefined")
        return;
      const { props, prevProps } = this.node;
      const hasOptionsChanged = ["amount", "margin", "root"].some(hasViewportOptionChanged(props, prevProps));
      if (hasOptionsChanged) {
        this.startObserver();
      }
    }
    unmount() {
    }
  };
  function hasViewportOptionChanged({ viewport = {} }, { viewport: prevViewport = {} } = {}) {
    return (name) => viewport[name] !== prevViewport[name];
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/features/gestures.mjs
  var gestureAnimations = {
    inView: {
      Feature: InViewFeature
    },
    tap: {
      Feature: PressGesture
    },
    focus: {
      Feature: FocusGesture
    },
    hover: {
      Feature: HoverGesture
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/motion/features/layout.mjs
  init_define_import_meta_env();
  var layout2 = {
    layout: {
      ProjectionNode: HTMLProjectionNode,
      MeasureLayout
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/create-visual-element.mjs
  init_define_import_meta_env();
  var import_react36 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/html/HTMLVisualElement.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/DOMVisualElement.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/VisualElement.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/reduced-motion/index.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/reduced-motion/state.mjs
  init_define_import_meta_env();
  var prefersReducedMotion = { current: null };
  var hasReducedMotionListener = { current: false };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/utils/reduced-motion/index.mjs
  function initPrefersReducedMotion() {
    hasReducedMotionListener.current = true;
    if (!isBrowser3)
      return;
    if (window.matchMedia) {
      const motionMediaQuery = window.matchMedia("(prefers-reduced-motion)");
      const setReducedMotionPreferences = () => prefersReducedMotion.current = motionMediaQuery.matches;
      motionMediaQuery.addListener(setReducedMotionPreferences);
      setReducedMotionPreferences();
    } else {
      prefersReducedMotion.current = false;
    }
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/value-types/find.mjs
  init_define_import_meta_env();
  var valueTypes = [...dimensionValueTypes, color2, complex];
  var findValueType = (v) => valueTypes.find(testValueType(v));

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/store.mjs
  init_define_import_meta_env();
  var visualElementStore = /* @__PURE__ */ new WeakMap();

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/utils/motion-values.mjs
  init_define_import_meta_env();
  function updateMotionValuesFromProps(element, next2, prev2) {
    for (const key in next2) {
      const nextValue = next2[key];
      const prevValue = prev2[key];
      if (isMotionValue(nextValue)) {
        element.addValue(key, nextValue);
        if (true) {
          warnOnce(nextValue.version === "11.18.2", `Attempting to mix Motion versions ${nextValue.version} with 11.18.2 may not work as expected.`);
        }
      } else if (isMotionValue(prevValue)) {
        element.addValue(key, motionValue(nextValue, { owner: element }));
      } else if (prevValue !== nextValue) {
        if (element.hasValue(key)) {
          const existingValue = element.getValue(key);
          if (existingValue.liveStyle === true) {
            existingValue.jump(nextValue);
          } else if (!existingValue.hasAnimated) {
            existingValue.set(nextValue);
          }
        } else {
          const latestValue = element.getStaticValue(key);
          element.addValue(key, motionValue(latestValue !== void 0 ? latestValue : nextValue, { owner: element }));
        }
      }
    }
    for (const key in prev2) {
      if (next2[key] === void 0)
        element.removeValue(key);
    }
    return next2;
  }

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/VisualElement.mjs
  var propEventHandlers = [
    "AnimationStart",
    "AnimationComplete",
    "Update",
    "BeforeLayoutMeasure",
    "LayoutMeasure",
    "LayoutAnimationStart",
    "LayoutAnimationComplete"
  ];
  var VisualElement = class {
    /**
     * This method takes React props and returns found MotionValues. For example, HTML
     * MotionValues will be found within the style prop, whereas for Three.js within attribute arrays.
     *
     * This isn't an abstract method as it needs calling in the constructor, but it is
     * intended to be one.
     */
    scrapeMotionValuesFromProps(_props, _prevProps, _visualElement) {
      return {};
    }
    constructor({ parent, props, presenceContext, reducedMotionConfig, blockInitialAnimation, visualState }, options = {}) {
      this.current = null;
      this.children = /* @__PURE__ */ new Set();
      this.isVariantNode = false;
      this.isControllingVariants = false;
      this.shouldReduceMotion = null;
      this.values = /* @__PURE__ */ new Map();
      this.KeyframeResolver = KeyframeResolver;
      this.features = {};
      this.valueSubscriptions = /* @__PURE__ */ new Map();
      this.prevMotionValues = {};
      this.events = {};
      this.propEventSubscriptions = {};
      this.notifyUpdate = () => this.notify("Update", this.latestValues);
      this.render = () => {
        if (!this.current)
          return;
        this.triggerBuild();
        this.renderInstance(this.current, this.renderState, this.props.style, this.projection);
      };
      this.renderScheduledAt = 0;
      this.scheduleRender = () => {
        const now2 = time.now();
        if (this.renderScheduledAt < now2) {
          this.renderScheduledAt = now2;
          frame.render(this.render, false, true);
        }
      };
      const { latestValues, renderState, onUpdate } = visualState;
      this.onUpdate = onUpdate;
      this.latestValues = latestValues;
      this.baseTarget = { ...latestValues };
      this.initialValues = props.initial ? { ...latestValues } : {};
      this.renderState = renderState;
      this.parent = parent;
      this.props = props;
      this.presenceContext = presenceContext;
      this.depth = parent ? parent.depth + 1 : 0;
      this.reducedMotionConfig = reducedMotionConfig;
      this.options = options;
      this.blockInitialAnimation = Boolean(blockInitialAnimation);
      this.isControllingVariants = isControllingVariants(props);
      this.isVariantNode = isVariantNode(props);
      if (this.isVariantNode) {
        this.variantChildren = /* @__PURE__ */ new Set();
      }
      this.manuallyAnimateOnMount = Boolean(parent && parent.current);
      const { willChange, ...initialMotionValues } = this.scrapeMotionValuesFromProps(props, {}, this);
      for (const key in initialMotionValues) {
        const value = initialMotionValues[key];
        if (latestValues[key] !== void 0 && isMotionValue(value)) {
          value.set(latestValues[key], false);
        }
      }
    }
    mount(instance) {
      this.current = instance;
      visualElementStore.set(instance, this);
      if (this.projection && !this.projection.instance) {
        this.projection.mount(instance);
      }
      if (this.parent && this.isVariantNode && !this.isControllingVariants) {
        this.removeFromVariantTree = this.parent.addVariantChild(this);
      }
      this.values.forEach((value, key) => this.bindToMotionValue(key, value));
      if (!hasReducedMotionListener.current) {
        initPrefersReducedMotion();
      }
      this.shouldReduceMotion = this.reducedMotionConfig === "never" ? false : this.reducedMotionConfig === "always" ? true : prefersReducedMotion.current;
      if (true) {
        warnOnce(this.shouldReduceMotion !== true, "You have Reduced Motion enabled on your device. Animations may not appear as expected.");
      }
      if (this.parent)
        this.parent.children.add(this);
      this.update(this.props, this.presenceContext);
    }
    unmount() {
      visualElementStore.delete(this.current);
      this.projection && this.projection.unmount();
      cancelFrame(this.notifyUpdate);
      cancelFrame(this.render);
      this.valueSubscriptions.forEach((remove) => remove());
      this.valueSubscriptions.clear();
      this.removeFromVariantTree && this.removeFromVariantTree();
      this.parent && this.parent.children.delete(this);
      for (const key in this.events) {
        this.events[key].clear();
      }
      for (const key in this.features) {
        const feature = this.features[key];
        if (feature) {
          feature.unmount();
          feature.isMounted = false;
        }
      }
      this.current = null;
    }
    bindToMotionValue(key, value) {
      if (this.valueSubscriptions.has(key)) {
        this.valueSubscriptions.get(key)();
      }
      const valueIsTransform = transformProps.has(key);
      const removeOnChange = value.on("change", (latestValue) => {
        this.latestValues[key] = latestValue;
        this.props.onUpdate && frame.preRender(this.notifyUpdate);
        if (valueIsTransform && this.projection) {
          this.projection.isTransformDirty = true;
        }
      });
      const removeOnRenderRequest = value.on("renderRequest", this.scheduleRender);
      let removeSyncCheck;
      if (window.MotionCheckAppearSync) {
        removeSyncCheck = window.MotionCheckAppearSync(this, key, value);
      }
      this.valueSubscriptions.set(key, () => {
        removeOnChange();
        removeOnRenderRequest();
        if (removeSyncCheck)
          removeSyncCheck();
        if (value.owner)
          value.stop();
      });
    }
    sortNodePosition(other) {
      if (!this.current || !this.sortInstanceNodePosition || this.type !== other.type) {
        return 0;
      }
      return this.sortInstanceNodePosition(this.current, other.current);
    }
    updateFeatures() {
      let key = "animation";
      for (key in featureDefinitions) {
        const featureDefinition = featureDefinitions[key];
        if (!featureDefinition)
          continue;
        const { isEnabled, Feature: FeatureConstructor } = featureDefinition;
        if (!this.features[key] && FeatureConstructor && isEnabled(this.props)) {
          this.features[key] = new FeatureConstructor(this);
        }
        if (this.features[key]) {
          const feature = this.features[key];
          if (feature.isMounted) {
            feature.update();
          } else {
            feature.mount();
            feature.isMounted = true;
          }
        }
      }
    }
    triggerBuild() {
      this.build(this.renderState, this.latestValues, this.props);
    }
    /**
     * Measure the current viewport box with or without transforms.
     * Only measures axis-aligned boxes, rotate and skew must be manually
     * removed with a re-render to work.
     */
    measureViewportBox() {
      return this.current ? this.measureInstanceViewportBox(this.current, this.props) : createBox();
    }
    getStaticValue(key) {
      return this.latestValues[key];
    }
    setStaticValue(key, value) {
      this.latestValues[key] = value;
    }
    /**
     * Update the provided props. Ensure any newly-added motion values are
     * added to our map, old ones removed, and listeners updated.
     */
    update(props, presenceContext) {
      if (props.transformTemplate || this.props.transformTemplate) {
        this.scheduleRender();
      }
      this.prevProps = this.props;
      this.props = props;
      this.prevPresenceContext = this.presenceContext;
      this.presenceContext = presenceContext;
      for (let i = 0; i < propEventHandlers.length; i++) {
        const key = propEventHandlers[i];
        if (this.propEventSubscriptions[key]) {
          this.propEventSubscriptions[key]();
          delete this.propEventSubscriptions[key];
        }
        const listenerName = "on" + key;
        const listener = props[listenerName];
        if (listener) {
          this.propEventSubscriptions[key] = this.on(key, listener);
        }
      }
      this.prevMotionValues = updateMotionValuesFromProps(this, this.scrapeMotionValuesFromProps(props, this.prevProps, this), this.prevMotionValues);
      if (this.handleChildMotionValue) {
        this.handleChildMotionValue();
      }
      this.onUpdate && this.onUpdate(this);
    }
    getProps() {
      return this.props;
    }
    /**
     * Returns the variant definition with a given name.
     */
    getVariant(name) {
      return this.props.variants ? this.props.variants[name] : void 0;
    }
    /**
     * Returns the defined default transition on this component.
     */
    getDefaultTransition() {
      return this.props.transition;
    }
    getTransformPagePoint() {
      return this.props.transformPagePoint;
    }
    getClosestVariantNode() {
      return this.isVariantNode ? this : this.parent ? this.parent.getClosestVariantNode() : void 0;
    }
    /**
     * Add a child visual element to our set of children.
     */
    addVariantChild(child) {
      const closestVariantNode = this.getClosestVariantNode();
      if (closestVariantNode) {
        closestVariantNode.variantChildren && closestVariantNode.variantChildren.add(child);
        return () => closestVariantNode.variantChildren.delete(child);
      }
    }
    /**
     * Add a motion value and bind it to this visual element.
     */
    addValue(key, value) {
      const existingValue = this.values.get(key);
      if (value !== existingValue) {
        if (existingValue)
          this.removeValue(key);
        this.bindToMotionValue(key, value);
        this.values.set(key, value);
        this.latestValues[key] = value.get();
      }
    }
    /**
     * Remove a motion value and unbind any active subscriptions.
     */
    removeValue(key) {
      this.values.delete(key);
      const unsubscribe = this.valueSubscriptions.get(key);
      if (unsubscribe) {
        unsubscribe();
        this.valueSubscriptions.delete(key);
      }
      delete this.latestValues[key];
      this.removeValueFromRenderState(key, this.renderState);
    }
    /**
     * Check whether we have a motion value for this key
     */
    hasValue(key) {
      return this.values.has(key);
    }
    getValue(key, defaultValue) {
      if (this.props.values && this.props.values[key]) {
        return this.props.values[key];
      }
      let value = this.values.get(key);
      if (value === void 0 && defaultValue !== void 0) {
        value = motionValue(defaultValue === null ? void 0 : defaultValue, { owner: this });
        this.addValue(key, value);
      }
      return value;
    }
    /**
     * If we're trying to animate to a previously unencountered value,
     * we need to check for it in our state and as a last resort read it
     * directly from the instance (which might have performance implications).
     */
    readValue(key, target) {
      var _a;
      let value = this.latestValues[key] !== void 0 || !this.current ? this.latestValues[key] : (_a = this.getBaseTargetFromProps(this.props, key)) !== null && _a !== void 0 ? _a : this.readValueFromInstance(this.current, key, this.options);
      if (value !== void 0 && value !== null) {
        if (typeof value === "string" && (isNumericalString(value) || isZeroValueString(value))) {
          value = parseFloat(value);
        } else if (!findValueType(value) && complex.test(target)) {
          value = getAnimatableNone2(key, target);
        }
        this.setBaseTarget(key, isMotionValue(value) ? value.get() : value);
      }
      return isMotionValue(value) ? value.get() : value;
    }
    /**
     * Set the base target to later animate back to. This is currently
     * only hydrated on creation and when we first read a value.
     */
    setBaseTarget(key, value) {
      this.baseTarget[key] = value;
    }
    /**
     * Find the base target for a value thats been removed from all animation
     * props.
     */
    getBaseTarget(key) {
      var _a;
      const { initial } = this.props;
      let valueFromInitial;
      if (typeof initial === "string" || typeof initial === "object") {
        const variant = resolveVariantFromProps(this.props, initial, (_a = this.presenceContext) === null || _a === void 0 ? void 0 : _a.custom);
        if (variant) {
          valueFromInitial = variant[key];
        }
      }
      if (initial && valueFromInitial !== void 0) {
        return valueFromInitial;
      }
      const target = this.getBaseTargetFromProps(this.props, key);
      if (target !== void 0 && !isMotionValue(target))
        return target;
      return this.initialValues[key] !== void 0 && valueFromInitial === void 0 ? void 0 : this.baseTarget[key];
    }
    on(eventName, callback) {
      if (!this.events[eventName]) {
        this.events[eventName] = new SubscriptionManager();
      }
      return this.events[eventName].add(callback);
    }
    notify(eventName, ...args) {
      if (this.events[eventName]) {
        this.events[eventName].notify(...args);
      }
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/DOMVisualElement.mjs
  var DOMVisualElement = class extends VisualElement {
    constructor() {
      super(...arguments);
      this.KeyframeResolver = DOMKeyframesResolver;
    }
    sortInstanceNodePosition(a, b) {
      return a.compareDocumentPosition(b) & 2 ? 1 : -1;
    }
    getBaseTargetFromProps(props, key) {
      return props.style ? props.style[key] : void 0;
    }
    removeValueFromRenderState(key, { vars: vars2, style }) {
      delete vars2[key];
      delete style[key];
    }
    handleChildMotionValue() {
      if (this.childSubscription) {
        this.childSubscription();
        delete this.childSubscription;
      }
      const { children } = this.props;
      if (isMotionValue(children)) {
        this.childSubscription = children.on("change", (latest) => {
          if (this.current) {
            this.current.textContent = `${latest}`;
          }
        });
      }
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/html/HTMLVisualElement.mjs
  function getComputedStyle(element) {
    return window.getComputedStyle(element);
  }
  var HTMLVisualElement = class extends DOMVisualElement {
    constructor() {
      super(...arguments);
      this.type = "html";
      this.renderInstance = renderHTML;
    }
    readValueFromInstance(instance, key) {
      if (transformProps.has(key)) {
        const defaultType = getDefaultValueType(key);
        return defaultType ? defaultType.default || 0 : 0;
      } else {
        const computedStyle = getComputedStyle(instance);
        const value = (isCSSVariableName(key) ? computedStyle.getPropertyValue(key) : computedStyle[key]) || 0;
        return typeof value === "string" ? value.trim() : value;
      }
    }
    measureInstanceViewportBox(instance, { transformPagePoint }) {
      return measureViewportBox(instance, transformPagePoint);
    }
    build(renderState, latestValues, props) {
      buildHTMLStyles(renderState, latestValues, props.transformTemplate);
    }
    scrapeMotionValuesFromProps(props, prevProps, visualElement) {
      return scrapeMotionValuesFromProps(props, prevProps, visualElement);
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/svg/SVGVisualElement.mjs
  init_define_import_meta_env();
  var SVGVisualElement = class extends DOMVisualElement {
    constructor() {
      super(...arguments);
      this.type = "svg";
      this.isSVGTag = false;
      this.measureInstanceViewportBox = createBox;
    }
    getBaseTargetFromProps(props, key) {
      return props[key];
    }
    readValueFromInstance(instance, key) {
      if (transformProps.has(key)) {
        const defaultType = getDefaultValueType(key);
        return defaultType ? defaultType.default || 0 : 0;
      }
      key = !camelCaseAttributes.has(key) ? camelToDash(key) : key;
      return instance.getAttribute(key);
    }
    scrapeMotionValuesFromProps(props, prevProps, visualElement) {
      return scrapeMotionValuesFromProps2(props, prevProps, visualElement);
    }
    build(renderState, latestValues, props) {
      buildSVGAttrs(renderState, latestValues, this.isSVGTag, props.transformTemplate);
    }
    renderInstance(instance, renderState, styleProp, projection) {
      renderSVG(instance, renderState, styleProp, projection);
    }
    mount(instance) {
      this.isSVGTag = isSVGTag(instance.tagName);
      super.mount(instance);
    }
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/dom/create-visual-element.mjs
  var createDomVisualElement = (Component3, options) => {
    return isSVGComponent(Component3) ? new SVGVisualElement(options) : new HTMLVisualElement(options, {
      allowProjection: Component3 !== import_react36.Fragment
    });
  };

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/components/motion/create.mjs
  var createMotionComponent = /* @__PURE__ */ createMotionComponentFactory({
    ...animations,
    ...gestureAnimations,
    ...drag,
    ...layout2
  }, createDomVisualElement);

  // remix/node_modules/.pnpm/framer-motion@11.18.2_@emotion+is-prop-valid@1.4.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/framer-motion/dist/es/render/components/motion/proxy.mjs
  var motion = /* @__PURE__ */ createDOMMotionComponentProxy(createMotionComponent);

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/toast/toast.provider.mjs
  var import_react47 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/toast/toast.component.mjs
  init_define_import_meta_env();
  var import_jsx_runtime12 = __toESM(require_react_shim(), 1);
  var import_react40 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/toast/toast.utils.mjs
  init_define_import_meta_env();
  var findById = (arr, id3) => arr.find((toast) => toast.id === id3);
  function findToast(toasts, id3) {
    const position3 = getToastPosition(toasts, id3);
    const index = position3 ? toasts[position3].findIndex((toast) => toast.id === id3) : -1;
    return {
      position: position3,
      index
    };
  }
  function getToastPosition(toasts, id3) {
    for (const [position3, values] of Object.entries(toasts)) {
      if (findById(values, id3)) {
        return position3;
      }
    }
  }
  function getToastStyle(position3) {
    const isRighty = position3.includes("right");
    const isLefty = position3.includes("left");
    let alignItems = "center";
    if (isRighty)
      alignItems = "flex-end";
    if (isLefty)
      alignItems = "flex-start";
    return {
      display: "flex",
      flexDirection: "column",
      alignItems
    };
  }
  function getToastListStyle(position3) {
    const isTopOrBottom = position3 === "top" || position3 === "bottom";
    const margin = isTopOrBottom ? "0 auto" : void 0;
    const top = position3.includes("top") ? "env(safe-area-inset-top, 0px)" : void 0;
    const bottom = position3.includes("bottom") ? "env(safe-area-inset-bottom, 0px)" : void 0;
    const right = !position3.includes("left") ? "env(safe-area-inset-right, 0px)" : void 0;
    const left = !position3.includes("right") ? "env(safe-area-inset-left, 0px)" : void 0;
    return {
      position: "fixed",
      zIndex: "var(--toast-z-index, 5500)",
      pointerEvents: "none",
      display: "flex",
      flexDirection: "column",
      margin,
      top,
      bottom,
      right,
      left
    };
  }

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/system/factory.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/system/system.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@emotion+styled@11.14.1_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@types+react@18.3.31_react@18.3.1/node_modules/@emotion/styled/dist/emotion-styled.browser.esm.js
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@emotion+styled@11.14.1_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@types+react@18.3.31_react@18.3.1/node_modules/@emotion/styled/base/dist/emotion-styled-base.browser.esm.js
  init_define_import_meta_env();
  var React6 = __toESM(require_react_shim());
  init_emotion_is_prop_valid_esm();
  var isDevelopment4 = false;
  var testOmitPropsOnStringTag = isPropValid;
  var testOmitPropsOnComponent = function testOmitPropsOnComponent2(key) {
    return key !== "theme";
  };
  var getDefaultShouldForwardProp = function getDefaultShouldForwardProp2(tag) {
    return typeof tag === "string" && // 96 is one less than the char code
    // for "a" so this is checking that
    // it's a lowercase character
    tag.charCodeAt(0) > 96 ? testOmitPropsOnStringTag : testOmitPropsOnComponent;
  };
  var composeShouldForwardProps = function composeShouldForwardProps2(tag, options, isReal) {
    var shouldForwardProp2;
    if (options) {
      var optionsShouldForwardProp = options.shouldForwardProp;
      shouldForwardProp2 = tag.__emotion_forwardProp && optionsShouldForwardProp ? function(propName) {
        return tag.__emotion_forwardProp(propName) && optionsShouldForwardProp(propName);
      } : optionsShouldForwardProp;
    }
    if (typeof shouldForwardProp2 !== "function" && isReal) {
      shouldForwardProp2 = tag.__emotion_forwardProp;
    }
    return shouldForwardProp2;
  };
  var Insertion3 = function Insertion4(_ref) {
    var cache = _ref.cache, serialized = _ref.serialized, isStringTag = _ref.isStringTag;
    registerStyles(cache, serialized, isStringTag);
    useInsertionEffectAlwaysWithSyncFallback(function() {
      return insertStyles(cache, serialized, isStringTag);
    });
    return null;
  };
  var createStyled = function createStyled2(tag, options) {
    var isReal = tag.__emotion_real === tag;
    var baseTag = isReal && tag.__emotion_base || tag;
    var identifierName;
    var targetClassName;
    if (options !== void 0) {
      identifierName = options.label;
      targetClassName = options.target;
    }
    var shouldForwardProp2 = composeShouldForwardProps(tag, options, isReal);
    var defaultShouldForwardProp = shouldForwardProp2 || getDefaultShouldForwardProp(baseTag);
    var shouldUseAs = !defaultShouldForwardProp("as");
    return function() {
      var args = arguments;
      var styles2 = isReal && tag.__emotion_styles !== void 0 ? tag.__emotion_styles.slice(0) : [];
      if (identifierName !== void 0) {
        styles2.push("label:" + identifierName + ";");
      }
      if (args[0] == null || args[0].raw === void 0) {
        styles2.push.apply(styles2, args);
      } else {
        var templateStringsArr = args[0];
        styles2.push(templateStringsArr[0]);
        var len = args.length;
        var i = 1;
        for (; i < len; i++) {
          styles2.push(args[i], templateStringsArr[i]);
        }
      }
      var Styled = withEmotionCache(function(props, cache, ref) {
        var FinalTag = shouldUseAs && props.as || baseTag;
        var className = "";
        var classInterpolations = [];
        var mergedProps = props;
        if (props.theme == null) {
          mergedProps = {};
          for (var key in props) {
            mergedProps[key] = props[key];
          }
          mergedProps.theme = React6.useContext(ThemeContext);
        }
        if (typeof props.className === "string") {
          className = getRegisteredStyles(cache.registered, classInterpolations, props.className);
        } else if (props.className != null) {
          className = props.className + " ";
        }
        var serialized = serializeStyles(styles2.concat(classInterpolations), cache.registered, mergedProps);
        className += cache.key + "-" + serialized.name;
        if (targetClassName !== void 0) {
          className += " " + targetClassName;
        }
        var finalShouldForwardProp = shouldUseAs && shouldForwardProp2 === void 0 ? getDefaultShouldForwardProp(FinalTag) : defaultShouldForwardProp;
        var newProps = {};
        for (var _key in props) {
          if (shouldUseAs && _key === "as") continue;
          if (finalShouldForwardProp(_key)) {
            newProps[_key] = props[_key];
          }
        }
        newProps.className = className;
        if (ref) {
          newProps.ref = ref;
        }
        return /* @__PURE__ */ React6.createElement(React6.Fragment, null, /* @__PURE__ */ React6.createElement(Insertion3, {
          cache,
          serialized,
          isStringTag: typeof FinalTag === "string"
        }), /* @__PURE__ */ React6.createElement(FinalTag, newProps));
      });
      Styled.displayName = identifierName !== void 0 ? identifierName : "Styled(" + (typeof baseTag === "string" ? baseTag : baseTag.displayName || baseTag.name || "Component") + ")";
      Styled.defaultProps = tag.defaultProps;
      Styled.__emotion_real = Styled;
      Styled.__emotion_base = baseTag;
      Styled.__emotion_styles = styles2;
      Styled.__emotion_forwardProp = shouldForwardProp2;
      Object.defineProperty(Styled, "toString", {
        value: function value() {
          if (targetClassName === void 0 && isDevelopment4) {
            return "NO_COMPONENT_SELECTOR";
          }
          return "." + targetClassName;
        }
      });
      Styled.withComponent = function(nextTag, nextOptions) {
        var newStyled = createStyled2(nextTag, _extends({}, options, nextOptions, {
          shouldForwardProp: composeShouldForwardProps(Styled, nextOptions, true)
        }));
        return newStyled.apply(void 0, styles2);
      };
      return Styled;
    };
  };

  // remix/node_modules/.pnpm/@emotion+styled@11.14.1_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@types+react@18.3.31_react@18.3.1/node_modules/@emotion/styled/dist/emotion-styled.browser.esm.js
  var import_react38 = __toESM(require_react_shim());
  init_emotion_is_prop_valid_esm();
  var tags = [
    "a",
    "abbr",
    "address",
    "area",
    "article",
    "aside",
    "audio",
    "b",
    "base",
    "bdi",
    "bdo",
    "big",
    "blockquote",
    "body",
    "br",
    "button",
    "canvas",
    "caption",
    "cite",
    "code",
    "col",
    "colgroup",
    "data",
    "datalist",
    "dd",
    "del",
    "details",
    "dfn",
    "dialog",
    "div",
    "dl",
    "dt",
    "em",
    "embed",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hgroup",
    "hr",
    "html",
    "i",
    "iframe",
    "img",
    "input",
    "ins",
    "kbd",
    "keygen",
    "label",
    "legend",
    "li",
    "link",
    "main",
    "map",
    "mark",
    "marquee",
    "menu",
    "menuitem",
    "meta",
    "meter",
    "nav",
    "noscript",
    "object",
    "ol",
    "optgroup",
    "option",
    "output",
    "p",
    "param",
    "picture",
    "pre",
    "progress",
    "q",
    "rp",
    "rt",
    "ruby",
    "s",
    "samp",
    "script",
    "section",
    "select",
    "small",
    "source",
    "span",
    "strong",
    "style",
    "sub",
    "summary",
    "sup",
    "table",
    "tbody",
    "td",
    "textarea",
    "tfoot",
    "th",
    "thead",
    "time",
    "title",
    "tr",
    "track",
    "u",
    "ul",
    "var",
    "video",
    "wbr",
    // SVG
    "circle",
    "clipPath",
    "defs",
    "ellipse",
    "foreignObject",
    "g",
    "image",
    "line",
    "linearGradient",
    "mask",
    "path",
    "pattern",
    "polygon",
    "polyline",
    "radialGradient",
    "rect",
    "stop",
    "svg",
    "text",
    "tspan"
  ];
  var styled = createStyled.bind(null);
  tags.forEach(function(tagName) {
    styled[tagName] = styled(tagName);
  });

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/system/system.mjs
  var import_react39 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/system/should-forward-prop.mjs
  init_define_import_meta_env();
  var allPropNames = /* @__PURE__ */ new Set([
    ...propNames,
    "textStyle",
    "layerStyle",
    "apply",
    "noOfLines",
    "focusBorderColor",
    "errorBorderColor",
    "as",
    "__css",
    "css",
    "sx"
  ]);
  var validHTMLProps = /* @__PURE__ */ new Set([
    "htmlWidth",
    "htmlHeight",
    "htmlSize",
    "htmlTranslate"
  ]);
  function shouldForwardProp(prop) {
    return (validHTMLProps.has(prop) || !allPropNames.has(prop)) && prop[0] !== "_";
  }

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/system/system.mjs
  var emotion_styled = interopDefault(styled);
  var toCSSObject = ({ baseStyle: baseStyle43 }) => (props) => {
    const { theme: theme2, css: cssProp, __css, sx, ...restProps } = props;
    const [styleProps2] = splitProps(restProps, isStyleProp);
    const finalBaseStyle = runIfFn(baseStyle43, props);
    const finalStyles = assignAfter(
      {},
      __css,
      finalBaseStyle,
      compact(styleProps2),
      sx
    );
    const computedCSS = css(finalStyles)(props.theme);
    return cssProp ? [computedCSS, cssProp] : computedCSS;
  };
  function styled2(component, options) {
    const { baseStyle: baseStyle43, ...styledOptions } = options ?? {};
    if (!styledOptions.shouldForwardProp) {
      styledOptions.shouldForwardProp = shouldForwardProp;
    }
    const styleObject = toCSSObject({ baseStyle: baseStyle43 });
    const Component3 = emotion_styled(
      component,
      styledOptions
    )(styleObject);
    const chakraComponent = (0, import_react39.forwardRef)(
      function ChakraComponent2(props, ref) {
        const { children, ...restProps } = props;
        const { colorMode, forced } = useColorMode();
        const dataTheme = forced ? colorMode : void 0;
        return (0, import_react39.createElement)(
          Component3,
          { ref, "data-theme": dataTheme, ...restProps },
          children
        );
      }
    );
    return chakraComponent;
  }

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/system/factory.mjs
  function factory() {
    const cache = /* @__PURE__ */ new Map();
    return new Proxy(styled2, {
      /**
       * @example
       * const Div = chakra("div")
       * const WithChakra = chakra(AnotherComponent)
       */
      apply(target, thisArg, argArray) {
        return styled2(...argArray);
      },
      /**
       * @example
       * <chakra.div />
       */
      get(_, element) {
        if (!cache.has(element)) {
          cache.set(element, styled2(element));
        }
        return cache.get(element);
      }
    });
  }
  var chakra = factory();

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/toast/toast.component.mjs
  var toastMotionVariants = {
    initial: (props) => {
      const { position: position3 } = props;
      const dir = ["top", "bottom"].includes(position3) ? "y" : "x";
      let factor = ["top-right", "bottom-right"].includes(position3) ? 1 : -1;
      if (position3 === "bottom")
        factor = 1;
      return {
        opacity: 0,
        [dir]: factor * 24
      };
    },
    animate: {
      opacity: 1,
      y: 0,
      x: 0,
      scale: 1,
      transition: {
        duration: 0.4,
        ease: [0.4, 0, 0.2, 1]
      }
    },
    exit: {
      opacity: 0,
      scale: 0.85,
      transition: {
        duration: 0.2,
        ease: [0.4, 0, 1, 1]
      }
    }
  };
  var ToastComponent = (0, import_react40.memo)((props) => {
    const {
      id: id3,
      message,
      onCloseComplete,
      onRequestRemove,
      requestClose = false,
      position: position3 = "bottom",
      duration = 5e3,
      containerStyle,
      motionVariants = toastMotionVariants,
      toastSpacing = "0.5rem"
    } = props;
    const [delay2, setDelay] = (0, import_react40.useState)(duration);
    const isPresent2 = useIsPresent();
    useUpdateEffect(() => {
      if (!isPresent2) {
        onCloseComplete?.();
      }
    }, [isPresent2]);
    useUpdateEffect(() => {
      setDelay(duration);
    }, [duration]);
    const onMouseEnter = () => setDelay(null);
    const onMouseLeave = () => setDelay(duration);
    const close = () => {
      if (isPresent2)
        onRequestRemove();
    };
    (0, import_react40.useEffect)(() => {
      if (isPresent2 && requestClose) {
        onRequestRemove();
      }
    }, [isPresent2, requestClose, onRequestRemove]);
    useTimeout(close, delay2);
    const containerStyles = (0, import_react40.useMemo)(
      () => ({
        pointerEvents: "auto",
        maxWidth: 560,
        minWidth: 300,
        margin: toastSpacing,
        ...containerStyle
      }),
      [containerStyle, toastSpacing]
    );
    const toastStyle = (0, import_react40.useMemo)(() => getToastStyle(position3), [position3]);
    return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
      motion.div,
      {
        layout: true,
        className: "chakra-toast",
        variants: motionVariants,
        initial: "initial",
        animate: "animate",
        exit: "exit",
        onHoverStart: onMouseEnter,
        onHoverEnd: onMouseLeave,
        custom: { position: position3 },
        style: toastStyle,
        children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
          chakra.div,
          {
            role: "status",
            "aria-atomic": "true",
            className: "chakra-toast__inner",
            __css: containerStyles,
            children: runIfFn(message, { id: id3, onClose: close })
          }
        )
      }
    );
  });
  ToastComponent.displayName = "ToastComponent";

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/toast/toast.store.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/toast/toast.mjs
  init_define_import_meta_env();
  var import_jsx_runtime21 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/alert/alert.mjs
  init_define_import_meta_env();
  var import_jsx_runtime16 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/alert/alert-context.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/alert/alert-icons.mjs
  init_define_import_meta_env();
  var import_jsx_runtime14 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/icon/icon.mjs
  init_define_import_meta_env();
  var import_jsx_runtime13 = __toESM(require_react_shim(), 1);

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/system/forward-ref.mjs
  init_define_import_meta_env();
  var import_react41 = __toESM(require_react_shim(), 1);
  function forwardRef5(component) {
    return (0, import_react41.forwardRef)(component);
  }

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/system/use-style-config.mjs
  init_define_import_meta_env();
  var import_react44 = __toESM(require_react_shim(), 1);
  var import_react_fast_compare = __toESM(require_react_fast_compare(), 1);

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/system/hooks.mjs
  init_define_import_meta_env();

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/system/use-theme.mjs
  init_define_import_meta_env();
  var import_react43 = __toESM(require_react_shim(), 1);
  function useTheme2() {
    const theme2 = (0, import_react43.useContext)(
      ThemeContext
    );
    if (!theme2) {
      throw Error(
        "useTheme: `theme` is undefined. Seems you forgot to wrap your app in `<ChakraProvider />` or `<ThemeProvider />`"
      );
    }
    return theme2;
  }

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/system/hooks.mjs
  function useChakra() {
    const colorModeResult = useColorMode();
    const theme2 = useTheme2();
    return { ...colorModeResult, theme: theme2 };
  }

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/system/use-style-config.mjs
  function omitReactElements(props) {
    return Object.fromEntries(
      Object.entries(props).filter(([key, value]) => {
        return value !== void 0 && key !== "children" && !(0, import_react44.isValidElement)(value);
      })
    );
  }
  function useStyleConfigImpl(themeKey, props = {}) {
    const { styleConfig: styleConfigProp, ...rest } = props;
    const { theme: theme2, colorMode } = useChakra();
    const themeStyleConfig = themeKey ? memoizedGet(theme2, `components.${themeKey}`) : void 0;
    const styleConfig = styleConfigProp || themeStyleConfig;
    const mergedProps = (0, import_lodash.default)(
      { theme: theme2, colorMode },
      styleConfig?.defaultProps ?? {},
      omitReactElements(rest),
      (obj, src) => !obj ? src : void 0
    );
    const stylesRef = (0, import_react44.useRef)({});
    if (styleConfig) {
      const getStyles = resolveStyleConfig(styleConfig);
      const styles2 = getStyles(mergedProps);
      const isStyleEqual = (0, import_react_fast_compare.default)(stylesRef.current, styles2);
      if (!isStyleEqual) {
        stylesRef.current = styles2;
      }
    }
    return stylesRef.current;
  }
  function useStyleConfig(themeKey, props = {}) {
    return useStyleConfigImpl(themeKey, props);
  }
  function useMultiStyleConfig(themeKey, props = {}) {
    return useStyleConfigImpl(themeKey, props);
  }

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/icon/icon.mjs
  var fallbackIcon = {
    path: /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("g", { stroke: "currentColor", strokeWidth: "1.5", children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
        "path",
        {
          strokeLinecap: "round",
          fill: "none",
          d: "M9,9a3,3,0,1,1,4,2.829,1.5,1.5,0,0,0-1,1.415V14.25"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
        "path",
        {
          fill: "currentColor",
          strokeLinecap: "round",
          d: "M12,17.25a.375.375,0,1,0,.375.375A.375.375,0,0,0,12,17.25h0"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("circle", { fill: "none", strokeMiterlimit: "10", cx: "12", cy: "12", r: "11.25" })
    ] }),
    viewBox: "0 0 24 24"
  };
  var Icon = forwardRef5((props, ref) => {
    const {
      as: element,
      viewBox,
      color: color3 = "currentColor",
      focusable = false,
      children,
      className,
      __css,
      ...rest
    } = props;
    const _className = cx("chakra-icon", className);
    const customStyles = useStyleConfig("Icon", props);
    const styles2 = {
      w: "1em",
      h: "1em",
      display: "inline-block",
      lineHeight: "1em",
      flexShrink: 0,
      color: color3,
      ...__css,
      ...customStyles
    };
    const shared = {
      ref,
      focusable,
      className: _className,
      __css: styles2
    };
    const _viewBox = viewBox ?? fallbackIcon.viewBox;
    if (element && typeof element !== "string") {
      return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(chakra.svg, { as: element, ...shared, ...rest });
    }
    const _path = children ?? fallbackIcon.path;
    return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(chakra.svg, { verticalAlign: "middle", viewBox: _viewBox, ...shared, ...rest, children: _path });
  });
  Icon.displayName = "Icon";

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/alert/alert-icons.mjs
  function CheckIcon(props) {
    return /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(Icon, { viewBox: "0 0 24 24", ...props, children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
      "path",
      {
        fill: "currentColor",
        d: "M12,0A12,12,0,1,0,24,12,12.014,12.014,0,0,0,12,0Zm6.927,8.2-6.845,9.289a1.011,1.011,0,0,1-1.43.188L5.764,13.769a1,1,0,1,1,1.25-1.562l4.076,3.261,6.227-8.451A1,1,0,1,1,18.927,8.2Z"
      }
    ) });
  }
  function InfoIcon(props) {
    return /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(Icon, { viewBox: "0 0 24 24", ...props, children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
      "path",
      {
        fill: "currentColor",
        d: "M12,0A12,12,0,1,0,24,12,12.013,12.013,0,0,0,12,0Zm.25,5a1.5,1.5,0,1,1-1.5,1.5A1.5,1.5,0,0,1,12.25,5ZM14.5,18.5h-4a1,1,0,0,1,0-2h.75a.25.25,0,0,0,.25-.25v-4.5a.25.25,0,0,0-.25-.25H10.5a1,1,0,0,1,0-2h1a2,2,0,0,1,2,2v4.75a.25.25,0,0,0,.25.25h.75a1,1,0,1,1,0,2Z"
      }
    ) });
  }
  function WarningIcon(props) {
    return /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(Icon, { viewBox: "0 0 24 24", ...props, children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
      "path",
      {
        fill: "currentColor",
        d: "M11.983,0a12.206,12.206,0,0,0-8.51,3.653A11.8,11.8,0,0,0,0,12.207,11.779,11.779,0,0,0,11.8,24h.214A12.111,12.111,0,0,0,24,11.791h0A11.766,11.766,0,0,0,11.983,0ZM10.5,16.542a1.476,1.476,0,0,1,1.449-1.53h.027a1.527,1.527,0,0,1,1.523,1.47,1.475,1.475,0,0,1-1.449,1.53h-.027A1.529,1.529,0,0,1,10.5,16.542ZM11,12.5v-6a1,1,0,0,1,2,0v6a1,1,0,1,1-2,0Z"
      }
    ) });
  }

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/spinner/spinner.mjs
  init_define_import_meta_env();
  var import_jsx_runtime15 = __toESM(require_react_shim(), 1);
  var spin = keyframes({
    "0%": {
      transform: "rotate(0deg)"
    },
    "100%": {
      transform: "rotate(360deg)"
    }
  });
  var Spinner = forwardRef5((props, ref) => {
    const styles2 = useStyleConfig("Spinner", props);
    const {
      label = "Loading...",
      thickness = "2px",
      speed = "0.45s",
      emptyColor = "transparent",
      className,
      ...rest
    } = omitThemingProps(props);
    const _className = cx("chakra-spinner", className);
    const spinnerStyles = {
      display: "inline-block",
      borderColor: "currentColor",
      borderStyle: "solid",
      borderRadius: "99999px",
      borderWidth: thickness,
      borderBottomColor: emptyColor,
      borderLeftColor: emptyColor,
      animation: `${spin} ${speed} linear infinite`,
      ...styles2
    };
    return /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
      chakra.div,
      {
        ref,
        __css: spinnerStyles,
        className: _className,
        ...rest,
        children: label && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(chakra.span, { srOnly: true, children: label })
      }
    );
  });
  Spinner.displayName = "Spinner";

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/alert/alert-context.mjs
  var [AlertProvider, useAlertContext] = createContext({
    name: "AlertContext",
    hookName: "useAlertContext",
    providerName: "<Alert />"
  });
  var [AlertStylesProvider, useAlertStyles] = createContext({
    name: `AlertStylesContext`,
    hookName: `useAlertStyles`,
    providerName: "<Alert />"
  });
  var STATUSES = {
    info: { icon: InfoIcon, colorScheme: "blue" },
    warning: { icon: WarningIcon, colorScheme: "orange" },
    success: { icon: CheckIcon, colorScheme: "green" },
    error: { icon: WarningIcon, colorScheme: "red" },
    loading: { icon: Spinner, colorScheme: "blue" }
  };
  function getStatusColorScheme(status) {
    return STATUSES[status].colorScheme;
  }
  function getStatusIcon(status) {
    return STATUSES[status].icon;
  }

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/alert/alert.mjs
  var Alert = forwardRef5(function Alert2(props, ref) {
    const { status = "info", addRole = true, ...rest } = omitThemingProps(props);
    const colorScheme = props.colorScheme ?? getStatusColorScheme(status);
    const styles2 = useMultiStyleConfig("Alert", { ...props, colorScheme });
    const alertStyles = defineStyle({
      width: "100%",
      display: "flex",
      alignItems: "center",
      position: "relative",
      overflow: "hidden",
      ...styles2.container
    });
    return /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(AlertProvider, { value: { status }, children: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(AlertStylesProvider, { value: styles2, children: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
      chakra.div,
      {
        "data-status": status,
        role: addRole ? "alert" : void 0,
        ref,
        ...rest,
        className: cx("chakra-alert", props.className),
        __css: alertStyles
      }
    ) }) });
  });
  Alert.displayName = "Alert";

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/alert/alert-icon.mjs
  init_define_import_meta_env();
  var import_jsx_runtime17 = __toESM(require_react_shim(), 1);
  function AlertIcon(props) {
    const { status } = useAlertContext();
    const BaseIcon = getStatusIcon(status);
    const styles2 = useAlertStyles();
    const css5 = status === "loading" ? styles2.spinner : styles2.icon;
    return /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
      chakra.span,
      {
        display: "inherit",
        "data-status": status,
        ...props,
        className: cx("chakra-alert__icon", props.className),
        __css: css5,
        children: props.children || /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(BaseIcon, { h: "100%", w: "100%" })
      }
    );
  }
  AlertIcon.displayName = "AlertIcon";

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/alert/alert-title.mjs
  init_define_import_meta_env();
  var import_jsx_runtime18 = __toESM(require_react_shim(), 1);
  var AlertTitle = forwardRef5(
    function AlertTitle2(props, ref) {
      const styles2 = useAlertStyles();
      const { status } = useAlertContext();
      return /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
        chakra.div,
        {
          ref,
          "data-status": status,
          ...props,
          className: cx("chakra-alert__title", props.className),
          __css: styles2.title
        }
      );
    }
  );
  AlertTitle.displayName = "AlertTitle";

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/alert/alert-description.mjs
  init_define_import_meta_env();
  var import_jsx_runtime19 = __toESM(require_react_shim(), 1);
  var AlertDescription = forwardRef5(
    function AlertDescription2(props, ref) {
      const { status } = useAlertContext();
      const styles2 = useAlertStyles();
      const descriptionStyles = defineStyle({
        display: "inline",
        ...styles2.description
      });
      return /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
        chakra.div,
        {
          ref,
          "data-status": status,
          ...props,
          className: cx("chakra-alert__desc", props.className),
          __css: descriptionStyles
        }
      );
    }
  );
  AlertDescription.displayName = "AlertDescription";

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/close-button/close-button.mjs
  init_define_import_meta_env();
  var import_jsx_runtime20 = __toESM(require_react_shim(), 1);
  function CloseIcon(props) {
    return /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Icon, { focusable: "false", "aria-hidden": true, ...props, children: /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
      "path",
      {
        fill: "currentColor",
        d: "M.439,21.44a1.5,1.5,0,0,0,2.122,2.121L11.823,14.3a.25.25,0,0,1,.354,0l9.262,9.263a1.5,1.5,0,1,0,2.122-2.121L14.3,12.177a.25.25,0,0,1,0-.354l9.263-9.262A1.5,1.5,0,0,0,21.439.44L12.177,9.7a.25.25,0,0,1-.354,0L2.561.44A1.5,1.5,0,0,0,.439,2.561L9.7,11.823a.25.25,0,0,1,0,.354Z"
      }
    ) });
  }
  var CloseButton = forwardRef5(
    function CloseButton2(props, ref) {
      const styles2 = useStyleConfig("CloseButton", props);
      const { children, isDisabled, __css, ...rest } = omitThemingProps(props);
      const baseStyle43 = {
        outline: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0
      };
      return /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
        chakra.button,
        {
          type: "button",
          "aria-label": "Close",
          ref,
          disabled: isDisabled,
          __css: {
            ...baseStyle43,
            ...styles2,
            ...__css
          },
          ...rest,
          children: children || /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(CloseIcon, { width: "1em", height: "1em" })
        }
      );
    }
  );
  CloseButton.displayName = "CloseButton";

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/toast/toast.mjs
  var Toast = (props) => {
    const {
      status,
      variant = "solid",
      id: id3,
      title,
      isClosable,
      onClose,
      description,
      colorScheme,
      icon
    } = props;
    const ids = id3 ? {
      root: `toast-${id3}`,
      title: `toast-${id3}-title`,
      description: `toast-${id3}-description`
    } : void 0;
    return /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(
      Alert,
      {
        addRole: false,
        status,
        variant,
        id: ids?.root,
        alignItems: "start",
        borderRadius: "md",
        boxShadow: "lg",
        paddingEnd: 8,
        textAlign: "start",
        width: "auto",
        colorScheme,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(AlertIcon, { children: icon }),
          /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(chakra.div, { flex: "1", maxWidth: "100%", children: [
            title && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(AlertTitle, { id: ids?.title, children: title }),
            description && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(AlertDescription, { id: ids?.description, display: "block", children: description })
          ] }),
          isClosable && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
            CloseButton,
            {
              size: "sm",
              onClick: onClose,
              position: "absolute",
              insetEnd: 1,
              top: 1
            }
          )
        ]
      }
    );
  };
  function createRenderToast(options = {}) {
    const { render, toastComponent: ToastComponent2 = Toast } = options;
    const renderToast = (props) => {
      if (typeof render === "function") {
        return render({ ...props, ...options });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(ToastComponent2, { ...props, ...options });
    };
    return renderToast;
  }

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/toast/toast.store.mjs
  var initialState = {
    top: [],
    "top-left": [],
    "top-right": [],
    "bottom-left": [],
    bottom: [],
    "bottom-right": []
  };
  var toastStore = createStore(initialState);
  function createStore(initialState2) {
    let state2 = initialState2;
    const listeners = /* @__PURE__ */ new Set();
    const setState = (setStateFn) => {
      state2 = setStateFn(state2);
      listeners.forEach((l) => l());
    };
    return {
      getState: () => state2,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          setState(() => initialState2);
          listeners.delete(listener);
        };
      },
      /**
       * Delete a toast record at its position
       */
      removeToast: (id3, position3) => {
        setState((prevState) => ({
          ...prevState,
          // id may be string or number
          // eslint-disable-next-line eqeqeq
          [position3]: prevState[position3].filter((toast) => toast.id != id3)
        }));
      },
      notify: (message, options) => {
        const toast = createToast(message, options);
        const { position: position3, id: id3 } = toast;
        setState((prevToasts) => {
          const isTop = position3.includes("top");
          const toasts = isTop ? [toast, ...prevToasts[position3] ?? []] : [...prevToasts[position3] ?? [], toast];
          return {
            ...prevToasts,
            [position3]: toasts
          };
        });
        return id3;
      },
      update: (id3, options) => {
        if (!id3)
          return;
        setState((prevState) => {
          const nextState = { ...prevState };
          const { position: position3, index } = findToast(nextState, id3);
          if (position3 && index !== -1) {
            nextState[position3][index] = {
              ...nextState[position3][index],
              ...options,
              message: createRenderToast(options)
            };
          }
          return nextState;
        });
      },
      closeAll: ({ positions } = {}) => {
        setState((prev2) => {
          const allPositions = [
            "bottom",
            "bottom-right",
            "bottom-left",
            "top",
            "top-left",
            "top-right"
          ];
          const positionsToClose = positions ?? allPositions;
          return positionsToClose.reduce(
            (acc, position3) => {
              acc[position3] = prev2[position3].map((toast) => ({
                ...toast,
                requestClose: true
              }));
              return acc;
            },
            { ...prev2 }
          );
        });
      },
      close: (id3) => {
        setState((prevState) => {
          const position3 = getToastPosition(prevState, id3);
          if (!position3)
            return prevState;
          return {
            ...prevState,
            [position3]: prevState[position3].map((toast) => {
              if (toast.id == id3) {
                return {
                  ...toast,
                  requestClose: true
                };
              }
              return toast;
            })
          };
        });
      },
      isActive: (id3) => Boolean(findToast(toastStore.getState(), id3).position)
    };
  }
  var counter = 0;
  function createToast(message, options = {}) {
    counter += 1;
    const id3 = options.id ?? counter;
    const position3 = options.position ?? "bottom";
    return {
      id: id3,
      message,
      position: position3,
      duration: options.duration,
      onCloseComplete: options.onCloseComplete,
      onRequestRemove: () => toastStore.removeToast(String(id3), position3),
      status: options.status,
      requestClose: false,
      containerStyle: options.containerStyle
    };
  }

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/portal/portal.mjs
  init_define_import_meta_env();
  var import_jsx_runtime22 = __toESM(require_react_shim(), 1);
  var import_react46 = __toESM(require_react_shim(), 1);
  var import_react_dom = __toESM(require_react_dom_shim(), 1);
  var [PortalContextProvider, usePortalContext] = createContext({
    strict: false,
    name: "PortalContext"
  });
  var PORTAL_CLASSNAME = "chakra-portal";
  var PORTAL_SELECTOR = `.chakra-portal`;
  var Container = (props) => /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
    "div",
    {
      className: "chakra-portal-zIndex",
      style: {
        position: "absolute",
        zIndex: props.zIndex,
        top: 0,
        left: 0,
        right: 0
        // NB: Don't add `bottom: 0`, it makes the entire app unusable
        // @see https://github.com/chakra-ui/chakra-ui/issues/3201
      },
      children: props.children
    }
  );
  var DefaultPortal = (props) => {
    const { appendToParentPortal, children } = props;
    const [tempNode, setTempNode] = (0, import_react46.useState)(null);
    const portal = (0, import_react46.useRef)(null);
    const [, forceUpdate] = (0, import_react46.useState)({});
    (0, import_react46.useEffect)(() => forceUpdate({}), []);
    const parentPortal = usePortalContext();
    const manager = usePortalManager();
    useSafeLayoutEffect(() => {
      if (!tempNode)
        return;
      const doc = tempNode.ownerDocument;
      const host = appendToParentPortal ? parentPortal ?? doc.body : doc.body;
      if (!host)
        return;
      portal.current = doc.createElement("div");
      portal.current.className = PORTAL_CLASSNAME;
      host.appendChild(portal.current);
      forceUpdate({});
      const portalNode = portal.current;
      return () => {
        if (host.contains(portalNode)) {
          host.removeChild(portalNode);
        }
      };
    }, [tempNode]);
    const _children = manager?.zIndex ? /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(Container, { zIndex: manager?.zIndex, children }) : children;
    return portal.current ? (0, import_react_dom.createPortal)(
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(PortalContextProvider, { value: portal.current, children: _children }),
      portal.current
    ) : /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
      "span",
      {
        ref: (el) => {
          if (el)
            setTempNode(el);
        }
      }
    );
  };
  var ContainerPortal = (props) => {
    const { children, containerRef, appendToParentPortal } = props;
    const containerEl = containerRef.current;
    const host = containerEl ?? (typeof window !== "undefined" ? document.body : void 0);
    const portal = (0, import_react46.useMemo)(() => {
      const node2 = containerEl?.ownerDocument.createElement("div");
      if (node2)
        node2.className = PORTAL_CLASSNAME;
      return node2;
    }, [containerEl]);
    const [, forceUpdate] = (0, import_react46.useState)({});
    useSafeLayoutEffect(() => forceUpdate({}), []);
    useSafeLayoutEffect(() => {
      if (!portal || !host)
        return;
      host.appendChild(portal);
      return () => {
        host.removeChild(portal);
      };
    }, [portal, host]);
    if (host && portal) {
      return (0, import_react_dom.createPortal)(
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(PortalContextProvider, { value: appendToParentPortal ? portal : null, children }),
        portal
      );
    }
    return null;
  };
  function Portal(props) {
    const portalProps = {
      appendToParentPortal: true,
      ...props
    };
    const { containerRef, ...rest } = portalProps;
    return containerRef ? /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(ContainerPortal, { containerRef, ...rest }) : /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(DefaultPortal, { ...rest });
  }
  Portal.className = PORTAL_CLASSNAME;
  Portal.selector = PORTAL_SELECTOR;
  Portal.displayName = "Portal";

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/toast/toast.provider.mjs
  var [ToastOptionProvider, useToastOptionContext] = createContext({
    name: `ToastOptionsContext`,
    strict: false
  });
  var ToastProvider = (props) => {
    const state2 = (0, import_react47.useSyncExternalStore)(
      toastStore.subscribe,
      toastStore.getState,
      toastStore.getState
    );
    const {
      motionVariants,
      component: Component3 = ToastComponent,
      portalProps,
      animatePresenceProps
    } = props;
    const stateKeys = Object.keys(state2);
    const toastList = stateKeys.map((position3) => {
      const toasts = state2[position3];
      return /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
        "div",
        {
          role: "region",
          "aria-live": "polite",
          "aria-label": `Notifications-${position3}`,
          "aria-hidden": !toasts.length,
          id: `chakra-toast-manager-${position3}`,
          style: getToastListStyle(position3),
          children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(AnimatePresence, { ...animatePresenceProps, initial: false, children: toasts.map((toast) => /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
            Component3,
            {
              motionVariants,
              ...toast
            },
            toast.id
          )) })
        },
        position3
      );
    });
    return /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(Portal, { ...portalProps, children: toastList });
  };

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/provider/create-provider.mjs
  var createProvider = (providerTheme) => {
    return function ChakraProvider2({
      children,
      theme: theme2 = providerTheme,
      toastOptions,
      ...restProps
    }) {
      return /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)(Provider, { theme: theme2, ...restProps, children: [
        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(ToastOptionProvider, { value: toastOptions?.defaultOptions, children }),
        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(ToastProvider, { ...toastOptions })
      ] });
    };
  };

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/chakra-provider.mjs
  init_define_import_meta_env();
  var ChakraProvider = createProvider(theme);

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/box/box.mjs
  init_define_import_meta_env();
  var Box = chakra("div");
  Box.displayName = "Box";

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/center/center.mjs
  init_define_import_meta_env();
  var import_jsx_runtime25 = __toESM(require_react_shim(), 1);
  var Center = chakra("div", {
    baseStyle: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  });
  Center.displayName = "Center";
  var centerStyles = {
    horizontal: {
      insetStart: "50%",
      transform: "translateX(-50%)"
    },
    vertical: {
      top: "50%",
      transform: "translateY(-50%)"
    },
    both: {
      insetStart: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)"
    }
  };
  var AbsoluteCenter = forwardRef5(
    function AbsoluteCenter2(props, ref) {
      const { axis = "both", ...rest } = props;
      return /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
        chakra.div,
        {
          ref,
          __css: centerStyles[axis],
          ...rest,
          position: "absolute"
        }
      );
    }
  );

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/flex/flex.mjs
  init_define_import_meta_env();
  var import_jsx_runtime26 = __toESM(require_react_shim(), 1);
  var Flex = forwardRef5(function Flex2(props, ref) {
    const { direction: direction2, align, justify, wrap: wrap2, basis, grow, shrink, ...rest } = props;
    const styles2 = {
      display: "flex",
      flexDirection: direction2,
      alignItems: align,
      justifyContent: justify,
      flexWrap: wrap2,
      flexBasis: basis,
      flexGrow: grow,
      flexShrink: shrink
    };
    return /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(chakra.div, { ref, __css: styles2, ...rest });
  });
  Flex.displayName = "Flex";

  // remix/node_modules/.pnpm/@chakra-ui+react@2.10.10_@emotion+react@11.14.0_@types+react@18.3.31_react@18.3.1__@emo_0427b1a1ebc4e9989dacd319e9b4bb54/node_modules/@chakra-ui/react/dist/esm/typography/heading.mjs
  init_define_import_meta_env();
  var import_jsx_runtime27 = __toESM(require_react_shim(), 1);
  var Heading = forwardRef5(
    function Heading2(props, ref) {
      const styles2 = useStyleConfig("Heading", props);
      const { className, ...rest } = omitThemingProps(props);
      return /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(
        chakra.h2,
        {
          ref,
          className: cx("chakra-heading", props.className),
          ...rest,
          __css: styles2
        }
      );
    }
  );
  Heading.displayName = "Heading";

  // remix/app/components/Branding/Branding.tsx
  init_define_import_meta_env();

  // remix/app/components/Branding/Logo.tsx
  init_define_import_meta_env();
  var import_jsx_runtime28 = __toESM(require_react_shim());
  var Logo = (props = {}) => {
    const { voxelSize = 25, unit = "px", theme: theme2 = "pink" } = props;
    const simpleMatrix = [
      [0, 7, 0],
      [7, 0, 7],
      [0, 8, 0]
    ];
    const fullLogoMatrix = [
      "111,020,030,000,000,070,030",
      "010,022,000,550,660,707,000,999,0xx",
      "010,022,040,550,660,080,040,999,0xx",
      "00000000000006",
      "00000000000066"
    ];
    const matrix = props?.matrix || (props.icon ? simpleMatrix : fullLogoMatrix);
    const defaultColours = {
      0: "transparent",
      1: "#59ff9c",
      2: "#59bdff",
      3: "#00b7ef",
      4: "#ed1c24",
      5: "#ffa3b1",
      6: "#6f3198",
      7: "#a8e61d",
      8: "#9c5a3c",
      9: "#ffc20e",
      x: "#ff7e00"
    };
    const themes = {
      default: defaultColours,
      nature: defaultColours,
      tt: defaultColours,
      thingtime: defaultColours,
      pink: {
        0: "transparent",
        1: "hotpink",
        2: "hotpink"
      }
    };
    const colourMap = props?.colourMap || (themes[theme2] ? themes[theme2] : themes.pink);
    const getColour = (col) => {
      const colour = colourMap[col];
      if (colour === "random") {
        const filteredKeys = Object.keys(defaultColours).filter((key) => defaultColours[key] !== "transparent");
        const filteredColours = {};
        filteredKeys.forEach((key) => {
          filteredColours[key] = defaultColours[key];
        });
        const randomKey = filteredKeys[Math.floor(Math.random() * filteredKeys.length)];
        return filteredColours[randomKey];
      }
      return colour || colourMap[1];
    };
    return /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(Box, { my: 8, opacity: props?.opacity, m: props?.space, p: props?.space, children: /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(Flex, { flexDir: "column", children: matrix?.map((row, rowIndex) => {
      const rowIterator = row instanceof Array ? row : Array.from(row);
      const rowEls = rowIterator?.map((col, colIndex) => {
        if (col === ",") {
          return null;
        }
        return /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(
          Box,
          {
            flexShrink: 0,
            _hover: { opacity: "0.5", cursor: "pointer" },
            transition: "all 250ms ease",
            w: voxelSize + unit,
            h: voxelSize + unit,
            bg: getColour(col)
          },
          colIndex
        );
      });
      return /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(Flex, { "data-row": "logo-row-" + rowIndex, flexDir: "row", children: rowEls?.filter((el) => el) }, rowIndex);
    }) }) });
  };

  // remix/app/components/Branding/Branding.tsx
  var import_jsx_runtime29 = __toESM(require_react_shim());
  var Branding = () => {
    return /* @__PURE__ */ (0, import_jsx_runtime29.jsxs)(Flex, { pt: [25, 50], flexDir: "column", w: "100%", minH: "100vh", px: "18px", maxW: "container", textAlign: "left", children: [
      /* @__PURE__ */ (0, import_jsx_runtime29.jsx)(Heading, { children: "Branding" }),
      /* @__PURE__ */ (0, import_jsx_runtime29.jsx)(Heading, { mt: 12, children: "Logo" }),
      /* @__PURE__ */ (0, import_jsx_runtime29.jsx)(Logo, { editable: true }),
      /* @__PURE__ */ (0, import_jsx_runtime29.jsx)(Logo, { editable: true, icon: true }),
      /* @__PURE__ */ (0, import_jsx_runtime29.jsx)(Logo, { editable: true, theme: "nature" }),
      /* @__PURE__ */ (0, import_jsx_runtime29.jsx)(Logo, { editable: true, theme: "nature", icon: true })
    ] });
  };

  // remix/app/components/Icon/Icon.tsx
  init_define_import_meta_env();
  var import_react50 = __toESM(require_react_shim());
  var import_emojis_list = __toESM(require_emojis_list());
  var import_jsx_runtime30 = __toESM(require_react_shim());
  var Icon2 = (props) => {
    const name = props?.name;
    const icon = import_react50.default.useMemo(() => {
      if (["\u2699\uFE0F", "gear", "cog"]?.includes(name)) {
        return "\u2699\uFE0F";
      }
      if (["\u{1F52E}", "crystal"]?.includes(name)) {
        return "\u{1F52E}";
      }
      if (["\u{1F33A}", "flower", "hibiscus"]?.includes(name)) {
        return "\u{1F33A}";
      }
      if (["\u2728", "sparke", "magic"]?.includes(name)) {
        return "\u2728";
      }
      if (["\u{1F9D9}\u200D\u2642\uFE0F", "wizard", "gandalf"]?.includes(name)) {
        return "\u{1F9D9}\u200D\u2642\uFE0F";
      }
      if (["\u{1F440}", "two eyes"]?.includes(name)) {
        return "\u{1F440}";
      }
      if (["\u{1F4E6}", "box", "thing", "object"]?.includes(name)) {
        return "\u{1F4E6}";
      }
      if (["\u270F\uFE0F", "pencil"]?.includes(name)) {
        return "\u270F\uFE0F";
      }
      if (["\u{1F3A8}", "edit", "paint", "create"]?.includes(name)) {
        return "\u{1F3A8}";
      }
      if (["\u{1F4DA}", "book", "books"]?.includes(name)) {
        return "\u{1F4DA}";
      }
      if (["\u{1FA84}", "any", "magic wand"]?.includes(name)) {
        return "\u{1FA84}";
      }
      if (["\u{1F4D6}", "book-open", "books-open"]?.includes(name)) {
        return "\u{1F4D6}";
      }
      if (["\u{1F469}\u200D\u{1F3EB}", "book-reader", "books-reader"]?.includes(name)) {
        return "\u{1F469}\u200D\u{1F3EB}";
      }
      if (["\u{1F4AF}", "number", "hundred"]?.includes(name)) {
        return "\u{1F4AF}";
      }
      if (["\u{1F9E9}", "puzzle", "types"]?.includes(name)) {
        return "\u{1F9E9}";
      }
      if (["\u2764\uFE0F", "heart"]?.includes(name)) {
        return "\u2764\uFE0F";
      }
      if (["\u{1F494}", "heart-broken"]?.includes(name)) {
        return "\u{1F494}";
      }
      if (["\u{1F497}", "heart-pulse"]?.includes(name)) {
        return "\u{1F497}";
      }
      if (["\u{1F4AC}", "string", "text"]?.includes(name)) {
        return "\u{1F4AC}";
      }
      if (["\u{1F4DA}", "array", "list"]?.includes(name)) {
        return "\u{1F4DA}";
      }
      if (["\u{1F317}", "boolean", "bool"]?.includes(name)) {
        return "\u{1F317}";
      }
      if (["\u{1F308}", "rainbow"]?.includes(name)) {
        return "\u{1F308}";
      }
      if (["\u2600\uFE0F", "sun"]?.includes(name)) {
        return "\u2600\uFE0F";
      }
      if (["\u{1F319}", "moon"]?.includes(name)) {
        return "\u{1F319}";
      }
      if (["\u{1F984}", "unicorn"]?.includes(name)) {
        return "\u{1F984}";
      }
      if (["\u{1F464}", "user", "person"]?.includes(name)) {
        return "\u{1F464}";
      }
      if (["\u{1F465}", "group", "team"]?.includes(name)) {
        return "\u{1F465}";
      }
      if (["\u2705", "success", "check"]?.includes(name)) {
        return "\u2705";
      }
      if (["\u274C", "error", "stop"]?.includes(name)) {
        return "\u274C";
      }
      if (["\u26A0\uFE0F", "warning", "alert"]?.includes(name)) {
        return "\u26A0\uFE0F";
      }
      if (["\u23F0", "time", "clock"]?.includes(name)) {
        return "\u23F0";
      }
      if (["\u2B50", "star", "favorite"]?.includes(name)) {
        return "\u2B50";
      }
      if (["\u{1F31F}", "glowing star", "glowing favorite"]?.includes(name)) {
        return "\u{1F31F}";
      }
      if (["\u2753", "question", "help"]?.includes(name)) {
        return "\u2753";
      }
      if (["\u{1F3A5}", "video", "media"]?.includes(name)) {
        return "\u{1F3A5}";
      }
      if (["\u{1F3B5}", "music", "audio"]?.includes(name)) {
        return "\u{1F3B5}";
      }
      if (["\u{1F5BC}\uFE0F", "image", "picture"]?.includes(name)) {
        return "\u{1F5BC}\uFE0F";
      }
      if (["\u2709\uFE0F", "email", "mail"]?.includes(name)) {
        return "\u2709\uFE0F";
      }
      if (["\u{1F4BB}", "computer", "laptop"]?.includes(name)) {
        return "\u{1F4BB}";
      }
      if (["\u{1F4F1}", "mobile", "phone"]?.includes(name)) {
        return "\u{1F4F1}";
      }
      if (["\u{1F30D}", "world", "globe"]?.includes(name)) {
        return "\u{1F30D}";
      }
      if (["\u{1F680}", "rocket", "launch"]?.includes(name)) {
        return "\u{1F680}";
      }
      if (["\u270F\uFE0F", "pencil", "edit"]?.includes(name)) {
        return "\u270F\uFE0F";
      }
      if (["\u{1F50D}", "search", "magnify"]?.includes(name)) {
        return "\u{1F50D}";
      }
      if (["\u{1F512}", "lock", "secure"]?.includes(name)) {
        return "\u{1F512}";
      }
      if (["\u{1F513}", "unlock", "access"]?.includes(name)) {
        return "\u{1F513}";
      }
      if (["\u{1F44D}", "thumb-up", "like"]?.includes(name)) {
        return "\u{1F44D}";
      }
      if (["\u{1F44E}", "thumb-down", "dislike"]?.includes(name)) {
        return "\u{1F44E}";
      }
      if (["\u2795", "plus", "add"]?.includes(name)) {
        return "\u2795";
      }
      if (["\u{1F331}", "seedling", "seed"]?.includes(name)) {
        return "\u{1F331}";
      }
      if (["\u2753", "undefined", "null", "question", "confused"]?.includes(name)) {
        return "\u2753";
      }
      if (["\u{1F916}", "codex", "robot", "ai", "chatgpt"]?.includes(name)) {
        return "\u{1F916}";
      }
      if (["\u{1F5D1}\uFE0F", "trash", "bin", "delete", "remove"]?.includes(name)) {
        return "\u{1F5D1}\uFE0F";
      }
      if (["cash", "money"]?.includes(name)) {
        return "\u{1F4B5}";
      }
      if (["\u{1F4B0}", "money bag"]?.includes(name)) {
        return "\u{1F4B0}";
      }
      if (["\u{1F300}", "cyclone", "tornado"]?.includes(name)) {
        return "\u{1F300}";
      }
      if (["thingtime"]?.includes(name)) {
        if (Math.random() > 0.5) {
          return "\u{1F333}";
        }
        return "\u{1F300}";
      }
      if (["\u{1F4D0}", "function", "lambda"]?.includes(name)) {
        return "\u{1F4D0}";
      }
      if (["\u{1F4CC}", "pin", "pinned", "located"]?.includes(name)) {
        return "\u{1F4CC}";
      }
      if (["\u{1F381}", "wrap", "wrapped"]?.includes(name)) {
        return "\u{1F381}";
      }
      if (["\u{1F995}", "dinosaur", "dino"]?.includes(name)) {
        return "\u{1F995}";
      }
      if (import_emojis_list.default?.includes(name)) {
        return name;
      }
      if (["random"]?.includes(name)) {
        return import_emojis_list.default[Math.floor(Math.random() * import_emojis_list.default.length)];
      }
      return "\u{1F937}\u200D\u2642\uFE0F";
    }, [name]);
    return /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(
      Center,
      {
        transition: "all 0.2s ease-out",
        ...props,
        ...props?.chakras,
        fontSize: props?.size,
        children: icon
      }
    );
  };

  // remix/app/components/Buttons/Attention.tsx
  init_define_import_meta_env();
  var import_jsx_runtime31 = __toESM(require_react_shim());
  var Attention = (props) => {
    return /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(
      Flex,
      {
        ...props,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        cursor: "pointer",
        children: /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(
          Flex,
          {
            sx: {
              "@keyframes moving-rainbow": {
                "0%": { backgroundPosition: "0 0" },
                "100%": { backgroundPosition: "200% 0" }
              },
              // add delay
              animation: `moving-rainbow 3s infinite linear`
            },
            width: props.w || "40px",
            height: "2px",
            marginBottom: "10px",
            background: "linear-gradient(to right, #f34a4a, #ffbc48, #58ca70, #47b5e6, #a555e8, #f34a4a);",
            backgroundSize: "200%",
            borderBottomRadius: "20px",
            transition: "all 0.5s ease-in-out"
          }
        )
      }
    );
  };

  // remix/app/components/Buttons/Hamburger.tsx
  init_define_import_meta_env();
  var import_jsx_runtime32 = __toESM(require_react_shim());
  var Hamburger = (props) => {
    const lineCount = [1, 2, 3];
    return /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(
      Flex,
      {
        ...props,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        cursor: "pointer",
        children: lineCount.map((line2, idx) => {
          return /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(
            Flex,
            {
              sx: {
                "@keyframes moving-rainbow": {
                  "0%": { backgroundPosition: "0 0" },
                  "100%": { backgroundPosition: "200% 0" }
                },
                // add delay
                animation: `moving-rainbow 3s infinite linear -${idx * 0.3}s}`
              },
              width: "40px",
              height: "3px",
              marginBottom: "10px",
              background: "linear-gradient(to right, #f34a4a, #ffbc48, #58ca70, #47b5e6, #a555e8, #f34a4a);",
              backgroundSize: "200%",
              borderRadius: "9px"
            },
            idx
          );
        })
      }
    );
  };

  // remix/app/components/Skeleton/RainbowSkeleton.tsx
  init_define_import_meta_env();
  var import_react54 = __toESM(require_react_shim());
  var import_jsx_runtime33 = __toESM(require_react_shim());
  var RainbowSkeleton = (props) => {
    const [rainbowColours] = import_react54.default.useState([
      "#f34a4a",
      "#ffbc48",
      "#58ca70",
      "#47b5e6",
      "#a555e8"
    ]);
    const keyframes3 = import_react54.default.useMemo(() => {
      const keyframes4 = {};
      rainbowColours.forEach((colour, idx) => {
        keyframes4[Math.round(idx * 100 / rainbowColours.length) + "%"] = {
          backgroundColor: colour
        };
      });
      keyframes4["100%"] = { backgroundColor: rainbowColours[0] };
      return keyframes4;
    }, [rainbowColours]);
    if (props?.loaded) {
      return props?.children;
    }
    return /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(
      Flex,
      {
        sx: {
          "@keyframes placeholder-rainbow": keyframes3,
          "@keyframes placeholder-opacity": {
            "0%": { opacity: 0.2 },
            "100%": { opacity: 1 }
          },
          // add delay
          animation: `placeholder-rainbow 8s infinite linear, placeholder-opacity 1.3s linear 0s infinite alternate none running}`
        },
        width: "10px",
        height: "8px",
        borderRadius: "2px",
        cursor: "pointer",
        ...props
      }
    );
  };
  return __toCommonJS(ds_entry_exports);
})();
window.Thingtime=Thingtime.__dsMainNs?Object.assign({},Thingtime,Thingtime.__dsMainNs,{__dsMainNs:undefined}):Thingtime;
