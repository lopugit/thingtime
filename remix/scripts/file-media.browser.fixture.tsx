import { WebpageBlocksRenderer } from '../app/components/Builder/WebpageBlocksRenderer';
import { pdfViewerBlocks } from '../app/components/Attachments/pdfPresentation';
import { ThingtimeContext } from '../app/Providers/ThingtimeProvider';
import { Subject } from 'rxjs';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ChakraProvider } from '@chakra-ui/react';
import { ThingFilePreview } from '../app/components/Things/ThingFilePreview';
import { PdfViewer } from '../app/components/Attachments/PdfDocument';
import { SharedMediaProvider } from '../app/components/Sharing/SharedMedia';
import { CharacterScope } from '../app/components/Characters/CharacterScope';
import { ThingsGridView } from '../app/components/Things/ThingsViews';
const events = new Subject();
const version = 'a'.repeat(64), mode = new URLSearchParams(location.search).get('mode');
const file = { id: 'image-file', thingtime: ['file'], crystal: { name: 'Synchronized image.png', trashed: false, content: { attachmentId: 'image-attachment', version, size: 6308 } }, visibility: 'private', tags: [], author: { id: 'fixture-owner' }, createdAt: '', updatedAt: '' };
const pdf = { id: 'pdf-attachment', name: 'Two pages.pdf', contentType: 'application/octet-stream', detectedContentType: 'application/pdf', mediaKind: 'file' as const, size: Number(new URLSearchParams(location.search).get('size')) };
function Fixture() {
 const [editing, setEditing] = React.useState(false), [selected, setSelected] = React.useState<string | null>(null);
 const [blocks, setBlocks] = React.useState<any[]>(() => JSON.parse(localStorage.getItem('pdf-fixture-blocks') || 'null') || pdfViewerBlocks(pdf));
 const find = (rows: any[]): any => rows.map(row => row.id === selected ? row : find(row.children || [])).find(Boolean);
 const update = (rows: any[], text: string): any[] => rows.map(row => row.id === selected ? { ...row, text } : { ...row, ...(row.children ? { children: update(row.children, text) } : {}) });
 const [displayMode, setDisplayMode] = React.useState<'name' | 'preview'>('name');
 return <ThingtimeContext.Provider value={{ Everything: { thingtime: {}, events } } as any}><CharacterScope.Provider value={{ id: 'fixture-owner' } as any}><SharedMediaProvider><main style={{ maxWidth: 860, margin: '20px auto', padding: 16 }}>
  <h1>File media regression fixture</h1><button onClick={() => setDisplayMode(v => v === 'name' ? 'preview' : 'name')}>Switch previews</button>
  <section aria-label="Default names grid"><ThingsGridView items={[file] as any} handlers={{ selected: new Set(), cutIds: new Set(), onAction: () => {}, onToggleSelect: () => {}, onItemContextMenu: () => {}, onOpen: () => {}, onClick: () => {} } as any} displayMode={displayMode} /></section>
  <section aria-label="Full image preview"><ThingFilePreview thing={file} /></section>
  <section aria-label="PDF preview">{mode === 'stale' ? <PdfViewer attachment={pdf} version={'b'.repeat(64)} /> : <>
    <button onClick={() => setEditing(v => !v)}>Edit PDF blocks</button>
    {editing && <><output aria-label="Selected block">{selected}</output><input aria-label="Selected block text" value={find(blocks)?.text || ''} onChange={event => setBlocks(rows => update(rows, event.target.value))} /><button onClick={() => { localStorage.setItem('pdf-fixture-blocks', JSON.stringify(blocks)); setEditing(false); }}>Save PDF blocks</button></>}
    <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} interactive chrome={editing ? { seamlessMode: 'builder', hoverId: null, selectedId: selected, onHover: () => {}, onSelect: setSelected, onInsert: () => {}, onMove: () => {} } : null} />
   </>}</section>
  <footer style={{ marginTop: 30 }}>End of fixture</footer>
 </main></SharedMediaProvider></CharacterScope.Provider></ThingtimeContext.Provider>;
}
const router = createBrowserRouter([{ id: 'root', path: '*', element: <Fixture /> }], { hydrationData: { loaderData: { root: { user: { id: 'fixture-owner', accountKind: 'user' }, dataPlane: 'home' } } } });
createRoot(document.getElementById('root')!).render(<ChakraProvider><RouterProvider router={router} /></ChakraProvider>);
