import { describe, expect, it } from 'vitest';
import { boardSeed, scheduleFor, scheduleTable } from './matchSchedule';

describe('复式轮转表', () => {
  it('庄家按 N/E/S/W 循环', () => {
    expect(scheduleFor(1).dealer).toBe('N');
    expect(scheduleFor(2).dealer).toBe('E');
    expect(scheduleFor(3).dealer).toBe('S');
    expect(scheduleFor(4).dealer).toBe('W');
    expect(scheduleFor(5).dealer).toBe('N');
  });

  it('16 副表覆盖四个局况且可循环', () => {
    const table = scheduleTable(16);
    expect(table).toHaveLength(16);
    expect(new Set(table.map((b) => b.vulnerability))).toEqual(new Set(['none', 'NS', 'EW', 'both']));
    expect(scheduleFor(17)).toEqual({ ...scheduleFor(1), index: 17 });
    expect(scheduleFor(18)).toEqual({ ...scheduleFor(2), index: 18 });
  });

  it('12/18/24 副按顺序截取', () => {
    expect(scheduleTable(12).map((b) => b.index)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    expect(scheduleFor(24).dealer).toBe(scheduleFor(8).dealer);
  });

  it('非整数/越界输入被归一化', () => {
    expect(scheduleFor(0).index).toBe(1);
    expect(scheduleFor(-3).index).toBe(1);
    expect(scheduleFor(2.9).index).toBe(2);
  });
});

describe('每副种子派生', () => {
  it('同一种子基值 + 副号可复现', () => {
    expect(boardSeed(12345, 3)).toBe(boardSeed(12345, 3));
  });

  it('不同副号/种子基值产生不同种子', () => {
    const seeds = new Set(
      Array.from({ length: 24 }, (_, i) => boardSeed(20261101, i + 1)),
    );
    expect(seeds.size).toBe(24);
    expect(boardSeed(1, 1)).not.toBe(boardSeed(2, 1));
  });

  it('结果为 32 位无符号整数', () => {
    const seed = boardSeed(0xffffffff, 24);
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 32);
  });
});
