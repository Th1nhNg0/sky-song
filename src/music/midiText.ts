/**
 * MIDI text meta events are commonly decoded as Latin-1. Keep exported names
 * ASCII so DAWs and other parsers show readable instrument/part labels.
 */
export function midiSafeText(value: string): string {
  const replacements: Record<string, string> = {
    '·': '-',
    '—': '-',
    '–': '-',
    '’': "'",
    '‘': "'",
    '“': '"',
    '”': '"',
    '♭': 'b',
    '♯': '#',
    '×': 'x',
    '…': '...',
  };
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, (char) => replacements[char] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}
