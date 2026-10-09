/**
 * Datele firmei pentru antetul bonului de ieșire — UN SINGUR LOC de completat.
 *
 * Înlocuiți valorile dintre [paranteze drepte] cu datele reale.
 * Un câmp lăsat gol ('') nu apare pe bon.
 *
 * Imagini (opționale): puneți fișierele în `client/public/bon/` cu exact aceste nume.
 * Dacă un fișier lipsește, bonul se generează normal, fără imaginea respectivă.
 *   - logo.png       sigla firmei (PNG sau JPG, ideal fundal transparent, ~600 px lățime)
 *   - stampila.png   ștampila firmei (PNG cu fundal transparent, ~400×400 px)
 */
export interface CompanyInfo {
  /** rând mic deasupra numelui (opțional) */
  tagline?: string;
  name: string;
  cui: string;
  regCom: string;
  address: string;
  phone: string;
  web?: string;
  email: string;
  /** cale publică spre siglă (sau '' ca să nu se încerce deloc) */
  logoUrl: string;
  /** cale publică spre ștampilă (sau '' ca să nu se încerce deloc) */
  stampUrl: string;
}

// Date confirmate de Lily (09.10.2026); CUI și Reg. Com. corespund cu ANAF.
export const COMPANY: CompanyInfo = {
  tagline: 'ECHIPA MUTANȚII',
  name: 'SC MUTANTII SRL',
  cui: 'RO21947113',
  regCom: 'J2007002736124',
  address: 'Str. Câmpului 312, Cluj-Napoca',
  phone: '0727 240356 / 0746 089696',
  web: 'mutantii.ro',
  email: '',
  logoUrl: '/bon/logo.png',
  stampUrl: '/bon/stampila.png',
};

/** true dacă mai există valori de completat (între [ ]). */
export function companyHasPlaceholders(c: CompanyInfo = COMPANY): boolean {
  return [c.tagline ?? '', c.name, c.cui, c.regCom, c.address, c.phone, c.web ?? '', c.email].some((v) => /^\[.*\]$/.test(v.trim()));
}
