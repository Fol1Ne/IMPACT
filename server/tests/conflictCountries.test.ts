import { describe, expect, it } from 'vitest';
import { countryCodeFromWikiName, parseWikiConflictFlags, toConflictCountries } from '../src/services/conflictCountries';

const SAMPLE = `
{| class="wikitable sortable" id="conflicts10000"
|-
! Location
| {{flag|Ukraine}} {{flag|Russia}} {{flag|Palestine}} {{flag|DR Congo}} {{flag|Sahrawi Republic}}
|}
`.repeat(8);

describe('Wikipedia conflict-country parsing', () => {
  it('maps flag templates to ISO codes and skips names it cannot resolve', () => {
    expect(countryCodeFromWikiName('Ukraine')).toBe('UA');
    expect(countryCodeFromWikiName('DR Congo')).toBe('CD');
    expect(countryCodeFromWikiName('Ivory Coast')).toBe('CI');
    expect(countryCodeFromWikiName('Sahrawi Republic')).toBeNull();
    const { flags, unmapped } = parseWikiConflictFlags(SAMPLE);
    expect(flags.map((f) => f.iso2)).toEqual(['CD', 'PS', 'RU', 'UA']);
    expect(unmapped).toEqual(['Sahrawi Republic']);
    expect(toConflictCountries(flags).map((c) => c.name)).toContain('Ukraine');
  });
  it('does not invent countries that are not in the wikitext', () => {
    const { flags } = parseWikiConflictFlags(`${'x'.repeat(40)}{{flag|Sudan}}`);
    expect(flags.map((f) => f.iso2)).toEqual(['SD']);
  });
});
