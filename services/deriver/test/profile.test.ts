import { describe, expect, it } from 'vitest';

import { summarise } from '../src/profile';

describe('summarise', () => {
  it('averages each step and lists the slowest first, with its share of the total', () => {
    const out = summarise([
      { download: 1000, derive_all: 6000, total: 10000 },
      { download: 3000, derive_all: 8000, total: 12000 },
    ]);
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^total\s+11000 ms/);
    expect(lines[1]).toMatch(/^derive_all\s+7000 ms\s+64%/);
    expect(lines[2]).toMatch(/^download\s+2000 ms\s+18%/);
  });
});
