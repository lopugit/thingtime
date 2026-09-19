// Synthetic transport with real post/media UI. No account data is changed.
import React from 'react';
import { ThingtimeContext } from '../app/Providers/ThingtimeProvider';
import { Subject } from 'rxjs';
const everything = { events: new Subject(), thingtime: {}, getThing: () => undefined } as any;
import { createRoot } from 'react-dom/client';
import { ChakraProvider, Box, Text } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { PostCard } from '../app/components/Feed/PostCard';
import { SharedMediaProvider } from '../app/components/Sharing/SharedMedia';
import type { PublicPost } from '../app/components/Feed/feedTypes';
const author = { id: 'owner', username: 'author', displayName: 'Audience QA', avatarUrl: null };
const base: PublicPost = {
 id: 'parent', thingtime: ['post'], type: 'text', author, visibility: 'hidden', acl: ['tt:hidden', 'tt:user'], linkKey: 'fixture-secret',
 text: 'Secret-link post with a nested comment gallery', images: [], attachments: [], mediaLayout: null, listing: null, thing: null,
 tags: [], reactionCounts: {}, viewerReactions: [], commentCount: 1, shareCount: 0, isShare: false, shareOf: null,
 createdAt: new Date().toISOString(), comments: [{id:'comment',thingtime:['post','comment'],author,type:'text',text:'Nested media inherits the secret link',images:[],attachments:[
 {id:'photo', name:'Nested photo', contentType:'image/png', mediaKind:'image',size:1,url:`${location.origin}/scripts/media-gallery-photo.svg`},
 {id:'video', name:'Nested video', contentType:'video/webm', mediaKind:'video',size:1,url:`${location.origin}/scripts/media-gallery-fixture.webm`}
 ],mediaLayout:null,listing:null,thing:null,tags:[],reactionCounts:{},viewerReactions:[],commentCount:0,targetId:'parent',createdAt:new Date().toISOString()}]
};
const media = {...base,id:'video',thingtime:['attachment'],acl:['tt:inherit'],linkKey:undefined,
 audience:{sourceId:'parent',acl:['tt:hidden','tt:user'],linkKey:'fixture-secret'},text:'Standalone inherited video',comments:[],commentCount:0,attachments:base.comments[0].attachments.slice(1)};
window.fetch = async () => new Response(JSON.stringify({ok:true,schemaVersion:1,origin:location.origin,features:{'api.things':{version:'1.21.0'},'api.attachment-content':{version:'1.8.1'}},thing:media,post:media}),{headers:{'Content-Type':'application/json'}});
const shareListeners = new Set<(value: string) => void>();
const auditShare = async (value: string) => { for (const listener of shareListeners) listener(value); };
Object.defineProperty(navigator, 'share', {configurable:true,value:({url}: {url:string})=>auditShare(url)});
Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:auditShare}});
function App() { const [shared,setShared]=React.useState('No link copied yet'); React.useEffect(()=>{shareListeners.add(setShared);return()=>{shareListeners.delete(setShared);};},[]); return <Box maxW="700px" mx="auto" p={4} display="flex" flexDirection="column" gap={6}>
<Text>Synthetic inherited audience QA — real PostCard, comments, galleries and menus</Text>
<PostCard post={base} defaultCommentsOpen />
<SharedMediaProvider linkKey="fixture-secret"><PostCard post={media} mediaThing /></SharedMediaProvider>
<PostCard post={{...base,id:'mixed',visibility:'custom',linkKey:undefined,acl:['tt:custom','tt:user/username','tt:user/username2','tt:user/an_exceptionally_long_username','tt:group/family','tt:hidden'],text:'Mixed audience with a long explanation',comments:[],commentCount:0}} />
<Text role="status" overflowWrap="anywhere">{shared}</Text></Box>; }
createRoot(document.getElementById('root')!).render(<ChakraProvider><ThingtimeContext.Provider value={{Everything:everything}}><RouterProvider router={createMemoryRouter([{path:'*',id:'root',element:<App/>}])}/></ThingtimeContext.Provider></ChakraProvider>);
