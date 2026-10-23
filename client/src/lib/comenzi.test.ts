import { describe, expect, it } from 'vitest';
import {
  destinationLabel,
  destinations,
  exportRows,
  filterComenzi,
  groupComenzi,
  requesterLabel,
  roDate,
  statusCounts,
  type ComandaRow,
} from './comenzi';

const row = (o: Partial<ComandaRow>): ComandaRow => ({
  ticket_id: 1,
  ticket_code: 'T-A',
  status: 'ORDERED',
  client_name: 'Andrei Pop',
  created_by: 'BT',
  created_at: '2026-10-20 08:00:00',
  closed_at: null,
  line_id: 1,
  ordered_qty: 1,
  name: 'SCAUN OPERATIONAL MIRO',
  barcode: '1225859',
  mijloc_fix: '000001091229',
  delivery_address: 'Str. Aurel Vlaicu 80',
  delivery_locality: 'Cluj-Napoca',
  recipient: 'Maria Ionescu',
  ...o,
});

const rows = [
  row({}),
  row({ line_id: 2, name: 'Birou ȘEF', barcode: '0001234' }),
  row({ ticket_id: 2, ticket_code: 'T-B', line_id: 3, status: 'CLOSED', closed_at: '2026-10-21 21:30:00', delivery_address: 'Traian Moșoiu Corp B', delivery_locality: 'Cluj-Napoca' }),
  row({ ticket_id: 3, ticket_code: 'T-C', line_id: 4, status: 'SENT', client_name: 'Ioana', created_by: 'Andrei.Pop', delivery_address: null, delivery_locality: 'Turda' }),
];

describe('Comenzi', () => {
  it('labels destination and requester', () => {
    expect(destinationLabel(rows[0])).toBe('Str. Aurel Vlaicu 80, Cluj-Napoca');
    expect(destinationLabel(rows[3])).toBe('Turda');
    expect(destinationLabel({ delivery_address: null, delivery_locality: null })).toBe('—');
    expect(destinationLabel({ delivery_address: 'Cluj-Napoca, str. X', delivery_locality: 'Cluj-Napoca' })).toBe('Cluj-Napoca, str. X');
    expect(requesterLabel(rows[0])).toBe('Andrei Pop (BT)');
    expect(requesterLabel({ client_name: 'BT', created_by: 'bt' })).toBe('BT');
  });

  it('search is accent/case-insensitive across ticket, product, code, destination, requester', () => {
    const f = (query: string) => filterComenzi(rows, { statuses: [], destination: '', query }).map((r) => r.line_id);
    expect(f('birou sef')).toEqual([2]);
    expect(f('mosoiu')).toEqual([3]);
    expect(f('t-c')).toEqual([4]);
    expect(f('1234')).toEqual([2]); // fără zerourile din față
    expect(f('ioana turda')).toEqual([4]);
    expect(f('andrei.pop')).toEqual([4]);
  });

  it('filters by several statuses and by destination; closed tickets included', () => {
    expect(filterComenzi(rows, { statuses: ['CLOSED', 'SENT'], destination: '', query: '' }).map((r) => r.line_id)).toEqual([3, 4]);
    expect(filterComenzi(rows, { statuses: [], destination: 'Turda', query: '' }).map((r) => r.line_id)).toEqual([4]);
    expect(destinations(rows)).toEqual(['Str. Aurel Vlaicu 80, Cluj-Napoca', 'Traian Moșoiu Corp B, Cluj-Napoca', 'Turda']);
  });

  it('counts tickets and lines per status, in flow order', () => {
    const c = statusCounts(rows);
    expect(c.map((x) => x.status)).toEqual(['ORDERED', 'NEEDS_FIX', 'SENT', 'DELIVERED', 'RETURNING', 'CLOSED']);
    expect(c[0]).toMatchObject({ label: 'Comandat', tickets: 1, lines: 2 });
    expect(c[5]).toMatchObject({ label: 'Închis', tickets: 1, lines: 1 });
  });

  it('groups by status (flow order) or by ticket, with counts', () => {
    const byStatus = groupComenzi(rows, 'status');
    expect(byStatus.map((g) => [g.title, g.tickets, g.rows.length])).toEqual([
      ['Comandat', 1, 2],
      ['Trimis', 1, 1],
      ['Închis', 1, 1],
    ]);
    const byTicket = groupComenzi(rows, 'ticket');
    expect(byTicket.map((g) => [g.title, g.rows.length])).toEqual([
      ['T-A', 2],
      ['T-B', 1],
      ['T-C', 1],
    ]);
  });

  it('shows dates in Romanian time and exports the filtered rows', () => {
    expect(roDate('2026-10-21 21:30:00')).toBe('22.10.2026');
    expect(roDate(null)).toBe('—');
    const e = exportRows([rows[2]]);
    expect(e[0]).toEqual(['T-B', 'Închis', 'SCAUN OPERATIONAL MIRO', '1225859', 1, '20.10.2026', 'Traian Moșoiu Corp B, Cluj-Napoca', 'Andrei Pop (BT)', '22.10.2026']);
  });
});
