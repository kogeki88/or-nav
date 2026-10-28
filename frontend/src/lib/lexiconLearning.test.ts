import { describe, it, expect } from 'vitest';
import { titleCaseTerm } from './lexiconLearning';

describe('titleCaseTerm', () => {
  it('should title case a single lowercase word', () => {
    expect(titleCaseTerm('apple')).toBe('Apple');
  });

  it('should title case multiple lowercase words', () => {
    expect(titleCaseTerm('adson pickups')).toBe('Adson Pickups');
  });

  it('should correctly handle mixed case words', () => {
    expect(titleCaseTerm('mIxTer clAmPs')).toBe('Mixter Clamps');
  });

  it('should preserve formatting if already title cased', () => {
    expect(titleCaseTerm('Rat Tooth')).toBe('Rat Tooth');
  });

  it('should correctly handle uppercase words', () => {
    expect(titleCaseTerm('FORCEPS')).toBe('Forceps');
  });

  it('should handle single character strings', () => {
    expect(titleCaseTerm('a')).toBe('A');
    expect(titleCaseTerm('X')).toBe('X');
  });

  it('should remove extra whitespace between words', () => {
    expect(titleCaseTerm('  rat   tooth  ')).toBe('Rat Tooth');
  });

  it('should handle empty strings', () => {
    expect(titleCaseTerm('')).toBe('');
  });

  it('should handle strings with non-alphabet characters', () => {
    expect(titleCaseTerm('1x2 pickups')).toBe('1x2 Pickups');
    expect(titleCaseTerm('right-angle clamp')).toBe('Right-angle Clamp');
  });

  it('should handle whitespace only strings', () => {
    expect(titleCaseTerm('   ')).toBe('');
  });
});
