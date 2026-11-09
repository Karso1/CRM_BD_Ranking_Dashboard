import { unzipSync, strFromU8 } from 'fflate';
import { clientsFromRows, type ClientRecord } from './api-clients';
export async function readClientXlsx(file: File): Promise<ClientRecord[]> {
 if(file.size > 2_000_000) throw new Error('Excel must be under 2 MB.');
 let expanded=0,entries=0;
 const files=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:entry=>{
  expanded+=entry.originalSize;entries++;
  if(expanded>32_000_000||entries>512)throw new Error('Excel contents are too large.');
  return entry.name.startsWith('xl/')&&entry.name.endsWith('.xml')||entry.name==='xl/_rels/workbook.xml.rels';
 }});
 const xml=(path:string)=>{if(!files[path])throw new Error('Invalid Excel workbook.');const doc=new DOMParser().parseFromString(strFromU8(files[path]),'application/xml');if(doc.getElementsByTagName('parsererror').length)throw new Error('Invalid Excel XML.');return doc;};
 const shared=files['xl/sharedStrings.xml']?Array.from(xml('xl/sharedStrings.xml').getElementsByTagName('si')).map(si=>Array.from(si.getElementsByTagName('t')).map(t=>t.textContent??'').join('')):[];
 const book=xml('xl/workbook.xml'),relId=book.getElementsByTagName('sheet')[0]?.getAttribute('r:id');
 const target=Array.from(xml('xl/_rels/workbook.xml.rels').getElementsByTagName('Relationship')).find(r=>r.getAttribute('Id')===relId)?.getAttribute('Target');
 if(!target)throw new Error('Worksheet not found.');
 const path=target.startsWith('/')?target.slice(1):`xl/${target.replace(/^\.\//,'')}`;
 const rows=Array.from(xml(path).getElementsByTagName('row')).map(row=>{const values:string[]=[];for(const cell of Array.from(row.getElementsByTagName('c'))){const ref=cell.getAttribute('r')??'A1';let col=0;for(const char of ref.replace(/[0-9]/g,''))col=col*26+char.charCodeAt(0)-64;const v=cell.getElementsByTagName('v')[0]?.textContent??'';values[col-1]=cell.getAttribute('t')==='s'?shared[Number(v)]??'':cell.getAttribute('t')==='inlineStr'?Array.from(cell.getElementsByTagName('t')).map(t=>t.textContent??'').join(''):v;}return values;});
 return clientsFromRows(rows);
}
