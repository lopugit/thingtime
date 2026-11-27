/** Pin-first pagination keeps both growing partitions reachable. Old plain
 * chronological cursors continue directly in the ordinary-post partition. */
export async function readPinnedFirstPage<T extends {createdAt: Date | string;shareId:string},C>(
  read:(pinned:boolean,cursor:C|null,count:number)=>Promise<T[]>,
  parse:(encoded:string)=>C|null,rawCursor:string,limit:number
):Promise<{page:T[];nextCursor:string|null}|null> {
  const pinnedPhase=!rawCursor||rawCursor.startsWith('pin:');
  const encoded=rawCursor.startsWith('pin:')||rawCursor.startsWith('post:')?rawCursor.slice(rawCursor.indexOf(':')+1):rawCursor;
  const cursor=encoded&&encoded!=='start'?parse(encoded):null;
  if(encoded&&encoded!=='start'&&!cursor)return null;
  let page:T[]=[],nextCursor:string|null=null;
  const encode=(doc:T)=>`${new Date(doc.createdAt).getTime()}_${doc.shareId}`;
  if(pinnedPhase){
    const pins=await read(true,cursor,limit+1);
    page=pins.slice(0,limit);
    if(pins.length>limit)nextCursor=`pin:${encode(page[page.length-1])}`;
  }
  if(!nextCursor){
    const remaining=limit-page.length;
    const ordinary=await read(false,!pinnedPhase?cursor:null,remaining+1);
    const selected=ordinary.slice(0,remaining);
    page.push(...selected);
    if(ordinary.length>remaining)nextCursor=selected.length?`post:${encode(selected[selected.length-1])}`:'post:start';
  }
  return {page,nextCursor};
}
