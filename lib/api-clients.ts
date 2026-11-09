export type ClientRecord = Record<string, string>;
export type ClientSnapshot = { records: ClientRecord[]; updatedAt: string; source: string };
export const CLIENT_KEY = 'crm:api-clients:v1';
export function validateClients(value: unknown): ClientRecord[] {
  if (!Array.isArray(value) || !value.length || value.length > 5000) throw new Error('Expected 1–5000 applications.');
  const seen = new Set<string>();
  return value.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid record.');
    const record: ClientRecord = {};
    for (const [key, field] of Object.entries(row)) {
      if (key.length > 100 || typeof field !== 'string' || field.length > 30000) throw new Error('Invalid field.');
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid field name.');
      record[key] = field;
    }
    const id = record['Request No.']?.trim();
    if (!id || !record.Status?.trim() || !record['Legal Entity Name']?.trim()) throw new Error('Required: Request No., Status, Legal Entity Name.');
    if (seen.has(id)) throw new Error(`Duplicate application: ${id}`);
    seen.add(id); record['Request No.'] = id;
    return record;
  });
}

export function clientsFromRows(rows:string[][]):ClientRecord[] {
  const headers=Array.from(rows[0]??[],value=>String(value??'').trim());
  if (!headers.length || headers.some(value=>!value) || new Set(headers).size!==headers.length) {
    throw new Error('Excel headers must be non-empty and unique.');
  }
  return validateClients(rows.slice(1).filter(row=>row.some(value=>value.trim())).map(row=>
    Object.fromEntries(headers.map((header,index)=>[header,row[index]??'']))));
}
export async function clientResponse(request: Request, store: KVNamespace): Promise<Response> {
  if (request.method === 'GET') return Response.json(await store.get(CLIENT_KEY, 'json') ?? { records: [], updatedAt: '', source: '' });
  if (request.method !== 'POST') return new Response('Method not allowed', {status:405});
  if (request.headers.get('Origin') !== new URL(request.url).origin) return new Response('Forbidden', {status:403});
  try {
    const reader = request.body?.getReader(); let text = '', size = 0; const decoder = new TextDecoder();
    if (reader) while (true) { const {value, done} = await reader.read(); if (done) break; size += value.byteLength; if (size > 2_000_000) { await reader.cancel(); return new Response('File too large', {status:413}); } text += decoder.decode(value, {stream:true}); }
    text += decoder.decode();
    const input = JSON.parse(text); const incoming = validateClients(input.records);
    const previous = await store.get<ClientSnapshot>(CLIENT_KEY, 'json');
    const merged = new Map((previous?.records ?? []).map(row => [row['Request No.'], row]));
    incoming.forEach(row => merged.set(row['Request No.'], row));
    const snapshot: ClientSnapshot = { records: [...merged.values()], updatedAt: new Date().toISOString(), source: String(input.source ?? 'Excel import').slice(0,200) };
    if (snapshot.records.length > 5000) throw new Error('Maximum 5000 applications.');
    if (previous) await store.put(`${CLIENT_KEY}:previous`, JSON.stringify(previous));
    await store.put(CLIENT_KEY, JSON.stringify(snapshot));
    return Response.json(snapshot);
  } catch (error) { return Response.json({error: error instanceof Error ? error.message : 'Import failed'}, {status:400}); }
}
