import React from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import WebPlatformSurface from '../../app/webPlatform/WebPlatformSurface';
import { mediaConversionProgram } from './programFixture';
import { mediaCompressorTemplate } from './authoredFixture';
import { WebpageBlocksRenderer } from '../../app/components/Builder/WebpageBlocksRenderer';
import { templateToBlocks } from '../../app/components/Builder/templateBlocks';
import { ChakraProvider } from '@chakra-ui/react';

const program = mediaConversionProgram();
let sequence=0;
const blocks=templateToBlocks(mediaCompressorTemplate(),kind=>`${kind}-${++sequence}`);
const router = createMemoryRouter([{
 id:'root',path:'/',loader:()=>({user:null}), Component:()=> <main style={{maxWidth:900,margin:'0 auto',padding:'24px 16px',boxSizing:'border-box'}}>
  {location.search.includes('legacy') ? <><h1>{program.title}</h1><p>{program.description}</p><WebPlatformSurface program={program} name="program" /></> :
   <><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} interactive={true} />{location.search.includes('duplicate') && <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} interactive={true} />}</>}
 </main>
}]);
createRoot(document.getElementById('root')!).render(<ChakraProvider><RouterProvider router={router} /></ChakraProvider>);
