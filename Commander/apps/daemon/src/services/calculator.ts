import type { CalculationResult, CalculatorSettings, SearchHit } from '@commander/protocol';

export const CALCULATOR_RESULT_ITEM_ID = 'builtin:calculator:result';

const MAX_EXPRESSION_LENGTH = 256;
const MAX_TOKENS = 128;
const MAX_NESTING = 32;
const MAX_FUNCTION_ARGUMENTS = 16;

type Operator = '+' | '-' | '*' | '/' | '%' | '^' | '!';

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'identifier'; value: string }
  | { kind: 'operator'; value: Operator }
  | { kind: 'left-parenthesis' }
  | { kind: 'right-parenthesis' }
  | { kind: 'comma' }
  | { kind: 'end' };

interface EvaluatedNode {
  value: number;
  label: string;
  percent?: boolean;
}

interface PreparedExpression {
  display: string;
  source: string;
  forced: boolean;
}

export function evaluateExpression(input: string, settings: CalculatorSettings): CalculationResult | null {
  if (!settings.enabled) return null;
  const prepared = prepareExpression(input);
  if (!prepared) return null;
  const tokens = tokenize(prepared.source);
  if (!tokens) return null;
  const parser = new ExpressionParser(tokens, prepared.forced || /\d[eE][+-]?\d/.test(prepared.source));
  const evaluated = parser.parse();
  if (!evaluated || !Number.isFinite(evaluated.value)) return null;
  const result = formatNumber(evaluated.value, settings.maxDecimalPlaces);
  if (!result) return null;
  const resultWords = integerWords(result);
  return {
    expression: prepared.display,
    result,
    label: evaluated.label,
    ...(resultWords ? { resultWords } : {}),
  };
}

export function calculatorSearchHit(query: string, settings: CalculatorSettings): SearchHit | undefined {
  const calculation = evaluateExpression(query, settings);
  if (!calculation) return undefined;
  return {
    id: CALCULATOR_RESULT_ITEM_ID,
    title: calculation.result,
    subtitle: calculation.expression,
    kind: 'calculator',
    keywords: [],
    icon: 'calculator',
    favourite: false,
    calculation,
    actions: [
      { id: 'copy-result', title: 'Copy Answer', shortcut: '↵' },
      { id: 'copy-expression', title: 'Copy Expression', shortcut: '⇧⌘C' },
    ],
    score: 1_000_000,
    matchedRanges: [],
  };
}

function prepareExpression(input: string): PreparedExpression | null {
  if (typeof input !== 'string' || input.length > MAX_EXPRESSION_LENGTH) return null;
  let display = input.trim();
  if (!display) return null;
  let forced = false;
  if (display.startsWith('=')) {
    forced = true;
    display = display.slice(1).trim();
  }
  if (display.endsWith('=')) {
    forced = true;
    display = display.slice(0, -1).trim();
  }
  if (
    !display ||
    /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(display) ||
    /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(display)
  )
    return null;

  let source = display
    .replace(/[−–—]/g, '-')
    .replace(/[×∙·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/([0-9)])\s*[xX]\s*(?=[0-9(])/g, '$1*');
  source = removeThousandsSeparators(source);
  return { display, source, forced };
}

function removeThousandsSeparators(value: string): string {
  let previous = '';
  let next = value;
  while (previous !== next) {
    previous = next;
    next = next.replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1');
  }
  return next;
}

function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  const push = (token: Token): boolean => {
    tokens.push(token);
    return tokens.length <= MAX_TOKENS;
  };

  while (index < source.length) {
    const character = source[index]!;
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (/\d|\./.test(character)) {
      const start = index;
      let sawDigit = false;
      while (index < source.length && /\d/.test(source[index]!)) {
        sawDigit = true;
        index += 1;
      }
      if (source[index] === '.') {
        index += 1;
        while (index < source.length && /\d/.test(source[index]!)) {
          sawDigit = true;
          index += 1;
        }
      }
      if (!sawDigit) return null;
      if (source[index] === 'e' || source[index] === 'E') {
        index += 1;
        if (source[index] === '+' || source[index] === '-') index += 1;
        const exponentStart = index;
        while (index < source.length && /\d/.test(source[index]!)) index += 1;
        if (index === exponentStart) return null;
      }
      const value = Number(source.slice(start, index));
      if (!Number.isFinite(value) || !push({ kind: 'number', value })) return null;
      continue;
    }
    if (/[A-Za-z_]/.test(character) || character === 'π') {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_]/.test(source[index]!)) index += 1;
      const value = source.slice(start, index).toLowerCase();
      if (!push({ kind: 'identifier', value })) return null;
      continue;
    }
    if (character === '(') {
      if (!push({ kind: 'left-parenthesis' })) return null;
      index += 1;
      continue;
    }
    if (character === ')') {
      if (!push({ kind: 'right-parenthesis' })) return null;
      index += 1;
      continue;
    }
    if (character === ',') {
      if (!push({ kind: 'comma' })) return null;
      index += 1;
      continue;
    }
    if ('+-*/%^!'.includes(character)) {
      const value: Operator = character === '*' && source[index + 1] === '*' ? '^' : (character as Operator);
      if (!push({ kind: 'operator', value })) return null;
      index += value === '^' && character === '*' ? 2 : 1;
      continue;
    }
    return null;
  }
  tokens.push({ kind: 'end' });
  return tokens;
}

