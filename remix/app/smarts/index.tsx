import { v4 as uuidv4 } from 'uuid'
// import { Buffer } from 'buffer'
// weird hack for remix client-side logic
try {
  window.process = {
    env: {}
  }
  window.Buffer = () => {}
  // window.Buffer = Buffer
} catch (err) {
  // nothing
}

const babel = require('@babel/standalone')

babel.template = require('@babel/template').default
babel.t = require('@babel/types')
babel.generator = require('@babel/generator').default
babel.babylon = require('@babel/parser')
babel.prettier = require('prettier')

const objList = []
const stringList = []

// ES6?
// import { uuidv4 as uuid } from 'uuid'

// import babel from '@babel/standalone'

// import template from '@babel/template'
// babel.template = template
// import t from '@babel/types'
// babel.t = t
// import generator from '@babel/generator'
// babel.generator = generator
// import babylon from '@babel/parser'
// babel.babylon = babylon
// import prettier from 'prettier'
// babel.prettier = prettier

export const local = {}
export const t = babel?.t

export const getBabel = () => {
  return babel
}
export const uuid = uuidv4
export const pause = (value, opts) => {
  return stringify(value, opts)
}
export const save = (value, opts) => {
  return stringify(value, opts)
}
export const toJavascript = (value, opts = {}) => {
  let defaultOpts = {
    wrapInFunction: true,
    declarations: [],
    identifier: 'obj',
    keys: {
      obj: 1
    },
    dependancies: {},
    mappings: [],
    seen: [],
    db: []
  }
  Object.assign(defaultOpts, opts)
  opts = defaultOpts
  toJavascriptAux(value, opts)
  // sort declarations by dependancies
  for (let declaration of opts.declarations) {
    if (declaration.type === 'ExpressionStatement') {
      // nothing
    } else {
      let key = declaration.declarations[0].id.name
      let dependancies = opts.dependancies[key]
      let dependancyCheck = {}
      for (let dependancy of dependancies) {
        dependancyCheck[dependancy] = false
      }
      let sortableDeclarationIndex = 0
      let insertionIndex = 0
      for (let sortableDeclaration of opts.declarations) {
        if (sortableDeclaration.type === 'ExpressionStatement') {
          // nothing
        } else {
          let sortableDeclarationKey =
            sortableDeclaration.declarations[0].id.name
          if (dependancyCheck[sortableDeclarationKey] === false) {
            insertionIndex = sortableDeclarationIndex + 1
            dependancyCheck[sortableDeclarationKey] = true
          }
        }
        // increment iterator index
        sortableDeclarationIndex++
      }
      let declarationIndex = opts.declarations.indexOf(declaration)
      opts.declarations.splice(declarationIndex, 1)
      opts.declarations.splice(insertionIndex, 0, declaration)
    }
  }
  let program
  if (opts.wrapInFunction && !opts.moduleExport) {
    opts.declarations.push(t.returnStatement(t.identifier('obj')))
    let expression = t.expressionStatement(
      t.callExpression(
        t.functionExpression(null, [], t.blockStatement(opts.declarations)),
        []
      )
    )
    program = t.program([expression])
  } else {
    if (opts.moduleExport) {
      opts.declarations.push(
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.memberExpression(t.identifier('module'), t.identifier('exports')),
            t.identifier('obj')
          )
        )
      )
    }
    program = t.program(opts.declarations)
  }
  let stringifiedProgram = getBabel().generator(program).code
  return getBabel().prettier.format(stringifiedProgram, {
    semi: false,
    parser: 'babel',
    useTabs: true
  })
}
export const toJavascriptAux = (value, opts) => {
  if (typeof value === 'object') {
    if (!opts.seen.includes(value)) {
      // update map and seen
      opts.seen.push(value)
      let properties = createObjectProperties(value, opts)
      let declaration = t.variableDeclaration('let', [
        t.variableDeclarator(
          t.identifier(opts.identifier),
          t.objectExpression(properties)
        )
      ])
      opts.declarations.unshift(declaration)
      for (let key of Object.keys(value)) {
        let property = properties.find(v => {
          return v.value.name === key
        })
        if (property) {
          let identifier = property.value.name
          toJavascriptAux(value[key], { ...opts, identifier })
        }
      }
    }
  } else if (typeof value === 'string') {
    let declaration = t.variableDeclaration('let', [
      t.variableDeclarator(
        t.identifier(opts.identifier),
        t.stringLiteral(value)
      )
    ])
    opts.declarations.unshift(declaration)
  }
}
export const createObjectProperties = (value, opts) => {
  let properties = []
  let dependancies = opts.dependancies[opts.identifier]
  if (!dependancies) dependancies = opts.dependancies[opts.identifier] = []
  for (let key of Object.keys(value)) {
    if (value[key] === value) {
      opts.declarations.push(
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.memberExpression(
              t.identifier(opts.identifier),
              t.identifier(key)
            ),
            t.identifier(opts.identifier)
          )
        )
      )
    } else {
      if (!opts.db.includes(value[key])) {
        opts.db.push(value[key])
        if (opts.keys[key] === undefined) {
          opts.keys[key] = 1
        }
        let keyIncrement = opts.keys[key]
        if (keyIncrement == 1) {
          opts.mappings.push(key)
        } else {
          opts.mappings.push(key + keyIncrement)
        }
        opts.keys[key]++
      }
      let identifier = opts.mappings[opts.db.indexOf(value[key])]
      dependancies.push(identifier)
      properties.push(
        t.objectProperty(
          t.identifier(key),
          t.identifier(identifier),
          false,
          key == identifier
        )
      )
    }
  }
  return properties
}
export const serialize = (value, opts = {}) => {
  opts.strictFunctions = false
  opts.serializeArrayProps = true
  return stringify(value, opts)
}
export const stringify = (value, opts = {}) => {
  let schema = {
    stringifier: stringifier,
    replace (key, value) {
      if (opts.firstRun) {
        opts.firstRun = !opts.firstRun
        return value
      }
      var after = opts.stringifier(key, value, opts)

      const type = typeof after.value

      if (type === 'object') {
        if (after === null || after.value === null) {
          const ret = after.value
          return ret
        }
      } else if (type === 'string') {
        const ret =
          opts.known.get(after.key) || setKnown(opts.known, opts.input, after)
        return ret
      }

      return after.value
    },
    strictFunctions: true,
    firstRun: undefined,
    known: new Map(),
    input: [],
    output: []
  }

  Object.keys(schema).forEach(key => {
    if (getsmart(opts, epp(key), { undefined: true }, true).undefined == true) {
      opts[key] = schema[key]
    }
  })

  opts.virtual = opts.stringifier('', value, opts)
  for (
    let i = parseInt(setKnown(opts.known, opts.input, opts.virtual));
    i < opts.input.length;
    i++
  ) {
    opts.firstRun = true
    try {
      opts.output[i] = JSON.stringify(opts.input[i], opts.replace, opts.space)
    } catch (err) {
      console.error(err)
    }
  }
  return '[' + opts.output.join(',') + ']'
}
export const replacer = (key, value) => {
  const opts = opts || {}

  if (opts.firstRun) {
    opts.firstRun = !opts.firstRun
    return value
  }
  var after = opts.stringifier(key, value, opts)
  // replace with if statements

  const type = typeof after.value

  if (type === 'object') {
    if (after === null) {
      const ret = after.value
      return ret
    }
  } else if (type === 'string') {
    const ret =
      opts.known.get(after.key) || setKnown(opts.known, opts.input, after)
    return ret
  }
  return after.value
}
export const setKnown = (known, input, virtual) => {
  var index = String(input.push(virtual.value) - 1)
  known.set(virtual.key, index)
  return index
}
export const stringifier = (key, val, opts) => {
  let ret = { value: val, key: val }
  if (
    val instanceof Function &&
    typeof val.toString === 'function' &&
    (!opts.strictFunctions || typeof val.$scopes != 'undefined')
  ) {
    let known = opts.known.get(ret.key)
    ret = {
      value: known || {
        type: 'function',
        js: val.toString(),
        $scopes: val.$scopes,
        $context: val.$context,
        ...val
      },
      key: val
    }
    if (ret.value.js == 'function () { [native code] }') return
    if (typeof known == 'undefined') setKnown(opts.known, opts.input, ret)
  } else if (ret.value === Infinity && typeof ret.value != 'string') {
    let known = opts.known.get(ret.key)
    ret = {
      value: known || {
        type: 'number',
        js: 'Infinity',
        $scopes: [],
        $context: {}
      },
      key: val
    }
    if (typeof known == 'undefined') setKnown(opts.known, opts.input, ret)
  } else if (typeof ret.value === 'undefined') {
    ret = {
      value: {
        type: 'undefined',
        js: 'undefined'
      },
      key: val
    }
  } else if (ret.value instanceof Array && opts.serializeArrayProps) {
    let known = opts.known.get(ret.key)
    ret = {
      value: known
        ? ret.value
        : {
            type: 'Array',
            js: ret.value,
            uuid: ret.value.uuid
          },
      key: val
    }
    setKnown(opts.known, opts.input, ret)
  }
  return ret
}
export const primitives = value => {
  return value instanceof String ? String(value) : value
}
export const Primitives = (key, value) => {
  return typeof value === 'string' ? new String(value) : value
}
export const play = (text, opts) => {
  return parse(text, opts)
}
export const load = (text, opts = {}) => {
  opts.strictFunctions = false
  return parse(text, opts)
}
export const parse = (text, opts = {}) => {
  let schema = {
    // parser: eval('(function '+parser+')'),
    parser: parser(opts),
    value: {},
    strictFunctions: true,
    noFunctions: false,
    firstPass: true,
    output: new Map()
  }

  Object.keys(schema).forEach(key => {
    if (getsmart(opts, epp(key), { undefined: true }, true).undefined == true) {
      opts[key] = schema[key]
    }
  })

  // opts.parser = opts.parser.bind(opts)
  opts.input = JSON.parse(text, Primitives)
  opts.firstPass = false
  opts.input = opts.input.map(primitives)
  opts.value = opts.input[0]
  let isObject = typeof opts.value === 'object' && opts.value
  var tmp = isObject
    ? revive(opts.input, opts.output, opts.value, opts.parser, opts)
    : opts.value

  opts.replaceMode = true
  let ret = revive(opts.input, new Map(), tmp, opts.parser, opts)
  ret = opts.parser('', tmp, opts)
  return ret
}
export const parser = opts => {
  return function (key, val) {
    if (val.js && val.type === 'Array') {
      const ret = opts.input[opts.output.get(val)].js
      ret.uuid = opts.input[opts.output.get(val)].uuid
      return ret
    } else if (
      val.js &&
      val.type === 'function' &&
      opts.replaceMode &&
      !opts.noFunctions
    ) {
      let ret = opts.input[opts.output.get(val)]
      if (typeof ret == val.type) return ret
      let uuid = jsUUID()
      var fn
      var scopedEval
      if (val.$scopedEval && typeof val.$scopedEval == 'function') {
        scopedEval = val.$scopedEval
      } else {
        var fns = createScopedEval(uuid)

        try {
          fn = eval(`(${fns})`)
          var input = { val, smarts }
          scopedEval = fn(input)
        } catch (err) {
          console.log('Caught error evaling createScopedEval', err)
        }
      }

      ret = scopedEval({ val })
      try {
        Object.defineProperty(ret, '$scopes', {
          value: val.$scopes,
          enumerable: true
        })
        if (val.uuid) {
          ret.uuid = val.uuid
        }
      } catch (err) {
        if (opts.verbose) console.error(err)
      }
      try {
        Object.defineProperty(ret, '$context', {
          value: val.$context,
          enumerable: true
        })
      } catch (err) {
        if (opts.verbose) console.error(err)
      }
      try {
        Object.defineProperty(ret, '$scopedEval', {
          value: scopedEval,
          enumerable: true
        })
      } catch (err) {
        if (opts.verbose) console.error(err)
      }
      opts.input[opts.output.get(val)] = ret
      return ret
    } else if (opts.replaceMode) {
      return val
    }
    return Primitives(key, val)
  }
}
export const revive = (input, parsed, output, parser, opts) => {
  return Object.keys(output).reduce((output, key) => {
    var value = output[key]
    // if the value hasn't been revived yet
    if (value instanceof String) {
      var tmp = input[value]
      if (typeof tmp === 'object' && !parsed.get(tmp)) {
        parsed.set(tmp, value)
        output[key] = primitives(
          parser(key, revive(input, parsed, tmp, parser, opts))
        )
      } else {
        try {
          output[key] = primitives(parser(key, tmp))
        } catch (err) {
          delete output[key]
        }
      }
    } else {
      try {
        if (opts.replaceMode) {
          // output[key] = primitives(parser(key, revive(input, parsed, value, parser, opts)))
          value = parser(key, value)
          if (typeof value === 'object' && !parsed.get(value)) {
            parsed.set(value, value)
            output[key] = primitives(
              parser(key, revive(input, parsed, value, parser, opts))
            )
          } else {
            try {
              output[key] = primitives(value)
            } catch (err) {
              delete output[key]
            }
          }
        } else {
          output[key] = primitives(parser(key, value))
        }
      } catch (err) {
        delete output[key]
      }
    }
    return output
  }, output)
}
export const createScopedEval = uuid => {
  let ret = /*javascript*/ `
		function createScopedEval(${uuid}){
			
			// scopeCode
			${uuid}.scopeCode = ${uuid}.scopeCode || ${uuid}.getBabel().template.ast('try{}catch(err){console.log(err)}')
			${uuid}.previousScopeCode = ${uuid}.currentScopeCode || ${uuid}.scopeCode
			${uuid}.currentScopeCode = ${uuid}.scopeCode.block.body.length ? ${uuid}.getBabel().template.ast('try{}catch(err){console.log(err)}') : ${uuid}.scopeCode
			if(${uuid}.previousScopeCode != ${uuid}.currentScopeCode){
				${uuid}.previousScopeCode.block.body.push(
					${uuid}.currentScopeCode
				)
			}
			${uuid}.closureIndex = ${uuid}.closureIndex || 0
			${uuid}.closure = ${uuid}.getsmart.bind(this)(${uuid}, ${
    /*javascript*/ `\`val.$scopes.\${${uuid}.closureIndex}\``
  }, {})
			${uuid}.variableKeys = Object.keys(${uuid}.closure)
			${uuid}.variableMap = ${uuid}.getsmart.bind(this)(${uuid}, ${
    /*javascript*/ `\`val.$context.$variableMaps.\${${uuid}.closureIndex}\``
  }, [])
			${uuid}.allowedIdentifiers = ['let','var','const']
			${uuid}.variableKeys.forEach((key)=>{
				if(
					typeof ${uuid}.variableMap[key] == 'string' 
					&& ${uuid}.allowedIdentifiers.indexOf(${uuid}.variableMap[key]) >= 0
				){
					try{
						${uuid}.currentScopeCode.block.body.push(
							${uuid}.getBabel().template.ast(
								${
                  /*javascript*/ `\`
									\${${uuid}.variableMap[key]} \${key} = ${uuid}.val.$scopes[\${${uuid}.closureIndex}]['\${key}']
								\``
                }
							)
						)
					}catch(err){console.log(1,err)}
					try{
						${uuid}.currentScopeCode.block.body.push(
							${uuid}.getBabel().template.ast(
								${
                  /*javascript*/ `\`
									Object.defineProperty(
										${uuid}.val.$scopes[\${${uuid}.closureIndex}],
										\${${uuid}.stringify(key)},
										{
											get(){
												return \${key}
											},
											set(val){
												\${key} = val
											},
											enumerable: true
										}
									)
								\``
                }
							)
						)
					}catch(err){console.log(2,err)}
				}
				// console.log(${uuid}.scopeCode)
			})
			// console.log(${uuid}.scopeCode)
			${uuid}.closureIndex++
			if(${uuid}.closureIndex >= ${uuid}.getsmart.bind(this)(${uuid}, 'val.$scopes.length', -1)){
				// console.log(${uuid}.scopeCode)
				try{
					${uuid}.currentScopeCode.block.body.push(
						${uuid}.getBabel().template.ast(
							${
                /*javascript*/ `\`
								return \${${uuid}.scopedEval('${uuid}')}
							\``
              }
						)
					)
				}catch(err){console.log(3,err)}
				try{
					${uuid}.wrapper = ${uuid}.getBabel().template.ast(
						${
              /*javascript*/ `\`
							function anonymous(){}							
						\``
            }
					)
				}catch(err){console.log(4,err)}
				// console.log(${uuid}.wrapper)
				// console.log(${uuid}.scopeCode)
				${uuid}.wrapper.body.body.push(${uuid}.scopeCode)
				${uuid}.scopeCode = ${uuid}.wrapper
				${uuid}.scopeCode = ${uuid}.getBabel().generator(
					${uuid}.scopeCode
				).code
				// console.log(${uuid}.scopeCode)
				${uuid}.scopeCode = eval("("+${uuid}.scopeCode+")")
				// console.log(${uuid}.scopeCode.toString())
				try {
					${uuid}.val.$scopedEval = ${uuid}.scopeCode()
				}catch(err){console.log(5,err)}
				// console.log(${uuid}.val.$scopedEval)
				// return ${uuid}.scopeCode.toString()
				return ${uuid}.val.$scopedEval
			} else {
				return eval(${
          /*javascript*/ `\`(\${${uuid}.createScopedEval('${uuid}')})\``
        })(${uuid})
			}
		}
	`
  return ret
}
export const defineVariable = uuid => {
  return /*javascript*/ `
		${uuid.variableType}	${uuid.variableKey} = ${uuid}.$scope[${uuid}.variableKey]
		Object.defineProperty(
			${uuid}.$scope, 
			${uuid}.variableKey, 
			{
				get(){
					return ${uuid.variableKey}
				},
				set(val){
					${uuid.variableKey} = val
				},
				enumerable: true
			}
		)
	`
}
export const scopedEval = uuid => {
  let ret = /*javascript*/ `function scopedEval(${uuid}){
			if(typeof ${uuid} == 'string'){
				${uuid} = {
					val: {
						js: ${uuid}
					}
				}
			} else if(typeof ${uuid} == 'function' && typeof ${uuid}.toString == 'function'){
				${uuid} = {
					val: {
						js: ${uuid}.toString()
					}
				}
			}
			try {
				${uuid}.ret = eval('('+${uuid}.val.js+')')
			} catch(err1){
				try {
					${uuid}.ret = eval('({'+${uuid}.val.js+'})')
					${uuid}.keys = Object.keys(${uuid}.ret)
					${uuid}.ret = ${uuid}.ret[${uuid}.keys[0]]
				} catch(err2){
					try {
						${uuid}.ret = eval('({b:'+ ${uuid}.val.js +'})').b
					} catch(err3){
						console.error(err1)
						console.error(err2)
						console.error(err3)
					}
				}
			}
			return ${uuid}.ret
		}
	`
  return ret
}
export const jsUUID = (prefix = 'uuid') => {
  return prefix + uuid().replace(/-/g, '')
}
export const context = opts => {
  let uuid = gosmart.bind(this)(opts, 'path.context.scope.uuid', jsUUID())
  return eval(/*javascript*/ `
		(
			function(){
				${contextObject(uuid)}
				return ${uuid}
			}
		)()
	`)
}
export const contextObject = uuid => {
  return /*javascript*/ `
		let ${uuid} = {
			$$uuid: '${uuid}',
			$closure: {},
			$variableMap: {},
			$functionScoper: (func)=>{
				Object.defineProperty(
					func,
					'$scopes', 
					{
						value: (function(arr){
							for (var i = 0, arr2 = new Array(arr.length); i < arr.length; i++) { 
								arr2[i] = arr[i]; 
							} 
							return arr2
						})((typeof ${uuid} != 'undefined') ? ${uuid}.$scopes : []),
						enumerable: true
					}
				)
				Object.defineProperty(
					func,
					'$context',
					{
						value: ${uuid}
					}
				)
				return func
			},
			$add: (type, name, value)=>{
				${uuid}.$closure[name] = value
				${uuid}.$variableMap[name] = type
			},
			$scopes: (function(arr){
				for (var i = 0, arr2 = new Array(arr.length); i < arr.length; i++) { 
					arr2[i] = arr[i]; 
				} 
				return arr2
			})((typeof $context == 'object') ? $context.$scopes : []),
			$variableMaps: (function(arr){
				for (var i = 0, arr2 = new Array(arr.length); i < arr.length; i++) { 
					arr2[i] = arr[i]; 
				} 
				return arr2
			})((typeof $context == 'object') ? $context.$variableMaps : []),
			$contexts: {},
			$contextsList: [],
			$parentContexts: [],
			$contextStatus: "var",
			$mode: (eval("var ${uuid}1 = null"), (typeof ${
    uuid + '1'
  } === "undefined")) ? "strict" : "non-strict",
		}
		${uuid}.$functionScoper = ${uuid}.$functionScoper(${uuid}.$functionScoper)
		${uuid}.$scopes.splice(0,0,${uuid}.$closure)
		${uuid}.$variableMaps.splice(0,0,${uuid}.$variableMap)
		var globalThis = globalThis || global || window || {}
		${uuid}.$contextStatus = ${uuid}.$mode == 'strict' ? '' : 'var'
		try { 
			eval(${
        /*javascript*/ `\`\${${uuid}.$contextStatus} $context = $context || ${uuid}\``
      })
		} catch(err){
			${uuid}.$contextStatus = ''
		}
		eval(${
      /*javascript*/ `\`\${${uuid}.$contextStatus} $context = $context || ${uuid}\``
    })
		if(typeof $context == 'object' && $context != ${uuid} && $context.$contexts instanceof Object){
			$context.$contexts[${uuid}.$$uuid] = $context.$contexts[${uuid}.$$uuid] || []
			${uuid}.$$instance = $context.$contexts[${uuid}.$$uuid].push(${uuid})-1
			${uuid}.$parentContexts.push($context)
			$context.$contextsList.push(${uuid})
		}
		if(!globalThis.$contexts){
			globalThis.$contexts = {}
			globalThis.$contexts[${uuid}.$$uuid] = [${uuid}]
			globalThis.$contextsList = [${uuid}]
			${uuid}.$$instance = 0
		} else if(
			globalThis.${uuid}s instanceof Object 
			&& ${uuid}.$parentContexts.length == 0
			&& typeof ${uuid}.$$instance == 'undefined'
		){
			globalThis.${uuid}s[${uuid}.$$uuid] = globalThis.$contexts[${uuid}.$$uuid] || []
			${uuid}.$$instance = globalThis.$contexts[${uuid}.$$uuid].push(${uuid})-1
			globalThis.$contextsList.push(${uuid})
		}
		{
			let $context = ${uuid}
		}
	`
}
export const createContext = opts => {
  schema(opts, {
    wrapBody: true
  })
  let node = opts.aster(/*javascript*/ `
		${contextObject(opts.uuid)}
	`)
  node[0].declarations[0].contextDeclaration = true
  // so the $functionScoper function doesn't get wrapped or have $context inserted
  let property3 = node[0].declarations[0].init.properties[3]
  property3.value.scoperWrapped = true
  property3.value.body.scopeInitialized = true
  let property3ScopesValue =
    property3.value.body.body[0].expression.arguments[2].properties[0].value
  property3ScopesValue.callee.scoperWrapped = true
  property3ScopesValue.callee.body.scopeInitialized = true
  let property3ForStatement = property3ScopesValue.callee.body.body[0]
  property3ForStatement.body.scopeInitialized = true
  property3ForStatement.init.declarations[0].inScope = true
  property3ForStatement.init.declarations[1].inScope = true
  // so the $add function doesn't get wrapped or have $context inserted
  let property4 = node[0].declarations[0].init.properties[4]
  property4.value.scoperWrapped = true
  property4.value.body.scopeInitialized = true
  // so the $scopes self-invoking function doesn't get wrapped or have $context inserted
  let property5 = node[0].declarations[0].init.properties[5]
  property5.value.callee.scoperWrapped = true
  property5.value.callee.body.scopeInitialized = true
  let property5ForStatement = property5.value.callee.body.body[0]
  property5ForStatement.body.scopeInitialized = true
  property5ForStatement.init.declarations[0].inScope = true
  property5ForStatement.init.declarations[1].inScope = true
  // so the $variableMaps self-invoking function doesn't get wrapped or have $context inserted
  let property6 = node[0].declarations[0].init.properties[6]
  property6.value.callee.scoperWrapped = true
  property6.value.callee.body.scopeInitialized = true
  let property6ForStatement = property6.value.callee.body.body[0]
  property6ForStatement.body.scopeInitialized = true
  property6ForStatement.init.declarations[0].inScope = true
  property6ForStatement.init.declarations[1].inScope = true
  const node6 = node[6]
  // make sure try statement block doesn't get scoped either
  node6.block.scopeInitialized = true
  // make sure catch statement block doesn't get scoped either
  node6.handler.body.scopeInitialized = true
  const node8 = node[8]
  // make sure if statement block doesn't get scoped either
  node8.consequent.scopeInitialized = true
  const node9 = node[9]
  // make sure if statement block doesn't get scoped either
  node9.consequent.scopeInitialized = true
  // make sure else if statement block doesn't get scoped either
  node9.alternate.consequent.scopeInitialized = true
  const node10 = node[10]
  node10.scopeInitialized = true
  node10.inheritScope = true
  node[node.length - 1].lastContextNode = true
  if (opts.wrapBody) {
    let bodyWrapper = node[node.length - 1]
    bodyWrapper.body.push(...opts.path.node.body)
  }
  addBindingsToContext({ ...opts, node })
  // let addContextToScopeNode = scopeVar({
  // 	uuid,
  // 	key: '$context',
  // 	type: 'let',
  // 	aster
  // })
  // wrapper.body.splice(1,0,addContextToScopeNode)
  return node
}
export const createInlineContext = opts => {
  let wrapperString = /*javascript*/ `
		for(let ${opts.uuid} = function(){
			// node goes here
			return ${opts.uuid}
		}() ; a<1;a++){}
	`
  let inlineContextNode = opts.aster(wrapperString).init.declarations[0]
  let contextBody = createContext({ ...opts, wrapBody: false })
  inlineContextNode.init.callee.body.body.splice(0, 0, ...contextBody)
  inlineContextNode.contextDeclaration = true
  return inlineContextNode
}
export const addBindingsToContext = opts => {
  for (let key in opts.path.scope.bindings) {
    let binding = opts.path.scope.bindings[key]
    if (binding.kind == 'var') {
      let newNode = scopeVar({
        ...opts,
        key,
        type: binding.kind
      })
      opts.node.splice(opts.node.length - 1, 0, newNode)
    }
  }
}
export const scopeVarCode = opts => {
  let ret = /*javascript*/ `
		Object.defineProperty(
			${opts.uuid}.$closure,
			${stringify(opts.key)},
			{
				get(){
					return ${opts.key}
				},
				set(val){
					${opts.key} = val
				},
				enumerable: true
			}
		) &&
		(${opts.uuid}.$variableMap["${opts.key}"] = "${opts.type}")
	`
  return ret
}
export const scopeVarInlineCode = opts => {
  let ret = /*javascript*/ `
		let ${jsUUID()} = (
			${scopeVarCode(opts)}
		)
	`
  return ret
}
export const scopeVar = (opts = {}) => {
  let string
  let thirdArg
  let node
  if (opts.inline) {
    string = scopeVarInlineCode(opts)
    node = opts.aster(string)
    thirdArg = node.declarations[0].init.left.arguments[2]
    node.declarations[0].inScope = true
  } else {
    string = scopeVarCode(opts)
    node = opts.aster(string)
    thirdArg = node.expression.left.arguments[2]
  }

  let getter = thirdArg.properties[0]
  let setter = thirdArg.properties[1]
  getter.body.scopeInitialized = true
  setter.body.scopeInitialized = true
  getter.body.scoperWrapped = true
  setter.body.scoperWrapped = true
  getter.scoperWrapped = true
  setter.scoperWrapped = true
  if (opts.inline) return node.declarations[0]
  return node
}
export const functionWrapper = (uuid, path, aster) => {
  let wrapper = aster(/*javascript*/ `
		${uuid}.$functionScoper()
	`)
  wrapper.expression.arguments.push(path.node)
  return wrapper
}
export const bodyInsert = (index, body, aster, ...things) => {
  body.splice(index, 0, ...things)
  return things.length
}
export const initBlock = (path, aster) => {
  if (!path.node.scopeInitialized) {
    path.node.scopeInitialized = true
    let uuid = getPathUUID({ path })
    let contextNode = createContext({ uuid, aster, path })
    path.node.body = contextNode
  }
}
export const getNodeUUID = opts => {
  if (
    opts.node &&
    opts.node.type != 'BlockStatement' &&
    opts.node.type != 'Program'
  )
    return getNodeUUID({
      ...opts,
      node: opts.node.body || opts.node.block
    })
  return gosmart.bind(this)(opts.node, 'uuid', jsUUID())
}
export const getPathUUID = opts => {
  if (
    opts.path.context.scope.path.node.inheritScope ||
    opts.path.scope.path.node.inheritScope
  )
    return getPathUUID({ ...opts, path: opts.path.parentPath })
  return getNodeUUID({
    ...opts,
    node: opts.path.context.scope.path.node
  })
}
export const babelPlugin = babel => {
  const aster = babel.template.ast

  let metaVisitor = {
    Program (path) {
      initBlock(path, aster)
    },
    BlockStatement (path) {
      initBlock(path, aster)
    },
    ForInStatement () {
      // nothing
    },
    // ForInStatement (path) {
    //   path = path
    // },
    ObjectMethod (path) {
      let name = path.node.key.name
      let replacement = aster(/*javascript*/ `
				let a = {
					${name}: function ${name}(){}
				}
			`)
      replacement = replacement.declarations[0].init.properties[0]
      replacement.value.body = path.node.body
      replacement.value.params = path.node.params
      path.replaceWith(replacement)
    },
    Function (path) {
      if (
        path.type != 'FunctionDeclaration' &&
        !path.node.scoperWrapped &&
        !path.node.body.scoperWrapped
      ) {
        path.node.scoperWrapped = true
        path.node.body.scoperWrapped = true
        let uuid = getPathUUID({ path })
        let replacement = functionWrapper(uuid, path, aster)
        path.replaceWith(replacement)
      }
    },
    FunctionDeclaration (path) {
      if (!path.node.scoped) {
        path.node.scoped = true
        const parentBlock = path.scope.parent
        try {
          parentBlock.block.body.forEach(node => {
            if (node.lastContextNode) {
              let uuid = getPathUUID({ path })
              let newNode = aster(/*javascript*/ `
								${uuid}.$functionScoper(${path.node.id.name})
							`)
              node.body.splice(1, 0, newNode)
              throw new Error('break foreach')
            }
          })
        } catch (err) {
          // nothing
        }
      }
    },
    VariableDeclarator (path) {
      if (!path.node.inScope) {
        path.node.inScope = true
        let parentPath = getsmart.bind(this)(path, 'parentPath', undefined)
        if (
          // this is for inline let and const declarations in normal
          // js blocks
          (parentPath.node.kind == 'let' || parentPath.node.kind == 'const') &&
          // we check the length of declarations because we only have to do inline replacement
          // if there's a chance another declaration might use a former one
          parentPath.node.declarations.length > 1 &&
          !(
            parentPath.parentPath.node.type == 'ForInStatement' ||
            parentPath.parentPath.node.type == 'ForOfStatement' ||
            parentPath.parentPath.node.type == 'ForStatement'
          )
        ) {
          let uuid = getPathUUID({ path })
          if (uuid) {
            let indexInParent = parentPath.node.declarations.indexOf(path.node)
            let newDeclaration = scopeVar({
              aster,
              inline: true,
              uuid,
              key: parentPath.node.declarations[indexInParent].id.name,
              type: parentPath.node.kind
            })
            parentPath.node.declarations.splice(
              indexInParent + 1,
              0,
              newDeclaration
            )
          }
        } else if (
          //
          (parentPath.node.kind == 'let' ||
            parentPath.node.kind == 'var' ||
            parentPath.node.kind == 'const') &&
          // only do this for singular declarations
          parentPath.node.declarations.length < 2 &&
          // and check if variable is declared inside a ForX statement
          (parentPath.parentPath.node.type == 'ForInStatement' ||
            parentPath.parentPath.node.type == 'ForOfStatement' ||
            parentPath.parentPath.node.type == 'ForStatement')
        ) {
          let uuid = getPathUUID({ path })
          if (uuid) {
            let indexInParent = parentPath.node.declarations.indexOf(path.node)
            let newNode = scopeVar({
              aster,
              uuid,
              key: parentPath.node.declarations[indexInParent].id.name,
              type: parentPath.node.kind
            })
            parentPath.parentPath.node.body.body.splice(0, 0, newNode)
          }
        } else if (
          // this is a special case for when ForStatements get their own scope
          (parentPath.node.kind == 'let' || parentPath.node.kind == 'const') &&
          // we check the length of declarations because we only have to do inline replacement
          // if there's a chance another declaration might use a former one
          parentPath.node.declarations.length > 1 &&
          parentPath.parentPath.node.type == 'ForStatement'
        ) {
          // if the first declaration isn't our context declaration, insert one
          let uuid = gosmart.bind(this)(path, 'scope.uuid', jsUUID())
          if (!parentPath.node.declarations[0].contextDeclaration) {
            let inlineContextDeclaration = createInlineContext({
              path,
              uuid,
              aster
            })
            parentPath.node.declarations.splice(0, 0, inlineContextDeclaration)
          }
          if (uuid) {
            let indexInParent = parentPath.node.declarations.indexOf(path.node)
            let newDeclaration = scopeVar({
              aster,
              inline: true,
              uuid,
              key: parentPath.node.declarations[indexInParent].id.name,
              type: parentPath.node.kind
            })
            parentPath.node.declarations.splice(
              indexInParent + 1,
              0,
              newDeclaration
            )
          }
        } else if (
          parentPath.node.kind == 'let' ||
          parentPath.node.kind == 'const'
        ) {
          let uuid = getPathUUID({ path })
          if (uuid) {
            let indexInParent = parentPath.node.declarations.indexOf(path.node)
            let newNode = scopeVar({
              aster,
              uuid,
              key: parentPath.node.declarations[indexInParent].id.name,
              type: parentPath.node.kind
            })
            parentPath.insertAfter(newNode)
          }
        } else {
          // let uuid = getPathUUID({path})
          // if(uuid){
          // 	let indexInParent = parentPath.node.declarations.indexOf(path.node)
          // 	let newNode = scopeVar({
          // 		aster,
          // 		uuid,
          // 		key: parentPath.node.declarations[indexInParent].id.name,
          // 		type: parentPath.node.kind
          // 	})
          // 	parentPath.insertAfter(newNode)
          // }
        }
      }
    }
  }
  let ret = {
    visitor: metaVisitor
    // visitor: {
    // 	Program(path){
    // 		path.traverse(metaVisitor)
    // 	}
    // }
  }
  return ret
}
export const transform = (src, opts = {}) => {
  return getBabel().transform(src, {
    plugins: [babelPlugin],
    ...opts
  })
}
/** non-parser stuff */
export const stripUuids = (thing, seen = []) => {
  try {
    delete thing.uuid
  } catch {
    // nothing
  }
  if (typeof thing === 'object') {
    const keys = Object.keys(thing)
    for (const key of keys) {
      const val = thing[key]
      if (!seen.includes(val)) {
        seen.push(val)
        stripUuids(val, seen)
      }
    }
  }
}
export const dupe = (obj, opts = {}) => {
  return parse(stringify(obj, opts), opts)
}
export const clone = (obj, opts = {}) => {
  return dupe(obj, opts)
}
export const schema = (obj1, obj2, opts = {}) => {
  if (!opts.noSchemaClone) {
    obj2 = clone(obj2, opts)
  }
  return merge(obj1, obj2, {
    ...opts
  })
}
export const create = (obj1, obj2, opts) => {
  let ret = merge(obj1, obj2, {
    clone: true,
    ...opts
  })

  return ret
}
export const merge = (value1, value2, opts = {}, seen = new Map()) => {
  if (seen.has(value1)) return seen.get(value1)

  if (value1 instanceof Array && value2 instanceof Array) {
    return value1
  }

  // base case non-basic value
  if (basic(value1) && !opts.overwrite) {
    return value1
  }

  if (opts.overwrite && basic(value2)) {
    return value2
  }

  if (!basic(value1) && basic(value2)) {
    return value1
  }

  if (opts.clone) {
    value1 = clone(value1)
    value2 = clone(value2)
  }

  let props = Object.keys(value2)

  props.forEach(prop => {
    let propertyValue1 = value1[prop]
    if (prop in value1 && basic(propertyValue1) && !opts.overwrite) {
      return
    }
    let propertyValue2 = value2[prop]
    seen.set(value1, value1)
    let newVal = propertyValue2
    if (prop in value1) {
      newVal = merge.bind(this)(
        propertyValue1,
        propertyValue2,
        { ...opts, ...{ clone: false } },
        seen
      )
    }
    if (
      getsmart.bind(this)(local.vue, 'reactiveSetter', false) &&
      getsmart.bind(this)(
        this,
        '$set',
        getsmart.bind(this)(local.vue, 'Vue.set', false)
      ) &&
      value1
    ) {
      const setToUse = this.$set || local.vue.Vue.set
      setToUse?.(value1, prop, newVal)
      if (
        typeof getsmart.bind(this)(window, '$store.commit', undefined) ==
        'function'
      ) {
        window.$store.commit(local.vue.basePath || 'graph/thing')
      }
    } else {
      value1[prop] = newVal
      if (
        getsmart.bind(this)(local.vue, 'store', false) &&
        typeof getsmart.bind(this)(window, '$store.commit', undefined) ==
          'function'
      ) {
        window.$store.commit(local.vue.basePath || 'graph/thing')
      }
    }
  })

  return value1
}
export const basic = value => {
  let valueType = typeof value
  let ret =
    !(
      valueType == 'object' ||
      valueType == 'array' ||
      valueType == 'function'
    ) || value === null
  return ret
}
export const mod = (args, mod) => {
  return mod(args) || args
}
// transform(value, fn, path, ret={}){
// 	return forEach(value, fn, path, ret)
// },
export const deepForEach = (
  value,
  fn,
  path,
  ret = {},
  seens = { originals: [], clones: [] },
  first = true
) => {
  path = path || ''
  if (first) {
    value = { '': value }
  }
  // if(!(typeof value == 'string' || typeof value == 'boolean' || typeof value == 'number')){
  // 	seens.originals.push(value)
  // }
  if (Array.isArray(value)) {
    forEachArray(value, fn, path, ret, seens)
  } else if (typeof value == 'object') {
    forEachObject(value, fn, path, ret, seens)
  }
  return ret['']
}
export const forEachObject = (obj, fn, path, ret, seens) => {
  for (const key in obj) {
    const deepPath = path ? `${path}.${key}` : key
    let primitive =
      typeof obj[key] == 'string' ||
      typeof obj[key] == 'boolean' ||
      typeof obj[key] == 'number'
    if (primitive || seens.originals.indexOf(obj[key]) < 0) {
      if (!primitive) {
        seens.originals.push(obj[key])
      }
      // Note that we always use obj[key] because it might be mutated by forEach
      fn(obj[key], key, obj, deepPath, ret, seens)

      deepForEach(obj[key], fn, deepPath, ret, seens, false)
    }
  }
}
export const forEachArray = (array, fn, path, ret = {}, seens) => {
  array.forEach((value, index, arr) => {
    let primitive =
      typeof value == 'string' ||
      typeof value == 'boolean' ||
      typeof value == 'number'
    if (primitive || seens.originals.indexOf(value) < 0) {
      if (!primitive) {
        seens.originals.push(value)
      }
      const deepPath = `${path}.${index}`

      fn(value, index, arr, deepPath, ret, seens)

      // Note that we use arr[index] because it might be mutated by forEach
      deepForEach(arr[index], fn, deepPath, ret, seens, false)
    }
  })
}
export const setThing = ({
  option,
  list = getsmart.bind(this)(objList),
  obj = true,
  keys = ['uuid', '_id', 'id'],
  keymatchtype,
  push,
  strings,
  targets
} = {}) => {
  let index = thingIndex({
    option,
    list,
    obj,
    keys,
    keymatchtype,
    strings
  })
  if (obj == 'debug') {
    console.log('index')
    console.log(index)
    console.log('list')
    console.log(list)
  }
  if (index >= 0 && list) {
    if (targets && targets.length && typeof targets.length == 'number') {
      for (var i = 0; i < targets.length; i++) {
        let value = getsmart.bind(this)(option, targets[i], undefined)
        if (value) {
          setsmart.bind(this)(list[index], targets[i], value)
        }
      }
    } else {
      list.splice(index, 1, option)
      if (
        getsmart.bind(this)(local.vue, 'reactiveSetter', false) &&
        getsmart.bind(this)(
          this,
          '$set',
          getsmart.bind(this)(local.vue, 'Vue.set', false)
        )
      ) {
        if (
          !localStorage.getItem('vuexWriteLock') &&
          typeof getsmart.bind(this)(window, '$store.commit', undefined) ==
            'function'
        ) {
          window.$store.commit(local.vue.basePath || 'graph/thing')
        }
      } else if (
        getsmart.bind(this)(local.vue, 'store', false) &&
        !localStorage.getItem('vuexWriteLock') &&
        typeof getsmart.bind(this)(window, '$store.commit', undefined) ==
          'function'
      ) {
        window.$store.commit(local.vue.basePath || 'graph/thing')
      }
    }
    // list[index] = option
  } else if (push && list) {
    if (
      getsmart.bind(this)(local.vue, 'reactiveSetter', false) ||
      getsmart.bind(this)(local.vue, 'store', false)
    ) {
      list.splice(list.length, 0, option)
      if (
        !localStorage.getItem('vuexWriteLock') &&
        typeof getsmart.bind(this)(window, '$store.commit', undefined) ==
          'function'
      ) {
        window.$store.commit(local.vue.basePath || 'graph/thing')
      }
    } else {
      list.push(option)
    }
    index = list.length - 1
  }
  return index
}
export const setThings = ({
  options,
  list = getsmart.bind(this)(objList),
  obj = true,
  keys = ['uuid', '_id', 'id'],
  keymatchtype,
  push,
  async
} = {}) => {
  if (options && options instanceof Array && list) {
    for (let option of options) {
      if (async) {
        new Promise(() => {
          setThing({
            option,
            list,
            obj,
            keys,
            keymatchtype,
            push
          })
        })
      } else {
        setThing({
          option,
          list,
          obj,
          keys,
          keymatchtype,
          push
        })
      }
    }
  }
  return list
}
export const optIn = (
  option,
  list = getsmart.bind(this)(stringList),
  obj,
  keys = ['uuid', '_id', 'id'],
  keymatchtype,
  index
) => {
  if (typeof option === 'object') {
    obj = true
  }
  if (!obj && list && list.indexOf && list.indexOf(option) >= 0) {
    return index ? list.indexOf(option) : true
  } else if (obj && list && typeof list.length == 'number') {
    for (var i = 0; i < list.length; i++) {
      if (!(keys && typeof keys.length == 'number')) return
      for (var indKey = 0; indKey < keys.length; indKey++) {
        if (keymatchtype == 'broad') {
          if (
            list[i] &&
            getsmart.bind(this)(list[i], keys[indKey], undefined) ==
              getsmart.bind(this)(option, keys[indKey], undefined) &&
            getsmart.bind(this)(list[i], keys[indKey], undefined) !== undefined
          ) {
            return index ? i : true
          } else if (
            list[i] &&
            typeof list[i] == 'string' &&
            list[i] == getsmart.bind(this)(option, keys[indKey], undefined) &&
            getsmart.bind(this)(option, keys[indKey], undefined) !== undefined
          ) {
            return index ? i : true
          }
        } else {
          if (
            list[i] &&
            getsmart.bind(this)(list[i], keys[indKey], undefined) ==
              getsmart.bind(this)(option, keys[indKey], undefined) &&
            getsmart.bind(this)(list[i], keys[indKey], undefined) !== undefined
          ) {
            if (indKey == keys.length - 1) {
              return index ? i : true
            }
          } else if (
            list[i] &&
            typeof list[i] == 'string' &&
            list[i] == getsmart.bind(this)(option, keys[indKey], undefined) &&
            getsmart.bind(this)(option, keys[indKey], undefined) !== undefined
          ) {
            if (indKey == keys.length - 1) {
              return index ? i : true
            }
          }
        }
      }
    }
  }
  return index ? -1 : false
}
export const thingIn = ({
  option,
  list = getsmart.bind(this)(objList),
  obj = true,
  keys = ['uuid', '_id', 'id'],
  keymatchtype,
  retIndex
  // vue = local.vue
} = {}) => {
  if (typeof option === 'object') {
    obj = true
  }
  if (!obj && list && list.indexOf && list.indexOf(option) >= 0) {
    if (retIndex) {
      return list.indexOf(option)
    } else {
      return true
    }
  } else if (obj && list && typeof list.length == 'number') {
    for (var i = 0; i < list.length; i++) {
      if (!(keys && typeof keys.length == 'number')) return
      for (var indKey = 0; indKey < keys.length; indKey++) {
        if (keymatchtype == 'broad') {
          if (
            list[i] &&
            getsmart.bind(this)(list[i], keys[indKey], undefined) ==
              getsmart.bind(this)(option, keys[indKey], undefined) &&
            getsmart.bind(this)(list[i], keys[indKey], undefined) !== undefined
          ) {
            if (retIndex) {
              return i
            } else {
              return true
            }
          } else if (
            list[i] &&
            typeof list[i] == 'string' &&
            list[i] == getsmart.bind(this)(option, keys[indKey], undefined) &&
            getsmart.bind(this)(option, keys[indKey], undefined) !== undefined
          ) {
            if (retIndex) {
              return i
            } else {
              return true
            }
          }
        } else {
          if (
            list[i] &&
            getsmart.bind(this)(list[i], keys[indKey], undefined) ==
              getsmart.bind(this)(option, keys[indKey], undefined) &&
            getsmart.bind(this)(list[i], keys[indKey], undefined) !== undefined
          ) {
            if (indKey == keys.length - 1) {
              if (retIndex) {
                return i
              } else {
                return true
              }
            }
          } else if (
            list[i] &&
            typeof list[i] == 'string' &&
            list[i] == getsmart.bind(this)(option, keys[indKey], undefined) &&
            getsmart.bind(this)(option, keys[indKey], undefined) !== undefined
          ) {
            if (indKey == keys.length - 1) {
              if (retIndex) {
                return i
              } else {
                return true
              }
            }
          }
        }
      }
    }
  }
  if (retIndex) {
    return -1
  } else {
    return false
  }
}
export const optsIn = (
  options,
  list = getsmart.bind(this)(stringList),
  obj,
  keys = ['uuid', '_id', 'id'],
  keymatchtype
) => {
  if (!(options instanceof Array)) return true
  for (let option of options) {
    // if(typeof option === 'object'){
    //   obj = true
    // }
    if (!obj && list && list.indexOf && list.indexOf(option) >= 0) {
      // return true
    } else if (obj && list) {
      for (var i = 0; i < list.length; i++) {
        if (!optIn(option, list[i], obj, keys, keymatchtype)) {
          return false
        }
      }
    } else {
      return false
    }
  }
  return true
}
export const thingsIn = ({
  options,
  list = getsmart.bind(this)(stringList),
  obj,
  keys = ['uuid', '_id', 'id'],
  keymatchtype
} = {}) => {
  if (!(options instanceof Array)) return true
  for (let option of options) {
    // if(typeof option === 'object'){
    //   obj = true
    // }
    if (!obj && list && list.indexOf && list.indexOf(option) >= 0) {
      // return true
    } else if (obj && list && typeof list.length == 'number') {
      for (var i = 0; i < list.length; i++) {
        if (!optIn(option, list[i], obj, keys, keymatchtype)) {
          return false
        }
      }
    } else {
      return false
    }
  }
  return true
}
export const anyOptsIn = (
  options,
  list = getsmart.bind(this)(stringList),
  obj,
  keys = ['uuid', '_id', 'id'],
  keymatchtype
) => {
  if (!(options instanceof Array)) return false
  for (let option of options) {
    // if(typeof option === 'object'){
    //   obj = true
    // }
    if (!obj && list && list.indexOf && list.indexOf(option) >= 0) {
      return true
    } else if (obj && list && typeof list.length == 'number') {
      for (var i = 0; i < list.length; i++) {
        if (optIn(option, list[i], obj, keys, keymatchtype)) {
          return true
        }
      }
    }
  }
  return false
}
export const anyThingsIn = ({
  options,
  list = getsmart.bind(this)(stringList),
  obj,
  keys = ['uuid', '_id', 'id'],
  keymatchtype
} = {}) => {
  if (!(options instanceof Array)) return false
  for (let option of options) {
    // if(typeof option === 'object'){
    //   obj = true
    // }
    if (!obj && list && list.indexOf && list.indexOf(option) >= 0) {
      return true
    } else if (obj && list && typeof list.length == 'number') {
      for (var i = 0; i < list.length; i++) {
        if (optIn(option, list[i], obj, keys, keymatchtype)) {
          return true
        }
      }
    }
  }
  return false
}
export const optIndex = (
  option,
  list = getsmart.bind(this)(stringList),
  obj,
  keys = ['uuid', '_id', 'id'],
  keymatchtype
) => {
  if (typeof option === 'object') {
    obj = true
  }
  if (obj && list && keys && typeof list.length == 'number') {
    for (var i = 0; i < list.length; i++) {
      if (optIn(option, list, obj, keys, keymatchtype)) {
        return i
      }
    }
  } else if (list) {
    return list.indexOf(option)
  }
  return -1
}
export const thingIndex = ({
  option,
  list,
  obj,
  keys = ['uuid', '_id', 'id'],
  keymatchtype,
  strings
} = {}) => {
  if (typeof option === 'object') {
    obj = true
  }
  if (obj && list && keys) {
    let index = thingIn({
      option,
      list,
      obj,
      keys,
      keymatchtype,
      strings,
      retIndex: true
    })
    return index
  } else if (list) {
    return list.indexOf(option)
  }
  return -1
}
export const pushOpt = (
  option,
  list = getsmart.bind(this)(stringList),
  obj,
  keys = ['uuid', '_id', 'id'],
  keymatchtype,
  index
) => {
  if (
    typeof list == 'object' &&
    !optIn(option, list, obj, keys, keymatchtype)
  ) {
    if (
      getsmart.bind(this)(local.vue, 'reactiveSetter', false) ||
      getsmart.bind(this)(local.vue, 'store', false)
    ) {
      list.splice(list.length, 0, option)
      if (
        !localStorage.getItem('vuexWriteLock') &&
        typeof getsmart.bind(this)(window, '$store.commit', undefined) ==
          'function'
      ) {
        window.$store.commit(local.vue.basePath || 'graph/thing')
      }
    } else {
      list.push(option)
    }
  }
  return index
    ? optIn(option, list, obj, keys, keymatchtype, index)
    : optIn(option, list, obj, keys, keymatchtype, index)
}
export const addOpt = (
  option,
  list = getsmart.bind(this)(stringList),
  obj,
  keys = ['uuid', '_id', 'id'],
  keymatchtype,
  index
) => {
  if (typeof list == 'object') {
    if (
      getsmart.bind(this)(local.vue, 'reactiveSetter', false) ||
      getsmart.bind(this)(local.vue, 'store', false)
    ) {
      list.splice(list.length, 0, option)
      if (
        !localStorage.getItem('vuexWriteLock') &&
        typeof getsmart.bind(this)(window, '$store.commit', undefined) ==
          'function'
      ) {
        window.$store.commit(local.vue.basePath || 'graph/thing')
      }
    } else {
      list.push(option)
    }
  }
  return index
    ? optIn(option, list, obj, keys, keymatchtype, index)
    : optIn(option, list, obj, keys, keymatchtype, index)
}
export const pushThing = ({
  option,
  list = getsmart.bind(this)(stringList),
  obj,
  keys = ['uuid', '_id', 'id'],
  keymatchtype
} = {}) => {
  if (
    typeof list == 'object' &&
    !thingIn({ option, list, obj, keys, keymatchtype })
  ) {
    if (
      getsmart.bind(this)(local.vue, 'reactiveSetter', false) ||
      getsmart.bind(this)(local.vue, 'store', false)
    ) {
      list.splice(list.length, 0, option)
      if (
        !localStorage.getItem('vuexWriteLock') &&
        typeof getsmart.bind(this)(window, '$store.commit', undefined) ==
          'function'
      ) {
        window.$store.commit(local.vue.basePath || 'graph/thing')
      }
    } else {
      list.push(option)
    }
  }
}
export const pushOpts = (
  options,
  list = getsmart.bind(this)(stringList),
  obj,
  keys = ['uuid', '_id', 'id'],
  keymatchtype
) => {
  if (!(options instanceof Array)) return
  for (let option of options) {
    pushOpt(option, list, obj, keys, keymatchtype)
  }
}
export const pushThings = ({
  options,
  list = getsmart.bind(this)(stringList),
  obj,
  keys = ['uuid', '_id', 'id'],
  keymatchtype
} = {}) => {
  if (!(options instanceof Array)) return
  for (let option of options) {
    pushThing({ option, list, obj, keys, keymatchtype })
  }
}
export const popOpt = (
  option,
  list = getsmart.bind(this)(stringList),
  obj,
  keys = ['uuid', '_id', 'id'],
  keymatchtype
) => {
  if (typeof list == 'object' && optIn(option, list, obj, keys, keymatchtype)) {
    list.splice(optIndex(option, list, obj, keys, keymatchtype), 1)
    if (
      getsmart.bind(this)(local.vue, 'reactiveSetter', false) ||
      getsmart.bind(this)(local.vue, 'store', false)
    ) {
      if (
        !localStorage.getItem('vuexWriteLock') &&
        typeof getsmart.bind(this)(window, '$store.commit', undefined) ==
          'function'
      ) {
        window.$store.commit(local.vue.basePath || 'graph/thing')
      }
    }
  }
}
export const popThing = ({
  option,
  list = getsmart.bind(this)(stringList),
  obj = true,
  keys = ['uuid', '_id', 'id'],
  keymatchtype
} = {}) => {
  if (
    typeof list == 'object' &&
    thingIn({
      option,
      list,
      obj,
      keys,
      keymatchtype
    })
  ) {
    list.splice(
      thingIndex({
        option,
        list,
        obj,
        keys,
        keymatchtype
      }),
      1
    )
    if (
      getsmart.bind(this)(local.vue, 'reactiveSetter', false) ||
      getsmart.bind(this)(local.vue, 'store', false)
    ) {
      if (
        !localStorage.getItem('vuexWriteLock') &&
        typeof getsmart.bind(this)(window, '$store.commit', undefined) ==
          'function'
      ) {
        window.$store.commit(local.vue.basePath || 'graph/thing')
      }
    }
  }
}
export const popOpts = (
  options,
  list = getsmart.bind(this)(stringList),
  obj,
  keys = ['uuid', '_id', 'id'],
  keymatchtype
) => {
  if (!(options instanceof Array)) return
  for (let option of options) {
    popOpt(option, list, obj, keys, keymatchtype)
  }
}
export const popThings = ({
  options,
  list = getsmart.bind(this)(stringList),
  obj = true,
  keys = ['uuid', '_id', 'id'],
  keymatchtype
} = {}) => {
  if (!(options instanceof Array)) return
  for (let option of options) {
    popOpt(option, list, obj, keys, keymatchtype)
  }
}
export const toggleOpt = (
  option,
  list = getsmart.bind(this)(stringList),
  obj,
  keys = ['uuid', '_id', 'id'],
  keymatchtype
) => {
  if (optIn(option, list, obj, keys, keymatchtype)) {
    popOpt(option, list, obj, keys, keymatchtype)
  } else {
    pushOpt(option, list, obj, keys, keymatchtype)
  }
}
export const toggleThing = ({
  option,
  list = getsmart.bind(this)(stringList),
  obj = true,
  keys = ['uuid', '_id', 'id'],
  keymatchtype
} = {}) => {
  if (optIn(option, list, obj, keys, keymatchtype)) {
    popOpt(option, list, obj, keys, keymatchtype)
  } else {
    pushOpt(option, list, obj, keys, keymatchtype)
  }
}
export const toggleOpts = (
  options,
  list = getsmart.bind(this)(stringList),
  obj,
  keys = ['uuid', '_id', 'id'],
  keymatchtype
) => {
  if (!(options instanceof Array)) return
  for (let option in options) {
    toggleOpt(option, list, obj, keys, keymatchtype)
  }
}
export const toggleThings = ({
  options,
  list = getsmart.bind(this)(stringList),
  obj = true,
  keys = ['uuid', '_id', 'id'],
  keymatchtype
} = {}) => {
  if (!(options instanceof Array)) return
  for (let option in options) {
    if (optIn(option, list, obj, keys, keymatchtype)) {
      popOpt(option, list, obj, keys, keymatchtype)
    } else {
      pushOpt(option, list, obj, keys, keymatchtype)
    }
  }
}
// no use right now
// export const ratchetOpt = (
//   option,
//   list,
//   obj,
//   keys = ['uuid', '_id', 'id'],
//   keymatchtype
// ) => {
//   // find(obj, property, equals){
//   // 	if(getsmart.bind(this)(obj, 'constructor', undefined) == Array){
//   // 		for(var i=0; i<obj.length; i++){
//   // 			find(obj[i], )
//   // 		}
//   // 	}
//   // },
// }
export const getsmart = (
  obj,
  property,
  defaultValue?: any,
  context?: any,
  schema?: any
) => {
  if (!property && obj && typeof obj == 'string') {
    property = obj.split('.')
    try {
      obj = eval(property[0])
    } catch (err) {
      // console.error(err)

      obj = property[0]
    }
    property = property.slice(1, property.length)
  }
  if (!property) {
    if (context) {
      return {
        value: defaultValue,
        undefined: true
      }
    } else {
      return defaultValue
    }
  }
  // If the property list is in dot notation, convert to array
  if (typeof property == 'string') {
    property = parsePropertyPath(property)
  } else if (getsmart.bind(this)(property, 'constructor', false) !== Array) {
    if (context) {
      return {
        value: defaultValue,
        undefined: true,
        err: 'properties path @property argument was not passed properly'
      }
    } else {
      return defaultValue
    }
  }

  let deepGetByArray = deepGetByArrayUnbound.bind(this)

  return deepGetByArray(obj, property, defaultValue)

  // In order to avoid constantly checking the type of the property
  // we separate the real logic out into an inner function.
  function deepGetByArrayUnbound (obj, propsArray, defaultValue) {
    // This case getting to the last property but it not being ultimately defined
    // Not just having a value of undefined
    if (
      propsArray.length > 0 &&
      context &&
      typeof obj == 'object' &&
      obj !== null &&
      !(ee(propsArray[0]) in obj)
    ) {
      return {
        value: defaultValue,
        undefined: true
      }
    }

    // If we have reached an undefined/null property
    // then stop executing and return the default value.
    // If no default was provided it will be undefined.
    if (
      typeof obj == 'undefined' ||
      obj == null ||
      (schema && obj.constructor.name !== schema)
    ) {
      if (context) {
        let undef = true
        if (propsArray.length === 0) {
          undef = false
        }
        return {
          value: defaultValue,
          undefined: undef,
          schema: schema && obj.constructor.name === schema
        }
      } else {
        return defaultValue
      }
    } // If the path array has no more elements, we've reached
    // the intended property and return its value

    if (propsArray.length === 0) {
      if (context) {
        return {
          value: obj,
          undefined: false
        }
      } else {
        return obj
      }
    } // Prepare our found property and path array for recursion

    var nextObj = obj[ee(propsArray[0])]
    var remainingProps = propsArray.slice(1)
    return deepGetByArray(nextObj, remainingProps, defaultValue)
  }
}
export const escapePropertyPath = (path = '') => {
  let newPath = escapeEscapes(path)
  return '["' + newPath + '"]'
}
export const epp = (path = '') => {
  return escapePropertyPath(path)
}
export const escapeEscapes = (path = '') => {
  let newPath = ''
  for (let i in path) {
    i = +i
    let char = path[i]
    if (i > 0 && i < path.length - 1) {
      let prevChar = path[i - 1]
      let nextChar = path[i + 1]
      let openingArrayPath = char === '"' && prevChar === '['
      // && (nextChar !== "\\" || i === path.length-1)
      let closingArrayPath =
        char === '"' && nextChar === ']' && prevChar !== '\\'
      // let offset = 0
      // if(openingArrayPath) offset = 1
      if (openingArrayPath || closingArrayPath) {
        newPath += '\\'
        // path = path.slice(0,i+offset)+"\\"+path.slice(i+offset,path.length)
      }
    }
    newPath += char
  }
  return newPath
}
export const ee = (path = '') => {
  return escapeEscapes(path)
}
// TODO
// Make parsing use \" or \'
// Currently only uses \"
export const parsePropertyPath = (path = '') => {
  let array = []

  let readingArrayBasedPath = false
  let i = 0
  let push = false
  let pushed = false
  while (i < path.length) {
    let arrayPathStart = path[i] == '[' && path[i + 1] == '"'
    let escapedStart = !(path[i + 1] !== '\\' || i === 0)

    if (readingArrayBasedPath) {
      // we found the end of an array delimited path
      let arrayPathEnd = path[i] == '"' && path[i + 1] == ']'
      let escapedEnd = !(path[i - 1] !== '\\' || i == 0)
      if (arrayPathEnd && !escapedEnd) {
        i += 1
        readingArrayBasedPath = false
        if (!pushed) push = true
      } else {
        // if the path includes an "escaped" array based path begin or end value
        // do not push the escape character
        if (
          (path[i] == '\\' && path[i + 1] == '"' && path[i + 2] == ']') ||
          (path[i - 1] == '[' && path[i] == '\\' && path[i + 1] == '"')
        ) {
          // nothing
        } else {
          array[array.length - 1] += path[i]
        }
      }
    } else if (path[i] == '.') {
      if (!pushed) push = true
    }
    // we found the start of an array delimited path
    else if (arrayPathStart && !escapedStart) {
      readingArrayBasedPath = true
      if (!pushed) push = true
      i += 1
    } else {
      if (i == 0) array.push('')
      array[array.length - 1] += path[i]
    }

    i++
    if (push && i < path.length) {
      pushed = true
      array.push('')
      push = false
    } else {
      pushed = false
    }
  }

  return array
}
export const ppp = (path = '') => {
  return this.parsePropertyPath(path)
}
export const parsePropertyArray = pathArray => {
  let path = ''

  if (pathArray instanceof Array) {
    pathArray.forEach(subPath => {
      path += epp(subPath)
    })
  } else if (typeof pathArray === 'string') {
    return path
  }

  return path
}
export const ppa = pathArray => {
  return this.parsePropertyArray(pathArray)
}
export const pathToArray = path => {
  if (typeof path == 'string') {
    return parsePropertyPath(path)
  } else {
    return path
  }
}
export const pathToString = path => {
  if (typeof path == 'string') {
    let ret = parsePropertyPath(path)
    ret = parsePropertyArray(ret)
    return ret
  } else {
    let ret = parsePropertyArray(path)
    return ret
  }
}
export const setsmart = (obj, property, value, context?: any) => {
  if (!property && typeof obj == 'string') {
    property = obj.split('.')
    try {
      obj = eval(property[0])
    } catch (err) {
      obj = property[0]
    }
    property = property.slice(1, property.length)
  }
  // If the property list is in dot notation, convert to array
  if (typeof property == 'string') {
    property = parsePropertyPath(property)
  } else if (getsmart.bind(this)(property, 'constructor', false) !== Array) {
    if (context) {
      return {
        value: value,
        undefined: true,
        err: 'properties path @property argument was not passed properly'
      }
    } else {
      return value
    }
  }

  // if no obj make obj
  if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) obj = {}

  let deepSetByArray = deepSetByArrayUnbound.bind(this)

  if (property) {
    return deepSetByArray(obj, property, value)
  } else {
    if (
      getsmart.bind(this)(local.vue, 'reactiveSetter', false) &&
      getsmart.bind(this)(
        this,
        '$set',
        getsmart.bind(this)(local.vue, 'Vue.set', false)
      ) &&
      obj
    ) {
      const setToUse = this.$set || local.vue.Vue.set
      setToUse(obj, undefined, value)
      if (
        typeof getsmart.bind(this)(window, '$store.commit', undefined) ==
        'function'
      ) {
        window.$store.commit(local.vue.basePath || 'graph/thing')
      }
    } else {
      obj = value
      if (
        getsmart.bind(this)(local.vue, 'store', false) &&
        typeof getsmart.bind(this)(window, '$store.commit', undefined) ==
          'function'
      ) {
        window.$store.commit(local.vue.basePath || 'graph/thing')
      }
    }
    if (context) {
      return {
        value: obj,
        undefined: false,
        err: 'there were no properties passed'
      }
    } else {
      return obj
    }
  }

  // In order to avoid constantly checking the type of the property
  // we separate the real logic out into an inner function.
  function deepSetByArrayUnbound (obj, propsArray, value) {
    // If the path array has only 1 more element, we've reached
    // the intended property and set its value
    if (propsArray.length == 1) {
      if (
        getsmart.bind(this)(local.vue, 'reactiveSetter', false) &&
        getsmart.bind(this)(
          this,
          '$set',
          getsmart.bind(this)(local.vue, 'Vue.set', false)
        ) &&
        obj
      ) {
        const setToUse = this.$set || local.vue.Vue.set
        setToUse(obj, ee(propsArray[0]), value)
        if (
          typeof getsmart.bind(this)(window, '$store.commit', undefined) ==
          'function'
        ) {
          window.$store.commit(local.vue.basePath || 'graph/thing')
        }
      } else {
        // TODO: make parent object new object so that react can see the change
        obj[ee(propsArray[0])] = value
        if (
          getsmart.bind(this)(local.vue, 'store', false) &&
          typeof getsmart.bind(this)(window, '$store.commit', undefined) ==
            'function'
        ) {
          window.$store.commit(local.vue.basePath || 'graph/thing')
        }
      }
      if (context) {
        return {
          value: obj[ee(propsArray[0])],
          undefined: false
        }
      } else {
        return obj[ee(propsArray[0])]
      }
    }
    // Prepare our path array for recursion
    var remainingProps = propsArray.slice(1)
    // check if next prop is object
    if (typeof obj[ee(propsArray[0])] !== 'object') {
      // If we have reached an undefined/null property
      if (
        getsmart.bind(this)(local.vue, 'reactiveSetter', false) &&
        getsmart.bind(this)(
          this,
          '$set',
          getsmart.bind(this)(local.vue, 'Vue.set', false)
        ) &&
        obj
      ) {
        const setToUse = this.$set || local.vue.Vue.set
        setToUse(obj, ee(propsArray[0]), {})
        if (
          typeof getsmart.bind(this)(window, '$store.commit', undefined) ==
          'function'
        ) {
          window.$store.commit(local.vue.basePath || 'graph/thing')
        }
      } else {
        obj[ee(propsArray[0])] = {}
        if (
          getsmart.bind(this)(local.vue, 'store', false) &&
          typeof getsmart.bind(this)(window, '$store.commit', undefined) ==
            'function'
        ) {
          window.$store.commit(local.vue.basePath || 'graph/thing')
        }
      }
    }
    return deepSetByArray(obj[ee(propsArray[0])], remainingProps, value)
  }
}
export const deletesmart = (obj, property) => {
  if (!property && typeof obj == 'string') {
    property = obj.split('.')
    try {
      obj = eval(property[0])
    } catch (err) {
      // console.error(err)
      obj = property[0]
    }
    property = property.slice(1, property.length)
  }
  // If the property list is in dot notation, convert to array
  if (typeof property == 'string') {
    property = parsePropertyPath(property)
  }
  let parentPathArray = property.slice(0, property.length - 1)
  let path = property[property.length - 1]
  let parentObj = getsmart(obj, parentPathArray, {})

  if (
    getsmart.bind(this)(local.vue, 'reactiveSetter', false) &&
    getsmart.bind(this)(
      this,
      '$set',
      getsmart.bind(this)(local.vue, 'Vue.set', false)
    ) &&
    obj
  ) {
    this.$delete(parentObj, path)
  } else {
    delete parentObj[path]
  }
}
export const pushSmart = (array, value) => {
  if (
    getsmart.bind(this)(local.vue, 'reactiveSetter', false) &&
    getsmart.bind(this)(
      this,
      '$set',
      getsmart.bind(this)(local.vue, 'Vue.set', false)
    ) &&
    array
  ) {
    array.push(value)
    if (
      typeof getsmart.bind(this)(window, '$store.commit', undefined) ==
      'function'
    ) {
      window.$store.commit(local.vue.basePath || 'graph/thing')
    }
  } else {
    array.push(value)
  }
}
export const gosmart = (obj, property, value, context, schema) => {
  // stands for get or set smart
  var get = getsmart.bind(this)(
    obj,
    property,
    value,
    true,
    schema ? absoluteType.bind(this)(value) : false
  )
  if (get.undefined || (schema && get.schema === false)) {
    get = setsmart.bind(this)(obj, property, get.value, context)
    if (context) {
      return get
    } else {
      return get
    }
  } else {
    return get.value
  }
}
export const gosmarter = (obj, property, value, context, schema = true) => {
  return gosmart.bind(this)(obj, property, value, context, schema)
}
export const absoluteType = value => {
  let type
  try {
    type = value.constructor.name
  } catch (e) {
    if (typeof value === 'undefined') type = 'undefined'
    if (value === null) type = 'null'
  }
  return type
}
export const vgosmart = (obj, property, value, context) => {
  // stands for v-model get or set smart
  // return value from property path, either gotten or smartly set
  return {
    get: () => {
      var get = getsmart.bind(this)(obj, property, value, true)
      if (get.undefined) {
        get = setsmart.bind(this)(obj, property, get.value, context)
      }
      if (context) {
        return get
      } else {
        return getsmart.bind(this)(get, 'value', get)
      }
    },
    set: val => {
      setsmart.bind(this)(obj, property, val)
    }
  }
}
export const getsmartval = (obj, property, defaultValue) => {
  // get the value of a property path based off its type
  let target = getsmart.bind(this)(obj, property, defaultValue)
  if (target && target.type) {
    if (target[target.type]) {
      return target[target.type]
    } else {
      return defaultValue
    }
  } else if (target) {
    return target
  }
  return defaultValue
}
export const safestring = something => {
  return smarts.stringify(something || '')
}
export const safeparse = something => {
  return smarts.parse(something || '')
}
export const flatten = (arrays, func = i => i) => {
  const flat = []

  arrays.forEach(array => {
    if (Array.isArray(array)) {
      flat.push(...flatten(array))
    } else {
      flat.push(func(array))
    }
  })

  return flat
}
export const mapsmart = (list, keyProperty = 'title', returnExistant) => {
  return new Promise((resolve, reject) => {
    if (!keyProperty) {
      reject()
    } else if (list && typeof list.length == 'number') {
      if (list.length == 0) {
        if (
          (returnExistant &&
            getsmart.bind(this)(list, 'mapped.' + returnExistant, false)) ||
          !returnExistant
        ) {
          resolve(true)
        } else if (returnExistant) {
          resolve(false)
        } else {
          resolve()
        }
      }
      if (!list.mapped || typeof list.mapped === 'boolean') {
        if (
          getsmart.bind(this)(local.vue, 'reactiveSetter', false) &&
          getsmart.bind(this)(
            this,
            '$set',
            getsmart.bind(this)(local.vue, 'Vue.set', false)
          ) &&
          list
        ) {
          const setToUse = this.$set || local.vue.Vue.set
          setToUse(list, 'mapped', {})
        } else {
          list['mapped'] = {}
        }
      }
      for (var i = 0; i < list.length; i++) {
        if (typeof list[i] !== 'string') {
          if (
            getsmart.bind(this)(local.vue, 'reactiveSetter', false) &&
            getsmart.bind(this)(
              this,
              '$set',
              getsmart.bind(this)(local.vue, 'Vue.set', false)
            ) &&
            list.mapped
          ) {
            const setToUse = this.$set || local.vue.Vue.set
            setToUse(list.mapped, list[i][keyProperty], list[i])
          } else {
            list['mapped'][list[i][keyProperty]] = list[i]
          }
          if (i == list.length - 1) {
            if (
              (returnExistant &&
                getsmart.bind(this)(list, 'mapped.' + returnExistant, false)) ||
              !returnExistant
            ) {
              resolve(true)
            } else if (returnExistant) {
              resolve(false)
            } else {
              resolve()
            }
          }
        }
        // else if(populate){
        //   var funCounter = this.funCounter
        //   this.funCounter = this.funCounter + 1
        //   getThing({
        //     thing: list[i],
        //     clientId: this._uid,
        //     funCounter
        //   })
        //   this.$options.sockets['giveThing'] = data => {
        //     if(this._uid == data.clientId && data.funCounter == funCounter){
        //       (this.$set || local.vue.Vue.set)(list, i.toString(), data.thing)
        //       (this.$set || local.vue.Vue.set)(list.mapped, list[i][keyProperty], list[i])
        //     }
        //     if(i==list.length-1){
        //       if((returnExistant && getsmart.bind(this)(list, 'mapped.'+returnExistant, false)) || !returnExistant){
        //         resolve(true)
        //       } else if(returnExistant) {
        //         resolve(false)
        //       } else {
        //         resolve()
        //       }
        //     }
        //   }
        // }
        else if (i == list.length - 1) {
          if (
            (returnExistant &&
              getsmart.bind(this)(list, 'mapped.' + returnExistant, false)) ||
            !returnExistant
          ) {
            resolve(true)
          } else if (returnExistant) {
            resolve(false)
          } else {
            resolve()
          }
        }
      }
      // if(list.mapped && !list.mapped['agora-client-mapped']){
      //   (this.$set || local.vue.Vue.set)(list.mapped, 'agora-client-mapped', true)
      // }
    }
  })
}
export const domval = thing => {
  return getsmart.bind(this)(thing, 'properties.description', '')
}
export const getParent = (levels = Infinity) => {
  if (typeof levels == 'string') levels = (levels.match(/\.\./g) || []).length

  if (levels >= this.pathAsArray.length - 1) {
    return this.pathAsArray[0]
  }

  let level = this.pathAsArray.length - 1 - levels

  return this.pathAsArray[level]
}
export const getThing = (props = {}) => {
  const { list = getsmart.bind(this)(objList), defaultValue = undefined } =
    props

  var index = thingIn({
    ...props,
    retIndex: true
  })
  if (index >= 0) {
    return list[index]
  } else {
    return defaultValue
  }
}
export const equal = (obj1, obj2, seen = []) => {
  if (obj1 && obj2 && typeof obj1 == 'object' && typeof obj2 == 'object') {
    seen.push(obj1, obj2)
    //Loop through properties in object 1
    for (const p in obj1) {
      //Check property exists on both objects
      if (
        typeof obj1.hasOwnProperty == 'function' &&
        typeof obj2.hasOwnProperty == 'function' &&
        Object.prototype.hasOwnProperty.call(obj1, p) !==
          Object.prototype.hasOwnProperty.call(obj2, p)
      )
        return false

      switch (typeof obj1[p]) {
        //Deep compare objects
        case 'object':
          if (seen.indexOf(obj1[p]) < 0 && !equal(obj1[p], obj2[p], seen))
            return false
          break
        //Compare function code
        case 'function':
          if (
            typeof obj2[p] == 'undefined' ||
            obj1[p].toString() != obj2[p].toString()
          )
            return false
          break
        //Compare values
        default:
          if (obj1[p] != obj2[p]) return false
      }
    }

    //Check object 2 for any extra properties
    for (const p in obj2) {
      if (!(p in obj1)) return false
    }
    return true
  }
}
export const mergeall = (array, options) => {
  if (!Array.isArray(array)) {
    throw new Error('first argument should be an array')
  }

  return array.reduce(function (prev, next) {
    return merge(prev, next, options)
  }, {})
}

// export const smarts with all other exports
export const smarts = {
  local,
  t,
  getBabel,
  uuid,
  pause,
  save,
  toJavascript,
  toJavascriptAux,
  createObjectProperties,
  serialize,
  stringify,
  replacer,
  setKnown,
  stringifier,
  primitives,
  Primitives,
  play,
  load,
  parse,
  parser,
  revive,
  createScopedEval,
  defineVariable,
  scopedEval,
  jsUUID,
  context,
  contextObject,
  createContext,
  createInlineContext,
  addBindingsToContext,
  scopeVarCode,
  scopeVarInlineCode,
  scopeVar,
  functionWrapper,
  bodyInsert,
  initBlock,
  getNodeUUID,
  getPathUUID,
  babelPlugin,
  transform,
  stripUuids,
  dupe,
  clone,
  schema,
  create,
  merge,
  basic,
  mod,
  deepForEach,
  forEachObject,
  forEachArray,
  setThing,
  setThings,
  optIn,
  thingIn,
  optsIn,
  thingsIn,
  anyOptsIn,
  anyThingsIn,
  optIndex,
  thingIndex,
  pushOpt,
  addOpt,
  pushThing,
  pushOpts,
  pushThings,
  popOpt,
  popThing,
  popOpts,
  popThings,
  toggleOpt,
  toggleThing,
  toggleOpts,
  toggleThings,
  // ratchetOpt,
  getsmart,
  escapePropertyPath,
  epp,
  escapeEscapes,
  ee,
  parsePropertyPath,
  ppp,
  parsePropertyArray,
  ppa,
  pathToArray,
  pathToString,
  setsmart,
  deletesmart,
  pushSmart,
  gosmart,
  gosmarter,
  absoluteType,
  vgosmart,
  getsmartval,
  safestring,
  safeparse,
  flatten,
  mapsmart,
  domval,
  getParent,
  getThing,
  equal,
  mergeall
}
