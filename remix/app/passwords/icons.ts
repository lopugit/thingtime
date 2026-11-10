/** Explicit icons override automatic Website presentation. */
export type PasswordIcon = { kind: 'url'; url: string } | { kind: 'attachment'; fileId: string };
export const PASSWORD_ICON_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon'];
export function passwordIconUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value).some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) throw new Error('Choose an HTTPS icon URL without credentials.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Choose an HTTPS icon URL without credentials.'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error('Choose an HTTPS icon URL without credentials.');
  return url.href;
}
export function validatePasswordIcon(value: unknown): PasswordIcon {
  const icon = value as PasswordIcon;
  if (icon?.kind === 'url') return { kind: 'url', url: passwordIconUrl(icon.url) };
  if (icon?.kind === 'attachment' && typeof icon.fileId === 'string' && /^att_[a-f0-9]{64}$/.test(icon.fileId)) return { kind: 'attachment', fileId: icon.fileId };
  throw new Error('Choose an uploaded icon or an HTTPS icon URL.');
}
export function passwordWebsiteIcon(value: string): PasswordIcon {
  const website = new URL(passwordIconUrl(value));
  return { kind: 'url', url: new URL('/favicon.ico', website.origin).href };
}

/** Only declared, unconcealed URL fields participate. Preserve saved order and
 * discard credentials, paths, queries and fragments before presentation lookup. */
export function passwordWebsiteOrigins(entry:{fields:{type:string;value:string;concealed?:boolean;structured?:boolean}[]}):string[]{
  const origins=new Set<string>();
  for(const field of entry.fields){
    if(field.type!=='url'||field.concealed||field.structured)continue;
    try{const url=new URL(field.value);if(url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443'))origins.add(url.origin);}catch{}
  }
  return [...origins];
}

/** Deterministic raster admission shared by the server and transient adapter.
 * Unknown formats, including SVG, never enter an automatic raster loader. */
export function passwordRasterIconFormat(bytes:Uint8Array):'png'|'jpeg'|'gif'|'webp'|'ico'|null{
 const text=(from:number,to:number)=>String.fromCharCode(...bytes.slice(from,to));
 if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))return 'png';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpeg';
 if(/^GIF8[79]a$/.test(text(0,6)))return 'gif';
 if(text(0,4)==='RIFF'&&text(8,12)==='WEBP')return 'webp';
 if(bytes.length>=6&&bytes[0]===0&&bytes[1]===0&&bytes[2]===1&&bytes[3]===0)return 'ico';
 return null;
}