class ExpressionParser {
  #index = 0;
  #usedMathSyntax: boolean;

  constructor(
    private readonly tokens: Token[],
    forced: boolean,
  ) {
    this.#usedMathSyntax = forced;
  }

  parse(): EvaluatedNode | null {
    try {
      const result = this.parseExpression(0, 0);
      if (this.current().kind !== 'end' || !this.#usedMathSyntax) return null;
      return finiteNode(result);
    } catch {
      return null;
    }
  }

  private parseExpression(minimumBindingPower: number, nesting: number): EvaluatedNode {
    if (nesting > MAX_NESTING) throw new Error('Expression nesting is too deep');
    let left = this.parsePrefix(nesting);

    while (true) {
      const token = this.current();
      if (token.kind === 'operator' && token.value === '!') {
        if (40 < minimumBindingPower) break;
        this.advance();
        this.#usedMathSyntax = true;
        left = factorial(left);
        continue;
      }
      if (
        token.kind === 'operator' &&
        token.value === '%' &&
        !canStartPrimary(this.tokens[this.#index + 1])
      ) {
        if (40 < minimumBindingPower) break;
        this.advance();
        this.#usedMathSyntax = true;
        left = finiteNode({ value: left.value / 100, label: 'Percentage', percent: true });
        continue;
      }

      const implicitMultiplication = canStartImplicitMultiplication(token);
      const operator = implicitMultiplication
        ? '*'
        : token.kind === 'operator' && token.value !== '!'
          ? token.value
          : undefined;
      if (!operator) break;
      const [leftBindingPower, rightBindingPower] = bindingPower(operator);
      if (leftBindingPower < minimumBindingPower) break;
      if (!implicitMultiplication) this.advance();
      this.#usedMathSyntax = true;
      const right = this.parseExpression(rightBindingPower, nesting);
      left = applyOperator(operator, left, right);
    }
    return left;
  }

  private parsePrefix(nesting: number): EvaluatedNode {
    const token = this.current();
    if (token.kind === 'number') {
      this.advance();
      return { value: token.value, label: 'Number' };
    }
    if (token.kind === 'operator' && (token.value === '+' || token.value === '-')) {
      this.advance();
      this.#usedMathSyntax = true;
      const operand = this.parseExpression(25, nesting);
      return finiteNode({
        value: token.value === '-' ? -operand.value : operand.value,
        label: token.value === '-' ? 'Negation' : operand.label,
        ...(operand.percent ? { percent: true } : {}),
      });
    }
    if (token.kind === 'left-parenthesis') {
      this.advance();
      const value = this.parseExpression(0, nesting + 1);
      this.expect('right-parenthesis');
      return value;
    }
    if (token.kind === 'identifier') {
      this.advance();
      if (this.current().kind === 'left-parenthesis') return this.parseFunction(token.value, nesting + 1);
      const constant = constantValue(token.value);
      if (constant === undefined) throw new Error('Unknown identifier');
      return { value: constant, label: token.value === 'π' || token.value === 'pi' ? 'Pi' : 'Constant' };
    }
    throw new Error('Expected a number, function, or parenthesis');
  }

  private parseFunction(name: string, nesting: number): EvaluatedNode {
    if (nesting > MAX_NESTING) throw new Error('Expression nesting is too deep');
    this.#usedMathSyntax = true;
    this.expect('left-parenthesis');
    const values: number[] = [];
    if (this.current().kind !== 'right-parenthesis') {
      while (true) {
        if (values.length === MAX_FUNCTION_ARGUMENTS) throw new Error('Too many function arguments');
        values.push(this.parseExpression(0, nesting).value);
        if (this.current().kind !== 'comma') break;
        this.advance();
      }
    }
    this.expect('right-parenthesis');
    return applyFunction(name, values);
  }

  private expect(kind: Token['kind']): void {
    if (this.current().kind !== kind) throw new Error(`Expected ${kind}`);
    this.advance();
  }

  private current(): Token {
    return this.tokens[this.#index] ?? { kind: 'end' };
  }

  private advance(): void {
    this.#index += 1;
  }
}

function canStartPrimary(token: Token | undefined): boolean {
  return token?.kind === 'number' || token?.kind === 'identifier' || token?.kind === 'left-parenthesis';
}

function canStartImplicitMultiplication(token: Token): boolean {
  return token.kind === 'identifier' || token.kind === 'left-parenthesis';
}

function bindingPower(operator: Exclude<Operator, '!'>): [number, number] {
  if (operator === '+' || operator === '-') return [10, 11];
  if (operator === '*' || operator === '/' || operator === '%') return [20, 21];
  return [30, 30];
}

function applyOperator(operator: Exclude<Operator, '!'>, left: EvaluatedNode, right: EvaluatedNode) {
  const percentageRight = right.percent ? left.value * right.value : right.value;
  if (operator === '+') return finiteNode({ value: left.value + percentageRight, label: 'Sum' });
  if (operator === '-') return finiteNode({ value: left.value - percentageRight, label: 'Difference' });
  if (operator === '*') return finiteNode({ value: left.value * right.value, label: 'Product' });
  if (operator === '/') return finiteNode({ value: left.value / right.value, label: 'Quotient' });
  if (operator === '%') return finiteNode({ value: left.value % right.value, label: 'Remainder' });
  return finiteNode({ value: left.value ** right.value, label: 'Power' });
}

function factorial(node: EvaluatedNode): EvaluatedNode {
  if (!Number.isInteger(node.value) || node.value < 0 || node.value > 170)
    throw new Error('Factorial input is out of range');
  let value = 1;
  for (let number = 2; number <= node.value; number += 1) value *= number;
  return finiteNode({ value, label: 'Factorial' });
}

function constantValue(name: string): number | undefined {
  if (name === 'pi' || name === 'π') return Math.PI;
  if (name === 'tau') return Math.PI * 2;
  if (name === 'e') return Math.E;
  return undefined;
}

function applyFunction(name: string, values: number[]): EvaluatedNode {
  const one = () => {
    if (values.length !== 1) throw new Error(`${name} expects one argument`);
    return values[0]!;
  };
  const two = () => {
    if (values.length !== 2) throw new Error(`${name} expects two arguments`);
    return [values[0]!, values[1]!] as const;
  };
  if (name === 'sqrt') return finiteNode({ value: Math.sqrt(one()), label: 'Square Root' });
  if (name === 'abs') return finiteNode({ value: Math.abs(one()), label: 'Absolute Value' });
  if (name === 'floor') return finiteNode({ value: Math.floor(one()), label: 'Floor' });
  if (name === 'ceil') return finiteNode({ value: Math.ceil(one()), label: 'Ceiling' });
  if (name === 'sin') return finiteNode({ value: Math.sin(one()), label: 'Sine' });
  if (name === 'cos') return finiteNode({ value: Math.cos(one()), label: 'Cosine' });
  if (name === 'tan') return finiteNode({ value: Math.tan(one()), label: 'Tangent' });
  if (name === 'ln') return finiteNode({ value: Math.log(one()), label: 'Natural Logarithm' });
  if (name === 'log') {
    if (values.length === 1) return finiteNode({ value: Math.log10(values[0]!), label: 'Logarithm' });
    const [value, base] = two();
    return finiteNode({ value: Math.log(value) / Math.log(base), label: 'Logarithm' });
  }
  if (name === 'exp') return finiteNode({ value: Math.exp(one()), label: 'Exponential' });
  if (name === 'pow') {
    const [base, exponent] = two();
    return finiteNode({ value: base ** exponent, label: 'Power' });
  }
  if (name === 'round') {
    if (values.length === 1) return finiteNode({ value: Math.round(values[0]!), label: 'Rounded' });
    const [value, rawPlaces] = two();
    const places = Math.min(14, Math.max(0, Math.trunc(rawPlaces)));
    const scale = 10 ** places;
    return finiteNode({ value: Math.round((value + Number.EPSILON) * scale) / scale, label: 'Rounded' });
  }
  if (name === 'min' || name === 'max') {
    if (!values.length) throw new Error(`${name} expects at least one argument`);
    return finiteNode({
      value: name === 'min' ? Math.min(...values) : Math.max(...values),
      label: name === 'min' ? 'Minimum' : 'Maximum',
    });
  }
  throw new Error('Unknown function');
}

function finiteNode<T extends EvaluatedNode>(node: T): T {
  if (!Number.isFinite(node.value)) throw new Error('Calculation is not finite');
  return node;
}

function formatNumber(value: number, maximumDecimalPlaces: number): string | null {
  if (!Number.isFinite(value)) return null;
  const normalized = Object.is(value, -0) ? 0 : value;
  const precision = Math.min(14, Math.max(0, Math.trunc(maximumDecimalPlaces)));
  const magnitude = Math.abs(normalized);
  if (magnitude >= 1e15 || (magnitude > 0 && magnitude < 1e-9)) {
    return normalized
      .toExponential(Math.max(0, Math.min(precision, 12)))
      .replace(/\.0+(?=e)/, '')
      .replace(/(\.\d*?[1-9])0+(?=e)/, '$1')
      .replace(/e\+/, 'e');
  }
  const fixed = normalized.toFixed(precision);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

function integerWords(value: string): string | undefined {
  if (!/^-?\d+$/.test(value)) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || Math.abs(number) > 999_999_999_999_999) return undefined;
  if (number === 0) return 'Zero';
  const groups = ['', 'Thousand', 'Million', 'Billion', 'Trillion'] as const;
  const words: string[] = [];
  let remaining = Math.abs(number);
  let group = 0;
  while (remaining > 0) {
    const chunk = remaining % 1_000;
    if (chunk) {
      const chunkWords = wordsBelowThousand(chunk);
      words.unshift(groups[group] ? `${chunkWords} ${groups[group]}` : chunkWords);
    }
    remaining = Math.floor(remaining / 1_000);
    group += 1;
  }
  return `${number < 0 ? 'Negative ' : ''}${words.join(' ')}`;
}

function wordsBelowThousand(value: number): string {
  const small = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ] as const;
  const tens = [
    '',
    '',
    'Twenty',
    'Thirty',
    'Forty',
    'Fifty',
    'Sixty',
    'Seventy',
    'Eighty',
    'Ninety',
  ] as const;
  const words: string[] = [];
  let remaining = value;
  if (remaining >= 100) {
    words.push(`${small[Math.floor(remaining / 100)]} Hundred`);
    remaining %= 100;
  }
  if (remaining >= 20) {
    words.push(tens[Math.floor(remaining / 10)]!);
    remaining %= 10;
  }
  if (remaining) words.push(small[remaining]!);
  return words.join(' ');
}
