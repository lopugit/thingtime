import { describe, expect, it } from 'vitest';
import { calculatorSearchHit, evaluateExpression } from './calculator.js';

const settings = { enabled: true, maxDecimalPlaces: 10 } as const;

describe('safe automatic calculator', () => {
  it('evaluates arithmetic precedence, parentheses, powers, and unary operators', () => {
    expect(evaluateExpression('256*2', settings)).toEqual({
      expression: '256*2',
      result: '512',
      label: 'Product',
      resultWords: 'Five Hundred Twelve',
    });
    expect(evaluateExpression('2 + 3 * 4', settings)?.result).toBe('14');
    expect(evaluateExpression('(2 + 3)^2', settings)?.result).toBe('25');
    expect(evaluateExpression('-2^2', settings)?.result).toBe('-4');
    expect(evaluateExpression('2**3**2', settings)?.result).toBe('512');
  });

  it('supports percentages, common functions, constants, factorials, and multiplication glyphs', () => {
    expect(evaluateExpression('100 + 10%', settings)?.result).toBe('110');
    expect(evaluateExpression('200 * 15%', settings)?.result).toBe('30');
    expect(evaluateExpression('sqrt(81) + sin(0)', settings)?.result).toBe('9');
    expect(evaluateExpression('2pi', settings)?.result).toBe('6.2831853072');
    expect(evaluateExpression('5!', settings)?.result).toBe('120');
    expect(evaluateExpression('256×2', settings)?.result).toBe('512');
    expect(evaluateExpression('1,000 + 25', settings)?.result).toBe('1025');
  });

  it('formats floating-point noise using the configured maximum decimal places', () => {
    expect(evaluateExpression('0.1 + 0.2', settings)?.result).toBe('0.3');
    expect(evaluateExpression('1 / 3', { enabled: true, maxDecimalPlaces: 4 })?.result).toBe('0.3333');
    expect(evaluateExpression('1 / 3', { enabled: true, maxDecimalPlaces: 0 })?.result).toBe('0');
  });

  it('only activates for complete, finite, bounded expressions', () => {
    expect(evaluateExpression('256', settings)).toBeNull();
    expect(evaluateExpression('256*', settings)).toBeNull();
    expect(evaluateExpression('2026-08-22', settings)).toBeNull();
    expect(evaluateExpression('22/08/2026', settings)).toBeNull();
    expect(evaluateExpression('Commander 256*2', settings)).toBeNull();
    expect(evaluateExpression('1 / 0', settings)).toBeNull();
    expect(evaluateExpression('sqrt(-1)', settings)).toBeNull();
    expect(evaluateExpression('('.repeat(40) + '1+1' + ')'.repeat(40), settings)).toBeNull();
    expect(evaluateExpression('1+1', { enabled: false, maxDecimalPlaces: 10 })).toBeNull();
    expect(evaluateExpression('=42', settings)?.result).toBe('42');
  });

  it('creates a leading result with explicit copy actions', () => {
    expect(calculatorSearchHit('6*7', settings)).toMatchObject({
      id: 'builtin:calculator:result',
      kind: 'calculator',
      title: '42',
      calculation: { expression: '6*7', result: '42', label: 'Product' },
      actions: [
        { id: 'copy-result', title: 'Copy Answer' },
        { id: 'copy-expression', title: 'Copy Expression' },
      ],
    });
  });
});
